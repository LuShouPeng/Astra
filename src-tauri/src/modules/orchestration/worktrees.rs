use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWorktree {
    pub id: String,
    pub branch: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeWorktree {
    pub id: String,
    pub run_id: String,
    pub branch: String,
    pub path: PathBuf,
}

pub struct WorktreeManager {
    repository: PathBuf,
    cache: PathBuf,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn git(root: &Path, args: impl IntoIterator<Item = OsString>) -> Result<Output, String> {
    Command::new("git.exe")
        .args(["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false"])
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|_| "Git could not be started.".to_string())
}

fn require_success(output: Output, message: &str) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "{message} {}",
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .next()
                .unwrap_or("Git failed.")
        ))
    }
}

impl WorktreeManager {
    pub fn new(repository: &Path, cache: &Path) -> Result<Self, String> {
        let repository = repository
            .canonicalize()
            .map_err(|_| "The Git repository is unavailable.".to_string())?;
        let top = require_success(
            git(
                &repository,
                [
                    OsString::from("rev-parse"),
                    OsString::from("--show-toplevel"),
                ],
            )?,
            "The project is not a Git repository.",
        )?;
        let top = PathBuf::from(top)
            .canonicalize()
            .map_err(|_| "The Git root is unavailable.".to_string())?;
        if top != repository {
            return Err("The project path must be the Git repository root.".into());
        }
        fs::create_dir_all(cache)
            .map_err(|_| "The worktree cache could not be created.".to_string())?;
        Ok(Self {
            repository,
            cache: cache.to_path_buf(),
        })
    }

    pub fn prepare_run(&self, run_id: &str) -> Result<RunWorktree, String> {
        if !valid_id(run_id) {
            return Err("The run identifier is invalid.".into());
        }
        let branch = format!("astra/run-{run_id}");
        let path = self.cache.join(run_id).join("integration");
        if path.exists() {
            return Err("The run worktree already exists.".into());
        }
        fs::create_dir_all(path.parent().expect("run parent"))
            .map_err(|_| "The run worktree directory could not be created.".to_string())?;
        require_success(
            git(
                &self.repository,
                [
                    OsString::from("worktree"),
                    OsString::from("add"),
                    OsString::from("-b"),
                    OsString::from(&branch),
                    path.as_os_str().to_owned(),
                    OsString::from("HEAD"),
                ],
            )?,
            "The integration worktree could not be created.",
        )?;
        Ok(RunWorktree {
            id: run_id.into(),
            branch,
            path,
        })
    }

    pub fn prepare_node(&self, run: &RunWorktree, node_id: &str) -> Result<NodeWorktree, String> {
        if !valid_id(node_id) || !valid_id(&run.id) {
            return Err("The node identifier is invalid.".into());
        }
        let branch = format!("astra/node-{}-{node_id}", run.id);
        let path = self.cache.join(&run.id).join(format!("node-{node_id}"));
        require_success(
            git(
                &self.repository,
                [
                    OsString::from("worktree"),
                    OsString::from("add"),
                    OsString::from("-b"),
                    OsString::from(&branch),
                    path.as_os_str().to_owned(),
                    OsString::from(&run.branch),
                ],
            )?,
            "The node worktree could not be created.",
        )?;
        Ok(NodeWorktree {
            id: node_id.into(),
            run_id: run.id.clone(),
            branch,
            path,
        })
    }

    pub fn commit_node(
        &self,
        node: &NodeWorktree,
        workflow_id: &str,
        run_id: &str,
        node_id: &str,
    ) -> Result<String, String> {
        if !valid_id(workflow_id) || !valid_id(run_id) || !valid_id(node_id) {
            return Err("Managed commit identifiers are invalid.".into());
        }
        require_success(
            git(&node.path, [OsString::from("add"), OsString::from("--all")])?,
            "Node changes could not be staged.",
        )?;
        let status = require_success(
            git(
                &node.path,
                [OsString::from("status"), OsString::from("--porcelain")],
            )?,
            "Node changes could not be inspected.",
        )?;
        if !status.is_empty() {
            let message = format!("astra: workflow {workflow_id} run {run_id} node {node_id}");
            require_success(
                git(
                    &node.path,
                    [
                        OsString::from("-c"),
                        OsString::from("user.name=Astra Nexus"),
                        OsString::from("-c"),
                        OsString::from("user.email=astra@localhost"),
                        OsString::from("commit"),
                        OsString::from("-m"),
                        OsString::from(message),
                    ],
                )?,
                "The managed node commit failed.",
            )?;
        }
        require_success(
            git(
                &node.path,
                [OsString::from("rev-parse"), OsString::from("HEAD")],
            )?,
            "The node commit could not be resolved.",
        )
    }

