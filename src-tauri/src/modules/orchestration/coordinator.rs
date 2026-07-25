use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;

use super::{
    commands::{reconcile_persisted_run, retry_node_checked},
    extensions::{node_mcp_redactions, skill_context, validate_mcp_config, McpServerInput},
    providers::AgentProvider,
    runtime::{
        cancel_active_agents, execute_agent, OrchestrationRuntime, ProviderEventCallback,
        StartAgentInput,
    },
    store::{
        ArtifactRecord, OrchestrationStore, RunEventRecord, RunProjection, WorkflowAttentionRecord,
    },
    worktrees::{manager, NodeIntegrationError, NodeWorktree, RunWorktree},
};

pub(crate) const RUN_EVENT_TOPIC: &str = "orchestration://run-event";
const MAX_PROVIDER_PROMPT_BYTES: usize = 100_000;

type EventNotifier = Arc<dyn Fn(RunEventNotification) + Send + Sync + 'static>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunEventNotification {
    pub run_id: String,
    pub sequence: i64,
    pub event_json: String,
}

#[derive(Clone)]
pub(crate) struct RunEventSink {
    store: OrchestrationStore,
    notify: EventNotifier,
}

impl RunEventSink {
    pub(crate) fn with_notifier(store: OrchestrationStore, notify: EventNotifier) -> Self {
        Self { store, notify }
    }

    fn with_app(store: OrchestrationStore, app: AppHandle) -> Self {
        Self::with_notifier(
            store,
            Arc::new(move |notification| {
                // The durable store is the recovery source when the live notification cannot be delivered.
                let _ = app.emit(RUN_EVENT_TOPIC, notification);
            }),
        )
    }

    pub(crate) fn persist_then_emit(
        &self,
        run_id: &str,
        event: Value,
    ) -> Result<RunEventNotification, String> {
        let event_json = event.to_string();
        let sequence = self
            .store
            .append_event(run_id, &event_json)
            .map_err(|error| error.to_string())?;
        Ok(self.emit_persisted(run_id, sequence, event_json))
    }

    pub(crate) fn emit_persisted(
        &self,
        run_id: &str,
        sequence: i64,
        event_json: String,
    ) -> RunEventNotification {
        let notification = RunEventNotification {
            run_id: run_id.to_string(),
            sequence,
            event_json,
        };
        (self.notify)(notification.clone());
        notification
    }

