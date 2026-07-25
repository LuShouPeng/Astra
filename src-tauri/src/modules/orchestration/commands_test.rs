use super::commands::{
    create_run, reconcile_persisted_run, request_final_merge, retry_node_checked,
    update_node_evidence_checked, update_node_provider_checked, update_node_status_checked,
    valid_external_node_transition, validate_run_definition, validate_run_input,
    validate_workflow_input, validate_worktree_cleanup, RunCreateInput, RunExecutionContextInput,
    WorkflowSaveInput,
};
use super::store::{
    ApprovalRecord, NodeRunRecord, OrchestrationStore, WorkflowMergeApprovalRecord,
    WorkflowRunContextRecord, WorkflowRunRecord,
};

fn input() -> WorkflowSaveInput {
    WorkflowSaveInput {
        id: "workflow-1".into(),
        version: 1,
        name: "Build and verify".into(),
        project_id: "project-1".into(),
        definition_json: r#"{
          "id":"workflow-1","version":1,"projectId":"project-1",
          "settings":{"maxConcurrency":2,"defaultRetries":1},
          "nodes":[
            {"id":"agent","type":"agent"},
            {"id":"gate","type":"condition","expression":"agent.succeeded"},
            {"id":"done","type":"join","strategy":"all"}
          ],
          "edges":[
            {"source":"agent","target":"gate"},
            {"source":"gate","target":"done","outcome":"true"}
          ]
        }"#
        .into(),
    }
}

fn execution_context() -> RunExecutionContextInput {
    RunExecutionContextInput {
        repository_path: "C:/projects/astra".into(),
        provider_paths_json: r#"{"codexPath":"C:/tools/codex.exe"}"#.into(),
    }
}

fn save_cleanup_run(store: &OrchestrationStore, id: &str, status: &str) {
    store
        .save_run(&WorkflowRunRecord {
            id: id.into(),
            workflow_id: "workflow-cleanup".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: status.into(),
            integration_branch: Some(format!("astra/run-{id}")),
        })
        .unwrap();
    store
        .save_run_context(&WorkflowRunContextRecord {
            run_id: id.into(),
            repository_path: "C:/projects/astra".into(),
            provider_paths_json: "{}".into(),
            run_worktree_json: Some(format!(r#"{{"id":"{id}","branch":"astra/run-{id}"}}"#)),
        })
        .unwrap();
}

#[test]
fn cleanup_only_allows_safe_terminal_runs_without_active_final_merge_approval() {
    let store = OrchestrationStore::in_memory().unwrap();

    for status in ["completed", "failed", "cancelled"] {
        let run_id = format!("run-cleanup-{status}");
        save_cleanup_run(&store, &run_id, status);
        assert_eq!(
            validate_worktree_cleanup(&store, &run_id)
                .unwrap()
                .repository_path,
            "C:/projects/astra"
        );
    }

    for status in ["waiting", "queued", "running", "paused", "interrupted"] {
        let run_id = format!("run-cleanup-unsafe-{status}");
        save_cleanup_run(&store, &run_id, status);
        assert_eq!(
            validate_worktree_cleanup(&store, &run_id).unwrap_err(),
            "Worktrees can only be cleaned up after a workflow run has completed, failed, or been cancelled."
        );
    }

    save_cleanup_run(&store, "run-cleanup-pending-merge", "completed");
    store
        .request_merge_approval(&WorkflowMergeApprovalRecord {
            id: "merge-cleanup-pending".into(),
            run_id: "run-cleanup-pending-merge".into(),
            status: "pending".into(),
            summary: "Review final merge".into(),
            merged_commit: None,
        })
        .unwrap();
    assert_eq!(
        validate_worktree_cleanup(&store, "run-cleanup-pending-merge").unwrap_err(),
        "Worktrees cannot be cleaned up while a final merge approval is pending or in progress."
    );

    save_cleanup_run(&store, "run-cleanup-approved-merge", "completed");
    store
        .request_merge_approval(&WorkflowMergeApprovalRecord {
            id: "merge-cleanup-approved".into(),
            run_id: "run-cleanup-approved-merge".into(),
            status: "pending".into(),
            summary: "Review final merge".into(),
            merged_commit: None,
        })
        .unwrap();
    assert!(store
        .decide_merge_approval("merge-cleanup-approved", true)
        .unwrap());
    assert_eq!(
        validate_worktree_cleanup(&store, "run-cleanup-approved-merge").unwrap_err(),
        "Worktrees cannot be cleaned up while a final merge approval is pending or in progress."
    );
}

#[test]
fn final_merge_requires_a_completed_run_with_persisted_execution_context() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-final-merge".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "completed".into(),
            integration_branch: Some("astra/run-run-final-merge".into()),
        })
        .unwrap();
    store
        .save_run_context(&WorkflowRunContextRecord {
            run_id: "run-final-merge".into(),
            repository_path: "C:/projects/astra".into(),
            provider_paths_json: "{}".into(),
            run_worktree_json: Some(
                r#"{"id":"run-final-merge","branch":"astra/run-run-final-merge"}"#.into(),
            ),
        })
        .unwrap();

    let requested = request_final_merge(&store, "run-final-merge").unwrap();
    assert_eq!(requested.merge_approval.unwrap().status, "pending");
    assert_eq!(
        store
            .list_events("run-final-merge")
            .unwrap()
            .iter()
            .filter(|event| event.contains("merge_approval_requested"))
            .count(),
        1
    );
    assert!(request_final_merge(&store, "run-final-merge").is_err());
}

