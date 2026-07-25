use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum TerminalError {
    #[error("PTY system error: {0}")]
    PtyError(String),
    #[error("Terminal session not found: {0}")]
    SessionNotFound(String),
    #[error("Command not permitted: {0}")]
    CommandNotPermitted(String),
    #[error("Working directory error: {0}")]
    WorkingDirectoryError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
}

impl Serialize for TerminalError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Terminal session configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    pub working_dir: PathBuf,
    pub cols: u16,
    pub rows: u16,
    pub shell: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

/// Command execution policy
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionPolicy {
    /// Always allow without confirmation
    Allow,
    /// Require user confirmation
    Confirm,
    /// Block execution
    Deny,
}

/// Command permission rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandRule {
    pub pattern: String,
    pub policy: ExecutionPolicy,
    pub description: String,
}

/// Terminal session state
struct TerminalSession {
    id: String,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    working_dir: PathBuf,
    config: TerminalConfig,
}

/// Global terminal manager state
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    command_rules: Arc<Mutex<Vec<CommandRule>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        let default_rules = vec![
            CommandRule {
                pattern: r"^rm\s+-rf\s+/".to_string(),
                policy: ExecutionPolicy::Deny,
                description: "Recursive delete from root is forbidden".to_string(),
            },
            CommandRule {
                pattern: r"^(sudo|su)\s+".to_string(),
                policy: ExecutionPolicy::Confirm,
                description: "Elevated privileges require confirmation".to_string(),
            },
            CommandRule {
                pattern: r"^(shutdown|reboot|halt)".to_string(),
                policy: ExecutionPolicy::Confirm,
                description: "System power operations require confirmation".to_string(),
            },
            CommandRule {
                pattern: r"^git\s+push\s+.*--force".to_string(),
                policy: ExecutionPolicy::Confirm,
                description: "Force push requires confirmation".to_string(),
            },
        ];

        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            command_rules: Arc::new(Mutex::new(default_rules)),
        }
    }

    fn check_command_policy(&self, command: &str) -> Result<ExecutionPolicy, TerminalError> {
        let rules = self.command_rules.lock().unwrap();

        for rule in rules.iter() {
            if let Ok(re) = regex::Regex::new(&rule.pattern) {
                if re.is_match(command) {
                    return Ok(rule.policy.clone());
                }
            }
        }

        Ok(ExecutionPolicy::Allow)
    }
}

/// Create a new terminal session
#[tauri::command]
pub async fn terminal_create_session(
    config: TerminalConfig,
    manager: State<'_, TerminalManager>,
) -> Result<String, TerminalError> {
    let session_id = Uuid::new_v4().to_string();

    // Validate and normalize working directory
    let working_dir = dunce::canonicalize(&config.working_dir)
        .map_err(|e| TerminalError::WorkingDirectoryError(e.to_string()))?;

    if !working_dir.exists() || !working_dir.is_dir() {
        return Err(TerminalError::WorkingDirectoryError(
            "Invalid working directory".to_string(),
        ));
    }

    // Create PTY
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: config.rows,
            cols: config.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| TerminalError::PtyError(e.to_string()))?;

    // Determine shell
    let shell = config.shell.clone().unwrap_or_else(|| {
        if cfg!(windows) {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        }
    });

    // Build command
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&working_dir);

    if let Some(env) = &config.env {
        for (key, value) in env {
            cmd.env(key, value);
        }
    }

    // Spawn child process
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| TerminalError::PtyError(e.to_string()))?;

    // Store session
    let session = TerminalSession {
        id: session_id.clone(),
        master: pty_pair.master,
        child,
        working_dir,
        config,
    };

    let mut sessions = manager.sessions.lock().unwrap();
    sessions.insert(session_id.clone(), session);

    Ok(session_id)
}

/// Write input to terminal
#[tauri::command]
pub async fn terminal_write_input(
    session_id: String,
    data: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), TerminalError> {
    let mut sessions = manager.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| TerminalError::SessionNotFound(session_id.clone()))?;

    session
        .master
        .write_all(data.as_bytes())
        .map_err(TerminalError::IoError)?;

    Ok(())
}

/// Read output from terminal
#[tauri::command]
pub async fn terminal_read_output(
    session_id: String,
    manager: State<'_, TerminalManager>,
) -> Result<String, TerminalError> {
    let mut sessions = manager.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| TerminalError::SessionNotFound(session_id.clone()))?;

    let mut buffer = [0u8; 8192];
    let mut output = Vec::new();

    match session.master.try_clone_reader() {
        Ok(mut reader) => {
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => output.extend_from_slice(&buffer[..n]),
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(e) => return Err(TerminalError::IoError(e)),
                }
            }
        }
        Err(e) => return Err(TerminalError::IoError(e)),
    }

    String::from_utf8(output)
        .map_err(|_| TerminalError::IoError(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Invalid UTF-8 in terminal output",
        )))
}

