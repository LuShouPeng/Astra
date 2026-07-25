use serde::Serialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

/// Error surfaced to the frontend when a session-log operation fails.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogError {
    code: &'static str,
    message: String,
}

impl SessionLogError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(context: &'static str, error: std::io::Error) -> Self {
        Self::new("IO_ERROR", format!("{context}: {error}"))
    }
}

/// Builds the per-session log path, rejecting any `session_id` that could escape
/// the log directory. The frontend controls this value, so it is untrusted:
/// only ASCII alphanumerics, `-` and `_` are allowed (no `.`, `/`, `\`).
fn safe_log_path(base_dir: &Path, session_id: &str) -> Result<PathBuf, SessionLogError> {
    if session_id.is_empty()
        || !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(SessionLogError::new(
            "INVALID_SESSION_ID",
            "Session id may only contain letters, digits, '-' and '_'.",
        ));
    }
    Ok(base_dir.join(format!("{session_id}.log")))
}

/// Milliseconds since the Unix epoch. Avoids pulling in `chrono` just for a
/// timestamp; the frontend renders it however it likes.
fn epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Testable core: append one event as a JSONL line under an explicit base dir.
///
/// Each line is `{"timestampMs":<u128>,"event":<event>}`. Append-only so
/// concurrent readers never see a partial rewrite; a single agent process owns
/// each session id (guaranteed by `AgentRegistry`), so lines never interleave.
fn append_event(base_dir: &Path, session_id: &str, event: &Value) -> Result<(), SessionLogError> {
    let path = safe_log_path(base_dir, session_id)?;
    fs::create_dir_all(base_dir).map_err(|e| SessionLogError::io("create log directory", e))?;

    let line = serde_json::json!({
        "timestampMs": epoch_millis().to_string(),
        "event": event,
    });
    let serialized = serde_json::to_string(&line)
        .map_err(|e| SessionLogError::new("SERIALIZE", e.to_string()))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| SessionLogError::io("open log file", e))?;
    writeln!(file, "{serialized}").map_err(|e| SessionLogError::io("write log line", e))?;
    Ok(())
}

/// Testable core: read log lines under an explicit base dir, with optional
/// `offset` (lines to skip) and `limit` (max lines returned). A missing file is
/// not an error — it yields an empty list (session never produced output yet).
fn read_events(
    base_dir: &Path,
    session_id: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<Value>, SessionLogError> {
    let path = safe_log_path(base_dir, session_id)?;
    let file = match OpenOptions::new().read(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(SessionLogError::io("open log file", error)),
    };

    let reader = BufReader::new(file);
    let skip = offset.unwrap_or(0);
    let mut out = Vec::new();
    for line in reader.lines().skip(skip) {
        let line = line.map_err(|e| SessionLogError::io("read log line", e))?;
        if line.trim().is_empty() {
            continue;
        }
        // A corrupt line (partial write during a crash) is skipped rather than
        // failing the whole read — the rest of the history is still useful.
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            out.push(value);
            if let Some(max) = limit {
                if out.len() >= max {
                    break;
                }
            }
        }
    }
    Ok(out)
}

/// Resolves `~/.astra/sessions/` via Tauri's home-dir resolver (cross-platform,
/// no `dirs` dependency).
fn session_log_dir(app: &tauri::AppHandle) -> Result<PathBuf, SessionLogError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| SessionLogError::new("NO_HOME_DIR", e.to_string()))?;
    Ok(home.join(".astra").join("sessions"))
}

/// Appends a streaming event to the session log. `event` is the raw
/// `AgentStreamEvent` JSON forwarded from the frontend.
#[tauri::command]
pub fn session_log_append(
    app: tauri::AppHandle,
    session_id: String,
    event: Value,
) -> Result<(), SessionLogError> {
    let dir = session_log_dir(&app)?;
    append_event(&dir, &session_id, &event)
}

