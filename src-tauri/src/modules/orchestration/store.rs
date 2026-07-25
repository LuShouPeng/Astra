use std::{path::Path, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::scheduler::{retry_decision, RetryDecision};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("Orchestration data could not be accessed.")]
    Database(#[from] rusqlite::Error),
    #[error("Orchestration migration backup could not be created.")]
    Io(#[from] std::io::Error),
    #[error("Orchestration data failed an integrity check: {0}")]
    Integrity(String),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRecord {
    pub id: String,
    pub version: i64,
    pub name: String,
    pub project_id: String,
    pub definition_json: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTemplateRecord {
    pub id: String,
    pub name: String,
    pub definition_json: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunRecord {
    pub id: String,
    pub workflow_id: String,
    pub workflow_version: i64,
    pub project_id: String,
    pub status: String,
    pub integration_branch: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeRunRecord {
    pub id: String,
    pub run_id: String,
    pub node_id: String,
    pub status: String,
    pub attempt: i64,
    pub provider: Option<String>,
    pub worktree_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    pub id: String,
    pub run_id: String,
    pub node_run_id: String,
    pub capability: String,
    pub risk: String,
    pub summary: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigRecord {
    pub id: String,
    pub config_json: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeRunProjection {
    #[serde(flatten)]
    pub node: NodeRunRecord,
    pub external_session_id: Option<String>,
    pub output_json: Option<String>,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunEventRecord {
    pub sequence: i64,
    pub event_json: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunProjection {
    pub run: WorkflowRunRecord,
    pub nodes: Vec<NodeRunProjection>,
    pub approvals: Vec<ApprovalRecord>,
    pub events: Vec<RunEventRecord>,
    pub artifacts: Vec<ArtifactRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub id: String,
    pub run_id: String,
    pub node_run_id: Option<String>,
    pub kind: String,
    pub path: String,
    pub content_hash: String,
    pub byte_length: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackageRecord {
    pub id: String,
    pub version: String,
    pub content_hash: String,
    pub package_json: String,
    pub uninstalled: bool,
}

pub struct OrchestrationStore {
    connection: Mutex<Connection>,
}

impl OrchestrationStore {
    pub fn backup_legacy_database(path: &Path) -> Result<Option<std::path::PathBuf>, StoreError> {
        if !path.is_file() {
            return Ok(None);
        }
        let connection = Connection::open(path)?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        drop(connection);
        if version >= 2 {
            return Ok(None);
        }
        let backup = path.with_extension("sqlite3.v1.backup");
        if !backup.exists() {
            std::fs::copy(path, &backup)?;
        }
        Ok(Some(backup))
    }

    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self, StoreError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, StoreError> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS workflows (
                id TEXT NOT NULL,
                version INTEGER NOT NULL,
                name TEXT NOT NULL,
                project_id TEXT NOT NULL,
                definition_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, version)
            );
            CREATE TABLE IF NOT EXISTS workflow_runs (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                workflow_version INTEGER NOT NULL,
                project_id TEXT NOT NULL,
                status TEXT NOT NULL,
                integration_branch TEXT,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS workflow_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                definition_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS node_runs (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
                node_id TEXT NOT NULL,
                status TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                provider TEXT,
                worktree_path TEXT,
                external_session_id TEXT,
                output_json TEXT,
                error TEXT,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS approvals (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
                node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
                capability TEXT NOT NULL,
                risk TEXT NOT NULL,
                summary TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS run_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
                event_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS mcp_servers (
                id TEXT PRIMARY KEY,
                config_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS skill_packages (
                id TEXT NOT NULL,
                version TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                package_json TEXT NOT NULL,
                uninstalled_at TEXT,
                installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, version, content_hash)
            );
            CREATE TABLE IF NOT EXISTS run_artifacts (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
                node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
                kind TEXT NOT NULL,
                path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                byte_length INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS workflow_run_skills (
                run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
                skill_id TEXT NOT NULL,
                version TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                PRIMARY KEY (run_id, skill_id, version, content_hash),
                FOREIGN KEY (skill_id, version, content_hash)
                    REFERENCES skill_packages(id, version, content_hash)
            );
            CREATE TABLE IF NOT EXISTS workflow_node_mcp_configs (
                run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
                node_id TEXT NOT NULL,
                server_id TEXT NOT NULL,
                config_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (run_id, node_id, server_id)
            );
            ",
        )?;
        Self::ensure_column(&transaction, "workflow_runs", "started_at", "TEXT")?;
        Self::ensure_column(&transaction, "workflow_runs", "completed_at", "TEXT")?;
        Self::ensure_column(&transaction, "node_runs", "external_session_id", "TEXT")?;
        Self::ensure_column(&transaction, "node_runs", "output_json", "TEXT")?;
        Self::ensure_column(&transaction, "node_runs", "error", "TEXT")?;
        Self::ensure_column(&transaction, "node_runs", "started_at", "TEXT")?;
        Self::ensure_column(&transaction, "node_runs", "completed_at", "TEXT")?;
        Self::ensure_column(&transaction, "skill_packages", "uninstalled_at", "TEXT")?;
        transaction.pragma_update(None, "user_version", 3)?;
        transaction.commit()?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn ensure_column(
        connection: &Connection,
        table: &str,
        column: &str,
        data_type: &str,
    ) -> Result<(), StoreError> {
        let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        if !columns.iter().any(|name| name == column) {
            connection.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {data_type}"
            ))?;
        }
        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn save_workflow(
        &self,
        id: &str,
        version: i64,
        name: &str,
        project_id: &str,
        definition_json: &str,
    ) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO workflows (id, version, name, project_id, definition_json)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id, version) DO UPDATE SET
               name = excluded.name,
               project_id = excluded.project_id,
               definition_json = excluded.definition_json,
               updated_at = CURRENT_TIMESTAMP",
            params![id, version, name, project_id, definition_json],
        )?;
        Ok(())
    }

    pub fn list_workflows(&self) -> Result<Vec<WorkflowRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT w.id, w.version, w.name, w.project_id, w.definition_json
             FROM workflows w
             INNER JOIN (SELECT id, MAX(version) version FROM workflows GROUP BY id) latest
               ON latest.id = w.id AND latest.version = w.version
             ORDER BY w.name COLLATE NOCASE",
        )?;
        let records = statement
            .query_map([], |row| {
                Ok(WorkflowRecord {
                    id: row.get(0)?,
                    version: row.get(1)?,
                    name: row.get(2)?,
                    project_id: row.get(3)?,
                    definition_json: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn get_workflow(
        &self,
        id: &str,
        version: i64,
    ) -> Result<Option<WorkflowRecord>, StoreError> {
        Ok(self
            .connection()
            .query_row(
                "SELECT id, version, name, project_id, definition_json
                 FROM workflows WHERE id = ?1 AND version = ?2",
                params![id, version],
                |row| {
                    Ok(WorkflowRecord {
                        id: row.get(0)?,
                        version: row.get(1)?,
                        name: row.get(2)?,
                        project_id: row.get(3)?,
                        definition_json: row.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn save_template(
        &self,
        id: &str,
        name: &str,
        definition_json: &str,
    ) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO workflow_templates (id, name, definition_json) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name,
               definition_json = excluded.definition_json, updated_at = CURRENT_TIMESTAMP",
            params![id, name, definition_json],
        )?;
        Ok(())
    }

    pub fn list_templates(&self) -> Result<Vec<WorkflowTemplateRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, name, definition_json FROM workflow_templates ORDER BY name COLLATE NOCASE",
        )?;
        let records = statement
            .query_map([], |row| {
                Ok(WorkflowTemplateRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    definition_json: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn save_run(&self, run: &WorkflowRunRecord) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO workflow_runs
               (id, workflow_id, workflow_version, project_id, status, integration_branch)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               status = excluded.status,
               integration_branch = excluded.integration_branch,
               updated_at = CURRENT_TIMESTAMP",
            params![
                run.id,
                run.workflow_id,
                run.workflow_version,
                run.project_id,
                run.status,
                run.integration_branch
            ],
        )?;
        Ok(())
    }

    pub fn create_run_bundle(
        &self,
        run: &WorkflowRunRecord,
        nodes: &[NodeRunRecord],
        approval: &ApprovalRecord,
        skill_ids: &[String],
        node_mcp_servers: &[(String, Vec<String>)],
        event_json: &str,
    ) -> Result<(), StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO workflow_runs
               (id, workflow_id, workflow_version, project_id, status, integration_branch)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                run.id,
                run.workflow_id,
                run.workflow_version,
                run.project_id,
                run.status,
                run.integration_branch
            ],
        )?;
        for skill_id in skill_ids {
            let inserted = transaction.execute(
                "INSERT INTO workflow_run_skills (run_id, skill_id, version, content_hash)
                 SELECT ?1, id, version, content_hash FROM skill_packages
                 WHERE id = ?2 AND uninstalled_at IS NULL ORDER BY installed_at DESC LIMIT 1",
                params![run.id, skill_id],
            )?;
            if inserted != 1 {
                return Err(StoreError::Integrity(format!(
                    "Skill '{skill_id}' was not available for the run snapshot."
                )));
            }
        }
        for (node_id, server_ids) in node_mcp_servers {
            for server_id in server_ids {
                let inserted = transaction.execute(
                    "INSERT INTO workflow_node_mcp_configs
                       (run_id, node_id, server_id, config_json)
                     SELECT ?1, ?2, id, config_json FROM mcp_servers WHERE id = ?3",
                    params![run.id, node_id, server_id],
                )?;
                if inserted != 1 {
                    return Err(StoreError::Integrity(format!(
                        "MCP server '{server_id}' was not available for the run snapshot."
                    )));
                }
            }
        }
        for node in nodes {
            transaction.execute(
                "INSERT INTO node_runs
                   (id, run_id, node_id, status, attempt, provider, worktree_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    node.id,
                    node.run_id,
                    node.node_id,
                    node.status,
                    node.attempt,
                    node.provider,
                    node.worktree_path
                ],
            )?;
        }
        transaction.execute(
            "INSERT INTO approvals
               (id, run_id, node_run_id, capability, risk, summary, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                approval.id,
                approval.run_id,
                approval.node_run_id,
                approval.capability,
                approval.risk,
                approval.summary,
                approval.status
            ],
        )?;
        transaction.execute(
            "INSERT INTO run_events (run_id, event_json) VALUES (?1, ?2)",
            params![run.id, event_json],
        )?;
        let approval_event = serde_json::json!({
            "type": "approval_requested",
            "approvalId": approval.id,
            "nodeRunId": approval.node_run_id,
            "capability": approval.capability,
            "risk": approval.risk,
        });
        transaction.execute(
            "INSERT INTO run_events (run_id, event_json) VALUES (?1, ?2)",
            params![run.id, approval_event.to_string()],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn get_run(&self, id: &str) -> Result<Option<WorkflowRunRecord>, StoreError> {
        Ok(self
            .connection()
            .query_row(
                "SELECT id, workflow_id, workflow_version, project_id, status, integration_branch
                 FROM workflow_runs WHERE id = ?1",
                [id],
                |row| {
                    Ok(WorkflowRunRecord {
                        id: row.get(0)?,
                        workflow_id: row.get(1)?,
                        workflow_version: row.get(2)?,
                        project_id: row.get(3)?,
                        status: row.get(4)?,
                        integration_branch: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn save_node_run(&self, node: &NodeRunRecord) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO node_runs
               (id, run_id, node_id, status, attempt, provider, worktree_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               status = excluded.status,
               attempt = excluded.attempt,
               provider = excluded.provider,
               worktree_path = excluded.worktree_path,
               updated_at = CURRENT_TIMESTAMP",
            params![
                node.id,
                node.run_id,
                node.node_id,
                node.status,
                node.attempt,
                node.provider,
                node.worktree_path
            ],
        )?;
        Ok(())
    }

    pub fn list_node_runs(&self, run_id: &str) -> Result<Vec<NodeRunRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, run_id, node_id, status, attempt, provider, worktree_path
             FROM node_runs WHERE run_id = ?1 ORDER BY created_at, id",
        )?;
        let records = statement
            .query_map([run_id], |row| {
                Ok(NodeRunRecord {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    node_id: row.get(2)?,
                    status: row.get(3)?,
                    attempt: row.get(4)?,
                    provider: row.get(5)?,
                    worktree_path: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn update_node_provider(
        &self,
        run_id: &str,
        node_id: &str,
        provider: &str,
    ) -> Result<(), StoreError> {
        self.connection().execute(
            "UPDATE node_runs SET provider = ?3, updated_at = CURRENT_TIMESTAMP
             WHERE run_id = ?1 AND node_id = ?2",
            params![run_id, node_id, provider],
        )?;
        Ok(())
    }

    pub fn save_approval(&self, approval: &ApprovalRecord) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO approvals
               (id, run_id, node_run_id, capability, risk, summary, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               status = excluded.status,
               updated_at = CURRENT_TIMESTAMP",
            params![
                approval.id,
                approval.run_id,
                approval.node_run_id,
                approval.capability,
                approval.risk,
                approval.summary,
                approval.status
            ],
        )?;
        Ok(())
    }

    pub fn request_approval(
        &self,
        approval: &ApprovalRecord,
        event_json: &str,
    ) -> Result<bool, StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let inserted = transaction.execute(
            "INSERT OR IGNORE INTO approvals
               (id, run_id, node_run_id, capability, risk, summary, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')",
            params![
                approval.id,
                approval.run_id,
                approval.node_run_id,
                approval.capability,
                approval.risk,
                approval.summary,
            ],
        )?;
        if inserted == 1 {
            transaction.execute(
                "INSERT INTO run_events (run_id, event_json) VALUES (?1, ?2)",
                params![approval.run_id, event_json],
            )?;
        }
        transaction.commit()?;
        Ok(inserted == 1)
    }

    pub fn list_approvals(&self, run_id: &str) -> Result<Vec<ApprovalRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, run_id, node_run_id, capability, risk, summary, status
             FROM approvals WHERE run_id = ?1 ORDER BY created_at, id",
        )?;
        let records = statement
            .query_map([run_id], |row| {
                Ok(ApprovalRecord {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    node_run_id: row.get(2)?,
                    capability: row.get(3)?,
                    risk: row.get(4)?,
                    summary: row.get(5)?,
                    status: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn append_event(&self, run_id: &str, event_json: &str) -> Result<i64, StoreError> {
        let connection = self.connection();
        connection.execute(
            "INSERT INTO run_events (run_id, event_json) VALUES (?1, ?2)",
            params![run_id, event_json],
        )?;
        Ok(connection.last_insert_rowid())
    }

    pub fn decide_run(&self, run_id: &str, approved: bool) -> Result<bool, StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let target = transaction
            .query_row(
                "SELECT a.id, a.node_run_id
                 FROM approvals a
                 INNER JOIN workflow_runs r ON r.id = a.run_id
                 INNER JOIN node_runs n ON n.id = a.node_run_id AND n.run_id = r.id
                 WHERE a.run_id = ?1 AND a.capability = 'worktree' AND a.status = 'pending'
                   AND r.status = 'waiting' AND n.status = 'waiting_approval'",
                [run_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((approval_id, node_run_id)) = target else {
            return Ok(false);
        };
        if approved {
            transaction.execute(
                "UPDATE approvals SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                [approval_id],
            )?;
        } else {
            transaction.execute(
                "UPDATE approvals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
                 WHERE run_id = ?1 AND status = 'pending'",
                [run_id],
            )?;
        }
        if approved {
            transaction.execute(
                "UPDATE node_runs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                [node_run_id],
            )?;
        } else {
            transaction.execute(
                "UPDATE node_runs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                 WHERE run_id = ?1 AND status IN ('pending','ready','running','waiting_approval')",
                [run_id],
            )?;
        }
        transaction.execute(
            "UPDATE workflow_runs SET status = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![run_id, if approved { "queued" } else { "cancelled" }],
        )?;
        transaction.execute(
            "INSERT INTO run_events (run_id, event_json) VALUES (?1, ?2)",
            params![
                run_id,
                if approved {
                    r#"{"type":"approval_decided","decision":"approved"}"#
                } else {
                    r#"{"type":"approval_decided","decision":"rejected"}"#
                }
            ],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn decide_approval(&self, approval_id: &str, approved: bool) -> Result<bool, StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let target = transaction
            .query_row(
                "SELECT a.run_id, a.node_run_id
                 FROM approvals a
                 INNER JOIN workflow_runs r ON r.id = a.run_id
                 INNER JOIN node_runs n ON n.id = a.node_run_id AND n.run_id = r.id
                 WHERE a.id = ?1 AND a.status = 'pending' AND a.capability != 'worktree'
                   AND r.status = 'waiting' AND n.status = 'waiting_approval'",
                [approval_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((run_id, node_run_id)) = target else {
            return Ok(false);
        };
        if approved {
            transaction.execute(
                "UPDATE approvals SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                [approval_id],
            )?;
        } else {
            transaction.execute(
                "UPDATE approvals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
                 WHERE run_id = ?1 AND node_run_id = ?2 AND status = 'pending'",
                params![run_id, node_run_id],
            )?;
        }
        transaction.execute(
            "UPDATE node_runs SET status = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![node_run_id, if approved { "pending" } else { "cancelled" }],
        )?;
        let event = serde_json::json!({
            "type": "approval_decided",
            "approvalId": approval_id,
            "decision": if approved { "approved" } else { "rejected" }
        });
        transaction.execute(
            "INSERT INTO run_events (run_id, event_json) VALUES (?1, ?2)",
            params![run_id, event.to_string()],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn set_run_status(&self, run_id: &str, status: &str) -> Result<(), StoreError> {
        self.connection().execute(
            "UPDATE workflow_runs SET status = ?2,
             started_at = CASE WHEN ?2 = 'running' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
             completed_at = CASE WHEN ?2 IN ('completed','failed','cancelled') THEN CURRENT_TIMESTAMP ELSE completed_at END,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![run_id, status],
        )?;
        Ok(())
    }

    pub fn cancel_run(&self, run_id: &str) -> Result<bool, StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE workflow_runs SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND status IN ('waiting','queued','running','interrupted')",
            [run_id],
        )?;
        if changed == 0 {
            return Ok(false);
        }
        transaction.execute(
            "UPDATE approvals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
             WHERE run_id = ?1 AND status = 'pending'",
            [run_id],
        )?;
        transaction.execute("UPDATE node_runs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE run_id = ?1 AND status IN ('pending','ready','running','waiting_approval')", [run_id])?;
        transaction.execute("INSERT INTO run_events (run_id, event_json) VALUES (?1, '{\"type\":\"run_cancelled\"}')", [run_id])?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn resume_run(&self, run_id: &str) -> Result<bool, StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE workflow_runs SET status = 'queued', completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'interrupted'",
            [run_id],
        )?;
        if changed == 0 {
            return Ok(false);
        }
        transaction.execute(
            "UPDATE node_runs SET status = 'pending', completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE run_id = ?1 AND status = 'interrupted'",
            [run_id],
        )?;
        transaction.execute(
            "INSERT INTO run_events (run_id, event_json) VALUES (?1, '{\"type\":\"run_resumed\"}')",
            [run_id],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn update_node_status(
        &self,
        run_id: &str,
        node_id: &str,
        status: &str,
        worktree_path: Option<&str>,
    ) -> Result<(), StoreError> {
        self.connection().execute(
            "UPDATE node_runs SET status = ?3, worktree_path = COALESCE(?4, worktree_path),
             started_at = CASE WHEN ?3 = 'running' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
             completed_at = CASE WHEN ?3 IN ('succeeded','failed','skipped','cancelled') THEN CURRENT_TIMESTAMP ELSE completed_at END,
             updated_at = CURRENT_TIMESTAMP WHERE run_id = ?1 AND node_id = ?2",
            params![run_id, node_id, status, worktree_path],
        )?;
        Ok(())
    }

    pub fn update_node_evidence(
        &self,
        run_id: &str,
        node_id: &str,
        external_session_id: Option<&str>,
        output_json: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), StoreError> {
        self.connection().execute(
            "UPDATE node_runs SET external_session_id = COALESCE(?3, external_session_id),
             output_json = COALESCE(?4, output_json), error = ?5, updated_at = CURRENT_TIMESTAMP
             WHERE run_id = ?1 AND node_id = ?2",
            params![run_id, node_id, external_session_id, output_json, error],
        )?;
        Ok(())
    }

    pub fn get_run_projection(&self, id: &str) -> Result<Option<RunProjection>, StoreError> {
        let Some(run) = self.get_run(id)? else {
            return Ok(None);
        };
        let connection = self.connection();
        let mut node_statement = connection.prepare(
            "SELECT id, run_id, node_id, status, attempt, provider, worktree_path,
                    external_session_id, output_json, error, started_at, completed_at
             FROM node_runs WHERE run_id = ?1 ORDER BY created_at, id",
        )?;
        let nodes = node_statement
            .query_map([id], |row| {
                Ok(NodeRunProjection {
                    node: NodeRunRecord {
                        id: row.get(0)?,
                        run_id: row.get(1)?,
                        node_id: row.get(2)?,
                        status: row.get(3)?,
                        attempt: row.get(4)?,
                        provider: row.get(5)?,
                        worktree_path: row.get(6)?,
                    },
                    external_session_id: row.get(7)?,
                    output_json: row.get(8)?,
                    error: row.get(9)?,
                    started_at: row.get(10)?,
                    completed_at: row.get(11)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut event_statement = connection.prepare(
            "SELECT sequence, event_json, created_at FROM run_events WHERE run_id = ?1 ORDER BY sequence",
        )?;
        let events = event_statement
            .query_map([id], |row| {
                Ok(RunEventRecord {
                    sequence: row.get(0)?,
                    event_json: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(event_statement);
        drop(node_statement);
        drop(connection);
        Ok(Some(RunProjection {
            run,
            nodes,
            approvals: self.list_approvals(id)?,
            events,
            artifacts: self.list_artifacts(id)?,
        }))
    }

    pub fn save_artifact(&self, artifact: &ArtifactRecord) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO run_artifacts
               (id, run_id, node_run_id, kind, path, content_hash, byte_length)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET path = excluded.path,
               content_hash = excluded.content_hash, byte_length = excluded.byte_length",
            params![
                artifact.id,
                artifact.run_id,
                artifact.node_run_id,
                artifact.kind,
                artifact.path,
                artifact.content_hash,
                artifact.byte_length
            ],
        )?;
        Ok(())
    }

    pub fn list_artifacts(&self, run_id: &str) -> Result<Vec<ArtifactRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, run_id, node_run_id, kind, path, content_hash, byte_length
             FROM run_artifacts WHERE run_id = ?1 ORDER BY created_at, id",
        )?;
        let artifacts = statement
            .query_map([run_id], |row| {
                Ok(ArtifactRecord {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    node_run_id: row.get(2)?,
                    kind: row.get(3)?,
                    path: row.get(4)?,
                    content_hash: row.get(5)?,
                    byte_length: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(artifacts)
    }

    pub fn retry_node(
        &self,
        run_id: &str,
        node_id: &str,
        max_retries: u8,
    ) -> Result<bool, StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let node = transaction
            .query_row(
                "SELECT n.attempt, n.status, r.status
                 FROM node_runs n
                 INNER JOIN workflow_runs r ON r.id = n.run_id
                 WHERE n.run_id = ?1 AND n.node_id = ?2",
                params![run_id, node_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((attempt, node_status, run_status)) = node else {
            return Ok(false);
        };
        if node_status != "failed" || run_status != "running" {
            return Ok(false);
        }
        let decision = retry_decision(attempt.clamp(0, u8::MAX as i64) as u8, max_retries);
        let retry = matches!(decision, RetryDecision::Retry { .. });
        if let RetryDecision::Retry {
            attempt: next_attempt,
        } = decision
        {
            transaction.execute(
                "UPDATE node_runs SET status = 'pending', attempt = ?3,
                 error = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE run_id = ?1 AND node_id = ?2 AND status = 'failed'",
                params![run_id, node_id, next_attempt],
            )?;
            let event = serde_json::json!({
                "type": "node_retry_scheduled",
                "nodeId": node_id,
                "attempt": next_attempt
            });
            transaction.execute(
                "INSERT INTO run_events (run_id, event_json) VALUES (?1, ?2)",
                params![run_id, event.to_string()],
            )?;
        }
        transaction.commit()?;
        Ok(retry)
    }

    pub fn save_mcp_config(&self, id: &str, config_json: &str) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO mcp_servers (id, config_json) VALUES (?1, ?2)
             ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP",
            params![id, config_json],
        )?;
        Ok(())
    }

    pub fn list_mcp_configs(&self) -> Result<Vec<McpConfigRecord>, StoreError> {
        let connection = self.connection();
        let mut statement =
            connection.prepare("SELECT id, config_json FROM mcp_servers ORDER BY id")?;
        let records = statement
            .query_map([], |row| {
                Ok(McpConfigRecord {
                    id: row.get(0)?,
                    config_json: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn get_mcp_config(&self, id: &str) -> Result<Option<McpConfigRecord>, StoreError> {
        Ok(self
            .connection()
            .query_row(
                "SELECT id, config_json FROM mcp_servers WHERE id = ?1",
                [id],
                |row| {
                    Ok(McpConfigRecord {
                        id: row.get(0)?,
                        config_json: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn snapshot_node_mcp_configs(
        &self,
        run_id: &str,
        node_id: &str,
        server_ids: &[String],
    ) -> Result<(), StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        for server_id in server_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO workflow_node_mcp_configs
                 (run_id, node_id, server_id, config_json)
                 SELECT ?1, ?2, id, config_json FROM mcp_servers WHERE id = ?3",
                params![run_id, node_id, server_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_node_mcp_configs(
        &self,
        run_id: &str,
        node_id: &str,
    ) -> Result<Vec<McpConfigRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT server_id, config_json FROM workflow_node_mcp_configs
             WHERE run_id = ?1 AND node_id = ?2 ORDER BY server_id",
        )?;
        let records = statement
            .query_map(params![run_id, node_id], |row| {
                Ok(McpConfigRecord {
                    id: row.get(0)?,
                    config_json: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn save_skill_package(
        &self,
        id: &str,
        version: &str,
        content_hash: &str,
        package_json: &str,
    ) -> Result<(), StoreError> {
        self.connection().execute(
            "INSERT INTO skill_packages (id, version, content_hash, package_json)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id, version, content_hash) DO UPDATE SET
               package_json = excluded.package_json, uninstalled_at = NULL",
            params![id, version, content_hash, package_json],
        )?;
        Ok(())
    }

    pub fn list_skill_packages(
        &self,
        include_uninstalled: bool,
    ) -> Result<Vec<SkillPackageRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, version, content_hash, package_json, uninstalled_at IS NOT NULL
             FROM skill_packages WHERE ?1 OR uninstalled_at IS NULL
             ORDER BY installed_at DESC, id",
        )?;
        let records = statement
            .query_map([include_uninstalled], |row| {
                Ok(SkillPackageRecord {
                    id: row.get(0)?,
                    version: row.get(1)?,
                    content_hash: row.get(2)?,
                    package_json: row.get(3)?,
                    uninstalled: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn uninstall_skill(&self, id: &str, content_hash: &str) -> Result<(), StoreError> {
        self.connection().execute(
            "UPDATE skill_packages SET uninstalled_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND content_hash = ?2",
            params![id, content_hash],
        )?;
        Ok(())
    }

    pub fn snapshot_skill_refs(
        &self,
        run_id: &str,
        skill_ids: &[String],
    ) -> Result<(), StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        for skill_id in skill_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO workflow_run_skills (run_id, skill_id, version, content_hash)
                 SELECT ?1, id, version, content_hash FROM skill_packages
                 WHERE id = ?2 AND uninstalled_at IS NULL ORDER BY installed_at DESC LIMIT 1",
                params![run_id, skill_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_run_skill_refs(&self, run_id: &str) -> Result<Vec<SkillPackageRecord>, StoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT p.id, p.version, p.content_hash, p.package_json, p.uninstalled_at IS NOT NULL
             FROM workflow_run_skills r JOIN skill_packages p
               ON p.id = r.skill_id AND p.version = r.version AND p.content_hash = r.content_hash
             WHERE r.run_id = ?1 ORDER BY p.id",
        )?;
        let records = statement
            .query_map([run_id], |row| {
                Ok(SkillPackageRecord {
                    id: row.get(0)?,
                    version: row.get(1)?,
                    content_hash: row.get(2)?,
                    package_json: row.get(3)?,
                    uninstalled: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn delete_mcp_config(&self, id: &str) -> Result<(), StoreError> {
        self.connection()
            .execute("DELETE FROM mcp_servers WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn mcp_secret_reference_in_use(&self, reference: &str) -> Result<bool, StoreError> {
        let connection = self.connection();
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM (
                SELECT 1 FROM mcp_servers
                WHERE json_extract(config_json, '$.secretRef') = ?1
                UNION ALL
                SELECT 1 FROM workflow_node_mcp_configs
                WHERE json_extract(config_json, '$.secretRef') = ?1
            )",
            [reference],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn list_events(&self, run_id: &str) -> Result<Vec<String>, StoreError> {
        let connection = self.connection();
        let mut statement = connection
            .prepare("SELECT event_json FROM run_events WHERE run_id = ?1 ORDER BY sequence")?;
        let events = statement
            .query_map([run_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(events)
    }

    pub fn interrupt_active_runs(&self) -> Result<usize, StoreError> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE node_runs SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP
             WHERE status IN ('ready', 'running', 'waiting_approval')",
            [],
        )?;
        let changed = transaction.execute(
            "UPDATE workflow_runs SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP
             WHERE status IN ('queued', 'running', 'waiting')",
            [],
        )?;
        transaction.commit()?;
        Ok(changed)
    }
}
