use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use super::workspace::safe_directory;

/// Error surfaced to the frontend when a runtime operation fails.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentError {
    code: &'static str,
    message: String,
}

impl AgentError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Launch parameters mirrored from `src/core/contracts/agents.ts`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchConfig {
    provider: String,
    working_directory: String,
    prompt: String,
    session_id: String,
    mode: Option<String>,
}

/// Streaming payload mirrored from the `AgentStreamEvent` union.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentStreamEvent {
    Stdout { chunk: String },
    Stderr { chunk: String },
    Exit { code: Option<i32> },
}

/// Abstraction over the emit target so the spawn loop can be tested without a
/// live Tauri `AppHandle`.
pub trait EventSink: Send + Sync + 'static {
    fn emit_stream(&self, session_id: &str, event: &AgentStreamEvent);
}

/// Production sink: forwards each event to `agent://stream/{sessionId}`.
struct AppEventSink {
    app: tauri::AppHandle,
}

impl EventSink for AppEventSink {
    fn emit_stream(&self, session_id: &str, event: &AgentStreamEvent) {
        let channel = format!("agent://stream/{session_id}");
        let _ = self.app.emit(&channel, event);
    }
}

/// Live handle for one running process. The child itself lives in the wait
/// task; the registry keeps only the control channels + pid for cleanup.
struct AgentHandle {
    pid: u32,
    stdin_tx: mpsc::UnboundedSender<String>,
    kill_tx: mpsc::UnboundedSender<()>,
}

/// Registry of running agents keyed by session id. Managed by Tauri state.
#[derive(Default, Clone)]
pub struct AgentRegistry {
    procs: Arc<Mutex<HashMap<String, AgentHandle>>>,
}

impl AgentRegistry {
    fn insert(&self, session_id: String, handle: AgentHandle) {
        if let Ok(mut guard) = self.procs.lock() {
            guard.insert(session_id, handle);
        }
    }

    fn remove(&self, session_id: &str) {
        if let Ok(mut guard) = self.procs.lock() {
            guard.remove(session_id);
        }
    }

    fn stdin_sender(&self, session_id: &str) -> Option<mpsc::UnboundedSender<String>> {
        self.procs
            .lock()
            .ok()
            .and_then(|guard| guard.get(session_id).map(|h| h.stdin_tx.clone()))
    }

    fn kill_sender(&self, session_id: &str) -> Option<mpsc::UnboundedSender<()>> {
        self.procs
            .lock()
            .ok()
            .and_then(|guard| guard.get(session_id).map(|h| h.kill_tx.clone()))
    }

    fn running_ids(&self) -> Vec<String> {
        self.procs
            .lock()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Snapshot of all live pids, for shutdown cleanup.
    fn running_pids(&self) -> Vec<u32> {
        self.procs
            .lock()
            .map(|guard| guard.values().map(|h| h.pid).collect())
            .unwrap_or_default()
    }

    /// Synchronously kills every registered process tree. Called from the app
    /// exit hook, where the async runtime may already be tearing down — so this
    /// uses blocking `std::process::Command` rather than the async `kill_tree`.
    pub fn kill_all_blocking(&self) {
        for pid in self.running_pids() {
            if pid == 0 {
                continue;
            }
            kill_tree_blocking(pid);
        }
        if let Ok(mut guard) = self.procs.lock() {
            guard.clear();
        }
    }
}

/// Blocking variant of `kill_tree` for use during shutdown (no tokio runtime).
fn kill_tree_blocking(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
}

/// Maps a provider + prompt to the argv it should be launched with. Kept in one
/// place so the three providers differ only by arguments — the backend landing
/// point for the "adapter" pattern.
fn provider_argv(
    provider: &str,
    prompt: &str,
    mode: Option<&str>,
) -> Option<(String, Vec<String>)> {
    match (provider, mode) {
        ("codex", Some("resume")) => Some((
            "codex".to_owned(),
            vec![
                "exec".to_owned(),
                "resume".to_owned(),
                "--last".to_owned(),
                prompt.to_owned(),
            ],
        )),
        ("claude", _) => Some((
            "claude".to_owned(),
            vec!["--print".to_owned(), prompt.to_owned()],
        )),
        ("codex", _) => Some((
            "codex".to_owned(),
            vec!["exec".to_owned(), prompt.to_owned()],
        )),
        ("gemini", _) => Some((
            "gemini".to_owned(),
            vec!["--prompt".to_owned(), prompt.to_owned()],
        )),
        _ => None,
    }
}

/// Builds a `tokio::process::Command`, wrapping the program in `cmd /C` on
/// Windows so `.cmd` shims (claude/gemini install as `.cmd`) resolve on PATH.
fn build_command(program: &str, args: &[String], working_dir: &Path) -> Command {
    #[cfg(windows)]
    let mut command = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(program);
        for arg in args {
            c.arg(arg);
        }
        c
    };

