use super::commands::{validate_workflow_input, WorkflowSaveInput};

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
