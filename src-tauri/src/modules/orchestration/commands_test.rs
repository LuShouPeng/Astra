use super::commands::{
    reconcile_persisted_run, validate_run_input, validate_workflow_input, RunCreateInput,
    WorkflowSaveInput,
};
use super::store::{NodeRunRecord, OrchestrationStore, WorkflowRunRecord};

fn input() -> WorkflowSaveInput {
    WorkflowSaveInput {
        id: "workflow-1".into(),
        version: 1,
        name: "Build and verify".into(),
        project_id: "project-1".into(),
        definition_json: r#"{"id":"workflow-1","nodes":[],"edges":[]}"#.into(),
    }
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
    };
    assert!(validate_run_input(&input).is_ok());
    input.node_ids.clear();
    assert!(validate_run_input(&input).is_err());
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