#[test]
fn retries_only_failed_nodes_using_the_saved_workflow_budget() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = serde_json::json!({
        "id": "workflow-retry",
        "version": 1,
        "projectId": "project-1",
        "settings": { "maxConcurrency": 2, "defaultRetries": 1 },
        "nodes": [
            { "id": "default", "type": "agent" },
            { "id": "disabled", "type": "agent", "retries": 0 },
            { "id": "succeeded", "type": "agent", "retries": 3 }
        ],
        "edges": []
    });
    store
        .save_workflow(
            "workflow-retry",
            1,
            "Retry policy",
            "project-1",
            &definition.to_string(),
        )
        .unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-retry".into(),
            workflow_id: "workflow-retry".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .unwrap();
    for (node_id, status) in [
        ("default", "failed"),
        ("disabled", "failed"),
        ("succeeded", "succeeded"),
    ] {
        store
            .save_node_run(&NodeRunRecord {
                id: format!("run-retry-{node_id}"),
                run_id: "run-retry".into(),
                node_id: node_id.into(),
                status: status.into(),
                attempt: 1,
                provider: None,
                worktree_path: None,
            })
            .unwrap();
    }

    assert!(retry_node_checked(&store, "run-retry", "default").unwrap());
    assert!(!retry_node_checked(&store, "run-retry", "disabled").unwrap());
    assert!(retry_node_checked(&store, "run-retry", "succeeded").is_err());

    let nodes = store.list_node_runs("run-retry").unwrap();
    let default = nodes.iter().find(|node| node.node_id == "default").unwrap();
    let disabled = nodes
        .iter()
        .find(|node| node.node_id == "disabled")
        .unwrap();
    assert_eq!((default.status.as_str(), default.attempt), ("pending", 2));
    assert_eq!((disabled.status.as_str(), disabled.attempt), ("failed", 1));
}

#[test]
fn validates_bounded_run_creation_input() {
    let mut input = RunCreateInput {
        id: "run-1".into(),
        workflow_id: "workflow-1".into(),
        workflow_version: 1,
        project_id: "project-1".into(),
        integration_branch: "astra/run-run-1".into(),
        node_ids: vec!["node-1".into()],
        execution_context: execution_context(),
    };
    assert!(validate_run_input(&input).is_ok());
    input.node_ids.clear();
    assert!(validate_run_input(&input).is_err());
    input.node_ids = vec!["node-1".into()];
    input.execution_context.repository_path = "relative/project".into();
    assert!(validate_run_input(&input).is_err());
}

