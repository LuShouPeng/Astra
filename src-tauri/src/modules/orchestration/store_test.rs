use super::store::{
    ApprovalRecord, ArtifactRecord, NodeRunRecord, OrchestrationStore, WorkflowRunRecord,
};

#[test]
fn retry_is_atomic_and_rejects_non_failed_or_inactive_nodes() {
    let store = OrchestrationStore::in_memory().unwrap();
    for (run_id, run_status, node_status) in [
        ("run-failed-node", "running", "failed"),
        ("run-succeeded-node", "running", "succeeded"),
        ("run-inactive", "failed", "failed"),
    ] {
        store
            .save_run(&WorkflowRunRecord {
                id: run_id.into(),
                workflow_id: "workflow-1".into(),
                workflow_version: 1,
                project_id: "project-1".into(),
                status: run_status.into(),
                integration_branch: None,
            })
            .unwrap();
        store
            .save_node_run(&NodeRunRecord {
                id: format!("{run_id}-agent"),
                run_id: run_id.into(),
                node_id: "agent".into(),
                status: node_status.into(),
                attempt: 1,
                provider: None,
                worktree_path: None,
            })
            .unwrap();
    }

    assert!(store.retry_node("run-failed-node", "agent", 1).unwrap());
    assert!(!store.retry_node("run-succeeded-node", "agent", 3).unwrap());
    assert!(!store.retry_node("run-inactive", "agent", 3).unwrap());
    assert!(!store.retry_node("run-failed-node", "agent", 3).unwrap());

    let retried = store.list_node_runs("run-failed-node").unwrap();
    assert_eq!(
        (retried[0].status.as_str(), retried[0].attempt),
        ("pending", 2)
    );
    assert_eq!(store.list_events("run-failed-node").unwrap().len(), 1);
}

#[test]
fn run_control_commands_do_not_rewrite_terminal_or_unrelated_approval_state() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-controls".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "completed".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-controls-node".into(),
            run_id: "run-controls".into(),
            node_id: "approval".into(),
            status: "succeeded".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();
    store
        .save_approval(&ApprovalRecord {
            id: "approval-controls".into(),
            run_id: "run-controls".into(),
            node_run_id: "run-controls-node".into(),
            capability: "execute".into(),
            risk: "medium".into(),
            summary: "Execute command".into(),
            status: "pending".into(),
        })
        .unwrap();

    assert!(!store.decide_run("run-controls", true).unwrap());
    assert!(!store.decide_approval("approval-controls", true).unwrap());
    assert!(!store.cancel_run("run-controls").unwrap());
    assert!(!store.resume_run("run-controls").unwrap());
    assert_eq!(
        store.get_run("run-controls").unwrap().unwrap().status,
        "completed"
    );
    assert_eq!(
        store.list_node_runs("run-controls").unwrap()[0].status,
        "succeeded"
    );
    assert_eq!(
        store.list_approvals("run-controls").unwrap()[0].status,
        "pending"
    );
    assert!(store.list_events("run-controls").unwrap().is_empty());
}

#[test]
fn cancelling_an_active_run_closes_pending_approvals() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-cancel-approvals".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "waiting".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-cancel-approvals-agent".into(),
            run_id: "run-cancel-approvals".into(),
            node_id: "agent".into(),
            status: "waiting_approval".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();
    for capability in ["execute", "network"] {
        store
            .save_approval(&ApprovalRecord {
                id: format!("approval-cancel-{capability}"),
                run_id: "run-cancel-approvals".into(),
                node_run_id: "run-cancel-approvals-agent".into(),
                capability: capability.into(),
                risk: "high".into(),
                summary: format!("Allow {capability}"),
                status: "pending".into(),
            })
            .unwrap();
    }

    assert!(store.cancel_run("run-cancel-approvals").unwrap());
    assert!(store
        .list_approvals("run-cancel-approvals")
        .unwrap()
        .iter()
        .all(|approval| approval.status == "rejected"));
}

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
fn run_bundle_creation_rolls_back_every_record_on_failure() {
    let store = OrchestrationStore::in_memory().unwrap();
    let run = WorkflowRunRecord {
        id: "run-atomic".into(),
        workflow_id: "workflow-1".into(),
        workflow_version: 1,
        project_id: "project-1".into(),
        status: "waiting".into(),
        integration_branch: Some("astra/run-atomic".into()),
    };
    let duplicate = NodeRunRecord {
        id: "run-atomic-node".into(),
        run_id: "run-atomic".into(),
        node_id: "agent".into(),
        status: "waiting_approval".into(),
        attempt: 1,
        provider: None,
        worktree_path: None,
    };
    let approval = ApprovalRecord {
        id: "approval-run-atomic".into(),
        run_id: "run-atomic".into(),
        node_run_id: "run-atomic-node".into(),
        capability: "worktree".into(),
        risk: "medium".into(),
        summary: "Create worktrees".into(),
        status: "pending".into(),
    };
    assert!(store
        .create_run_bundle(
            &run,
            &[duplicate.clone(), duplicate],
            &approval,
            &[],
            &[],
            r#"{"type":"run_created"}"#,
        )
        .is_err());
    assert!(store.get_run("run-atomic").unwrap().is_none());
    assert!(store.list_node_runs("run-atomic").unwrap().is_empty());
    assert!(store.list_approvals("run-atomic").unwrap().is_empty());
}

