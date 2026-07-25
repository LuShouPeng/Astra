use std::sync::{Arc, Mutex};

use serde_json::json;

use super::{
    coordinator::{
        mcp_runtime_context, provider_path_from_context, validate_provider_mcp_support,
        RunEventSink,
    },
    providers::AgentProvider,
    store::{
        ApprovalRecord, NodeRunRecord, OrchestrationStore, WorkflowAttentionRecord,
        WorkflowRunContextRecord, WorkflowRunRecord,
    },
};

fn run(store: &OrchestrationStore, id: &str) {
    store
        .save_run(&WorkflowRunRecord {
            id: id.into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .expect("save run");
}

fn node(store: &OrchestrationStore, run_id: &str, node_id: &str) {
    store
        .save_node_run(&NodeRunRecord {
            id: format!("{run_id}-{node_id}"),
            run_id: run_id.into(),
            node_id: node_id.into(),
            status: "ready".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .expect("save node");
}

#[test]
fn event_sink_persists_the_event_before_notifying_subscribers() {
    let store = OrchestrationStore::in_memory().expect("store");
    run(&store, "run-events");
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observed_events = observed.clone();
    let callback_store = store.clone();
    let sink = RunEventSink::with_notifier(
        store.clone(),
        Arc::new(move |notification| {
            let persisted = callback_store
                .list_events_after(&notification.run_id, notification.sequence - 1, 1)
                .expect("read persisted event");
            observed_events
                .lock()
                .expect("observed events")
                .push((notification, persisted));
        }),
    );

    let emitted = sink
        .persist_then_emit(
            "run-events",
            json!({"type":"node_started","nodeId":"agent"}),
        )
        .expect("persist and emit");

    let observed = observed.lock().expect("observed events");
    assert_eq!(observed.len(), 1);
    assert_eq!(observed[0].0.sequence, emitted.sequence);
    assert_eq!(observed[0].1[0].sequence, emitted.sequence);
    assert_eq!(observed[0].1[0].event_json, emitted.event_json);
}

#[test]
fn provider_path_is_resolved_from_the_persisted_run_context() {
    let context =
        r#"{"claudePath":"C:/providers/claude.exe","codexPath":"C:/providers/codex.exe"}"#;

    assert_eq!(
        provider_path_from_context(AgentProvider::Codex, context).expect("codex path"),
        "C:/providers/codex.exe"
    );
    assert_eq!(
        provider_path_from_context(AgentProvider::Claude, context).expect("claude path"),
        "C:/providers/claude.exe"
    );
    assert!(provider_path_from_context(
        AgentProvider::Codex,
        r#"{"claudePath":"C:/providers/claude.exe"}"#
    )
    .is_err());
}

#[test]
fn mcp_runtime_context_uses_the_node_snapshot_not_the_live_configuration() {
    let store = OrchestrationStore::in_memory().expect("store");
    run(&store, "run-mcp");
    node(&store, "run-mcp", "agent");
    store
        .save_mcp_config(
            "search",
            r#"{"id":"search","name":"Search","transport":"streamable_http","url":"https://snapshot.example/mcp","enabled":true}"#,
        )
        .expect("save snapshot source");
    store
        .snapshot_node_mcp_configs("run-mcp", "agent", &["search".into()])
        .expect("snapshot mcp");
    store
        .save_mcp_config(
            "search",
            r#"{"id":"search","name":"Search","transport":"streamable_http","url":"https://live.example/mcp","enabled":true}"#,
        )
        .expect("change live config");

    let context = mcp_runtime_context(&store, "run-mcp", "agent").expect("MCP context");

    assert!(context.contains("https://snapshot.example/mcp"));
    assert!(!context.contains("https://live.example/mcp"));
    assert!(context.contains("\"mcpServers\""));
    assert!(validate_provider_mcp_support(AgentProvider::Claude, &context).is_ok());
    assert!(validate_provider_mcp_support(AgentProvider::Codex, &context).is_err());
}

#[test]
fn event_sink_recovers_events_from_a_cursor() {
    let store = OrchestrationStore::in_memory().expect("store");
    run(&store, "run-cursor");
    let sink = RunEventSink::with_notifier(store, Arc::new(|_| {}));
    let first = sink
        .persist_then_emit("run-cursor", json!({"type":"first"}))
        .expect("first event");
    let second = sink
        .persist_then_emit("run-cursor", json!({"type":"second"}))
        .expect("second event");

    let recovered = sink
        .events_after("run-cursor", first.sequence, 10)
        .expect("events after");
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].sequence, second.sequence);
}

#[test]
fn a_conflicting_integration_pauses_the_run_and_resume_requeues_blocked_nodes() {
    let store = OrchestrationStore::in_memory().expect("store");
    run(&store, "run-conflict");
    node(&store, "run-conflict", "first");
    node(&store, "run-conflict", "second");
    store
        .claim_ready_node("run-conflict", "first")
        .expect("claim first node");
    let attention = WorkflowAttentionRecord {
        id: "attention-conflict".into(),
        run_id: "run-conflict".into(),
        node_run_id: Some("run-conflict-first".into()),
        kind: "git_conflict".into(),
        priority: "high".into(),
        status: "open".into(),
        summary: "The node branch conflicts with the integration branch.".into(),
        context_json: r#"{"nodeId":"first"}"#.into(),
    };

    assert!(store
        .pause_run_for_attention(&attention)
        .expect("pause run for attention"));
    let paused = store
        .get_run_projection("run-conflict")
        .expect("projection")
        .expect("run");
    assert_eq!(paused.run.status, "paused");
    assert!(paused
        .nodes
        .iter()
        .all(|node| node.node.status == "blocked"));
    assert_eq!(paused.attentions.len(), 1);

    assert!(store.resume_run("run-conflict").expect("resume run"));
    let resumed = store
        .get_run_projection("run-conflict")
        .expect("projection")
        .expect("run");
    assert_eq!(resumed.run.status, "queued");
    assert!(resumed
        .nodes
        .iter()
        .all(|node| node.node.status == "pending"));
}

#[test]
fn ready_node_claim_is_single_use_across_concurrent_scheduler_kicks() {
    let store = OrchestrationStore::in_memory().expect("store");
    run(&store, "run-claim");
    node(&store, "run-claim", "agent");

    assert!(store
        .claim_ready_node("run-claim", "agent")
        .expect("first claim")
        .is_some());
    assert!(store
        .claim_ready_node("run-claim", "agent")
        .expect("second claim")
        .is_none());
    assert_eq!(
        store.list_node_runs("run-claim").expect("nodes")[0].status,
        "running"
    );
}

#[test]
fn only_one_concurrent_initial_approval_can_persist_a_worktree() {
    let store = OrchestrationStore::in_memory().expect("store");
    store
        .save_run(&WorkflowRunRecord {
            id: "run-initial-approval".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "waiting".into(),
            integration_branch: Some("astra/run-initial-approval".into()),
        })
        .expect("run");
    store
        .save_run_context(&WorkflowRunContextRecord {
            run_id: "run-initial-approval".into(),
            repository_path: "C:/projects/astra".into(),
            provider_paths_json: "{}".into(),
            run_worktree_json: None,
        })
        .expect("context");
    node(&store, "run-initial-approval", "bootstrap");
    store
        .update_node_status(
            "run-initial-approval",
            "bootstrap",
            "waiting_approval",
            None,
        )
        .expect("wait for approval");
    store
        .save_approval(&ApprovalRecord {
            id: "approval-initial".into(),
            run_id: "run-initial-approval".into(),
            node_run_id: "run-initial-approval-bootstrap".into(),
            capability: "worktree".into(),
            risk: "medium".into(),
            summary: "Create isolated worktrees.".into(),
            status: "pending".into(),
        })
        .expect("approval");

    let first = store.clone();
    let second = store.clone();
    let first = std::thread::spawn(move || {
        first.decide_run_with_worktree("run-initial-approval", r#"{"branch":"first"}"#)
    });
    let second = std::thread::spawn(move || {
        second.decide_run_with_worktree("run-initial-approval", r#"{"branch":"second"}"#)
    });
    let outcomes = [
        first.join().expect("first join").expect("first decision"),
        second
            .join()
            .expect("second join")
            .expect("second decision"),
    ];

    assert_eq!(outcomes.into_iter().filter(|outcome| *outcome).count(), 1);
    let context = store
        .get_run_context("run-initial-approval")
        .expect("context")
        .expect("stored context");
    assert!(matches!(
        context.run_worktree_json.as_deref(),
        Some(r#"{"branch":"first"}"#) | Some(r#"{"branch":"second"}"#)
    ));
    assert_eq!(
        store
            .list_events("run-initial-approval")
            .expect("events")
            .into_iter()
            .filter(|event| event.contains("approval_decided"))
            .count(),
        1
    );
}