/// Reads persisted session-log lines (for resume / diagnostics), oldest first.
#[tauri::command]
pub fn session_log_read(
    app: tauri::AppHandle,
    session_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<Value>, SessionLogError> {
    let dir = session_log_dir(&app)?;
    read_events(&dir, &session_id, offset, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temporary_directory(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("astra-{label}-{suffix}"));
        fs::create_dir_all(&path).expect("create temporary directory");
        dunce::canonicalize(&path).expect("canonicalize temp dir")
    }

    fn cleanup(path: PathBuf) {
        assert!(
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("astra-")),
            "temporary cleanup must remain scoped to an Astra test directory"
        );
        let _ = fs::remove_dir_all(&path);
    }

    #[test]
    fn append_then_read_roundtrips_events_in_order() {
        let dir = temporary_directory("sesslog-roundtrip");
        append_event(&dir, "sess-1", &json!({"kind": "stdout", "chunk": "hello"})).unwrap();
        append_event(&dir, "sess-1", &json!({"kind": "stdout", "chunk": "world"})).unwrap();
        append_event(&dir, "sess-1", &json!({"kind": "exit", "code": 0})).unwrap();

        let events = read_events(&dir, "sess-1", None, None).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0]["event"]["chunk"], "hello");
        assert_eq!(events[2]["event"]["kind"], "exit");
        assert!(events[0]["timestampMs"].is_string());
        cleanup(dir);
    }

    #[test]
    fn read_supports_offset_and_limit() {
        let dir = temporary_directory("sesslog-paging");
        for i in 0..5 {
            append_event(
                &dir,
                "sess-1",
                &json!({"kind": "stdout", "chunk": i.to_string()}),
            )
            .unwrap();
        }
        let page = read_events(&dir, "sess-1", Some(1), Some(2)).unwrap();
        assert_eq!(page.len(), 2);
        assert_eq!(page[0]["event"]["chunk"], "1");
        assert_eq!(page[1]["event"]["chunk"], "2");
        cleanup(dir);
    }

    #[test]
    fn read_missing_log_returns_empty_not_error() {
        let dir = temporary_directory("sesslog-missing");
        let events = read_events(&dir, "never-ran", None, None).unwrap();
        assert!(events.is_empty());
        cleanup(dir);
    }

    #[test]
    fn append_isolates_sessions_by_id() {
        let dir = temporary_directory("sesslog-isolation");
        append_event(&dir, "sess-a", &json!({"kind": "stdout", "chunk": "a"})).unwrap();
        append_event(&dir, "sess-b", &json!({"kind": "stdout", "chunk": "b"})).unwrap();
        assert_eq!(read_events(&dir, "sess-a", None, None).unwrap().len(), 1);
        assert_eq!(read_events(&dir, "sess-b", None, None).unwrap().len(), 1);
        cleanup(dir);
    }

    #[test]
    fn corrupt_line_is_skipped_not_fatal() {
        let dir = temporary_directory("sesslog-corrupt");
        append_event(&dir, "sess-1", &json!({"kind": "stdout", "chunk": "ok"})).unwrap();
        // Simulate a torn write from a crash by appending a partial line.
        let path = safe_log_path(&dir, "sess-1").unwrap();
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{{\"timestampMs\":\"1\",\"event\":{{partial").unwrap();
        append_event(&dir, "sess-1", &json!({"kind": "exit", "code": 0})).unwrap();

        let events = read_events(&dir, "sess-1", None, None).unwrap();
        assert_eq!(
            events.len(),
            2,
            "corrupt middle line skipped, valid ones kept"
        );
        assert_eq!(events[1]["event"]["kind"], "exit");
        cleanup(dir);
    }

    #[test]
    fn rejects_session_ids_with_path_traversal() {
        let dir = temporary_directory("sesslog-traversal");
        for bad in ["../escape", "a/b", "a\\b", "..", "with.dot", ""] {
            assert_eq!(
                append_event(&dir, bad, &json!({"kind": "exit", "code": 0}))
                    .unwrap_err()
                    .code,
                "INVALID_SESSION_ID",
                "session id {bad:?} must be rejected",
            );
            assert_eq!(
                read_events(&dir, bad, None, None).unwrap_err().code,
                "INVALID_SESSION_ID",
            );
        }
        cleanup(dir);
    }

    #[test]
    fn accepts_valid_session_id_shapes() {
        let dir = temporary_directory("sesslog-valid-ids");
        for ok in ["sess-1", "session_2", "abc123", "A-B_c-9"] {
            append_event(&dir, ok, &json!({"kind": "exit", "code": 0})).unwrap();
        }
        cleanup(dir);
    }
}