#[test]
fn external_node_updates_cannot_bypass_or_rewrite_terminal_states() {
    assert!(!valid_external_node_transition("pending", "succeeded"));
    assert!(valid_external_node_transition("ready", "running"));
    assert!(valid_external_node_transition("running", "succeeded"));
    assert!(!valid_external_node_transition("succeeded", "running"));

    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-state".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-state-agent".into(),
            run_id: "run-state".into(),
            node_id: "agent".into(),
            status: "pending".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();
    assert!(update_node_status_checked(&store, "run-state", "agent", "succeeded", None).is_err());
    assert!(update_node_evidence_checked(
        &store,
        "run-state",
        "agent",
        None,
        Some(serde_json::json!({ "forged": true })),
        None
    )
    .is_err());
    store
        .update_node_status("run-state", "agent", "ready", None)
        .unwrap();
    update_node_status_checked(&store, "run-state", "agent", "running", None).unwrap();
    update_node_evidence_checked(
        &store,
        "run-state",
        "agent",
        None,
        Some(serde_json::json!({ "commit": "abc123" })),
        None,
    )
    .unwrap();
    update_node_status_checked(&store, "run-state", "agent", "succeeded", None).unwrap();
    assert!(update_node_status_checked(&store, "run-state", "agent", "running", None).is_err());
    assert!(update_node_evidence_checked(
        &store,
        "run-state",
        "agent",
        None,
        Some(serde_json::json!({ "rewritten": true })),
        None
    )
    .is_err());
    let audit = store.list_events("run-state").unwrap().join("\n");
    assert!(audit.contains("running"));
    assert!(audit.contains("succeeded"));
}

#[test]
fn provider_selection_is_limited_to_active_agent_nodes() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = serde_json::json!({
        "id": "workflow-provider",
        "version": 1,
        "projectId": "project-1",
        "settings": { "maxConcurrency": 2, "defaultRetries": 0 },
        "nodes": [
            { "id": "agent", "type": "agent" },
            { "id": "join", "type": "join", "strategy": "all" }
        ],
        "edges": []
    });
    store
        .save_workflow(
            "workflow-provider",
            1,
            "Provider",
            "project-1",
            &definition.to_string(),
        )
        .unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-provider".into(),
            workflow_id: "workflow-provider".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .unwrap();
    for node_id in ["agent", "join"] {
        store
            .save_node_run(&NodeRunRecord {
                id: format!("run-provider-{node_id}"),
                run_id: "run-provider".into(),
                node_id: node_id.into(),
                status: "ready".into(),
                attempt: 1,
                provider: None,
                worktree_path: None,
            })
            .unwrap();
    }
    update_node_provider_checked(&store, "run-provider", "agent", "codex").unwrap();
    assert!(update_node_provider_checked(&store, "run-provider", "join", "codex").is_err());
    store
        .update_node_status("run-provider", "agent", "succeeded", None)
        .unwrap();
    assert!(update_node_provider_checked(&store, "run-provider", "agent", "claude").is_err());
    let provider = store
        .list_node_runs("run-provider")
        .unwrap()
        .into_iter()
        .find(|node| node.node_id == "agent")
        .unwrap()
        .provider;
    assert_eq!(provider.as_deref(), Some("codex"));
}

