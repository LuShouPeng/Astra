use super::commands::{
    validate_run_input, validate_workflow_input, RunCreateInput, WorkflowSaveInput,
};

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
