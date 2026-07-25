use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

use super::providers::{build_launch_spec, parse_provider_line, AgentProvider, ProviderEvent};

#[derive(Default)]
pub struct OrchestrationRuntime {
    active: Mutex<HashMap<String, u32>>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDiscoveryInput {
    pub claude_path: Option<String>,
    pub codex_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRuntimeStatus {
    pub provider: AgentProvider,
    pub available: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentInput {
    pub run_id: String,
    pub provider: AgentProvider,
    pub provider_path: String,
    pub cwd: String,
    pub prompt: String,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"-_.".contains(&character))
}

fn provider_candidates(provider: AgentProvider, configured: Option<&str>) -> Vec<PathBuf> {
    if let Some(path) = configured.filter(|path| !path.trim().is_empty()) {
        return vec![PathBuf::from(path)];
    }
    let names: &[&str] = match provider {
        AgentProvider::Claude => &["claude.ps1", "claude.exe"],
        AgentProvider::Codex => &["codex.exe"],
    };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .filter(|path| path.is_file())
        .collect()
}

fn probe_spec(provider: AgentProvider, path: &Path) -> Result<(PathBuf, Vec<String>), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if provider == AgentProvider::Claude && extension == "ps1" {
        return Ok((
            PathBuf::from("powershell.exe"),
            vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                path.to_string_lossy().into_owned(),
                "--version".into(),
            ],
        ));
    }
    if extension != "exe" {
        return Err(
            "Configured provider path must be an .exe or supported Claude .ps1 file.".into(),
        );
    }
    Ok((path.to_path_buf(), vec!["--version".into()]))
}

async fn probe_provider(
    provider: AgentProvider,
    configured: Option<&str>,
) -> ProviderRuntimeStatus {
    let Some(path) = provider_candidates(provider, configured).into_iter().next() else {
        return ProviderRuntimeStatus {
            provider,
            available: false,
            executable_path: None,
            version: None,
            reason: Some("Provider executable was not found.".into()),
        };
    };
    let Ok((executable, args)) = probe_spec(provider, &path) else {
        return ProviderRuntimeStatus {
            provider,
            available: false,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: None,
            reason: Some("Provider executable type is not supported.".into()),
        };
    };
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(executable).args(args).output(),
    )
    .await;
    match result {
        Ok(Ok(output)) if output.status.success() => ProviderRuntimeStatus {
            provider,
            available: true,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            reason: None,
        },
        Ok(Ok(output)) => ProviderRuntimeStatus {
            provider,
            available: false,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: None,
            reason: Some(
                String::from_utf8_lossy(&output.stderr)
                    .lines()
                    .next()
                    .unwrap_or("Provider health check failed.")
                    .to_string(),
            ),
        },
        Ok(Err(_)) => ProviderRuntimeStatus {
            provider,
            available: false,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: None,
            reason: Some("Provider executable could not be started.".into()),
        },
        Err(_) => ProviderRuntimeStatus {
            provider,
            available: false,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: None,
            reason: Some("Provider health check timed out.".into()),
        },
    }
}

#[tauri::command]
pub async fn orchestration_discover_providers(
    input: ProviderDiscoveryInput,
) -> Result<Vec<ProviderRuntimeStatus>, String> {
    let (claude, codex) = tokio::join!(
        probe_provider(AgentProvider::Claude, input.claude_path.as_deref()),
        probe_provider(AgentProvider::Codex, input.codex_path.as_deref())
    );
    Ok(vec![claude, codex])
}

async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    provider: AgentProvider,
    stream: &'static str,
    channel: Channel<ProviderEvent>,
) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let event = if stream == "stdout" {
            parse_provider_line(provider, &line)
        } else {
            ProviderEvent::Output {
                stream: stream.into(),
                text: line,
            }
        };
        let _ = channel.send(event);
    }
}

#[tauri::command]
pub async fn orchestration_start_agent(
    runtime: State<'_, OrchestrationRuntime>,
    input: StartAgentInput,
    on_event: Channel<ProviderEvent>,
) -> Result<(), String> {
    if !valid_identifier(&input.run_id) || input.prompt.is_empty() || input.prompt.len() > 100_000 {
        return Err("Agent run input is invalid.".into());
    }
    let cwd = PathBuf::from(&input.cwd)
        .canonicalize()
        .map_err(|_| "Agent working directory is unavailable.".to_string())?;
    if !cwd.is_dir() {
        return Err("Agent working directory is unavailable.".into());
    }
    let provider_path = PathBuf::from(&input.provider_path)
        .canonicalize()
        .map_err(|_| "Provider executable is unavailable.".to_string())?;
    let launch = build_launch_spec(input.provider, &provider_path, &cwd)?;
    let mut child = Command::new(&launch.executable)
        .args(&launch.args)
        .current_dir(&launch.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Provider executable could not be started.".to_string())?;
    let pid = child
        .id()
        .ok_or_else(|| "Provider process id is unavailable.".to_string())?;
    runtime
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(input.run_id.clone(), pid);
    let _ = on_event.send(ProviderEvent::Started {
        provider: input.provider,
    });
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.prompt.as_bytes())
            .await
            .map_err(|_| "Provider input could not be written.".to_string())?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Provider output is unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Provider output is unavailable.".to_string())?;
    let stdout_task = tokio::spawn(forward_lines(
        stdout,
        input.provider,
        "stdout",
        on_event.clone(),
    ));
    let stderr_task = tokio::spawn(forward_lines(
        stderr,
        input.provider,
        "stderr",
        on_event.clone(),
    ));
    let status = child
        .wait()
        .await
        .map_err(|_| "Provider process could not be observed.".to_string())?;
    let _ = tokio::join!(stdout_task, stderr_task);
    runtime
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&input.run_id);
    if status.success() {
        let _ = on_event.send(ProviderEvent::Completed {
            exit_code: status.code(),
        });
        Ok(())
    } else {
        let _ = on_event.send(ProviderEvent::Failed {
            message: "Provider process failed.".into(),
        });
        Err("Provider process failed.".into())
    }
}

#[tauri::command]
pub async fn orchestration_cancel_agent(
    runtime: State<'_, OrchestrationRuntime>,
    run_id: String,
) -> Result<(), String> {
    if !valid_identifier(&run_id) {
        return Err("Agent run identifier is invalid.".into());
    }
    let pid = runtime
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&run_id)
        .copied()
        .ok_or_else(|| "Agent run is not active.".to_string())?;
    #[cfg(target_os = "windows")]
    let status = Command::new("taskkill.exe")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .await;
    #[cfg(not(target_os = "windows"))]
    let status = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .await;
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err("Agent process could not be cancelled.".into()),
    }
}
