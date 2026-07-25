use super::{
    extensions::{
        mcp_invocation_evidence, preflight_agent_capabilities, resolve_mcp_configs,
        resolve_run_mcp_config, AgentCapabilityPreflightInput, McpServerInput,
    },
    store::{NodeRunRecord, OrchestrationStore, WorkflowRunRecord},
};

#[test]
fn mcp_invocation_evidence_does_not_persist_tool_results() {
    let result = serde_json::json!({ "secret": "must-not-be-persisted" });
    let evidence = mcp_invocation_evidence("exa", "search");
    assert!(evidence.contains("exa"));
    assert!(evidence.contains("search"));
    assert!(!evidence.contains(result["secret"].as_str().unwrap()));
}

fn http_server(id: &str) -> McpServerInput {
    McpServerInput {
        id: id.into(),
        name: id.into(),
        transport: "streamable_http".into(),
        command: None,
        args: vec![],
        url: Some(format!("https://{id}.example.test/mcp")),
        secret_ref: Some(format!("credentials/{id}")),
        secret_header: Some("x-api-key".into()),
        enabled: true,
    }
}

#[test]
fn fails_preflight_for_disabled_or_missing_credentials() {
    let mut disabled = http_server("disabled");
    disabled.enabled = false;
    assert!(resolve_mcp_configs(&["disabled".into()], |_| Ok(Some(disabled.clone()))).is_err());
}

#[test]
fn resolves_only_registered_unique_mcp_ids() {
    let ids = vec!["exa".to_string()];
    let configs = resolve_mcp_configs(&ids, |id| Ok((id == "exa").then(|| http_server(id))))
        .expect("registered config");
    assert_eq!(configs[0].id, "exa");
    assert!(resolve_mcp_configs(&["missing".into()], |_| Ok(None)).is_err());
    assert!(resolve_mcp_configs(&["exa".into(), "exa".into()], |id| {
        Ok(Some(http_server(id)))
    })
    .is_err());
}

#[test]
fn preflight_validates_immutable_snapshots_and_audits_only_public_ids() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = serde_json::json!({
        "id": "workflow-1",
        "version": 1,
        "projectId": "project-1",
        "settings": { "maxConcurrency": 1, "defaultRetries": 0 },
        "nodes": [{
            "id": "agent-1", "type": "agent", "provider": "auto", "prompt": "Research",
            "skillIds": [], "mcpServerIds": ["exa"]
        }],
        "edges": []
    });
    store
        .save_workflow(
            "workflow-1",
            1,
            "Research",
            "project-1",
            &definition.to_string(),
        )
        .unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-1".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-1-agent-1".into(),
            run_id: "run-1".into(),
            node_id: "agent-1".into(),
            status: "ready".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();
    store
        .save_mcp_config("exa", &serde_json::to_string(&http_server("exa")).unwrap())
        .unwrap();
    store
        .snapshot_node_mcp_configs("run-1", "agent-1", &["exa".into()])
        .unwrap();
    store.delete_mcp_config("exa").unwrap();
    let manifest = preflight_agent_capabilities(
        &store,
        &AgentCapabilityPreflightInput {
            run_id: "run-1".into(),
            node_id: "agent-1".into(),
            mcp_server_ids: vec!["exa".into()],
            skill_ids: vec![],
        },
        |reference| {
            assert_eq!(reference, "AstraNexus/credentials/exa");
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(manifest.mcp_servers[0].id, "exa");
    assert_eq!(
        store
            .list_node_mcp_configs("run-1", "agent-1")
            .unwrap()
            .len(),
        1
    );
    let audit = store.list_events("run-1").unwrap().join("\n");
    assert!(audit.contains("exa"));
    assert!(!audit.contains("credentials/exa"));
}

#[test]
fn preflight_rejects_capabilities_not_declared_by_the_saved_agent_node() {
    let store = OrchestrationStore::in_memory().unwrap();
    let definition = serde_json::json!({
        "id": "workflow-boundary",
        "version": 1,
        "projectId": "project-1",
        "settings": { "maxConcurrency": 1, "defaultRetries": 0 },
        "nodes": [{
            "id": "agent", "type": "agent", "provider": "auto", "prompt": "Research",
            "skillIds": [], "mcpServerIds": ["exa"]
        }],
        "edges": []
    });
    store
        .save_workflow(
            "workflow-boundary",
            1,
            "Boundary",
            "project-1",
            &definition.to_string(),
        )
        .unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-boundary".into(),
            workflow_id: "workflow-boundary".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "running".into(),
            integration_branch: None,
        })
        .unwrap();
    store
        .save_node_run(&NodeRunRecord {
            id: "run-boundary-agent".into(),
            run_id: "run-boundary".into(),
            node_id: "agent".into(),
            status: "ready".into(),
            attempt: 1,
            provider: None,
            worktree_path: None,
        })
        .unwrap();
    for id in ["exa", "injected"] {
        store
            .save_mcp_config(id, &serde_json::to_string(&http_server(id)).unwrap())
            .unwrap();
    }
    store
        .snapshot_node_mcp_configs("run-boundary", "agent", &["exa".into()])
        .unwrap();

    assert!(preflight_agent_capabilities(
        &store,
        &AgentCapabilityPreflightInput {
            run_id: "run-boundary".into(),
            node_id: "agent".into(),
            mcp_server_ids: vec!["exa".into(), "injected".into()],
            skill_ids: vec![],
        },
        |_| Ok(()),
    )
    .is_err());
    assert!(preflight_agent_capabilities(
        &store,
        &AgentCapabilityPreflightInput {
            run_id: "run-boundary".into(),
            node_id: "missing".into(),
            mcp_server_ids: vec!["exa".into()],
            skill_ids: vec![],
        },
        |_| Ok(()),
    )
    .is_err());
    assert!(store.list_events("run-boundary").unwrap().is_empty());
}

#[test]
fn run_mcp_resolution_is_stable_after_registry_changes() {
    let store = OrchestrationStore::in_memory().unwrap();
    store
        .save_run(&WorkflowRunRecord {
            id: "run-stable".into(),
            workflow_id: "workflow-1".into(),
            workflow_version: 1,
            project_id: "project-1".into(),
            status: "queued".into(),
            integration_branch: None,
        })
        .unwrap();
    let original = http_server("exa");
    store
        .save_mcp_config("exa", &serde_json::to_string(&original).unwrap())
        .unwrap();
    store
        .snapshot_node_mcp_configs("run-stable", "agent-1", &["exa".into()])
        .unwrap();

    let mut changed = original.clone();
    changed.url = Some("https://changed.example.test/mcp".into());
    store
        .save_mcp_config("exa", &serde_json::to_string(&changed).unwrap())
        .unwrap();
    store.delete_mcp_config("exa").unwrap();

    let resolved = resolve_run_mcp_config(&store, "run-stable", "agent-1", "exa").unwrap();
    assert_eq!(resolved.url, original.url);
}
