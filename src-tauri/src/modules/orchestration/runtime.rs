use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

use super::providers::{
    build_launch_spec, extract_workflow_json, parse_provider_line, AgentProvider, ProviderEvent,
};
use super::store::{ArtifactRecord, OrchestrationStore};

const MAX_LOG_BYTES: usize = 10 * 1024 * 1024;

#[derive(Default)]
pub struct OrchestrationRuntime {
    active: Mutex<HashMap<String, Vec<u32>>>,
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
pub struct PlanWorkflowInput {
    pub project_id: String,
    pub goal: String,
    pub claude_path: Option<String>,
    pub codex_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentInput {
    pub run_id: String,
    pub node_id: String,
    pub provider: AgentProvider,
    pub provider_path: String,
    pub cwd: String,
    pub prompt: String,
    pub timeout_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionResult {
    pub external_session_id: Option<String>,
    pub log_path: String,
    pub log_hash: String,
    pub exit_code: Option<i32>,
}

#[derive(Default)]
struct EventCapture {
    bytes: usize,
    lines: Vec<String>,
    external_session_id: Option<String>,
}

impl EventCapture {
    fn record(&mut self, event: &ProviderEvent) {
        match event {
            ProviderEvent::Session {
                external_session_id,
            } => self.external_session_id = Some(external_session_id.clone()),
            ProviderEvent::Output { stream, text } if self.bytes < MAX_LOG_BYTES => {
                let remaining = MAX_LOG_BYTES - self.bytes;
                let mut line = format!("[{stream}] {text}");
                if line.len() > remaining {
                    line.truncate(remaining);
                }
                self.bytes += line.len() + 1;
                self.lines.push(line);
            }
            _ => {}
        }
    }
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

fn planning_launch(
    provider: AgentProvider,
    path: &Path,
    cwd: &Path,
) -> Result<super::providers::LaunchSpec, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match provider {
        AgentProvider::Claude => {
            let mut args = Vec::new();
            let executable = if extension == "ps1" {
                args.extend([
                    "-NoProfile".into(),
                    "-NonInteractive".into(),
                    "-ExecutionPolicy".into(),
                    "Bypass".into(),
                    "-File".into(),
                    path.to_string_lossy().into_owned(),
                ]);
                PathBuf::from("powershell.exe")
            } else if extension == "exe" {
                path.to_path_buf()
            } else {
                return Err("Claude executable must be an .exe or .ps1 file.".into());
            };
            args.extend([
                "-p".into(),
                "--input-format".into(),
                "text".into(),
                "--output-format".into(),
                "json".into(),
                "--permission-mode".into(),
                "plan".into(),
            ]);
            Ok(super::providers::LaunchSpec {
                executable,
                args,
                cwd: cwd.to_path_buf(),
            })
        }
        AgentProvider::Codex => Ok(super::providers::LaunchSpec {
            executable: path.to_path_buf(),
            args: vec![
                "exec".into(),
                "--json".into(),
                "--sandbox".into(),
                "read-only".into(),
                "-".into(),
            ],
            cwd: cwd.to_path_buf(),
        }),
    }
}

fn validate_planned_workflow(value: &serde_json::Value) -> Result<(), String> {
    let nodes = value
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Planned workflow nodes are invalid.".to_string())?;
    let edges = value
        .get("edges")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Planned workflow edges are invalid.".to_string())?;
    if nodes.is_empty() || nodes.len() > 100 || edges.len() > 300 {
        return Err("The planned workflow exceeds graph limits.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for node in nodes {
        let id = node
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|id| valid_identifier(id))
            .ok_or_else(|| "A planned node identifier is invalid.".to_string())?;
        let kind = node
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if !ids.insert(id)
            || !matches!(
                kind,
                "agent" | "mcp_tool" | "approval" | "condition" | "join"
            )
        {
            return Err("A planned workflow node is invalid.".into());
        }
    }
    if edges.iter().any(|edge| {
        let source = edge.get("source").and_then(serde_json::Value::as_str);
        let target = edge.get("target").and_then(serde_json::Value::as_str);
        source.is_none_or(|id| !ids.contains(id)) || target.is_none_or(|id| !ids.contains(id))
    }) {
        return Err("A planned workflow edge is invalid.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn orchestration_plan_workflow(
    app: AppHandle,
    input: PlanWorkflowInput,
) -> Result<serde_json::Value, String> {
    if !valid_identifier(&input.project_id)
        || input.goal.trim().is_empty()
        || input.goal.len() > 20_000
    {
        return Err("Workflow planning input is invalid.".into());
    }
    let candidates = [
        (AgentProvider::Claude, input.claude_path.as_deref()),
        (AgentProvider::Codex, input.codex_path.as_deref()),
    ];
    let mut selected = None;
    for (provider, configured) in candidates {
        if let Some(path) = provider_candidates(provider, configured).into_iter().next() {
            selected = Some((provider, path));
            break;
        }
    }
    let (provider, path) =
        selected.ok_or_else(|| "No planning Provider is available.".to_string())?;
    let cwd = app
        .path()
        .app_data_dir()
        .map_err(|_| "The application data directory is unavailable.".to_string())?
        .join("planner");
    fs::create_dir_all(&cwd)
        .map_err(|_| "The planning directory could not be created.".to_string())?;
    let launch = planning_launch(provider, &path, &cwd)?;
    let prompt = format!(
        r#"Create an editable acyclic workflow DAG for this goal: {goal}
Return JSON only. Required shape: {{"name":"...","description":"...","settings":{{"maxConcurrency":2,"defaultTimeoutSeconds":1800,"defaultRetries":1}},"nodes":[{{"id":"agent-1","type":"agent","name":"...","position":{{"x":80,"y":120}},"provider":"auto","prompt":"...","skillIds":[],"mcpServerIds":[]}}],"edges":[{{"id":"edge-1","source":"agent-1","target":"approval-1"}}]}}.
Allowed node types: agent, mcp_tool, approval, condition, join. Conditions must use expression "true" or "false". No loops. Include a final approval before integration."#,
        goal = input.goal.trim()
    );
    let mut child = Command::new(launch.executable)
        .args(launch.args)
        .current_dir(launch.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "The planning Provider could not be started.".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|_| "The planning prompt could not be written.".to_string())?;
    }
    let output = tokio::time::timeout(Duration::from_secs(120), child.wait_with_output())
        .await
        .map_err(|_| "Workflow planning timed out.".to_string())?
        .map_err(|_| "The planning Provider could not be observed.".to_string())?;
    if !output.status.success() || output.stdout.len() > 2 * 1024 * 1024 {
        return Err("The planning Provider failed or returned too much output.".into());
    }
    let workflow = extract_workflow_json(&String::from_utf8_lossy(&output.stdout))?;
    validate_planned_workflow(&workflow)?;
    Ok(workflow)
}

async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    provider: AgentProvider,
    stream: &'static str,
    channel: Channel<ProviderEvent>,
    capture: Arc<Mutex<EventCapture>>,
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
        capture
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .record(&event);
        let _ = channel.send(event);
    }
}

async fn terminate_process_tree(pid: u32) -> Result<(), String> {
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

#[tauri::command]
pub async fn orchestration_start_agent(
    app: AppHandle,
    runtime: State<'_, OrchestrationRuntime>,
    store: State<'_, OrchestrationStore>,
    input: StartAgentInput,
    on_event: Channel<ProviderEvent>,
) -> Result<AgentExecutionResult, String> {
    if !valid_identifier(&input.run_id)
        || !valid_identifier(&input.node_id)
        || input.prompt.is_empty()
        || input.prompt.len() > 100_000
        || !(1..=86_400).contains(&input.timeout_seconds)
    {
        return Err("Agent run input is invalid.".into());
    }
    let cwd = PathBuf::from(&input.cwd)
        .canonicalize()
        .map_err(|_| "Agent working directory is unavailable.".to_string())?;
    if !cwd.is_dir() {
        return Err("Agent working directory is unavailable.".into());
    }
    let worktree_root = app
        .path()
        .app_data_dir()
        .map_err(|_| "The application data directory is unavailable.".to_string())?
        .join("worktrees")
        .join(&input.run_id)
        .canonicalize()
        .map_err(|_| "The run worktree is unavailable.".to_string())?;
    if !cwd.starts_with(&worktree_root)
        || cwd.file_name() != Some(std::ffi::OsStr::new(&format!("node-{}", input.node_id)))
    {
        return Err("Agent execution is restricted to its managed node worktree.".into());
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
        .entry(input.run_id.clone())
        .or_default()
        .push(pid);
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
    let capture = Arc::new(Mutex::new(EventCapture::default()));
    let stdout_task = tokio::spawn(forward_lines(
        stdout,
        input.provider,
        "stdout",
        on_event.clone(),
        capture.clone(),
    ));
    let stderr_task = tokio::spawn(forward_lines(
        stderr,
        input.provider,
        "stderr",
        on_event.clone(),
        capture.clone(),
    ));
    let (status, timed_out) = match tokio::time::timeout(
        Duration::from_secs(input.timeout_seconds),
        child.wait(),
    )
    .await
    {
        Ok(result) => (
            result.map_err(|_| "Provider process could not be observed.".to_string())?,
            false,
        ),
        Err(_) => {
            let _ = terminate_process_tree(pid).await;
            (
                child
                    .wait()
                    .await
                    .map_err(|_| "Provider process could not be observed.".to_string())?,
                true,
            )
        }
    };
    let _ = tokio::join!(stdout_task, stderr_task);
    runtime
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get_mut(&input.run_id)
        .map(|pids| pids.retain(|active_pid| *active_pid != pid));
    let (external_session_id, log) = {
        let capture = capture
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        (
            capture.external_session_id.clone(),
            capture.lines.join("\n"),
        )
    };
    let log_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "The application data directory is unavailable.".to_string())?
        .join("runs")
        .join(&input.run_id)
        .join("logs");
    fs::create_dir_all(&log_directory)
        .map_err(|_| "The run log directory could not be created.".to_string())?;
    let log_path = log_directory.join(format!("{}.log", input.node_id));
    fs::write(&log_path, log.as_bytes())
        .map_err(|_| "The run log could not be written.".to_string())?;
    let log_hash = Sha256::digest(log.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let node_run_id = format!("{}-{}", input.run_id, input.node_id);
    store
        .save_artifact(&ArtifactRecord {
            id: format!("artifact-{}-{}-log", input.run_id, input.node_id),
            run_id: input.run_id.clone(),
            node_run_id: Some(node_run_id),
            kind: "log".into(),
            path: log_path.to_string_lossy().into_owned(),
            content_hash: log_hash.clone(),
            byte_length: log.len() as i64,
        })
        .map_err(|error| error.to_string())?;
    let failure = if timed_out {
        Some("Provider process timed out.")
    } else if !status.success() {
        Some("Provider process failed.")
    } else {
        None
    };
    store
        .update_node_evidence(
            &input.run_id,
            &input.node_id,
            external_session_id.as_deref(),
            None,
            failure,
        )
        .map_err(|error| error.to_string())?;
    if failure.is_none() {
        let _ = on_event.send(ProviderEvent::Completed {
            exit_code: status.code(),
        });
        Ok(AgentExecutionResult {
            external_session_id,
            log_path: log_path.to_string_lossy().into_owned(),
            log_hash,
            exit_code: status.code(),
        })
    } else {
        let _ = on_event.send(ProviderEvent::Failed {
            message: failure.expect("failure exists").into(),
        });
        store
            .update_node_status(&input.run_id, &input.node_id, "failed", None)
            .map_err(|error| error.to_string())?;
        Err(failure.expect("failure exists").into())
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
    let pids = runtime
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&run_id)
        .ok_or_else(|| "Agent run is not active.".to_string())?;
    for pid in pids {
        terminate_process_tree(pid).await?;
    }
    Ok(())
}
