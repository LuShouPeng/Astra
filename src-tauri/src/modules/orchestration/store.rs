use std::{path::Path, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("Orchestration data could not be accessed.")]
    Database(#[from] rusqlite::Error),
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

pub struct OrchestrationStore {
    connection: Mutex<Connection>,
}

impl OrchestrationStore {
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
                installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, version, content_hash)
            );
            PRAGMA user_version = 1;
            ",
        )?;
        transaction.commit()?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
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