#[test]
fn run_nodes_must_exactly_match_the_saved_workflow() {
    let mut input = RunCreateInput {
        id: "run-1".into(),
        workflow_id: "workflow-1".into(),
        workflow_version: 1,
        project_id: "project-1".into(),
        integration_branch: "astra/run-run-1".into(),
        node_ids: vec!["agent-1".into(), "join-1".into()],
        execution_context: execution_context(),
    };
    let definition = serde_json::json!({
        "projectId": "project-1",
        "nodes": [
            {
                "id": "agent-1",
                "type": "agent",
                "mcpServerIds": ["exa"],
                "skillIds": ["review"]
            },
            { "id": "join-1", "type": "join" }
        ]
    });
    let capabilities = validate_run_definition(&input, &definition).unwrap();
    assert_eq!(capabilities[0].mcp_server_ids, ["exa"]);
    assert_eq!(capabilities[0].skill_ids, ["review"]);

    input.node_ids = vec!["agent-1".into()];
    assert!(validate_run_definition(&input, &definition).is_err());
    input.node_ids = vec!["agent-1".into(), "join-1".into()];
    input.project_id = "other-project".into();
    assert!(validate_run_definition(&input, &definition).is_err());
}

#[test]
fn creating_a_run_snapshots_each_nodes_mcp_configuration() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = serde_json::json!({
        "id": "workflow-1",
        "projectId": "project-1",
        "settings": { "maxConcurrency": 2, "defaultRetries": 1 },
        "nodes": [
            {
                "id": "agent-1",
                "type": "agent",
                "mcpServerIds": ["exa"],
                "skillIds": []
            }
        ],
        "edges": []
    });
    store
        .save_workflow(
            "workflow-1",
            1,
            "Runtime",
            "project-1",
            &definition.to_string(),
        )
        .unwrap();
    store
        .save_mcp_config(
            "exa",
            r#"{"id":"exa","name":"Exa","transport":"streamable_http","url":"https://mcp.exa.ai/mcp","enabled":true}"#,
        )
        .unwrap();
    let input = RunCreateInput {
        id: "run-snapshot".into(),
        workflow_id: "workflow-1".into(),
        workflow_version: 1,
        project_id: "project-1".into(),
        integration_branch: "astra/run-run-snapshot".into(),
        node_ids: vec!["agent-1".into()],
        execution_context: execution_context(),
    };
    create_run(&store, input.clone()).unwrap();
    assert!(create_run(&store, input).is_err());
    store.delete_mcp_config("exa").unwrap();

    let snapshots = store
        .list_node_mcp_configs("run-snapshot", "agent-1")
        .unwrap();
    assert_eq!(snapshots.len(), 1);
    assert!(snapshots[0].config_json.contains("mcp.exa.ai"));
    assert_eq!(
        store
            .get_run_projection("run-snapshot")
            .unwrap()
            .unwrap()
            .context
            .unwrap()
            .repository_path,
        "C:/projects/astra"
    );
    let audit = store.list_events("run-snapshot").unwrap().join("\n");
    assert!(audit.contains("approval_requested"));
    assert!(audit.contains("worktree"));
}

#[test]
fn creating_a_run_rejects_missing_skill_snapshots_without_partial_state() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = serde_json::json!({
        "id": "workflow-skill",
        "projectId": "project-1",
        "settings": { "maxConcurrency": 1, "defaultRetries": 0 },
        "nodes": [{
            "id": "agent",
            "type": "agent",
            "mcpServerIds": [],
            "skillIds": ["missing-skill"]
        }],
        "edges": []
    });
    store
        .save_workflow(
            "workflow-skill",
            1,
            "Skill",
            "project-1",
            &definition.to_string(),
        )
        .unwrap();
    let result = create_run(
        &store,
        RunCreateInput {
            id: "run-missing-skill".into(),
            workflow_id: "workflow-skill".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            integration_branch: "astra/run-missing-skill".into(),
            node_ids: vec!["agent".into()],
            execution_context: execution_context(),
        },
    );
    assert!(result.is_err());
    assert!(store.get_run("run-missing-skill").unwrap().is_none());
}