    pub fn integrate_node(&self, run: &RunWorktree, node: &NodeWorktree) -> Result<(), String> {
        if node.run_id != run.id {
            return Err("The node worktree belongs to a different run.".into());
        }
        let message = format!("astra: integrate run {} node {}", run.id, node.id);
        require_success(
            git(
                &run.path,
                [
                    OsString::from("-c"),
                    OsString::from("user.name=Astra Nexus"),
                    OsString::from("-c"),
                    OsString::from("user.email=astra@localhost"),
                    OsString::from("merge"),
                    OsString::from("--no-ff"),
                    OsString::from(&node.branch),
                    OsString::from("-m"),
                    OsString::from(message),
                ],
            )?,
            "The node branch conflicts with the integration branch.",
        )?;
        Ok(())
    }

    pub fn merge_to_user_branch(&self, run: &RunWorktree, approved: bool) -> Result<(), String> {
        if !approved {
            return Err("Final integration requires explicit approval.".into());
        }
        let status = require_success(
            git(
                &self.repository,
                [OsString::from("status"), OsString::from("--porcelain")],
            )?,
            "The user branch could not be inspected.",
        )?;
        if !status.is_empty() {
            return Err("The user worktree must be clean before final integration.".into());
        }
        let message = format!("astra: merge workflow run {}", run.id);
        require_success(
            git(
                &self.repository,
                [
                    OsString::from("-c"),
                    OsString::from("user.name=Astra Nexus"),
                    OsString::from("-c"),
                    OsString::from("user.email=astra@localhost"),
                    OsString::from("merge"),
                    OsString::from("--no-ff"),
                    OsString::from(&run.branch),
                    OsString::from("-m"),
                    OsString::from(message),
                ],
            )?,
            "The final integration conflicts with the user branch.",
        )?;
        Ok(())
    }
}

fn manager(app: &AppHandle, repository: &str) -> Result<WorktreeManager, String> {
    let cache = app
        .path()
        .app_data_dir()
        .map_err(|_| "The application data directory is unavailable.".to_string())?
        .join("worktrees");
    WorktreeManager::new(Path::new(repository), &cache)
}

#[tauri::command]
pub async fn orchestration_prepare_run_worktree(
    app: AppHandle,
    repository: String,
    run_id: String,
) -> Result<RunWorktree, String> {
    tauri::async_runtime::spawn_blocking(move || manager(&app, &repository)?.prepare_run(&run_id))
        .await
        .map_err(|_| "The worktree task stopped unexpectedly.".to_string())?
}

#[tauri::command]
pub async fn orchestration_prepare_node_worktree(
    app: AppHandle,
    repository: String,
    run: RunWorktree,
    node_id: String,
) -> Result<NodeWorktree, String> {
    tauri::async_runtime::spawn_blocking(move || {
        manager(&app, &repository)?.prepare_node(&run, &node_id)
    })
    .await
    .map_err(|_| "The worktree task stopped unexpectedly.".to_string())?
}

#[tauri::command]
pub async fn orchestration_integrate_node(
    app: AppHandle,
    repository: String,
    run: RunWorktree,
    node: NodeWorktree,
    workflow_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = manager(&app, &repository)?;
        let commit = manager.commit_node(&node, &workflow_id, &run.id, &node.id)?;
        manager.integrate_node(&run, &node)?;
        Ok(commit)
    })
    .await
    .map_err(|_| "The integration task stopped unexpectedly.".to_string())?
}

#[tauri::command]
pub async fn orchestration_merge_run(
    app: AppHandle,
    repository: String,
    run: RunWorktree,
    approved: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        manager(&app, &repository)?.merge_to_user_branch(&run, approved)
    })
    .await
    .map_err(|_| "The final integration task stopped unexpectedly.".to_string())?
}
