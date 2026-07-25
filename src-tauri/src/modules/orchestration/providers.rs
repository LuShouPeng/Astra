use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentProvider {
    Claude,
    Codex,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchSpec {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ProviderEvent {
    Started { provider: AgentProvider },
    Session { external_session_id: String },
    Output { stream: String, text: String },
    Approval { capability: String, summary: String },
    Completed { exit_code: Option<i32> },
    Failed { message: String },
}

pub fn build_launch_spec(
    provider: AgentProvider,
    provider_path: &Path,
    cwd: &Path,
) -> Result<LaunchSpec, String> {
    let extension = provider_path
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
                    provider_path.to_string_lossy().into_owned(),
                ]);
                PathBuf::from("powershell.exe")
            } else if extension == "exe" {
                provider_path.to_path_buf()
            } else {
                return Err("Claude executable must be an .exe or .ps1 file.".into());
            };
            args.extend([
                "-p".into(),
                "--input-format".into(),
                "text".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--permission-mode".into(),
                "manual".into(),
                "--verbose".into(),
            ]);
            Ok(LaunchSpec {
                executable,
                args,
                cwd: cwd.to_path_buf(),
            })
        }
        AgentProvider::Codex => {
            if extension != "exe" {
                return Err("Codex executable must be an .exe file.".into());
            }
            Ok(LaunchSpec {
                executable: provider_path.to_path_buf(),
                args: vec![
                    "exec".into(),
                    "--json".into(),
                    "--sandbox".into(),
                    "workspace-write".into(),
                    "-".into(),
                ],
                cwd: cwd.to_path_buf(),
            })
        }
    }
}

fn session_id(provider: AgentProvider, value: &Value) -> Option<String> {
    match provider {
        AgentProvider::Claude => value.get("session_id").and_then(Value::as_str),
        AgentProvider::Codex => value.get("thread_id").and_then(Value::as_str),
    }
    .map(ToOwned::to_owned)
}

pub fn parse_provider_line(provider: AgentProvider, line: &str) -> ProviderEvent {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return ProviderEvent::Output {
            stream: "stdout".into(),
            text: line.into(),
        };
    };
    if let Some(external_session_id) = session_id(provider, &value) {
        return ProviderEvent::Session {
            external_session_id,
        };
    }
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if event_type.contains("approval") || event_type.contains("permission") {
        return ProviderEvent::Approval {
            capability: value
                .get("capability")
                .and_then(Value::as_str)
                .unwrap_or("execute")
                .into(),
            summary: value
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("Provider requested approval.")
                .into(),
        };
    }
    ProviderEvent::Output {
        stream: "stdout".into(),
        text: line.into(),
    }
}
