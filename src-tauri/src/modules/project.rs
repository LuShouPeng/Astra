use git2::{Repository, StatusOptions};
use serde::Serialize;
use std::path::Path;
use tauri_plugin_opener::OpenerExt;

use super::workspace::safe_directory;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitSummary {
    git_repository: bool,
    branch: Option<String>,
    git_status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectError {
    code: &'static str,
    message: String,
    recoverable: bool,
}

impl ProjectError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable: true,
        }
    }
}

fn inspect_git(root: &Path) -> Result<ProjectGitSummary, ProjectError> {
    let repository = match Repository::open(root) {
        Ok(repository) => repository,
        Err(error) if error.code() == git2::ErrorCode::NotFound => {
            return Ok(ProjectGitSummary {
                git_repository: false,
                branch: None,
                git_status: "unknown",
            });
        }
        Err(_) => {
            return Err(ProjectError::new(
                "GIT_UNAVAILABLE",
                "Git information could not be read for this project.",
            ));
        }
    };

    let branch = repository
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_owned));
    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repository.statuses(Some(&mut options)).map_err(|_| {
        ProjectError::new(
            "GIT_UNAVAILABLE",
            "Git status could not be read for this project.",
        )
    })?;

    Ok(ProjectGitSummary {
        git_repository: true,
        branch,
        git_status: if statuses.is_empty() {
            "clean"
        } else {
            "modified"
        },
    })
}

#[tauri::command]
pub fn project_git_summary(root_path: String) -> Result<ProjectGitSummary, ProjectError> {
    let canonical = safe_directory(Path::new(&root_path))
        .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
    inspect_git(&canonical)
}

#[tauri::command]
pub fn system_open_directory(app: tauri::AppHandle, root_path: String) -> Result<(), ProjectError> {
    let canonical = safe_directory(Path::new(&root_path))
        .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
    app.opener()
        .open_path(canonical.to_string_lossy(), None::<&str>)
        .map_err(|_| {
            ProjectError::new(
                "OPEN_FAILED",
                "The project directory could not be opened in the system file manager.",
            )
        })
}

#[cfg(test)]
mod tests {
    use super::inspect_git;
    use git2::{Repository, Signature};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("astra-{label}-{suffix}"));
        fs::create_dir_all(&path).expect("create temporary directory");
        path
    }

    #[test]
    fn reports_non_repository_without_searching_parent_directories() {
        let root = temporary_directory("not-git");
        let summary = inspect_git(&root).expect("inspect non repository");
        assert!(!summary.git_repository);
        assert_eq!(summary.git_status, "unknown");
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn reports_clean_and_modified_repository_states() {
        let root = temporary_directory("git");
        let repository = Repository::init(&root).expect("initialize repository");
        fs::write(root.join("README.md"), "Astra\n").expect("write fixture");
        let mut index = repository.index().expect("open index");
        index
            .add_path(std::path::Path::new("README.md"))
            .expect("add file");
        index.write().expect("persist index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        let signature = Signature::now("Astra", "astra@example.test").expect("signature");
        repository
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .expect("create initial commit");

        let clean = inspect_git(&root).expect("inspect clean repository");
        assert_eq!(clean.git_status, "clean");
        assert_eq!(clean.branch.as_deref(), Some("master"));

        fs::write(root.join("README.md"), "Changed\n").expect("modify fixture");
        let modified = inspect_git(&root).expect("inspect modified repository");
        assert_eq!(modified.git_status, "modified");
        drop(tree);
        drop(repository);
        fs::remove_dir_all(root).expect("remove temporary repository");
    }
}
