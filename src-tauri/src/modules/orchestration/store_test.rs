use super::store::{ApprovalRecord, NodeRunRecord, OrchestrationStore, WorkflowRunRecord};

#[test]
fn persists_versioned_workflows_and_runtime_state() {
    let store = OrchestrationStore::in_memory().expect("store");
    let definition = r#"{"id":"workflow-1","version":1,"nodes":[],"edges":[]}"#;

    store
        .save_workflow("workflow-1", 1, "Build and verify", "project-1", definition)
        .expect("save workflow");
    store
        .save_run(&WorkflowRunRecord {
            id: "run-1".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: Some("astra/run-1".into()),
        })
        .expect("save run");
    store
        .save_node_run(&NodeRunRecord {
            id: "node-run-1".into(),
            run_id: "run-1".into(),
            node_id: "agent-1".into(),
            status: "running".into(),
            attempt: 1,
            provider: Some("claude".into()),
            worktree_path: Some("C:/worktrees/run-1-agent-1".into()),
        })
        .expect("save node run");
    store
        .save_approval(&ApprovalRecord {
            id: "approval-1".into(),
            run_id: "run-1".into(),
            node_run_id: "node-run-1".into(),
            capability: "execute".into(),
            risk: "high".into(),
            summary: "Run tests".into(),
            status: "pending".into(),
        })
        .expect("save approval");
    store
        .append_event("run-1", r#"{"type":"run_created"}"#)
        .expect("append event");

    assert_eq!(store.list_workflows().expect("list").len(), 1);
    assert_eq!(
        store.get_run("run-1").expect("get run").unwrap().status,
        "running"
    );
    assert_eq!(store.list_node_runs("run-1").expect("nodes").len(), 1);
    assert_eq!(store.list_approvals("run-1").expect("approvals").len(), 1);
    assert_eq!(store.list_events("run-1").expect("events").len(), 1);
}

#[test]
fn marks_active_work_as_interrupted_on_recovery() {
    let store = OrchestrationStore::in_memory().expect("store");
    store
        .save_run(&WorkflowRunRecord {
            id: "run-active".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .expect("save run");
    store
        .save_node_run(&NodeRunRecord {
            id: "node-active".into(),
            run_id: "run-active".into(),
            node_id: "agent-1".into(),
            status: "running".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .expect("save node");

    let recovered = store.interrupt_active_runs().expect("recover");

    assert_eq!(recovered, 1);
    assert_eq!(
        store.get_run("run-active").unwrap().unwrap().status,
        "interrupted"
    );
    assert_eq!(
        store.list_node_runs("run-active").unwrap()[0].status,
        "interrupted"
    );
}

#[test]
fn approval_and_cancellation_update_run_nodes_and_audit_events() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-decision".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "waiting".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "node-decision".into(),
            run_id: "run-decision".into(),
            node_id: "agent".into(),
            status: "waiting_approval".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();
    store
        .save_approval(&ApprovalRecord {
            id: "approval-decision".into(),
            run_id: "run-decision".into(),
            node_run_id: "node-decision".into(),
            capability: "worktree".into(),
            risk: "medium".into(),
            summary: "Create worktree".into(),
            status: "pending".into(),
        })
        .unwrap();
    store.decide_run("run-decision", true).unwrap();
    assert_eq!(
        store.get_run("run-decision").unwrap().unwrap().status,
        "queued"
    );
    assert_eq!(
        store.list_node_runs("run-decision").unwrap()[0].status,
        "ready"
    );
    store.cancel_run("run-decision").unwrap();
    assert_eq!(
        store.get_run("run-decision").unwrap().unwrap().status,
        "cancelled"
    );
    assert_eq!(store.list_events("run-decision").unwrap().len(), 2);
    store.save_mcp_config("exa", r#"{"id":"exa"}"#).unwrap();
    assert_eq!(store.list_mcp_configs().unwrap()[0].id, "exa");
    store.delete_mcp_config("exa").unwrap();
    assert!(store.list_mcp_configs().unwrap().is_empty());
}