    pub(crate) fn events_after(
        &self,
        run_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<RunEventRecord>, String> {
        if !valid_identifier(run_id) || after_sequence < 0 || limit > 1_000 {
            return Err("Workflow event cursor input is invalid.".into());
        }
        self.store
            .list_events_after(run_id, after_sequence, limit)
            .map_err(|error| error.to_string())
    }
}

#[derive(Clone)]
pub(crate) struct RunCoordinator {
    app: AppHandle,
    store: OrchestrationStore,
    runtime: OrchestrationRuntime,
    events: RunEventSink,
    scheduler_locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
    integration_locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderPaths {
    claude_path: Option<String>,
    codex_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentNodeDefinition {
    id: String,
    #[serde(default)]
    provider: Option<String>,
    prompt: String,
    #[serde(default)]
    timeout_seconds: Option<u64>,
    #[serde(default)]
    skill_ids: Vec<String>,
}

#[derive(Clone)]
struct AgentExecutionPlan {
    workflow_id: String,
    repository_path: String,
    run_worktree: RunWorktree,
    provider: AgentProvider,
    provider_path: String,
    prompt: String,
    timeout_seconds: u64,
    mcp_context: String,
    selected_skill_ids: Vec<String>,
    redactions: Vec<String>,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"-_.".contains(&character))
}

fn configured_path(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_provider_paths(context_json: &str) -> Result<ProviderPaths, String> {
    serde_json::from_str(context_json)
        .map_err(|_| "The persisted Provider path configuration is invalid.".to_string())
}

pub(crate) fn provider_path_from_context(
    provider: AgentProvider,
    context_json: &str,
) -> Result<String, String> {
    let paths = parse_provider_paths(context_json)?;
    let path = match provider {
        AgentProvider::Claude => configured_path(paths.claude_path.as_deref()),
        AgentProvider::Codex => configured_path(paths.codex_path.as_deref()),
    };
    path.ok_or_else(|| match provider {
        AgentProvider::Claude => "Claude is unavailable in the persisted run context.".into(),
        AgentProvider::Codex => "Codex is unavailable in the persisted run context.".into(),
    })
}

fn provider_from_name(value: &str) -> Result<AgentProvider, String> {
    match value {
        "claude" => Ok(AgentProvider::Claude),
        "codex" => Ok(AgentProvider::Codex),
        _ => Err("The persisted Agent Provider selection is invalid.".into()),
    }
}

fn resolve_provider(
    node_provider: Option<&str>,
    selected_provider: Option<&str>,
    context_json: &str,
) -> Result<(AgentProvider, String), String> {
    let paths = parse_provider_paths(context_json)?;
    let preferred = selected_provider.or(node_provider).unwrap_or("auto");
    let provider = if preferred == "auto" {
        if configured_path(paths.codex_path.as_deref()).is_some() {
            AgentProvider::Codex
        } else if configured_path(paths.claude_path.as_deref()).is_some() {
            AgentProvider::Claude
        } else {
            return Err("No Provider executable is configured for this persisted run.".into());
        }
    } else {
        provider_from_name(preferred)?
    };
    let path = match provider {
        AgentProvider::Claude => configured_path(paths.claude_path.as_deref()),
        AgentProvider::Codex => configured_path(paths.codex_path.as_deref()),
    }
    .ok_or_else(|| {
        "The selected Provider is unavailable in the persisted run context.".to_string()
    })?;
    Ok((provider, path))
}

pub(crate) fn mcp_runtime_context(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
) -> Result<String, String> {
    let records = store
        .list_node_mcp_configs(run_id, node_id)
        .map_err(|error| error.to_string())?;
    let mut servers = serde_json::Map::with_capacity(records.len());
    for record in records {
        let config: McpServerInput = serde_json::from_str(&record.config_json)
            .map_err(|_| "A snapshotted MCP configuration is invalid.".to_string())?;
        validate_mcp_config(&config)?;
        if !config.enabled {
            return Err("A snapshotted MCP server is disabled.".into());
        }
        if config.secret_ref.is_some() {
            return Err(
                "An MCP server that requires a stored secret cannot be mounted for managed Provider execution yet."
                    .into(),
            );
        }
        let provider_config = match config.transport.as_str() {
            "stdio" => json!({
                "command": config.command,
                "args": config.args,
            }),
            "streamable_http" => json!({
                "type": "http",
                "url": config.url,
            }),
            _ => return Err("The snapshotted MCP transport is unsupported.".into()),
        };
        servers.insert(config.id, provider_config);
    }
    serde_json::to_string(&json!({ "mcpServers": servers }))
        .map_err(|_| "The MCP runtime context could not be encoded.".to_string())
}

pub(crate) fn validate_provider_mcp_support(
    provider: AgentProvider,
    mcp_context: &str,
) -> Result<(), String> {
    let has_servers = match serde_json::from_str::<Value>(mcp_context) {
        Ok(value) => value
            .get("mcpServers")
            .and_then(Value::as_object)
            .is_some_and(|servers| !servers.is_empty()),
        Err(_) => false,
    };
    if has_servers && provider == AgentProvider::Codex {
        return Err(
            "Codex MCP execution is unavailable because this installed Provider has no verified managed MCP configuration interface."
                .into(),
        );
    }
    Ok(())
}

fn agent_definition(
    definition_json: &str,
    node_id: &str,
) -> Result<(AgentNodeDefinition, u64), String> {
    let definition: Value = serde_json::from_str(definition_json)
        .map_err(|_| "The persisted workflow definition is invalid.".to_string())?;
    let default_timeout = definition
        .get("settings")
        .and_then(|settings| settings.get("defaultTimeoutSeconds"))
        .and_then(Value::as_u64)
        .filter(|timeout| (1..=86_400).contains(timeout))
        .ok_or_else(|| "The workflow default timeout is invalid.".to_string())?;
    let node = definition
        .get("nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find(|node| {
                node.get("id").and_then(Value::as_str) == Some(node_id)
                    && node.get("type").and_then(Value::as_str) == Some("agent")
            })
        })
        .cloned()
        .ok_or_else(|| "The ready workflow node is not an Agent node.".to_string())?;
    let agent: AgentNodeDefinition = serde_json::from_value(node)
        .map_err(|_| "The persisted Agent node is invalid.".to_string())?;
    if agent.id != node_id
        || agent.prompt.trim().is_empty()
        || agent.prompt.len() > 32_768
        || agent.skill_ids.len() > 32
        || agent.skill_ids.iter().any(|skill| !valid_identifier(skill))
        || agent.skill_ids.iter().collect::<HashSet<_>>().len() != agent.skill_ids.len()
        || agent
            .timeout_seconds
            .is_some_and(|timeout| !(1..=86_400).contains(&timeout))
        || agent
            .provider
            .as_deref()
            .is_some_and(|provider| !matches!(provider, "auto" | "claude" | "codex"))
    {
        return Err("The persisted Agent node is invalid.".into());
    }
    Ok((
        agent.clone(),
        agent.timeout_seconds.unwrap_or(default_timeout),
    ))
}