    #[cfg(not(windows))]
    let mut command = {
        let mut c = Command::new(program);
        c.args(args);
        c
    };

    command.current_dir(working_dir);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // Detach from any parent console so line buffering is predictable.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Kills a process tree by pid. On Windows a CLI may fork children, so a plain
/// `child.kill()` leaves orphans — `taskkill /T` walks the tree.
async fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .await;
    }
}

/// Spawns the resolved command and drives it: pumps stdin, streams stdout/stderr
/// line-by-line through the sink, and emits a final `exit` event. The registry
/// entry is inserted here and removed when the process ends. Returns the child
/// pid on success.
///
/// This is the testable core — it takes an already-built `Command` and a sink,
/// so a unit test can spawn `echo` and assert on the collected events without a
/// Tauri runtime.
fn spawn_process(
    mut command: Command,
    session_id: String,
    registry: AgentRegistry,
    sink: Arc<dyn EventSink>,
) -> Result<u32, AgentError> {
    let mut child = command
        .spawn()
        .map_err(|error| AgentError::new("SPAWN_FAILED", error.to_string()))?;

    let pid = child.id().unwrap_or_default();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut stdin = child.stdin.take();

    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    let (kill_tx, mut kill_rx) = mpsc::unbounded_channel::<()>();

    registry.insert(
        session_id.clone(),
        AgentHandle {
            pid,
            stdin_tx,
            kill_tx,
        },
    );

    // stdout reader
    if let Some(stdout) = stdout {
        let sink = Arc::clone(&sink);
        let sid = session_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                sink.emit_stream(&sid, &AgentStreamEvent::Stdout { chunk: line });
            }
        });
    }

    // stderr reader
    if let Some(stderr) = stderr {
        let sink = Arc::clone(&sink);
        let sid = session_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                sink.emit_stream(&sid, &AgentStreamEvent::Stderr { chunk: line });
            }
        });
    }

    // stdin pump
    tokio::spawn(async move {
        while let Some(text) = stdin_rx.recv().await {
            if let Some(writer) = stdin.as_mut() {
                if writer.write_all(text.as_bytes()).await.is_err() {
                    break;
                }
                let _ = writer.flush().await;
            }
        }
    });

    // wait + kill supervisor
    let wait_sink = Arc::clone(&sink);
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx.recv() => {
                if pid != 0 {
                    kill_tree(pid).await;
                }
                let _ = child.wait().await;
                None
            }
        };
        wait_sink.emit_stream(&session_id, &AgentStreamEvent::Exit { code });
        registry.remove(&session_id);
    });

    Ok(pid)
}

/// Starts an agent process for the given session.
///
/// Must be `async` so Tauri runs it on its managed tokio runtime — the inner
/// `command.spawn()` (tokio::process) and `tokio::spawn` reader tasks panic with
/// "no reactor running" if invoked from a plain sync command (no runtime context).
#[tauri::command]
pub async fn agent_start(
    config: AgentLaunchConfig,
    app: tauri::AppHandle,
    registry: tauri::State<'_, AgentRegistry>,
) -> Result<(), AgentError> {
    if registry.running_ids().contains(&config.session_id) {
        return Err(AgentError::new(
            "ALREADY_RUNNING",
            "A process for this session is already running.",
        ));
    }

    let working_dir = safe_directory(Path::new(&config.working_directory))
        .map_err(|message| AgentError::new("INVALID_DIRECTORY", message))?;

    let (program, args) =
        provider_argv(&config.provider, &config.prompt, config.mode.as_deref())
            .ok_or_else(|| AgentError::new("UNKNOWN_PROVIDER", "Unsupported agent provider."))?;

    let command = build_command(&program, &args, &working_dir);
    let sink: Arc<dyn EventSink> = Arc::new(AppEventSink { app: app.clone() });

    spawn_process(command, config.session_id, registry.inner().clone(), sink)?;
    Ok(())
}