#[test]
fn run_bundle_rolls_back_when_an_mcp_snapshot_source_disappears() {
    let store = OrchestrationStore::in_memory().unwrap();
    let run = WorkflowRunRecord {
        id: "run-missing-mcp".into(),
        workflow_id: "workflow-1".into(),
        workflow_version: 1,
        project_id: "project-1".into(),
        status: "waiting".into(),
        integration_branch: None,
    };
    let node = NodeRunRecord {
        id: "run-missing-mcp-agent".into(),
        run_id: run.id.clone(),
        node_id: "agent".into(),
        status: "waiting_approval".into(),
        attempt: 1,
        provider: None,
        worktree_path: None,
    };
    let approval = ApprovalRecord {
        id: "approval-run-missing-mcp".into(),
        run_id: run.id.clone(),
        node_run_id: node.id.clone(),
        capability: "worktree".into(),
        risk: "medium".into(),
        summary: "Create worktrees".into(),
        status: "pending".into(),
    };
    assert!(store
        .create_run_bundle(
            &run,
            &[node],
            &approval,
            &[],
            &[("agent".into(), vec!["missing".into()])],
            r#"{"type":"run_created"}"#,
        )
        .is_err());
    assert!(store.get_run(&run.id).unwrap().is_none());
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
        "pending"
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

#[test]
fn snapshots_node_mcp_configs_independently_from_the_registry() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-mcp".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "queued".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_mcp_config("exa", r#"{"id":"exa","secretRef":"credential/exa"}"#)
        .unwrap();
    store
        .snapshot_node_mcp_configs("run-mcp", "agent-1", &["exa".into()])
        .unwrap();
    store.delete_mcp_config("exa").unwrap();
    let snapshots = store.list_node_mcp_configs("run-mcp", "agent-1").unwrap();
    assert_eq!(snapshots.len(), 1);
    assert!(snapshots[0].config_json.contains("credential/exa"));
    assert!(store.mcp_secret_reference_in_use("credential/exa").unwrap());
}

#[test]
fn detects_only_live_mcp_secret_references() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_mcp_config("exa", r#"{"id":"exa","secretRef":"credential/exa"}"#)
        .unwrap();
    assert!(store.mcp_secret_reference_in_use("credential/exa").unwrap());
    assert!(!store
        .mcp_secret_reference_in_use("credential/other")
        .unwrap());
    store.delete_mcp_config("exa").unwrap();
    assert!(!store.mcp_secret_reference_in_use("credential/exa").unwrap());
}

#[test]
fn reconstructs_a_run_projection_with_runtime_evidence() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-projection".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 2,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: Some("astra/run-projection".into()),
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-projection-agent".into(),
            run_id: "run-projection".into(),
            node_id: "agent".into(),
            status: "succeeded".into(),
            attempt: 2,
            provider: None,
            worktree_path: Some("C:/worktrees/agent".into()),
        })
        .unwrap();
    store
        .update_node_evidence(
            "run-projection",
            "agent",
            Some("thread-1"),
            Some(r#"{"commit":"abc123"}"#),
            None,
        )
        .unwrap();
    store
        .update_node_provider("run-projection", "agent", "codex")
        .unwrap();
    store
        .append_event(
            "run-projection",
            r#"{"type":"node_output","message":"tests passed"}"#,
        )
        .unwrap();
    store
        .save_artifact(&ArtifactRecord {
            id: "artifact-log".into(),
            run_id: "run-projection".into(),
            node_run_id: Some("run-projection-agent".into()),
            kind: "log".into(),
            path: "C:/runs/agent.log".into(),
            content_hash: "abc123".into(),
            byte_length: 42,
        })
        .unwrap();

    let projection = store.get_run_projection("run-projection").unwrap().unwrap();
    assert_eq!(projection.run.id, "run-projection");
    assert_eq!(
        projection.nodes[0].external_session_id.as_deref(),
        Some("thread-1")
    );
    assert_eq!(
        projection.nodes[0].output_json.as_deref(),
        Some(r#"{"commit":"abc123"}"#)
    );
    assert_eq!(projection.events.len(), 1);
    assert_eq!(projection.nodes[0].node.provider.as_deref(), Some("codex"));
    assert_eq!(projection.artifacts.len(), 1);
    assert_eq!(projection.artifacts[0].byte_length, 42);
}

#[test]
fn preserves_skill_versions_referenced_by_historical_runs() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-skill".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "queued".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_skill_package(
            "review-skill",
            "1.0.0",
            "abc123",
            r#"{"name":"Review Skill"}"#,
        )
        .unwrap();
    store
        .snapshot_skill_refs("run-skill", &["review-skill".into()])
        .unwrap();
    store.uninstall_skill("review-skill", "abc123").unwrap();

    assert_eq!(store.list_skill_packages(true).unwrap().len(), 1);
    assert_eq!(store.list_run_skill_refs("run-skill").unwrap().len(), 1);
}

#[test]
fn backs_up_a_legacy_database_before_transactional_migration() {
    let path = std::env::temp_dir().join(format!(
        "astra-orchestration-v1-{}.sqlite3",
        std::process::id()
    ));
    let backup = path.with_extension("sqlite3.v1.backup");
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&backup);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.pragma_update(None, "user_version", 1).unwrap();
    connection
        .execute_batch("CREATE TABLE legacy (id TEXT);")
        .unwrap();
    drop(connection);

    assert_eq!(
        OrchestrationStore::backup_legacy_database(&path).unwrap(),
        Some(backup.clone())
    );
    assert!(backup.is_file());
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(backup);
}