/// Execute a command with policy check
#[tauri::command]
pub async fn terminal_execute_command(
    session_id: String,
    command: String,
    app: AppHandle,
    manager: State<'_, TerminalManager>,
) -> Result<ExecutionPolicy, TerminalError> {
    // Check command policy
    let policy = manager.check_command_policy(&command)?;

    match policy {
        ExecutionPolicy::Deny => {
            Err(TerminalError::CommandNotPermitted(format!(
                "Command '{}' is not permitted",
                command
            )))
        }
        ExecutionPolicy::Confirm => {
            // Emit event to frontend for confirmation
            app.emit("terminal-command-confirmation-required", &command)
                .map_err(|e| TerminalError::PtyError(e.to_string()))?;
            Ok(ExecutionPolicy::Confirm)
        }
        ExecutionPolicy::Allow => {
            // Execute directly
            let command_with_newline = format!("{}\n", command);
            terminal_write_input(session_id, command_with_newline, manager).await?;
            Ok(ExecutionPolicy::Allow)
        }
    }
}

/// Confirm and execute a pending command
#[tauri::command]
pub async fn terminal_confirm_command(
    session_id: String,
    command: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), TerminalError> {
    let command_with_newline = format!("{}\n", command);
    terminal_write_input(session_id, command_with_newline, manager).await
}

/// Cancel a command execution
#[tauri::command]
pub async fn terminal_cancel_command(
    session_id: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), TerminalError> {
    // Send Ctrl+C (interrupt signal)
    terminal_write_input(session_id, "\x03".to_string(), manager).await
}

/// Resize terminal
#[tauri::command]
pub async fn terminal_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    manager: State<'_, TerminalManager>,
) -> Result<(), TerminalError> {
    let mut sessions = manager.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| TerminalError::SessionNotFound(session_id.clone()))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| TerminalError::PtyError(e.to_string()))?;

    Ok(())
}

/// Get session info
#[tauri::command]
pub async fn terminal_get_session_info(
    session_id: String,
    manager: State<'_, TerminalManager>,
) -> Result<TerminalSessionInfo, TerminalError> {
    let sessions = manager.sessions.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| TerminalError::SessionNotFound(session_id.clone()))?;

    Ok(TerminalSessionInfo {
        id: session.id.clone(),
        working_dir: session.working_dir.to_string_lossy().to_string(),
        cols: session.config.cols,
        rows: session.config.rows,
        is_alive: session.child.try_wait().ok().flatten().is_none(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub id: String,
    pub working_dir: String,
    pub cols: u16,
    pub rows: u16,
    pub is_alive: bool,
}

/// Close terminal session
#[tauri::command]
pub async fn terminal_close_session(
    session_id: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), TerminalError> {
    let mut sessions = manager.sessions.lock().unwrap();

    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }

    Ok(())
}

/// List all active sessions
#[tauri::command]
pub async fn terminal_list_sessions(
    manager: State<'_, TerminalManager>,
) -> Result<Vec<String>, TerminalError> {
    let sessions = manager.sessions.lock().unwrap();
    Ok(sessions.keys().cloned().collect())
}

/// Add or update command rule
#[tauri::command]
pub async fn terminal_add_command_rule(
    rule: CommandRule,
    manager: State<'_, TerminalManager>,
) -> Result<(), TerminalError> {
    let mut rules = manager.command_rules.lock().unwrap();

    // Remove existing rule with same pattern
    rules.retain(|r| r.pattern != rule.pattern);
    rules.push(rule);

    Ok(())
}

/// Get all command rules
#[tauri::command]
pub async fn terminal_get_command_rules(
    manager: State<'_, TerminalManager>,
) -> Result<Vec<CommandRule>, TerminalError> {
    let rules = manager.command_rules.lock().unwrap();
    Ok(rules.clone())
}

/// Change working directory for a session
#[tauri::command]
pub async fn terminal_change_directory(
    session_id: String,
    path: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), TerminalError> {
    let new_path = PathBuf::from(&path);

    // Validate directory
    let canonical_path = dunce::canonicalize(&new_path)
        .map_err(|e| TerminalError::WorkingDirectoryError(e.to_string()))?;

    if !canonical_path.exists() || !canonical_path.is_dir() {
        return Err(TerminalError::WorkingDirectoryError(
            "Invalid directory path".to_string(),
        ));
    }

    // Send cd command
    let cd_command = if cfg!(windows) {
        format!("cd '{}'\n", path)
    } else {
        format!("cd '{}'\n", path)
    };

    terminal_write_input(session_id.clone(), cd_command, manager.clone()).await?;

    // Update session working dir
    let mut sessions = manager.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.working_dir = canonical_path;
    }

    Ok(())
}
