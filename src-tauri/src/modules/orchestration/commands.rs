use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use super::store::{OrchestrationStore, WorkflowRecord};

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