fn build_agent_prompt(
    task: &str,
    skill_context: &str,
    mcp_context: &str,
) -> Result<String, String> {
    let prompt = format!(
        "<astra-runtime-context>\nThe following MCP configuration is persisted for this run. Use only these configured servers and do not rely on browser state.\n{mcp_context}\n</astra-runtime-context>{skill_context}\n\n<astra-task>\n{task}\n</astra-task>"
    );
    if prompt.len() > MAX_PROVIDER_PROMPT_BYTES {
        return Err("The assembled Agent runtime prompt is too large.".into());
    }
    Ok(prompt)
}

impl RunCoordinator {
    pub(crate) fn new(
        app: AppHandle,
        store: OrchestrationStore,
        runtime: OrchestrationRuntime,
    ) -> Self {
        let events = RunEventSink::with_app(store.clone(), app.clone());
        Self {
            app,
            store,
            runtime,
            events,
            scheduler_locks: Arc::new(Mutex::new(HashMap::new())),
            integration_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn schedule(&self, run_id: &str) -> Result<(), String> {
        if !valid_identifier(run_id) {
            return Err("Workflow run identifier is invalid.".into());
        }
        if self
            .store
            .get_run(run_id)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Err("Workflow run was not found.".into());
        }
        let coordinator = self.clone();
        let run_id = run_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = coordinator.drive_run(&run_id).await {
                let _ = coordinator.events.persist_then_emit(
                    &run_id,
                    json!({
                        "type": "run_scheduler_failed",
                        "message": error.chars().take(16_384).collect::<String>(),
                    }),
                );
            }
        });
        Ok(())
    }

    pub(crate) async fn decide_initial_run(
        &self,
        run_id: &str,
        approved: bool,
    ) -> Result<RunProjection, String> {
        if !valid_identifier(run_id) {
            return Err("Workflow run identifier is invalid.".into());
        }
        let lock = Self::lock_for(&self.scheduler_locks, run_id);
        let guard = lock.lock().await;
        let pending = self.projection(run_id)?;
        if pending.run.status != "waiting" {
            return Err("The run has no pending worktree approval in its current state.".into());
        }
        if approved {
            let context = self
                .store
                .get_run_context(run_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "The workflow run execution context is unavailable.".to_string())?;
            let repository = context.repository_path;
            if context.run_worktree_json.is_some() {
                return Err("The workflow run worktree was already prepared.".into());
            }
            let app = self.app.clone();
            let worktree_repository = repository.clone();
            let worktree_run_id = run_id.to_string();
            let worktree = tauri::async_runtime::spawn_blocking(move || {
                manager(&app, &worktree_repository)?.prepare_run(&worktree_run_id)
            })
            .await
            .map_err(|_| "The worktree task stopped unexpectedly.".to_string());
            let worktree = match worktree {
                Ok(Ok(worktree)) => worktree,
                Ok(Err(error)) => {
                    let _ = self.cleanup_prepared_run(&repository, run_id).await;
                    return Err(error);
                }
                Err(error) => {
                    let _ = self.cleanup_prepared_run(&repository, run_id).await;
                    return Err(error);
                }
            };
            let worktree_json = match serde_json::to_string(&worktree) {
                Ok(value) => value,
                Err(_) => {
                    let _ = self.cleanup_prepared_run(&repository, run_id).await;
                    return Err("The workflow run worktree could not be stored.".into());
                }
            };
            if !self
                .store
                .decide_run_with_worktree(run_id, &worktree_json)
                .map_err(|error| error.to_string())?
            {
                let _ = self.cleanup_prepared_run(&repository, run_id).await;
                return Err(
                    "The run has no pending worktree approval in its current state.".into(),
                );
            }
        } else if !self
            .store
            .decide_run(run_id, false)
            .map_err(|error| error.to_string())?
        {
            return Err("The run has no pending worktree approval in its current state.".into());
        }
        self.events.persist_then_emit(
            run_id,
            json!({
                "type": "worktree_approval_applied",
                "decision": if approved { "approved" } else { "rejected" },
            }),
        )?;
        drop(guard);
        if approved {
            self.schedule(run_id)?;
        }
        self.projection(run_id)
    }

    async fn cleanup_prepared_run(&self, repository: &str, run_id: &str) -> Result<(), String> {
        let app = self.app.clone();
        let repository = repository.to_string();
        let run_id = run_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            manager(&app, &repository)?.cleanup_run(&run_id)
        })
        .await
        .map_err(|_| "The worktree rollback task stopped unexpectedly.".to_string())?
    }

    pub(crate) fn decide_approval(&self, approval_id: &str, approved: bool) -> Result<(), String> {
        if !valid_identifier(approval_id) {
            return Err("Approval identifier is invalid.".into());
        }
        let approval = self
            .store
            .get_approval(approval_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "The approval was not found.".to_string())?;
        if !self
            .store
            .decide_approval(approval_id, approved)
            .map_err(|error| error.to_string())?
        {
            return Err("The approval cannot be decided in its current state.".into());
        }
        self.events.persist_then_emit(
            &approval.run_id,
            json!({
                "type": "approval_scheduler_decision",
                "approvalId": approval_id,
                "decision": if approved { "approved" } else { "rejected" },
            }),
        )?;
        self.schedule(&approval.run_id)
    }

    pub(crate) async fn cancel(&self, run_id: &str) -> Result<bool, String> {
        if !valid_identifier(run_id) {
            return Err("Workflow run identifier is invalid.".into());
        }
        let cancelled = self
            .store
            .cancel_run(run_id)
            .map_err(|error| error.to_string())?;
        if cancelled {
            let terminated = cancel_active_agents(&self.runtime, run_id).await;
            let event = match terminated {
                Ok(processes) => json!({
                    "type": "run_cancellation_applied",
                    "terminatedProcessCount": processes,
                }),
                Err(error) => json!({
                    "type": "run_cancellation_applied",
                    "terminationError": error,
                }),
            };
            self.events.persist_then_emit(run_id, event)?;
        }
        Ok(cancelled)
    }

    pub(crate) fn resume(&self, run_id: &str) -> Result<RunProjection, String> {
        if !valid_identifier(run_id) {
            return Err("Workflow run identifier is invalid.".into());
        }
        if !self
            .store
            .resume_run(run_id)
            .map_err(|error| error.to_string())?
        {
            return Err("Only an interrupted or paused workflow run can be resumed.".into());
        }
        self.events
            .persist_then_emit(run_id, json!({"type": "run_resume_scheduled"}))?;
        self.schedule(run_id)?;
        self.projection(run_id)
    }

    pub(crate) fn retry_node(&self, run_id: &str, node_id: &str) -> Result<bool, String> {
        let retried = retry_node_checked(&self.store, run_id, node_id)?;
        if retried {
            self.events.persist_then_emit(
                run_id,
                json!({"type": "node_retry_kicked", "nodeId": node_id}),
            )?;
            self.schedule(run_id)?;
        }
        Ok(retried)
    }

    pub(crate) fn events_after(
        &self,
        run_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<RunEventRecord>, String> {
        self.events.events_after(run_id, after_sequence, limit)
    }

    pub(crate) fn projection(&self, run_id: &str) -> Result<RunProjection, String> {
        self.store
            .get_run_projection(run_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Workflow run was not found.".to_string())
    }

    fn lock_for(
        locks: &Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
        run_id: &str,
    ) -> Arc<AsyncMutex<()>> {
        locks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry(run_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }

    async fn drive_run(&self, run_id: &str) -> Result<(), String> {
        let lock = Self::lock_for(&self.scheduler_locks, run_id);
        let _guard = lock.lock().await;
        let projection = self.projection(run_id)?;
        if matches!(
            projection.run.status.as_str(),
            "paused" | "completed" | "failed" | "cancelled" | "interrupted"
        ) {
            return Ok(());
        }
        let projection = reconcile_persisted_run(&self.store, run_id)?;
        if !matches!(projection.run.status.as_str(), "queued" | "running") {
            return Ok(());
        }
        for node in projection
            .nodes
            .iter()
            .filter(|node| node.node.status == "ready")
        {
            let Some((sequence, event_json)) = self
                .store
                .claim_ready_node(run_id, &node.node.node_id)
                .map_err(|error| error.to_string())?
            else {
                continue;
            };
            self.events.emit_persisted(run_id, sequence, event_json);
            let coordinator = self.clone();
            let node_id = node.node.node_id.clone();
            let owned_run_id = run_id.to_string();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = coordinator
                    .execute_claimed_node(&owned_run_id, &node_id)
                    .await
                {
                    let _ = coordinator
                        .fail_node(&owned_run_id, &node_id, &error, None)
                        .await;
                }
            });
        }
        Ok(())
    }

    fn execution_plan(&self, run_id: &str, node_id: &str) -> Result<AgentExecutionPlan, String> {
        let projection = self.projection(run_id)?;
        if projection.run.status != "running" {
            return Err("The workflow run is no longer active.".into());
        }
        let node_run = projection
            .nodes
            .iter()
            .find(|node| node.node.node_id == node_id)
            .ok_or_else(|| "Workflow node run was not found.".to_string())?;
        if node_run.node.status != "running" {
            return Err("The workflow node is no longer claimed for execution.".into());
        }
        let context = projection
            .context
            .ok_or_else(|| "The workflow run execution context is unavailable.".to_string())?;
        let run_worktree: RunWorktree = serde_json::from_str(
            context
                .run_worktree_json
                .as_deref()
                .ok_or_else(|| "The workflow run worktree is unavailable.".to_string())?,
        )
        .map_err(|_| "The workflow run worktree metadata is invalid.".to_string())?;
        let workflow = self
            .store
            .get_workflow(&projection.run.workflow_id, projection.run.workflow_version)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Workflow definition was not found.".to_string())?;
        let (agent, timeout_seconds) = agent_definition(&workflow.definition_json, node_id)?;
        let (provider, provider_path) = resolve_provider(
            agent.provider.as_deref(),
            node_run.node.provider.as_deref(),
            &context.provider_paths_json,
        )?;
        let redactions = node_mcp_redactions(&self.store, run_id, node_id)?;
        let mcp_context = mcp_runtime_context(&self.store, run_id, node_id)?;
        let skills = self
            .store
            .list_run_skill_refs(run_id)
            .map_err(|error| error.to_string())?;
        if agent
            .skill_ids
            .iter()
            .any(|id| !skills.iter().any(|skill| &skill.id == id))
        {
            return Err("A persisted Skill snapshot is unavailable for this Agent node.".into());
        }
        let skill_text = skill_context(&self.app, skills.clone(), &agent.skill_ids)?;
        let prompt = build_agent_prompt(&agent.prompt, &skill_text, &mcp_context)?;
        validate_provider_mcp_support(provider, &mcp_context)?;
        Ok(AgentExecutionPlan {
            workflow_id: workflow.id,
            repository_path: context.repository_path,
            run_worktree,
            provider,
            provider_path,
            prompt,
            timeout_seconds,
            mcp_context,
            selected_skill_ids: agent.skill_ids,
            redactions,
        })
    }

    fn write_runtime_mount(
        &self,
        run_id: &str,
        node_id: &str,
        plan: &AgentExecutionPlan,
    ) -> Result<Option<String>, String> {
        let app_data = self
            .app
            .path()
            .app_data_dir()
            .map_err(|_| "The application data directory is unavailable.".to_string())?;
        let mcp: Value = serde_json::from_str(&plan.mcp_context)
            .map_err(|_| "The MCP runtime context is invalid.".to_string())?;
        let has_servers = mcp
            .get("mcpServers")
            .and_then(Value::as_object)
            .is_some_and(|servers| !servers.is_empty());
        if !has_servers {
            return Ok(None);
        }
        let directory = app_data.join("runs").join(run_id).join("contexts");
        fs::create_dir_all(&directory).map_err(|_| {
            "The Provider runtime context directory could not be created.".to_string()
        })?;
        let path = directory.join(format!("{node_id}.mcp.json"));
        let bytes = serde_json::to_vec_pretty(&mcp)
            .map_err(|_| "The Provider runtime context could not be encoded.".to_string())?;
        fs::write(&path, &bytes)
            .map_err(|_| "The Provider runtime context could not be written.".to_string())?;
        let content_hash = Sha256::digest(&bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.store
            .save_artifact(&ArtifactRecord {
                id: format!("artifact-{run_id}-{node_id}-mcp-config"),
                run_id: run_id.to_string(),
                node_run_id: Some(format!("{run_id}-{node_id}")),
                kind: "provider_mcp_config".into(),
                path: path.to_string_lossy().into_owned(),
                content_hash,
                byte_length: bytes.len() as i64,
            })
            .map_err(|error| error.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }

    async fn execute_claimed_node(&self, run_id: &str, node_id: &str) -> Result<(), String> {
        let plan = self.execution_plan(run_id, node_id)?;
        let app = self.app.clone();
        let repository = plan.repository_path.clone();
        let run_worktree = plan.run_worktree.clone();
        let node_worktree_id = node_id.to_string();
        let node_worktree = tauri::async_runtime::spawn_blocking(move || {
            manager(&app, &repository)?.prepare_node(&run_worktree, &node_worktree_id)
        })
        .await
        .map_err(|_| "The node worktree task stopped unexpectedly.".to_string())??;
        if !self
            .store
            .set_running_node_worktree(run_id, node_id, &node_worktree.path.to_string_lossy())
            .map_err(|error| error.to_string())?
        {
            return Ok(());
        }
        self.events.persist_then_emit(
            run_id,
            json!({
                "type": "node_worktree_prepared",
                "nodeId": node_id,
                "path": node_worktree.path,
            }),
        )?;
        let runtime_context_path = self.write_runtime_mount(run_id, node_id, &plan)?;
        let events = self.events.clone();
        let event_run_id = run_id.to_string();
        let event_node_id = node_id.to_string();
        let callback: ProviderEventCallback = Arc::new(move |event| {
            let _ = events.persist_then_emit(
                &event_run_id,
                json!({
                    "type": "provider_event",
                    "nodeId": event_node_id,
                    "event": event,
                }),
            );
        });
        let result = execute_agent(
            self.app.clone(),
            self.runtime.clone(),
            self.store.clone(),
            StartAgentInput {
                run_id: run_id.to_string(),
                node_id: node_id.to_string(),
                provider: plan.provider,
                provider_path: plan.provider_path.clone(),
                cwd: node_worktree.path.to_string_lossy().into_owned(),
                prompt: plan.prompt.clone(),
                timeout_seconds: plan.timeout_seconds,
                runtime_context_path,
            },
            callback,
            plan.redactions.clone(),
        )
        .await;
        match result {
            Ok(result) => {
                self.integrate_completed_node(run_id, node_id, plan, node_worktree, result)
                    .await
            }
            Err(error) => self.fail_node(run_id, node_id, &error, None).await,
        }
    }

    async fn integrate_completed_node(
        &self,
        run_id: &str,
        node_id: &str,
        plan: AgentExecutionPlan,
        node_worktree: NodeWorktree,
        result: super::runtime::AgentExecutionResult,
    ) -> Result<(), String> {
        let integration_lock = Self::lock_for(&self.integration_locks, run_id);
        let _guard = integration_lock.lock().await;
        if !self.is_node_running(run_id, node_id)? {
            return Ok(());
        }
        let app = self.app.clone();
        let repository = plan.repository_path.clone();
        let run_worktree = plan.run_worktree.clone();
        let workflow_id = plan.workflow_id.clone();
        let node = node_worktree.clone();
        let integration = tauri::async_runtime::spawn_blocking(move || {
            let manager = manager(&app, &repository).map_err(NodeIntegrationError::Failure)?;
            let commit = manager
                .commit_node(&node, &workflow_id, &run_worktree.id, &node.id)
                .map_err(NodeIntegrationError::Failure)?;
            manager.integrate_node(&run_worktree, &node)?;
            Ok::<_, NodeIntegrationError>(commit)
        })
        .await
        .map_err(|_| "The node integration task stopped unexpectedly.".to_string())?;
        match integration {
            Ok(commit) => {
                if !self.is_node_running(run_id, node_id)? {
                    return Ok(());
                }
                let output = json!({
                    "commit": commit,
                    "provider": plan.provider,
                    "logPath": result.log_path,
                    "logHash": result.log_hash,
                    "runtimeSkills": plan.selected_skill_ids,
                })
                .to_string();
                self.store
                    .update_node_evidence(
                        run_id,
                        node_id,
                        result.external_session_id.as_deref(),
                        Some(&output),
                        None,
                    )
                    .map_err(|error| error.to_string())?;
                if self
                    .store
                    .transition_running_node(run_id, node_id, "succeeded")
                    .map_err(|error| error.to_string())?
                {
                    self.events.persist_then_emit(
                        run_id,
                        json!({"type": "node_succeeded", "nodeId": node_id, "commit": commit}),
                    )?;
                    self.schedule(run_id)?;
                }
                Ok(())
            }
            Err(NodeIntegrationError::Conflict { summary }) => {
                self.pause_for_conflict(run_id, node_id, &node_worktree, &summary)
                    .await
            }
            Err(NodeIntegrationError::Failure(error)) => {
                self.fail_node(run_id, node_id, &error, Some(&node_worktree.path))
                    .await
            }
        }
    }

    async fn pause_for_conflict(
        &self,
        run_id: &str,
        node_id: &str,
        node_worktree: &NodeWorktree,
        summary: &str,
    ) -> Result<(), String> {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "The system clock is unavailable.".to_string())?
            .as_nanos();
        let attention = WorkflowAttentionRecord {
            id: format!("attention-conflict-{run_id}-{node_id}-{unique}"),
            run_id: run_id.to_string(),
            node_run_id: Some(format!("{run_id}-{node_id}")),
            kind: "git_conflict".into(),
            priority: "high".into(),
            status: "open".into(),
            summary: summary.chars().take(16_384).collect(),
            context_json: json!({
                "nodeId": node_id,
                "nodeBranch": node_worktree.branch,
                "nodeWorktreePath": node_worktree.path,
            })
            .to_string(),
        };
        if self
            .store
            .pause_run_for_attention(&attention)
            .map_err(|error| error.to_string())?
        {
            let _ = cancel_active_agents(&self.runtime, run_id).await;
            self.events.persist_then_emit(
                run_id,
                json!({
                    "type": "workflow_attention_created",
                    "attentionId": attention.id,
                    "nodeId": node_id,
                    "kind": "git_conflict",
                    "runStatus": "paused",
                }),
            )?;
        }
        Ok(())
    }

    async fn fail_node(
        &self,
        run_id: &str,
        node_id: &str,
        error: &str,
        worktree_path: Option<&PathBuf>,
    ) -> Result<(), String> {
        let projection = self.projection(run_id)?;
        if projection.run.status != "running" {
            return Ok(());
        }
        let node = projection
            .nodes
            .iter()
            .find(|node| node.node.node_id == node_id)
            .ok_or_else(|| "Workflow node run was not found.".to_string())?;
        if !matches!(node.node.status.as_str(), "running" | "failed") {
            return Ok(());
        }
        self.store
            .update_node_evidence(run_id, node_id, None, None, Some(error))
            .map_err(|store_error| store_error.to_string())?;
        if node.node.status == "running" {
            let _ = self
                .store
                .transition_running_node(run_id, node_id, "failed")
                .map_err(|store_error| store_error.to_string())?;
        }
        self.events.persist_then_emit(
            run_id,
            json!({
                "type": "node_failed",
                "nodeId": node_id,
                "message": error.chars().take(16_384).collect::<String>(),
                "worktreePath": worktree_path.map(|path| path.to_string_lossy().into_owned()),
            }),
        )?;
        if retry_node_checked(&self.store, run_id, node_id)? {
            self.events.persist_then_emit(
                run_id,
                json!({"type": "node_retry_kicked", "nodeId": node_id}),
            )?;
        }
        self.schedule(run_id)
    }

    fn is_node_running(&self, run_id: &str, node_id: &str) -> Result<bool, String> {
        let projection = self.projection(run_id)?;
        Ok(projection.run.status == "running"
            && projection
                .nodes
                .iter()
                .any(|node| node.node.node_id == node_id && node.node.status == "running"))
    }
}
