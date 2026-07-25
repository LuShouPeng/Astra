use super::providers::{
    build_launch_spec, extract_workflow_json, parse_provider_line, AgentProvider, ProviderEvent,
};
use std::path::Path;

#[test]
fn builds_fixed_argument_launch_specs_without_embedding_the_prompt() {
    let claude = build_launch_spec(
        AgentProvider::Claude,
        Path::new("C:/tools/claude.ps1"),
        Path::new("C:/repo/worktree"),
    )
    .expect("claude spec");
    assert_eq!(claude.executable, Path::new("powershell.exe"));
    assert!(claude.args.iter().any(|arg| arg == "--output-format"));
    assert!(!claude.args.iter().any(|arg| arg.contains("user prompt")));

    let codex = build_launch_spec(
        AgentProvider::Codex,
        Path::new("C:/tools/codex.exe"),
        Path::new("C:/repo/worktree"),
    )
    .expect("codex spec");
    assert_eq!(codex.executable, Path::new("C:/tools/codex.exe"));
    assert!(codex.args.iter().any(|arg| arg == "--json"));
}

#[test]
fn parses_provider_jsonl_and_preserves_unknown_lines_as_output() {
    assert_eq!(
        parse_provider_line(
            AgentProvider::Claude,
            r#"{"type":"system","subtype":"init","session_id":"claude-session"}"#,
        ),
        ProviderEvent::Session {
            external_session_id: "claude-session".into()
        }
    );
    assert_eq!(
        parse_provider_line(
            AgentProvider::Codex,
            r#"{"type":"thread.started","thread_id":"codex-thread"}"#,
        ),
        ProviderEvent::Session {
            external_session_id: "codex-thread".into()
        }
    );
    assert_eq!(
        parse_provider_line(AgentProvider::Claude, "plain output"),
        ProviderEvent::Output {
            stream: "stdout".into(),
            text: "plain output".into()
        }
    );
}

#[test]
fn extracts_a_schema_shaped_workflow_from_provider_envelopes() {
    let output = r#"{"type":"result","result":"```json\n{\"name\":\"Plan\",\"nodes\":[],\"edges\":[]}\n```"}"#;
    let value = extract_workflow_json(output).expect("workflow json");
    assert_eq!(value["name"], "Plan");
    assert!(extract_workflow_json(r#"{"message":"no graph"}"#).is_err());
}
