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

use super::permissions::redact;
use super::providers::{
    build_launch_spec, extract_workflow_json, parse_provider_line, AgentProvider, ProviderEvent,
};
use super::store::{ArtifactRecord, OrchestrationStore};

const MAX_LOG_BYTES: usize = 10 * 1024 * 1024;
const MAX_PROVIDER_LINE_BYTES: usize = 16 * 1024;
const MAX_PROVIDER_EVENT_COUNT: usize = 1_000;
const MAX_PROVIDER_EVENT_BYTES: usize = 1 * 1024 * 1024;
const PROVIDER_OUTPUT_TRUNCATED: &str =
    "Provider output was truncated to protect the run event stream.";

#[derive(Clone, Default)]
pub struct OrchestrationRuntime {
    active: Arc<Mutex<HashMap<String, Vec<u32>>>>,
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
    pub runtime_context_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionResult {
    pub external_session_id: Option<String>,
    pub log_path: String,
    pub log_hash: String,
    pub exit_code: Option<i32>,
}

pub(crate) type ProviderEventCallback = Arc<dyn Fn(ProviderEvent) + Send + Sync + 'static>;

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

struct EventBudget {
    max_events: usize,
    max_bytes: usize,
    events: usize,
    bytes: usize,
    exhausted: bool,
    truncation_notice_emitted: bool,
}

impl Default for EventBudget {
    fn default() -> Self {
        Self::with_limits(MAX_PROVIDER_EVENT_COUNT, MAX_PROVIDER_EVENT_BYTES)
    }
}

impl EventBudget {
    fn with_limits(max_events: usize, max_bytes: usize) -> Self {
        Self {
            max_events,
            max_bytes,
            events: 0,
            bytes: 0,
            exhausted: false,
            truncation_notice_emitted: false,
        }
    }

    fn forward(&mut self, event: ProviderEvent, line_was_truncated: bool) -> Option<ProviderEvent> {
        if self.exhausted {
            return None;
        }
        if line_was_truncated {
            return self.truncation_notice(event_stream(&event));
        }

        let event_bytes = serde_json::to_vec(&event)
            .map(|serialized| serialized.len())
            .unwrap_or(usize::MAX);
        if self.events >= self.max_events || event_bytes > self.max_bytes.saturating_sub(self.bytes)
        {
            self.exhausted = true;
            return self.truncation_notice(event_stream(&event));
        }

        self.events += 1;
        self.bytes += event_bytes;
        Some(event)
    }