#[test]
fn validates_workflow_command_input() {
    assert!(validate_workflow_input(&input()).is_ok());

    let mut invalid_id = input();
    invalid_id.id = "../outside".into();
    assert!(validate_workflow_input(&invalid_id).is_err());

    let mut invalid_version = input();
    invalid_version.version = 0;
    assert!(validate_workflow_input(&invalid_version).is_err());

    let mut invalid_json = input();
    invalid_json.definition_json = "not json".into();
    assert!(validate_workflow_input(&invalid_json).is_err());

    let mut cyclic = input();
    cyclic.definition_json = r#"{
      "id":"workflow-1","version":1,"projectId":"project-1",
      "settings":{"maxConcurrency":2,"defaultRetries":1},
      "nodes":[{"id":"a","type":"agent"},{"id":"b","type":"join","strategy":"all"}],
      "edges":[{"source":"a","target":"b"},{"source":"b","target":"a"}]
    }"#
    .into();
    assert!(validate_workflow_input(&cyclic).is_err());

    let mut invalid_outcome = input();
    invalid_outcome.definition_json = r#"{
      "id":"workflow-1","version":1,"projectId":"project-1",
      "settings":{"maxConcurrency":2,"defaultRetries":1},
      "nodes":[{"id":"a","type":"agent"},{"id":"b","type":"join","strategy":"all"}],
      "edges":[{"source":"a","target":"b","outcome":"true"}]
    }"#
    .into();
    assert!(validate_workflow_input(&invalid_outcome).is_err());
}

#[test]
fn persisted_reconciliation_drives_conditions_approvals_and_joins() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = r#"{
      "id":"workflow-1","version":1,
      "settings":{"maxConcurrency":2,"defaultRetries":1},
      "nodes":[
        {"id":"agent","type":"agent"},
        {"id":"gate","type":"condition","expression":"agent.succeeded"},
        {"id":"yes","type":"join","strategy":"all"},
        {"id":"no","type":"join","strategy":"all"}
      ],
      "edges":[
        {"source":"agent","target":"gate"},
        {"source":"gate","target":"yes","outcome":"true"},
        {"source":"gate","target":"no","outcome":"false"}
      ]
    }"#;
    store
        .save_workflow("workflow-1", 1, "Runtime", "project-1", definition)
        .unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-1".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "queued".into(),
            integration_branch: Some("astra/run-1".into()),
        })
        .unwrap();
    for id in ["agent", "gate", "yes", "no"] {
        store
            .save_node_run(&NodeRunRecord {
                id: format!("run-1-{id}"),
                run_id: "run-1".into(),
                node_id: id.into(),
                status: "pending".into(),
                attempt: 1,
                provider: None,
                worktree_path: None,
            })
            .unwrap();
    }

    let first = reconcile_persisted_run(&store, "run-1").unwrap();
    assert_eq!(first.nodes[0].node.status, "waiting_approval");
    let approval = first.approvals.first().unwrap();
    store.decide_approval(&approval.id, true).unwrap();
    let ready = reconcile_persisted_run(&store, "run-1").unwrap();
    assert_eq!(ready.nodes[0].node.status, "ready");

    store
        .update_node_status("run-1", "agent", "succeeded", None)
        .unwrap();
    let completed = reconcile_persisted_run(&store, "run-1").unwrap();
    assert_eq!(completed.run.status, "completed");
    let node_status = |id: &str| {
        completed
            .nodes
            .iter()
            .find(|node| node.node.node_id == id)
            .unwrap()
            .node
            .status
            .as_str()
    };
    assert_eq!(node_status("gate"), "succeeded");
    assert_eq!(node_status("yes"), "succeeded");
    assert_eq!(node_status("no"), "skipped");
}

