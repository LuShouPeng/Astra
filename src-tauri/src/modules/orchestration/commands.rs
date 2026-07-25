use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use serde_json::Value;
use tauri::State;

use super::permissions::{classify_operation, Operation, PolicyDecision};
use super::scheduler::{
    reconcile, validate_definition, Edge, JoinStrategy, Node, NodeKind, NodeStatus, RunDisposition,
    Workflow,
};
use super::store::{
    ApprovalRecord, NodeRunRecord, OrchestrationStore, RunProjection, WorkflowRecord,
    WorkflowRunRecord, WorkflowTemplateRecord,
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

fn valid_capability_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"-_.:/".contains(&character))
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
        || object.get("version").and_then(Value::as_i64) != Some(input.version)
        || object.get("projectId").and_then(Value::as_str) != Some(input.project_id.as_str())
        || !object.get("nodes").is_some_and(Value::is_array)
        || !object.get("edges").is_some_and(Value::is_array)
    {
        return Err("Workflow definition fields are invalid.".into());
    }
    let runtime: RuntimeDefinition = serde_json::from_value(definition)
        .map_err(|_| "Workflow runtime fields are invalid.".to_string())?;
    validate_runtime_definition(&runtime)?;
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

#[tauri::command]
pub fn orchestration_save_template(
    store: State<'_, OrchestrationStore>,
    input: WorkflowSaveInput,
) -> Result<(), String> {
    validate_workflow_input(&input)?;
    store
        .save_template(&input.id, input.name.trim(), &input.definition_json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_list_templates(
    store: State<'_, OrchestrationStore>,
) -> Result<Vec<WorkflowTemplateRecord>, String> {
    store.list_templates().map_err(|error| error.to_string())
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
        || input.node_ids.iter().collect::<HashSet<_>>().len() != input.node_ids.len()
        || !input.integration_branch.starts_with("astra/run-")
        || input.integration_branch.len() > 180
    {
        return Err("Workflow run input is invalid.".into());
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct NodeCapabilities {
    pub node_id: String,
    pub mcp_server_ids: Vec<String>,
    pub skill_ids: Vec<String>,
}

pub(super) fn validate_run_definition(
    input: &RunCreateInput,
    definition: &Value,
) -> Result<Vec<NodeCapabilities>, String> {
    if definition.get("projectId").and_then(Value::as_str) != Some(input.project_id.as_str()) {
        return Err("The workflow run project does not match the saved definition.".into());
    }
    let nodes = definition
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "The stored workflow nodes are invalid.".to_string())?;
    let mut capabilities = Vec::with_capacity(nodes.len());
    let mut definition_ids = HashSet::new();
    for node in nodes {
        let node_id = node
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_identifier(id))
            .ok_or_else(|| "A stored workflow node identifier is invalid.".to_string())?;
        if !definition_ids.insert(node_id.to_string()) {
            return Err("Stored workflow node identifiers must be unique.".into());
        }
        let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
        let mcp_server_ids = match node_type {
            "agent" => node
                .get("mcpServerIds")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|value| {
                    value
                        .as_str()
                        .filter(|id| valid_capability_identifier(id))
                        .map(ToOwned::to_owned)
                        .ok_or_else(|| "An Agent MCP server identifier is invalid.".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?,
            "mcp_tool" => vec![node
                .get("serverId")
                .and_then(Value::as_str)
                .filter(|id| valid_capability_identifier(id))
                .map(ToOwned::to_owned)
                .ok_or_else(|| "An MCP tool server identifier is invalid.".to_string())?],
            _ => Vec::new(),
        };
        let skill_ids = if node_type == "agent" {
            node.get("skillIds")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|value| {
                    value
                        .as_str()
                        .filter(|id| valid_identifier(id))
                        .map(ToOwned::to_owned)
                        .ok_or_else(|| "An Agent Skill identifier is invalid.".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };
        if mcp_server_ids.iter().collect::<HashSet<_>>().len() != mcp_server_ids.len()
            || skill_ids.iter().collect::<HashSet<_>>().len() != skill_ids.len()
        {
            return Err("Workflow node capabilities must not be duplicated.".into());
        }
        capabilities.push(NodeCapabilities {
            node_id: node_id.to_string(),
            mcp_server_ids,
            skill_ids,
        });
    }
    let submitted = input.node_ids.iter().cloned().collect::<HashSet<_>>();
    if submitted != definition_ids {
        return Err("Workflow run nodes must exactly match the saved definition.".into());
    }
    Ok(capabilities)
}

#[tauri::command]
pub fn orchestration_create_run(
    store: State<'_, OrchestrationStore>,
    input: RunCreateInput,
) -> Result<(), String> {
    create_run(&store, input)
}

pub(super) fn create_run(store: &OrchestrationStore, input: RunCreateInput) -> Result<(), String> {
    validate_run_input(&input)?;
    if store
        .get_run(&input.id)
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Err("A workflow run with this identifier already exists.".into());
    }
    let workflow = store
        .get_workflow(&input.workflow_id, input.workflow_version)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow definition was not found.".to_string())?;
    if workflow.project_id != input.project_id {
        return Err("The workflow run project does not match the saved workflow.".into());
    }
    let definition: Value = serde_json::from_str(&workflow.definition_json)
        .map_err(|_| "Stored workflow definition is invalid.".to_string())?;
    let capabilities = validate_run_definition(&input, &definition)?;
    for server_id in capabilities
        .iter()
        .flat_map(|node| &node.mcp_server_ids)
        .collect::<HashSet<_>>()
    {
        if store
            .get_mcp_config(server_id)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Err(format!("MCP server '{server_id}' is not registered."));
        }
    }
    let skill_ids = capabilities
        .iter()
        .flat_map(|node| node.skill_ids.iter().cloned())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let installed_skills = store
        .list_skill_packages(false)
        .map_err(|error| error.to_string())?;
    if let Some(missing) = skill_ids
        .iter()
        .find(|skill_id| !installed_skills.iter().any(|skill| &skill.id == *skill_id))
    {
        return Err(format!("Skill '{missing}' is not installed."));
    }
    if classify_operation(Operation::Worktree) != PolicyDecision::RequireApproval {
        return Err("The worktree permission policy is invalid.".into());
    }
    let nodes = input
        .node_ids
        .iter()
        .enumerate()
        .map(|(index, node_id)| NodeRunRecord {
            id: format!("{}-{node_id}", input.id),
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
        .collect::<Vec<_>>();
    let run = WorkflowRunRecord {
        id: input.id.clone(),
        workflow_id: input.workflow_id,
        workflow_version: input.workflow_version,
        project_id: input.project_id,
        status: "waiting".into(),
        integration_branch: Some(input.integration_branch),
    };
    let approval = ApprovalRecord {
        id: format!("approval-{}", input.id),
        run_id: input.id.clone(),
        node_run_id: nodes[0].id.clone(),
        capability: "worktree".into(),
        risk: "medium".into(),
        summary: "Create isolated integration and Agent worktrees.".into(),
        status: "pending".into(),
    };
    let node_mcp_servers = capabilities
        .into_iter()
        .map(|node| (node.node_id, node.mcp_server_ids))
        .collect::<Vec<_>>();
    store
        .create_run_bundle(
            &run,
            &nodes,
            &approval,
            &skill_ids,
            &node_mcp_servers,
            r#"{"type":"run_created","status":"waiting"}"#,
        )
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
    let changed = store
        .decide_run(&run_id, approved)
        .map_err(|error| error.to_string())?;
    if !changed {
        return Err("The run has no pending worktree approval in its current state.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn orchestration_cancel_run(
    store: State<'_, OrchestrationStore>,
    run_id: String,
) -> Result<(), String> {
    if !valid_identifier(&run_id) {
        return Err("Workflow run identifier is invalid.".into());
    }
    if !store
        .cancel_run(&run_id)
        .map_err(|error| error.to_string())?
    {
        return Err("The workflow run cannot be cancelled in its current state.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn orchestration_resume_run(
    store: State<'_, OrchestrationStore>,
    run_id: String,
) -> Result<RunProjection, String> {
    if !valid_identifier(&run_id) {
        return Err("Workflow run identifier is invalid.".into());
    }
    let resumed = store
        .resume_run(&run_id)
        .map_err(|error| error.to_string())?;
    if !resumed {
        return Err("Only an interrupted workflow run can be resumed.".into());
    }
    reconcile_persisted_run(&store, &run_id)
}

#[tauri::command]
pub fn orchestration_update_node_status(
    store: State<'_, OrchestrationStore>,
    run_id: String,
    node_id: String,
    status: String,
    worktree_path: Option<String>,
) -> Result<(), String> {
    update_node_status_checked(&store, &run_id, &node_id, &status, worktree_path.as_deref())
}

pub(super) fn valid_external_node_transition(current: &str, target: &str) -> bool {
    current == target
        || matches!(
            (current, target),
            ("ready", "running" | "cancelled" | "interrupted")
                | (
                    "running",
                    "waiting_approval" | "succeeded" | "failed" | "cancelled" | "interrupted"
                )
        )
}

pub(super) fn update_node_status_checked(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
    status: &str,
    worktree_path: Option<&str>,
) -> Result<(), String> {
    if !valid_identifier(run_id)
        || !valid_identifier(node_id)
        || !matches!(
            status,
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
            .is_some_and(|path| path.len() > 32_768 || !std::path::Path::new(path).is_absolute())
    {
        return Err("Node status input is invalid.".into());
    }
    let run = store
        .get_run(run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow run was not found.".to_string())?;
    if run.status != "running" {
        return Err("Node execution status can only change while the run is running.".into());
    }
    let node = store
        .list_node_runs(run_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|node| node.node_id == node_id)
        .ok_or_else(|| "Workflow node run was not found.".to_string())?;
    if !valid_external_node_transition(&node.status, status) {
        return Err("The requested node status transition is not allowed.".into());
    }
    store
        .update_node_status(run_id, node_id, status, worktree_path)
        .map_err(|error| error.to_string())?;
    let event = serde_json::json!({ "type": "node_status", "nodeId": node_id, "status": status });
    store
        .append_event(run_id, &event.to_string())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn orchestration_update_node_provider(
    store: State<'_, OrchestrationStore>,
    run_id: String,
    node_id: String,
    provider: String,
) -> Result<(), String> {
    update_node_provider_checked(&store, &run_id, &node_id, &provider)
}

pub(super) fn update_node_provider_checked(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
    provider: &str,
) -> Result<(), String> {
    if !valid_identifier(run_id)
        || !valid_identifier(node_id)
        || !matches!(provider, "claude" | "codex" | "gemini")
    {
        return Err("Node Provider input is invalid.".into());
    }
    let projection = store
        .get_run_projection(run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow run was not found.".to_string())?;
    if projection.run.status != "running" {
        return Err("Node Provider can only be selected while the run is running.".into());
    }
    let node_run = projection
        .nodes
        .iter()
        .find(|node| node.node.node_id == node_id)
        .ok_or_else(|| "Workflow node run was not found.".to_string())?;
    if !matches!(node_run.node.status.as_str(), "ready" | "running") {
        return Err("Node Provider cannot be changed in the current node state.".into());
    }
    let workflow = store
        .get_workflow(&projection.run.workflow_id, projection.run.workflow_version)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow definition was not found.".to_string())?;
    let definition: Value = serde_json::from_str(&workflow.definition_json)
        .map_err(|_| "Stored workflow definition is invalid.".to_string())?;
    let is_agent = definition
        .get("nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|node| {
            node.get("id").and_then(Value::as_str) == Some(node_id)
                && node.get("type").and_then(Value::as_str) == Some("agent")
        });
    if !is_agent {
        return Err("Provider selection is only valid for Agent nodes.".into());
    }
    store
        .update_node_provider(run_id, node_id, provider)
        .map_err(|error| error.to_string())?;
    let event = serde_json::json!({
        "type": "node_provider_selected",
        "nodeId": node_id,
        "provider": provider
    });
    store
        .append_event(run_id, &event.to_string())
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettings {
    max_concurrency: usize,
    default_retries: u8,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum RuntimeNode {
    #[serde(rename = "agent")]
    Agent {
        id: String,
        retries: Option<u8>,
        #[serde(default, rename = "mcpServerIds")]
        mcp_server_ids: Vec<String>,
    },
    #[serde(rename = "mcp_tool")]
    McpTool { id: String, retries: Option<u8> },
    #[serde(rename = "approval")]
    Approval { id: String, retries: Option<u8> },
    #[serde(rename = "condition")]
    Condition {
        id: String,
        retries: Option<u8>,
        expression: String,
    },
    #[serde(rename = "join")]
    Join {
        id: String,
        retries: Option<u8>,
        strategy: String,
    },
}

impl RuntimeNode {
    fn id(&self) -> &str {
        match self {
            Self::Agent { id, .. }
            | Self::McpTool { id, .. }
            | Self::Approval { id, .. }
            | Self::Condition { id, .. }
            | Self::Join { id, .. } => id,
        }
    }

    fn retries(&self) -> Option<u8> {
        match self {
            Self::Agent { retries, .. }
            | Self::McpTool { retries, .. }
            | Self::Approval { retries, .. }
            | Self::Condition { retries, .. }
            | Self::Join { retries, .. } => *retries,
        }
    }

    fn kind(&self) -> NodeKind {
        match self {
            Self::Agent { .. } => NodeKind::Agent,
            Self::McpTool { .. } => NodeKind::McpTool,
            Self::Approval { .. } => NodeKind::Approval,
            Self::Condition { .. } => NodeKind::Condition,
            Self::Join { strategy, .. } => NodeKind::Join(if strategy == "any" {
                JoinStrategy::Any
            } else {
                JoinStrategy::All
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
struct RuntimeEdge {
    source: String,
    target: String,
    outcome: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct RuntimeDefinition {
    settings: RuntimeSettings,
    nodes: Vec<RuntimeNode>,
    edges: Vec<RuntimeEdge>,
}

fn runtime_graph(definition: &RuntimeDefinition) -> Workflow {
    Workflow {
        max_concurrency: definition.settings.max_concurrency,
        default_retries: definition.settings.default_retries,
        nodes: definition
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id().to_string(),
                kind: node.kind(),
                retries: node.retries(),
            })
            .collect(),
        edges: definition
            .edges
            .iter()
            .map(|edge| Edge {
                source: edge.source.clone(),
                target: edge.target.clone(),
                outcome: edge.outcome.as_deref().and_then(|value| match value {
                    "true" => Some(true),
                    "false" => Some(false),
                    _ => None,
                }),
            })
            .collect(),
    }
}

fn validate_runtime_definition(definition: &RuntimeDefinition) -> Result<(), String> {
    if definition.nodes.len() > 256 || definition.edges.len() > 1_024 {
        return Err("Workflow graph exceeds the supported size.".into());
    }
    let kinds = definition
        .nodes
        .iter()
        .map(|node| (node.id(), node.kind()))
        .collect::<HashMap<_, _>>();
    for edge in &definition.edges {
        match edge.outcome.as_deref() {
            None | Some("success") => {}
            Some("true" | "false")
                if matches!(kinds.get(edge.source.as_str()), Some(NodeKind::Condition)) => {}
            _ => return Err("Workflow edge outcomes are invalid.".into()),
        }
    }
    validate_definition(&runtime_graph(definition))
}

fn status(value: &str) -> Option<NodeStatus> {
    match value {
        "pending" => Some(NodeStatus::Pending),
        "ready" => Some(NodeStatus::Ready),
        "running" => Some(NodeStatus::Running),
        "waiting_approval" => Some(NodeStatus::WaitingApproval),
        "succeeded" => Some(NodeStatus::Succeeded),
        "failed" => Some(NodeStatus::Failed),
        "skipped" => Some(NodeStatus::Skipped),
        "cancelled" => Some(NodeStatus::Cancelled),
        "interrupted" => Some(NodeStatus::Interrupted),
        _ => None,
    }
}

fn condition_value(
    expression: &str,
    statuses: &HashMap<String, NodeStatus>,
) -> Result<bool, String> {
    let expression = expression.trim();
    match expression.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" => Ok(true),
        "false" | "0" | "no" => Ok(false),
        _ => {
            if let Some(node_id) = expression.strip_suffix(".succeeded") {
                return Ok(statuses.get(node_id) == Some(&NodeStatus::Succeeded));
            }
            if let Some(node_id) = expression.strip_suffix(".failed") {
                return Ok(statuses.get(node_id) == Some(&NodeStatus::Failed));
            }
            Err("Condition expressions must be boolean or inspect a node's succeeded/failed status.".into())
        }
    }
}

pub(super) fn reconcile_persisted_run(
    store: &OrchestrationStore,
    run_id: &str,
) -> Result<RunProjection, String> {
    let run = store
        .get_run(run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow run was not found.".to_string())?;
    let workflow_record = store
        .get_workflow(&run.workflow_id, run.workflow_version)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow definition was not found.".to_string())?;
    let definition: RuntimeDefinition = serde_json::from_str(&workflow_record.definition_json)
        .map_err(|_| "Stored workflow definition is invalid.".to_string())?;
    let graph = runtime_graph(&definition);

    for _ in 0..=definition.nodes.len() {
        let projection = store
            .get_run_projection(run_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Workflow run was not found.".to_string())?;
        let statuses = projection
            .nodes
            .iter()
            .filter_map(|node| {
                status(&node.node.status).map(|value| (node.node.node_id.clone(), value))
            })
            .collect::<HashMap<_, _>>();
        let outcomes = projection
            .nodes
            .iter()
            .filter_map(|node| {
                let value = node.output_json.as_deref().and_then(|json| {
                    serde_json::from_str::<Value>(json)
                        .ok()?
                        .get("condition")?
                        .as_bool()
                })?;
                Some((node.node.node_id.clone(), value))
            })
            .collect::<HashMap<_, _>>();
        let plan = reconcile(&graph, &statuses, &outcomes);
        let mut changed = false;
        for node_id in plan.skipped {
            store
                .update_node_status(run_id, &node_id, "skipped", None)
                .map_err(|error| error.to_string())?;
            changed = true;
        }
        let approvals = projection.approvals;
        for node_id in plan.ready {
            let Some(node) = definition.nodes.iter().find(|node| node.id() == node_id) else {
                continue;
            };
            match node {
                RuntimeNode::Condition { expression, .. } => {
                    match condition_value(expression, &statuses) {
                        Ok(value) => {
                            let output = serde_json::json!({ "condition": value }).to_string();
                            store
                                .update_node_evidence(run_id, &node_id, None, Some(&output), None)
                                .map_err(|error| error.to_string())?;
                            store
                                .update_node_status(run_id, &node_id, "succeeded", None)
                                .map_err(|error| error.to_string())?;
                        }
                        Err(error) => {
                            store
                                .update_node_evidence(run_id, &node_id, None, None, Some(&error))
                                .map_err(|store_error| store_error.to_string())?;
                            store
                                .update_node_status(run_id, &node_id, "failed", None)
                                .map_err(|store_error| store_error.to_string())?;
                        }
                    }
                }
                RuntimeNode::Join { .. } => store
                    .update_node_status(run_id, &node_id, "succeeded", None)
                    .map_err(|error| error.to_string())?,
                RuntimeNode::Approval { .. }
                | RuntimeNode::Agent { .. }
                | RuntimeNode::McpTool { .. } => {
                    let node_run = projection
                        .nodes
                        .iter()
                        .find(|item| item.node.node_id == node_id)
                        .ok_or_else(|| "Workflow node run was not found.".to_string())?;
                    let required_capabilities = match node {
                        RuntimeNode::Agent { mcp_server_ids, .. } if !mcp_server_ids.is_empty() => {
                            vec![
                                ("execute", Operation::Execute),
                                ("network", Operation::Network),
                            ]
                        }
                        RuntimeNode::McpTool { .. } => vec![("network", Operation::Network)],
                        _ => vec![("execute", Operation::Execute)],
                    };
                    let all_approved = required_capabilities.iter().all(|(capability, _)| {
                        approvals.iter().any(|approval| {
                            approval.node_run_id == node_run.node.id
                                && approval.capability == *capability
                                && approval.status == "approved"
                        })
                    });
                    if all_approved {
                        store
                            .update_node_status(
                                run_id,
                                &node_id,
                                if matches!(node, RuntimeNode::Approval { .. }) {
                                    "succeeded"
                                } else {
                                    "ready"
                                },
                                None,
                            )
                            .map_err(|error| error.to_string())?;
                    } else {
                        for (capability, operation) in required_capabilities {
                            if classify_operation(operation) != PolicyDecision::RequireApproval {
                                return Err("The node permission policy is invalid.".into());
                            }
                            let exists = approvals.iter().any(|approval| {
                                approval.node_run_id == node_run.node.id
                                    && approval.capability == capability
                            });
                            if exists {
                                continue;
                            }
                            let approval_id = format!("approval-{run_id}-{node_id}-{capability}");
                            let approval = ApprovalRecord {
                                id: approval_id.clone(),
                                run_id: run_id.to_string(),
                                node_run_id: node_run.node.id.clone(),
                                capability: capability.into(),
                                risk: if capability == "network" {
                                    "high"
                                } else {
                                    "medium"
                                }
                                .into(),
                                summary: format!(
                                    "Allow {capability} capability for node {node_id}."
                                ),
                                status: "pending".into(),
                            };
                            let event = serde_json::json!({
                                "type": "approval_requested",
                                "approvalId": approval_id,
                                "nodeId": node_id,
                                "capability": capability,
                                "risk": approval.risk,
                            });
                            store
                                .request_approval(&approval, &event.to_string())
                                .map_err(|error| error.to_string())?;
                        }
                        store
                            .update_node_status(run_id, &node_id, "waiting_approval", None)
                            .map_err(|error| error.to_string())?;
                    }
                }
            }
            changed = true;
        }
        let status = match plan.disposition {
            RunDisposition::Waiting => "waiting",
            RunDisposition::Completed => "completed",
            RunDisposition::Failed => "failed",
            RunDisposition::Cancelled => "cancelled",
            RunDisposition::Interrupted => "interrupted",
            RunDisposition::Running => "running",
        };
        store
            .set_run_status(run_id, status)
            .map_err(|error| error.to_string())?;
        if !changed {
            break;
        }
    }
    store
        .get_run_projection(run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow run was not found.".to_string())
}

#[tauri::command]
pub fn orchestration_get_run(
    store: State<'_, OrchestrationStore>,
    run_id: String,
) -> Result<Option<RunProjection>, String> {
    if !valid_identifier(&run_id) {
        return Err("Workflow run identifier is invalid.".into());
    }
    store
        .get_run_projection(&run_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_reconcile_run(
    store: State<'_, OrchestrationStore>,
    run_id: String,
) -> Result<RunProjection, String> {
    if !valid_identifier(&run_id) {
        return Err("Workflow run identifier is invalid.".into());
    }
    reconcile_persisted_run(&store, &run_id)
}

#[tauri::command]
pub fn orchestration_decide_approval(
    store: State<'_, OrchestrationStore>,
    approval_id: String,
    approved: bool,
) -> Result<(), String> {
    if !valid_identifier(&approval_id) {
        return Err("Approval identifier is invalid.".into());
    }
    let changed = store
        .decide_approval(&approval_id, approved)
        .map_err(|error| error.to_string())?;
    if !changed {
        return Err("The approval cannot be decided in its current state.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn orchestration_retry_node(
    store: State<'_, OrchestrationStore>,
    run_id: String,
    node_id: String,
    max_retries: u8,
) -> Result<bool, String> {
    if max_retries > 3 {
        return Err("Node retry input is invalid.".into());
    }
    retry_node_checked(&store, &run_id, &node_id)
}

pub(super) fn retry_node_checked(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
) -> Result<bool, String> {
    if !valid_identifier(run_id) || !valid_identifier(node_id) {
        return Err("Node retry input is invalid.".into());
    }
    let projection = store
        .get_run_projection(run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow run was not found.".to_string())?;
    if projection.run.status != "running" {
        return Err("Nodes can only be retried while the run is running.".into());
    }
    let node_run = projection
        .nodes
        .iter()
        .find(|node| node.node.node_id == node_id)
        .ok_or_else(|| "Workflow node run was not found.".to_string())?;
    if node_run.node.status != "failed" {
        return Err("Only failed workflow nodes can be retried.".into());
    }
    let workflow = store
        .get_workflow(&projection.run.workflow_id, projection.run.workflow_version)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workflow definition was not found.".to_string())?;
    let definition: RuntimeDefinition = serde_json::from_str(&workflow.definition_json)
        .map_err(|_| "Stored workflow definition is invalid.".to_string())?;
    let node = definition
        .nodes
        .iter()
        .find(|node| node.id() == node_id)
        .ok_or_else(|| "Workflow node definition was not found.".to_string())?;
    let configured_retries = node
        .retries()
        .unwrap_or(definition.settings.default_retries);
    store
        .retry_node(run_id, node_id, configured_retries)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_update_node_evidence(
    store: State<'_, OrchestrationStore>,
    run_id: String,
    node_id: String,
    external_session_id: Option<String>,
    output: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    update_node_evidence_checked(
        &store,
        &run_id,
        &node_id,
        external_session_id.as_deref(),
        output,
        error.as_deref(),
    )
}

pub(super) fn update_node_evidence_checked(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
    external_session_id: Option<&str>,
    output: Option<Value>,
    error: Option<&str>,
) -> Result<(), String> {
    if !valid_identifier(run_id)
        || !valid_identifier(node_id)
        || external_session_id.is_some_and(|value| value.len() > 512)
        || error.is_some_and(|value| value.len() > 16_384)
    {
        return Err("Node evidence input is invalid.".into());
    }
    let output_json = output
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|_| "Node evidence output is invalid.".to_string())?;
    if output_json
        .as_deref()
        .is_some_and(|value| value.len() > 1024 * 1024)
    {
        return Err("Node evidence output is too large.".into());
    }
    let projection = store
        .get_run_projection(run_id)
        .map_err(|store_error| store_error.to_string())?
        .ok_or_else(|| "Workflow run was not found.".to_string())?;
    if projection.run.status != "running" {
        return Err("Node evidence can only be updated while the run is running.".into());
    }
    let node = projection
        .nodes
        .iter()
        .find(|node| node.node.node_id == node_id)
        .ok_or_else(|| "Workflow node run was not found.".to_string())?;
    if node.node.status != "running" {
        return Err("Node evidence can only be updated while the node is running.".into());
    }
    store
        .update_node_evidence(
            run_id,
            node_id,
            external_session_id,
            output_json.as_deref(),
            error,
        )
        .map_err(|store_error| store_error.to_string())
}