    fn truncation_notice(&mut self, stream: &str) -> Option<ProviderEvent> {
        if self.truncation_notice_emitted {
            return None;
        }
        self.truncation_notice_emitted = true;
        Some(ProviderEvent::Output {
            stream: stream.into(),
            text: PROVIDER_OUTPUT_TRUNCATED.into(),
        })
    }
}

fn event_stream(event: &ProviderEvent) -> &str {
    match event {
        ProviderEvent::Output { stream, .. } => stream,
        _ => "stdout",
    }
}

struct ActiveProcessGuard {
    runtime: OrchestrationRuntime,
    run_id: String,
    pid: u32,
}

impl Drop for ActiveProcessGuard {
    fn drop(&mut self) {
        let mut active = self
            .runtime
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(pids) = active.get_mut(&self.run_id) {
            pids.retain(|active_pid| *active_pid != self.pid);
            if pids.is_empty() {
                active.remove(&self.run_id);
            }
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

fn redact_provider_event(event: ProviderEvent, secrets: &[String]) -> ProviderEvent {
    match event {
        ProviderEvent::Session {
            external_session_id,
        } => ProviderEvent::Session {
            external_session_id: redact(&external_session_id, secrets),
        },
        ProviderEvent::Output { stream, text } => ProviderEvent::Output {
            stream,
            text: redact(&text, secrets),
        },
        ProviderEvent::Approval {
            capability,
            summary,
        } => ProviderEvent::Approval {
            capability: redact(&capability, secrets),
            summary: redact(&summary, secrets),
        },
        ProviderEvent::Failed { message } => ProviderEvent::Failed {
            message: redact(&message, secrets),
        },
        event => event,
    }
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
        if !ids.insert(id) || !matches!(kind, "agent" | "approval" | "condition" | "join") {
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
Allowed node types: agent, approval, condition, join. MCP servers and Skills must be attached to Agent nodes. Conditions must use expression "true" or "false". No loops. Include a final approval before integration."#,
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

async fn next_provider_line<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> std::io::Result<Option<(String, bool)>> {
    let mut bytes = Vec::with_capacity(MAX_PROVIDER_LINE_BYTES.min(4096));
    let mut truncated = false;

    loop {
        let (consume_length, has_newline) = {
            let buffer = reader.fill_buf().await?;
            if buffer.is_empty() {
                if bytes.is_empty() && !truncated {
                    return Ok(None);
                }
                break;
            }

            let newline = buffer.iter().position(|byte| *byte == b'\n');
            let content_length = newline.unwrap_or(buffer.len());
            let captured_length =
                content_length.min(MAX_PROVIDER_LINE_BYTES.saturating_sub(bytes.len()));
            bytes.extend_from_slice(&buffer[..captured_length]);
            if captured_length < content_length {
                truncated = true;
            }
            (
                newline.map_or(buffer.len(), |index| index + 1),
                newline.is_some(),
            )
        };
        reader.consume(consume_length);
        if has_newline {
            break;
        }
    }

    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    Ok(Some((
        String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    )))
}

async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    provider: AgentProvider,
    stream: &'static str,
    on_event: ProviderEventCallback,
    capture: Arc<Mutex<EventCapture>>,
    redactions: Arc<Vec<String>>,
    budget: Arc<Mutex<EventBudget>>,
) {
    let mut reader = BufReader::new(reader);
    while let Ok(Some((line, line_was_truncated))) = next_provider_line(&mut reader).await {
        let event = if line_was_truncated {
            ProviderEvent::Output {
                stream: stream.into(),
                text: PROVIDER_OUTPUT_TRUNCATED.into(),
            }
        } else if stream == "stdout" {
            parse_provider_line(provider, &line)
        } else {
            ProviderEvent::Output {
                stream: stream.into(),
                text: line,
            }
        };
        let event = redact_provider_event(event, &redactions);
        capture
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .record(&event);
        let event = budget
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .forward(event, line_was_truncated);
        if let Some(event) = event {
            on_event(event);
        }
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

pub(crate) async fn execute_agent(
    app: AppHandle,
    runtime: OrchestrationRuntime,
    store: OrchestrationStore,
    input: StartAgentInput,
    on_event: ProviderEventCallback,
    redactions: Vec<String>,
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
    let runtime_context_path = if let Some(path) = input.runtime_context_path.as_deref() {
        let context_root = app
            .path()
            .app_data_dir()
            .map_err(|_| "The application data directory is unavailable.".to_string())?
            .join("runs")
            .join(&input.run_id)
            .join("contexts")
            .canonicalize()
            .map_err(|_| {
                "The managed Provider runtime context directory is unavailable.".to_string()
            })?;
        let runtime_context = PathBuf::from(path)
            .canonicalize()
            .map_err(|_| "The managed Provider runtime context is unavailable.".to_string())?;
        if !runtime_context.is_file() || !runtime_context.starts_with(&context_root) {
            return Err(
                "Agent execution is restricted to its managed Provider runtime context.".into(),
            );
        }
        Some(runtime_context)
    } else {
        None
    };
    let provider_path = PathBuf::from(&input.provider_path)
        .canonicalize()
        .map_err(|_| "Provider executable is unavailable.".to_string())?;
    let mut launch = build_launch_spec(input.provider, &provider_path, &cwd)?;
    if let Some(runtime_context_path) = runtime_context_path.as_ref() {
        let context: serde_json::Value =
            serde_json::from_slice(&fs::read(runtime_context_path).map_err(|_| {
                "The managed Provider runtime context could not be read.".to_string()
            })?)
            .map_err(|_| "The managed Provider runtime context is invalid.".to_string())?;
        if context
            .get("mcpServers")
            .and_then(serde_json::Value::as_object)
            .is_none()
        {
            return Err("The managed Provider runtime context is not an MCP configuration.".into());
        }
        match input.provider {
            AgentProvider::Claude => launch.args.extend([
                "--mcp-config".into(),
                runtime_context_path.to_string_lossy().into_owned(),
                "--strict-mcp-config".into(),
            ]),
            AgentProvider::Codex => {
                return Err(
                    "Codex MCP execution is unavailable because this installed Provider has no verified managed MCP configuration interface."
                        .into(),
                );
            }
        }
    }
    let mut command = Command::new(&launch.executable);
    command
        .args(&launch.args)
        .current_dir(&launch.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
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
    let active_process = ActiveProcessGuard {
        runtime: runtime.clone(),
        run_id: input.run_id.clone(),
        pid,
    };
    let redactions = Arc::new(redactions);
    on_event(redact_provider_event(
        ProviderEvent::Started {
            provider: input.provider,
        },
        &redactions,
    ));
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
    let event_budget = Arc::new(Mutex::new(EventBudget::default()));
    let stdout_task = tokio::spawn(forward_lines(
        stdout,
        input.provider,
        "stdout",
        on_event.clone(),
        capture.clone(),
        redactions.clone(),
        event_budget.clone(),
    ));
    let stderr_task = tokio::spawn(forward_lines(
        stderr,
        input.provider,
        "stderr",
        on_event.clone(),
        capture.clone(),
        redactions.clone(),
        event_budget,
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
    drop(active_process);
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
    }
    .map(|message| redact(message, &redactions));
    store
        .update_node_evidence(
            &input.run_id,
            &input.node_id,
            external_session_id.as_deref(),
            None,
            failure.as_deref(),
        )
        .map_err(|error| error.to_string())?;
    if failure.is_none() {
        on_event(redact_provider_event(
            ProviderEvent::Completed {
                exit_code: status.code(),
            },
            &redactions,
        ));
        Ok(AgentExecutionResult {
            external_session_id,
            log_path: log_path.to_string_lossy().into_owned(),
            log_hash,
            exit_code: status.code(),
        })
    } else {
        let failure_message = failure.as_deref().expect("failure exists").to_string();
        on_event(redact_provider_event(
            ProviderEvent::Failed {
                message: failure_message.clone(),
            },
            &redactions,
        ));
        let run_is_active = store
            .get_run(&input.run_id)
            .map_err(|error| error.to_string())?
            .is_some_and(|run| run.status == "running");
        if run_is_active {
            store
                .update_node_status(&input.run_id, &input.node_id, "failed", None)
                .map_err(|error| error.to_string())?;
        }
        Err(failure_message)
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
    let channel = Arc::new(Mutex::new(on_event));
    let callback: ProviderEventCallback = Arc::new(move |event| {
        let _ = channel
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .send(event);
    });
    execute_agent(
        app,
        runtime.inner().clone(),
        store.inner().clone(),
        input,
        callback,
        Vec::new(),
    )
    .await
}

#[tauri::command]
pub async fn orchestration_cancel_agent(
    runtime: State<'_, OrchestrationRuntime>,
    run_id: String,
) -> Result<(), String> {
    if !valid_identifier(&run_id) {
        return Err("Agent run identifier is invalid.".into());
    }
    let cancelled = cancel_active_agents(runtime.inner(), &run_id).await?;
    if cancelled == 0 {
        return Err("Agent run is not active.".into());
    }
    Ok(())
}

pub(crate) async fn cancel_active_agents(
    runtime: &OrchestrationRuntime,
    run_id: &str,
) -> Result<usize, String> {
    let pids = runtime
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(run_id)
        .unwrap_or_default();
    let count = pids.len();
    for pid in pids {
        terminate_process_tree(pid).await?;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_clones_share_the_active_process_registry() {
        let runtime = OrchestrationRuntime::default();
        let clone = runtime.clone();
        runtime
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry("run-1".into())
            .or_default()
            .push(42);

        assert_eq!(
            clone
                .active
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get("run-1"),
            Some(&vec![42]),
        );

        clone
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove("run-1");
        assert!(runtime
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
    }

    #[test]
    fn active_process_guard_removes_a_pid_when_execution_returns_early() {
        let runtime = OrchestrationRuntime::default();
        runtime
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry("run-early".into())
            .or_default()
            .push(77);
        let guard = ActiveProcessGuard {
            runtime: runtime.clone(),
            run_id: "run-early".into(),
            pid: 77,
        };

        drop(guard);

        assert!(runtime
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get("run-early")
            .is_none());
    }

    #[test]
    fn redacts_provider_output_before_it_reaches_callbacks_or_logs() {
        let event = redact_provider_event(
            ProviderEvent::Output {
                stream: "stdout".into(),
                text: "received Bearer secret-123 and sk-live-example".into(),
            },
            &["secret-123".into()],
        );

        assert_eq!(
            event,
            ProviderEvent::Output {
                stream: "stdout".into(),
                text: "received Bearer [REDACTED] and sk-[REDACTED]".into(),
            }
        );
    }

    #[tokio::test]
    async fn forward_lines_records_and_forwards_events_through_the_callback() {
        let (mut writer, reader) = tokio::io::duplex(1024);
        writer
            .write_all(b"provider warning secret-123\n")
            .await
            .expect("write provider output");
        drop(writer);

        let received = Arc::new(Mutex::new(Vec::new()));
        let callback_events = received.clone();
        let callback: ProviderEventCallback = Arc::new(move |event| {
            callback_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        });
        let capture = Arc::new(Mutex::new(EventCapture::default()));

        forward_lines(
            reader,
            AgentProvider::Codex,
            "stderr",
            callback,
            capture.clone(),
            Arc::new(vec!["secret-123".into()]),
            Arc::new(Mutex::new(EventBudget::default())),
        )
        .await;

        assert_eq!(
            received
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_slice(),
            [ProviderEvent::Output {
                stream: "stderr".into(),
                text: "provider warning [REDACTED]".into(),
            }],
        );
        assert_eq!(
            capture
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .lines,
            ["[stderr] provider warning [REDACTED]"],
        );
    }

    #[tokio::test]
    async fn forward_lines_discards_oversized_lines_without_leaking_their_content() {
        let (mut writer, reader) = tokio::io::duplex(MAX_PROVIDER_LINE_BYTES * 2);
        let oversized = format!("Bearer secret-123{}\n", "x".repeat(MAX_PROVIDER_LINE_BYTES));
        writer
            .write_all(oversized.as_bytes())
            .await
            .expect("write oversized provider output");
        drop(writer);

        let received = Arc::new(Mutex::new(Vec::new()));
        let callback_events = received.clone();
        let callback: ProviderEventCallback = Arc::new(move |event| {
            callback_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        });
        let capture = Arc::new(Mutex::new(EventCapture::default()));

        forward_lines(
            reader,
            AgentProvider::Codex,
            "stderr",
            callback,
            capture.clone(),
            Arc::new(vec!["secret-123".into()]),
            Arc::new(Mutex::new(EventBudget::default())),
        )
        .await;

        let received = received.lock().expect("received events");
        assert_eq!(received.len(), 1);
        assert_eq!(
            received[0],
            ProviderEvent::Output {
                stream: "stderr".into(),
                text: PROVIDER_OUTPUT_TRUNCATED.into(),
            }
        );
        assert!(!format!("{received:?}").contains("secret-123"));
        assert!(!capture
            .lock()
            .expect("capture")
            .lines
            .join("\n")
            .contains("secret-123"));
    }

    #[tokio::test]
    async fn forward_lines_limits_the_total_number_of_callback_events() {
        let (mut writer, reader) = tokio::io::duplex(1024);
        writer
            .write_all(b"one\ntwo\nthree\nfour\n")
            .await
            .expect("write provider output");
        drop(writer);

        let received = Arc::new(Mutex::new(Vec::new()));
        let callback_events = received.clone();
        let callback: ProviderEventCallback = Arc::new(move |event| {
            callback_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        });

        forward_lines(
            reader,
            AgentProvider::Codex,
            "stderr",
            callback,
            Arc::new(Mutex::new(EventCapture::default())),
            Arc::new(Vec::new()),
            Arc::new(Mutex::new(EventBudget::with_limits(2, usize::MAX))),
        )
        .await;

        assert_eq!(
            received.lock().expect("received events").as_slice(),
            [
                ProviderEvent::Output {
                    stream: "stderr".into(),
                    text: "one".into(),
                },
                ProviderEvent::Output {
                    stream: "stderr".into(),
                    text: "two".into(),
                },
                ProviderEvent::Output {
                    stream: "stderr".into(),
                    text: PROVIDER_OUTPUT_TRUNCATED.into(),
                },
            ],
        );
    }
}