#[test]
fn agent_with_mcp_capabilities_requires_execute_and_network_approval() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = r#"{
      "id":"workflow-agent-mcp","version":1,"projectId":"project-1",
      "settings":{"maxConcurrency":1,"defaultRetries":0},
      "nodes":[{
        "id":"agent","type":"agent","provider":"auto","prompt":"Research",
        "skillIds":[],"mcpServerIds":["exa"]
      }],
      "edges":[]
    }"#;
    store
        .save_workflow(
            "workflow-agent-mcp",
            1,
            "Agent MCP",
            "project-1",
            definition,
        )
        .unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-agent-mcp".into(),
            workflow_id: "workflow-agent-mcp".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "queued".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-agent-mcp-agent".into(),
            run_id: "run-agent-mcp".into(),
            node_id: "agent".into(),
            status: "pending".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();

    let waiting = reconcile_persisted_run(&store, "run-agent-mcp").unwrap();
    assert_eq!(waiting.run.status, "waiting");
    assert_eq!(waiting.nodes[0].node.status, "waiting_approval");
    assert_eq!(
        waiting
            .approvals
            .iter()
            .map(|approval| approval.capability.as_str())
            .collect::<std::collections::HashSet<_>>(),
        std::collections::HashSet::from(["execute", "network"])
    );
    let request_events = store
        .list_events("run-agent-mcp")
        .unwrap()
        .into_iter()
        .filter(|event| event.contains("approval_requested"))
        .collect::<Vec<_>>();
    assert_eq!(request_events.len(), 2);
    assert!(request_events.iter().any(|event| event.contains("execute")));
    assert!(request_events.iter().any(|event| event.contains("network")));

    let execute = waiting
        .approvals
        .iter()
        .find(|approval| approval.capability == "execute")
        .unwrap();
    assert!(store.decide_approval(&execute.id, true).unwrap());
    let still_waiting = reconcile_persisted_run(&store, "run-agent-mcp").unwrap();
    assert_eq!(still_waiting.nodes[0].node.status, "waiting_approval");

    let network = still_waiting
        .approvals
        .iter()
        .find(|approval| approval.capability == "network")
        .unwrap();
    assert!(store.decide_approval(&network.id, true).unwrap());
    let ready = reconcile_persisted_run(&store, "run-agent-mcp").unwrap();
    assert_eq!(ready.nodes[0].node.status, "ready");
}

#[test]
fn rejected_node_approval_cancels_the_persisted_run() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = r#"{
      "id":"workflow-reject","version":1,"projectId":"project-1",
      "settings":{"maxConcurrency":1,"defaultRetries":0},
      "nodes":[{"id":"approval","type":"approval"}],
      "edges":[]
    }"#;
    store
        .save_workflow("workflow-reject", 1, "Reject", "project-1", definition)
        .unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-reject".into(),
            workflow_id: "workflow-reject".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-reject-approval".into(),
            run_id: "run-reject".into(),
            node_id: "approval".into(),
            status: "pending".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();
    let waiting = reconcile_persisted_run(&store, "run-reject").unwrap();
    let approval_id = waiting.approvals[0].id.clone();
    store.decide_approval(&approval_id, false).unwrap();

    let cancelled = reconcile_persisted_run(&store, "run-reject").unwrap();
    assert_eq!(cancelled.run.status, "cancelled");
    assert_eq!(cancelled.nodes[0].node.status, "cancelled");
}

#[test]
fn rejecting_one_agent_capability_closes_its_sibling_approvals() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-reject-capability".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "waiting".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-reject-capability-agent".into(),
            run_id: "run-reject-capability".into(),
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
                id: format!("approval-reject-{capability}"),
                run_id: "run-reject-capability".into(),
                node_run_id: "run-reject-capability-agent".into(),
                capability: capability.into(),
                risk: "high".into(),
                summary: format!("Allow {capability}"),
                status: "pending".into(),
            })
            .unwrap();
    }

    assert!(store
        .decide_approval("approval-reject-execute", false)
        .unwrap());
    assert!(store
        .list_approvals("run-reject-capability")
        .unwrap()
        .iter()
        .all(|approval| approval.status == "rejected"));
}