/// Sends a line of input to a running process's stdin.
#[tauri::command]
pub fn agent_send_input(
    session_id: String,
    text: String,
    registry: tauri::State<'_, AgentRegistry>,
) -> Result<(), AgentError> {
    let sender = registry
        .stdin_sender(&session_id)
        .ok_or_else(|| AgentError::new("NOT_RUNNING", "No running process for this session."))?;
    let line = if text.ends_with('\n') {
        text
    } else {
        format!("{text}\n")
    };
    sender
        .send(line)
        .map_err(|_| AgentError::new("SEND_FAILED", "The process is no longer accepting input."))
}

/// Requests termination of a running process (kills the whole tree).
#[tauri::command]
pub fn agent_stop(
    session_id: String,
    registry: tauri::State<'_, AgentRegistry>,
) -> Result<(), AgentError> {
    let sender = registry
        .kill_sender(&session_id)
        .ok_or_else(|| AgentError::new("NOT_RUNNING", "No running process for this session."))?;
    sender
        .send(())
        .map_err(|_| AgentError::new("STOP_FAILED", "The process already exited."))
}

/// Lists session ids with a live process.
#[tauri::command]
pub fn agent_list_running(registry: tauri::State<'_, AgentRegistry>) -> Vec<String> {
    registry.running_ids()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// Test sink that collects events into a shared Vec.
    struct CollectorSink {
        events: Arc<StdMutex<Vec<(String, AgentStreamEvent)>>>,
    }

    impl CollectorSink {
        fn new() -> Self {
            Self {
                events: Arc::new(StdMutex::new(Vec::new())),
            }
        }

        fn collected(&self) -> Vec<(String, AgentStreamEvent)> {
            self.events.lock().unwrap().clone()
        }
    }

    impl EventSink for CollectorSink {
        fn emit_stream(&self, session_id: &str, event: &AgentStreamEvent) {
            if let Ok(mut guard) = self.events.lock() {
                guard.push((session_id.to_owned(), event.clone()));
            }
        }
    }

    #[tokio::test]
    async fn spawns_echo_and_captures_output() {
        let registry = AgentRegistry::default();
        let sink = Arc::new(CollectorSink::new());
        let session_id = "test-session-1".to_owned();

        #[cfg(windows)]
        let mut command = Command::new("cmd");
        #[cfg(windows)]
        command.args(["/C", "echo", "hello from test"]);

        #[cfg(not(windows))]
        let mut command = Command::new("echo");
        #[cfg(not(windows))]
        command.arg("hello from test");

        command
            .current_dir(std::env::current_dir().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let result = spawn_process(command, session_id.clone(), registry.clone(), sink.clone());
        assert!(result.is_ok(), "spawn should succeed");

        // Wait for the process to finish and events to be emitted
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        let events = sink.collected();
        assert!(!events.is_empty(), "should have emitted at least one event");

        let has_stdout = events
            .iter()
            .any(|(_, e)| matches!(e, AgentStreamEvent::Stdout { .. }));
        let has_exit = events
            .iter()
            .any(|(_, e)| matches!(e, AgentStreamEvent::Exit { code: Some(0) }));

        assert!(has_stdout, "should have stdout event with test message");
        assert!(has_exit, "should have exit event with code 0");
    }

    #[test]
    fn provider_argv_maps_claude() {
        let (prog, args) = provider_argv("claude", "test prompt", None).unwrap();
        assert_eq!(prog, "claude");
        assert_eq!(args, vec!["--print", "test prompt"]);
    }

    #[test]
    fn provider_argv_maps_codex() {
        let (prog, args) = provider_argv("codex", "do something", None).unwrap();
        assert_eq!(prog, "codex");
        assert_eq!(args, vec!["exec", "do something"]);
    }

    #[test]
    fn provider_argv_maps_codex_resume() {
        let (prog, args) = provider_argv("codex", "continue", Some("resume")).unwrap();
        assert_eq!(prog, "codex");
        assert_eq!(args, vec!["exec", "resume", "--last", "continue"]);
    }

    #[test]
    fn provider_argv_maps_gemini() {
        let (prog, args) = provider_argv("gemini", "analyze this", None).unwrap();
        assert_eq!(prog, "gemini");
        assert_eq!(args, vec!["--prompt", "analyze this"]);
    }

    #[test]
    fn provider_argv_rejects_unknown() {
        assert!(provider_argv("unknown", "test", None).is_none());
    }
}
