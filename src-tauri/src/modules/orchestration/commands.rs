use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use super::store::{
    ApprovalRecord, NodeRunRecord, OrchestrationStore, WorkflowRecord, WorkflowRunRecord,
};

const MAX_DEFINITION_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSaveInput {
    pub id: String,
    pub version: i64,
    pub name: String,
    pub project_id: String,
    pub definition_json: String,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"-_.".contains(&character))
}

pub(super) fn validate_workflow_input(input: &WorkflowSaveInput) -> Result<(), String> {
    if !valid_identifier(&input.id) || !valid_identifier(&input.project_id) {
        return Err("Workflow identifiers are invalid.".into());
    }
    if input.version < 1 || input.name.trim().is_empty() || input.name.len() > 120 {
        return Err("Workflow metadata is invalid.".into());
    }
    if input.definition_json.len() > MAX_DEFINITION_BYTES {
        return Err("Workflow definition is too large.".into());
    }
    let definition: Value = serde_json::from_str(&input.definition_json)
        .map_err(|_| "Workflow definition is not valid JSON.".to_string())?;
    let object = definition
        .as_object()
        .ok_or_else(|| "Workflow definition must be an object.".to_string())?;
    if object.get("id").and_then(Value::as_str) != Some(input.id.as_str())
        || !object.get("nodes").is_some_and(Value::is_array)
        || !object.get("edges").is_some_and(Value::is_array)
    {
        return Err("Workflow definition fields are invalid.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn orchestration_list_workflows(
    store: State<'_, OrchestrationStore>,
) -> Result<Vec<WorkflowRecord>, String> {
    store.list_workflows().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_save_workflow(
    store: State<'_, OrchestrationStore>,
    input: WorkflowSaveInput,
) -> Result<(), String> {
    validate_workflow_input(&input)?;
    store
        .save_workflow(
            &input.id,
            input.version,
            input.name.trim(),
            &input.project_id,
            &input.definition_json,
        )
        .map_err(|error| error.to_string())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCreateInput {
    pub id: String,
    pub workflow_id: String,
    pub workflow_version: i64,
    pub project_id: String,
    pub integration_branch: String,
    pub node_ids: Vec<String>,
}

pub(super) fn validate_run_input(input: &RunCreateInput) -> Result<(), String> {
    if !valid_identifier(&input.id)
        || !valid_identifier(&input.workflow_id)
        || !valid_identifier(&input.project_id)
        || input.workflow_version < 1
        || input.node_ids.is_empty()
        || input.node_ids.len() > 256
        || input.node_ids.iter().any(|id| !valid_identifier(id))
        || !input.integration_branch.starts_with("astra/run-")
        || input.integration_branch.len() > 180
    {
        return Err("Workflow run input is invalid.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn orchestration_create_run(
    store: State<'_, OrchestrationStore>,
    input: RunCreateInput,
) -> Result<(), String> {
    validate_run_input(&input)?;
    store
        .save_run(&WorkflowRunRecord {
            id: input.id.clone(),
            workflow_id: input.workflow_id,
            workflow_version: input.workflow_version,
            project_id: input.project_id,
            status: "waiting".into(),
            integration_branch: Some(input.integration_branch),
        })
        .map_err(|error| error.to_string())?;
    for (index, node_id) in input.node_ids.iter().enumerate() {
        let node_run_id = format!("{}-{node_id}", input.id);
        store
            .save_node_run(&NodeRunRecord {
                id: node_run_id.clone(),
                run_id: input.id.clone(),
                node_id: node_id.clone(),
                status: if index == 0 {
                    "waiting_approval".into()
                } else {
                    "pending".into()
                },
                attempt: 1,
                provider: None,
                worktree_path: None,
            })
            .map_err(|error| error.to_string())?;
        if index == 0 {
            store
                .save_approval(&ApprovalRecord {
                    id: format!("approval-{}", input.id),
                    run_id: input.id.clone(),
                    node_run_id,
                    capability: "worktree".into(),
                    risk: "medium".into(),
                    summary: "Create isolated integration and Agent worktrees.".into(),
                    status: "pending".into(),
                })
                .map_err(|error| error.to_string())?;
        }
    }
    store
        .append_event(&input.id, r#"{"type":"run_created","status":"waiting"}"#)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn orchestration_decide_run(
    store: State<'_, OrchestrationStore>,
    run_id: String,
    approved: bool,
) -> Result<(), String> {
    if !valid_identifier(&run_id) {
        return Err("Workflow run identifier is invalid.".into());
    }
    store
        .decide_run(&run_id, approved)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_cancel_run(
    store: State<'_, OrchestrationStore>,
    run_id: String,
) -> Result<(), String> {
    if !valid_identifier(&run_id) {
        return Err("Workflow run identifier is invalid.".into());
    }
    store.cancel_run(&run_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_update_node_status(
    store: State<'_, OrchestrationStore>,
    run_id: String,
    node_id: String,
    status: String,
    worktree_path: Option<String>,
) -> Result<(), String> {
    if !valid_identifier(&run_id)
        || !valid_identifier(&node_id)
        || !matches!(
            status.as_str(),
            "ready"
                | "running"
                | "waiting_approval"
                | "succeeded"
                | "failed"
                | "skipped"
                | "cancelled"
                | "interrupted"
        )
        || worktree_path
            .as_deref()
            .is_some_and(|path| path.len() > 32_768)
    {
        return Err("Node status input is invalid.".into());
    }
    store
        .update_node_status(&run_id, &node_id, &status, worktree_path.as_deref())
        .map_err(|error| error.to_string())?;
    let event = serde_json::json!({ "type": "node_status", "nodeId": node_id, "status": status });
    store
        .append_event(&run_id, &event.to_string())
        .map_err(|error| error.to_string())?;
    Ok(())
}
