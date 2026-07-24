use git2::{Delta, DiffFormat, DiffOptions, Patch, Repository, StatusOptions};
use serde::Serialize;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

use super::workspace::safe_directory;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitSummary {
    git_repository: bool,
    branch: Option<String>,
    git_status: &'static str,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitChange {
    relative_path: String,
    status: &'static str,
    additions: usize,
    deletions: usize,
    binary: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileDiff {
    diff: Option<String>,
    binary: bool,
    truncated: bool,
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

fn open_repository(root: &Path) -> Result<Repository, ProjectError> {
    Repository::open(root).map_err(|_| {
        ProjectError::new(
            "GIT_UNAVAILABLE",
            "Git changes could not be read for this project.",
        )
    })
}

fn worktree_diff<'repo>(
    repository: &'repo Repository,
    relative_path: Option<&str>,
) -> Result<git2::Diff<'repo>, ProjectError> {
    let mut options = DiffOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_typechange(true);
    if let Some(path) = relative_path {
        options.disable_pathspec_match(true).pathspec(path);
    }
    let head_tree = repository
        .head()
        .ok()
        .and_then(|head| head.peel_to_tree().ok());
    repository
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut options))
        .map_err(|_| {
            ProjectError::new(
                "GIT_UNAVAILABLE",
                "Git changes could not be read for this project.",
            )
        })
}

fn status_label(status: Delta) -> &'static str {
    match status {
        Delta::Added | Delta::Untracked => "added",
        Delta::Deleted => "deleted",
        Delta::Renamed => "renamed",
        _ => "modified",
    }
}

fn delta_path<'a>(delta: &'a git2::DiffDelta<'a>) -> Option<&'a Path> {
    delta.new_file().path().or_else(|| delta.old_file().path())
}

fn normalized_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn bytes_look_binary(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

fn delta_looks_binary(repository: &Repository, root: &Path, delta: &git2::DiffDelta<'_>) -> bool {
    if delta.old_file().is_binary() || delta.new_file().is_binary() {
        return true;
    }
    if let Some(path) = delta.new_file().path() {
        if let Ok(file) = std::fs::File::open(root.join(path)) {
            let mut bytes = Vec::with_capacity(8_192);
            if file.take(8_192).read_to_end(&mut bytes).is_ok() && bytes_look_binary(&bytes) {
                return true;
            }
        }
    }
    let old_id = delta.old_file().id();
    if !old_id.is_zero() {
        if let Ok(blob) = repository.find_blob(old_id) {
            let content = blob.content();
            return bytes_look_binary(&content[..content.len().min(8_192)]);
        }
    }
    false
}

fn git_changes(root: &Path) -> Result<Vec<ProjectGitChange>, ProjectError> {
    let repository = open_repository(root)?;
    let diff = worktree_diff(&repository, None)?;
    diff.deltas()
        .enumerate()
        .filter_map(|(index, delta)| {
            let status = delta.status();
            delta_path(&delta).map(|path| (index, status, path.to_owned()))
        })
        .map(|(index, status, path)| {
            let patch = Patch::from_diff(&diff, index).map_err(|_| {
                ProjectError::new("GIT_UNAVAILABLE", "A changed file could not be inspected.")
            })?;
            let binary = patch
                .as_ref()
                .map(|value| delta_looks_binary(&repository, root, &value.delta()))
                .unwrap_or(true);
            let (_, additions, deletions) = patch
                .as_ref()
                .and_then(|value| value.line_stats().ok())
                .unwrap_or((0, 0, 0));
            Ok(ProjectGitChange {
                relative_path: normalized_relative_path(&path),
                status: status_label(status),
                additions,
                deletions,
                binary,
            })
        })
        .collect()
}

fn validate_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, ProjectError> {
    let relative = Path::new(relative_path);
    if relative_path.trim().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ProjectError::new(
            "INVALID_RELATIVE_PATH",
            "The selected file path is outside the registered project.",
        ));
    }
    let candidate = root.join(relative);
    if candidate.exists() {
        let canonical = dunce::canonicalize(&candidate).map_err(|_| {
            ProjectError::new(
                "FILE_UNAVAILABLE",
                "The selected file could not be normalized.",
            )
        })?;
        if !canonical.starts_with(root) {
            return Err(ProjectError::new(
                "INVALID_RELATIVE_PATH",
                "The selected file path is outside the registered project.",
            ));
        }
        return Ok(canonical);
    }
    Ok(candidate)
}

fn file_diff(root: &Path, relative_path: &str) -> Result<ProjectFileDiff, ProjectError> {
    validate_relative_path(root, relative_path)?;
    let repository = open_repository(root)?;
    let diff = worktree_diff(&repository, Some(relative_path))?;
    let Some(index) = diff
        .deltas()
        .position(|delta| delta_path(&delta) == Some(Path::new(relative_path)))
    else {
        return Err(ProjectError::new(
            "CHANGE_NOT_FOUND",
            "No Git change was found for the selected file.",
        ));
    };
    let patch = Patch::from_diff(&diff, index).map_err(|_| {
        ProjectError::new(
            "GIT_UNAVAILABLE",
            "The selected file diff could not be read.",
        )
    })?;
    if patch
        .as_ref()
        .map(|value| delta_looks_binary(&repository, root, &value.delta()))
        .unwrap_or(true)
    {
        return Ok(ProjectFileDiff {
            diff: None,
            binary: true,
            truncated: false,
        });
    }

    const MAX_DIFF_BYTES: usize = 512 * 1024;
    let mut output = Vec::new();
    let mut truncated = false;
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        if truncated {
            return true;
        }
        let prefix = match line.origin() {
            '+' | '-' | ' ' => Some(line.origin() as u8),
            _ => None,
        };
        let required = line.content().len() + usize::from(prefix.is_some());
        if output.len() + required > MAX_DIFF_BYTES {
            truncated = true;
            return true;
        }
        if let Some(prefix) = prefix {
            output.push(prefix);
        }
        output.extend_from_slice(line.content());
        true
    })
    .map_err(|_| {
        ProjectError::new(
            "GIT_UNAVAILABLE",
            "The selected file diff could not be read.",
        )
    })?;
    Ok(ProjectFileDiff {
        diff: Some(String::from_utf8_lossy(&output).into_owned()),
        binary: false,
        truncated,
    })
}

#[tauri::command]
pub fn project_git_summary(root_path: String) -> Result<ProjectGitSummary, ProjectError> {
    let canonical = safe_directory(Path::new(&root_path))
        .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
    inspect_git(&canonical)
}

#[tauri::command]
pub fn project_git_changes(root_path: String) -> Result<Vec<ProjectGitChange>, ProjectError> {
    let canonical = safe_directory(Path::new(&root_path))
        .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
    git_changes(&canonical)
}

#[tauri::command]
pub fn project_file_diff(
    root_path: String,
    relative_path: String,
) -> Result<ProjectFileDiff, ProjectError> {
    let canonical = safe_directory(Path::new(&root_path))
        .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
    file_diff(&canonical, &relative_path)
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

#[tauri::command]
pub fn system_open_file(
    app: tauri::AppHandle,
    root_path: String,
    relative_path: String,
) -> Result<(), ProjectError> {
    let canonical_root = safe_directory(Path::new(&root_path))
        .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
    let canonical_file = validate_relative_path(&canonical_root, &relative_path)?;
    if !canonical_file.is_file() {
        return Err(ProjectError::new(
            "FILE_UNAVAILABLE",
            "The selected file is not available.",
        ));
    }
    app.opener()
        .open_path(canonical_file.to_string_lossy(), None::<&str>)
        .map_err(|_| {
            ProjectError::new(
                "OPEN_FAILED",
                "The selected file could not be opened with the system application.",
            )
        })
}

#[cfg(test)]
mod tests {
    use super::{file_diff, git_changes, inspect_git};
    use git2::{Repository, Signature};
    use std::fs;
    use std::thread;
    use std::time::Duration;
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

    fn remove_temporary_directory(path: std::path::PathBuf) {
        assert!(
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("astra-")),
            "temporary cleanup must remain scoped to an Astra test directory"
        );
        for attempt in 0..20 {
            match fs::remove_dir_all(&path) {
                Ok(()) => return,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                Err(_) if attempt < 19 => thread::sleep(Duration::from_millis(10)),
                Err(error) => panic!("remove temporary repository: {error}"),
            }
        }
    }

    #[test]
    fn reports_non_repository_without_searching_parent_directories() {
        let root = temporary_directory("not-git");
        let summary = inspect_git(&root).expect("inspect non repository");
        assert!(!summary.git_repository);
        assert_eq!(summary.git_status, "unknown");
        remove_temporary_directory(root);
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
        drop(index);
        drop(tree);
        drop(repository);
        remove_temporary_directory(root);
    }

    #[test]
    fn reads_bounded_text_changes_and_rejects_parent_traversal() {
        let root = temporary_directory("diff");
        let repository = Repository::init(&root).expect("initialize repository");
        fs::write(root.join("source.txt"), "old line\n").expect("write fixture");
        let mut index = repository.index().expect("open index");
        index
            .add_path(std::path::Path::new("source.txt"))
            .expect("add file");
        index.write().expect("persist index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        let signature = Signature::now("Astra", "astra@example.test").expect("signature");
        repository
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .expect("create initial commit");

        fs::write(root.join("source.txt"), "new line\nextra\n").expect("modify fixture");
        let changes = git_changes(&root).expect("read changes");
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].relative_path, "source.txt");
        assert_eq!(changes[0].status, "modified");
        assert_eq!(changes[0].additions, 2);
        assert_eq!(changes[0].deletions, 1);

        let diff = file_diff(&root, "source.txt").expect("read diff");
        assert!(!diff.binary);
        assert!(!diff.truncated);
        assert!(diff.diff.expect("text diff").contains("+new line"));

        fs::write(root.join("source.txt"), "large line\n".repeat(60_000))
            .expect("write large fixture");
        let bounded = file_diff(&root, "source.txt").expect("read bounded diff");
        assert!(bounded.truncated);
        assert!(bounded.diff.expect("bounded text diff").len() <= 512 * 1024);

        let error = file_diff(&root, "../outside.txt").expect_err("reject traversal");
        assert_eq!(error.code, "INVALID_RELATIVE_PATH");
        drop(index);
        drop(tree);
        drop(repository);
        remove_temporary_directory(root);
    }

    #[test]
    fn returns_a_binary_marker_without_exposing_binary_content() {
        let root = temporary_directory("binary-diff");
        let repository = Repository::init(&root).expect("initialize repository");
        fs::write(root.join("asset.bin"), [0_u8, 1, 2]).expect("write fixture");
        let mut index = repository.index().expect("open index");
        index
            .add_path(std::path::Path::new("asset.bin"))
            .expect("add file");
        index.write().expect("persist index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        let signature = Signature::now("Astra", "astra@example.test").expect("signature");
        repository
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .expect("create initial commit");
        fs::write(root.join("asset.bin"), [0_u8, 3, 4]).expect("modify fixture");

        let diff = file_diff(&root, "asset.bin").expect("read binary diff");
        assert!(diff.binary);
        assert!(diff.diff.is_none());
        drop(index);
        drop(tree);
        drop(repository);
        remove_temporary_directory(root);
    }
}
