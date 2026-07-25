use git2::{
    BranchType, Delta, DiffFormat, DiffOptions, IndexAddOption, Oid, Patch, Repository, ResetType,
    Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};
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
pub async fn project_git_summary(root_path: String) -> Result<ProjectGitSummary, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        inspect_git(&canonical)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Git information could not be read because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn project_git_changes(root_path: String) -> Result<Vec<ProjectGitChange>, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_changes(&canonical)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Git changes could not be read because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn project_file_diff(
    root_path: String,
    relative_path: String,
) -> Result<ProjectFileDiff, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        file_diff(&canonical, &relative_path)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "The file diff could not be read because the background task stopped.",
        )
    })?
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

// ============================================================================
// Git Write Operations
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    message: String,
    author_name: Option<String>,
    author_email: Option<String>,
    file_paths: Option<Vec<String>>, // If None, commit all changes
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    commit_id: String,
    branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutRequest {
    branch_name: String,
    create_new: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeRequest {
    branch_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeResult {
    success: bool,
    conflicts: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitResetRequest {
    commit_id: Option<String>, // If None, reset to HEAD
    reset_type: String,        // "soft", "mixed", "hard"
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateRequest {
    name: String,
    branch_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeInfo {
    name: String,
    path: String,
    branch: Option<String>,
}

fn get_signature<'a>(
    repository: &'a Repository,
    author_name: Option<&'a str>,
    author_email: Option<&'a str>,
) -> Result<Signature<'a>, ProjectError> {
    if let (Some(name), Some(email)) = (author_name, author_email) {
        return Signature::now(name, email).map_err(|_| {
            ProjectError::new(
                "INVALID_SIGNATURE",
                "Invalid author name or email provided.",
            )
        });
    }

    repository.signature().map_err(|_| {
        ProjectError::new(
            "GIT_CONFIG_ERROR",
            "Git user name or email not configured. Please configure git user.name and user.email.",
        )
    })
}

fn git_commit_impl(
    root: &Path,
    request: GitCommitRequest,
) -> Result<GitCommitResult, ProjectError> {
    let repository = open_repository(root)?;
    let mut index = repository
        .index()
        .map_err(|_| ProjectError::new("GIT_UNAVAILABLE", "Could not access git index."))?;

    // Stage files
    if let Some(file_paths) = &request.file_paths {
        // Stage specific files
        for path in file_paths {
            let relative = Path::new(path);
            validate_relative_path(root, path)?;
            index.add_path(relative).map_err(|_| {
                ProjectError::new("GIT_ADD_FAILED", format!("Could not stage file: {}", path))
            })?;
        }
    } else {
        // Stage all changes (similar to git add -A)
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .map_err(|_| ProjectError::new("GIT_ADD_FAILED", "Could not stage changes."))?;
        index
            .update_all(["*"].iter(), None)
            .map_err(|_| ProjectError::new("GIT_ADD_FAILED", "Could not update staged changes."))?;
    }

    index
        .write()
        .map_err(|_| ProjectError::new("GIT_ADD_FAILED", "Could not write git index."))?;

    let tree_id = index
        .write_tree()
        .map_err(|_| ProjectError::new("GIT_COMMIT_FAILED", "Could not create tree from index."))?;

    let tree = repository
        .find_tree(tree_id)
        .map_err(|_| ProjectError::new("GIT_COMMIT_FAILED", "Could not find tree object."))?;

    let signature = get_signature(
        &repository,
        request.author_name.as_deref(),
        request.author_email.as_deref(),
    )?;

    let head = repository
        .head()
        .map_err(|_| ProjectError::new("GIT_COMMIT_FAILED", "Could not get HEAD reference."))?;

    let parent_commit = head
        .peel_to_commit()
        .map_err(|_| ProjectError::new("GIT_COMMIT_FAILED", "Could not find parent commit."))?;

    let commit_id = repository
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            &request.message,
            &tree,
            &[&parent_commit],
        )
        .map_err(|_| ProjectError::new("GIT_COMMIT_FAILED", "Could not create commit."))?;

    let branch = head
        .shorthand()
        .ok_or_else(|| ProjectError::new("GIT_COMMIT_FAILED", "Could not determine branch name."))?
        .to_string();

    Ok(GitCommitResult {
        commit_id: commit_id.to_string(),
        branch,
    })
}

fn git_checkout_impl(root: &Path, request: GitCheckoutRequest) -> Result<(), ProjectError> {
    let repository = open_repository(root)?;

    if request.create_new {
        // Create new branch
        let head = repository.head().map_err(|_| {
            ProjectError::new("GIT_CHECKOUT_FAILED", "Could not get HEAD reference.")
        })?;

        let target_commit = head.peel_to_commit().map_err(|_| {
            ProjectError::new("GIT_CHECKOUT_FAILED", "Could not find target commit.")
        })?;

        repository
            .branch(&request.branch_name, &target_commit, false)
            .map_err(|_| {
                ProjectError::new(
                    "GIT_CHECKOUT_FAILED",
                    format!("Could not create branch: {}", request.branch_name),
                )
            })?;
    }

    // Checkout the branch
    let (object, reference) = repository.revparse_ext(&request.branch_name).map_err(|_| {
        ProjectError::new(
            "GIT_CHECKOUT_FAILED",
            format!("Could not find branch: {}", request.branch_name),
        )
    })?;

    repository
        .checkout_tree(&object, None)
        .map_err(|_| ProjectError::new("GIT_CHECKOUT_FAILED", "Could not checkout tree."))?;

    if let Some(reference) = reference {
        repository
            .set_head(reference.name().ok_or_else(|| {
                ProjectError::new("GIT_CHECKOUT_FAILED", "Invalid reference name.")
            })?)
            .map_err(|_| {
                ProjectError::new("GIT_CHECKOUT_FAILED", "Could not set HEAD reference.")
            })?;
    } else {
        repository
            .set_head_detached(object.id())
            .map_err(|_| ProjectError::new("GIT_CHECKOUT_FAILED", "Could not detach HEAD."))?;
    }

    Ok(())
}

fn git_merge_impl(root: &Path, request: GitMergeRequest) -> Result<GitMergeResult, ProjectError> {
    let repository = open_repository(root)?;

    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    let statuses = repository
        .statuses(Some(&mut status_options))
        .map_err(|_| {
            ProjectError::new(
                "GIT_MERGE_FAILED",
                "Could not inspect the working tree before merge.",
            )
        })?;
    if !statuses.is_empty() {
        return Err(ProjectError::new(
            "GIT_MERGE_DIRTY_WORKTREE",
            "Commit, stash, or discard local changes before merging.",
        ));
    }

    // Find the branch to merge
    let branch = repository
        .find_branch(&request.branch_name, BranchType::Local)
        .map_err(|_| {
            ProjectError::new(
                "GIT_MERGE_FAILED",
                format!("Could not find branch: {}", request.branch_name),
            )
        })?;

    let branch_commit = branch
        .get()
        .peel_to_commit()
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not find branch commit."))?;

    let head = repository
        .head()
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not get HEAD reference."))?;

    let head_commit = head
        .peel_to_commit()
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not find HEAD commit."))?;

    let annotated_commit = repository
        .find_annotated_commit(branch_commit.id())
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not resolve branch commit."))?;

    // Perform the merge analysis
    let analysis = repository
        .merge_analysis(&[&annotated_commit])
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not analyze merge."))?;

    if analysis.0.is_up_to_date() {
        return Ok(GitMergeResult {
            success: true,
            conflicts: vec![],
        });
    }

    if analysis.0.is_fast_forward() {
        // Fast-forward merge
        let refname = head.name().ok_or_else(|| {
            ProjectError::new("GIT_MERGE_FAILED", "Could not get HEAD reference name.")
        })?;

        repository
            .reference(
                refname,
                branch_commit.id(),
                true,
                &format!("merge {}: Fast-forward", request.branch_name),
            )
            .map_err(|_| {
                ProjectError::new("GIT_MERGE_FAILED", "Could not update HEAD reference.")
            })?;

        repository.checkout_head(None).map_err(|_| {
            ProjectError::new("GIT_MERGE_FAILED", "Could not checkout HEAD after merge.")
        })?;

        return Ok(GitMergeResult {
            success: true,
            conflicts: vec![],
        });
    }

    // Normal merge
    let mut index = repository
        .merge_commits(&head_commit, &branch_commit, None)
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not merge commits."))?;

    // Check for conflicts
    if index.has_conflicts() {
        let conflicts = index
            .conflicts()
            .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not read conflicts."))?
            .filter_map(|conflict| conflict.ok())
            .filter_map(|conflict| {
                conflict
                    .our
                    .or(conflict.their)
                    .or(conflict.ancestor)
                    .and_then(|entry| String::from_utf8(entry.path.clone()).ok())
            })
            .collect();

        return Ok(GitMergeResult {
            success: false,
            conflicts,
        });
    }

    // Complete the merge with a commit
    let tree_id = index
        .write_tree_to(&repository)
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not write tree after merge."))?;

    let tree = repository
        .find_tree(tree_id)
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not find tree after merge."))?;

    let signature = repository.signature().map_err(|_| {
        ProjectError::new(
            "GIT_CONFIG_ERROR",
            "Git user not configured for merge commit.",
        )
    })?;

    repository
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("Merge branch '{}'", request.branch_name),
            &tree,
            &[&head_commit, &branch_commit],
        )
        .map_err(|_| ProjectError::new("GIT_MERGE_FAILED", "Could not create merge commit."))?;

    Ok(GitMergeResult {
        success: true,
        conflicts: vec![],
    })
}

fn git_reset_impl(root: &Path, request: GitResetRequest) -> Result<(), ProjectError> {
    let repository = open_repository(root)?;

    let reset_type = match request.reset_type.as_str() {
        "soft" => ResetType::Soft,
        "mixed" => ResetType::Mixed,
        "hard" => ResetType::Hard,
        _ => {
            return Err(ProjectError::new(
                "INVALID_RESET_TYPE",
                "Reset type must be 'soft', 'mixed', or 'hard'.",
            ))
        }
    };

    let target_oid = if let Some(commit_id) = request.commit_id {
        Oid::from_str(&commit_id)
            .map_err(|_| ProjectError::new("INVALID_COMMIT_ID", "Invalid commit ID provided."))?
    } else {
        repository
            .head()
            .map_err(|_| ProjectError::new("GIT_RESET_FAILED", "Could not get HEAD reference."))?
            .target()
            .ok_or_else(|| ProjectError::new("GIT_RESET_FAILED", "Could not get HEAD target."))?
    };

    let target_commit = repository
        .find_commit(target_oid)
        .map_err(|_| ProjectError::new("GIT_RESET_FAILED", "Could not find target commit."))?;

    repository
        .reset(target_commit.as_object(), reset_type, None)
        .map_err(|_| ProjectError::new("GIT_RESET_FAILED", "Could not perform reset."))?;

    Ok(())
}

fn git_worktree_list_impl(root: &Path) -> Result<Vec<GitWorktreeInfo>, ProjectError> {
    let repository = open_repository(root)?;

    let worktrees = repository
        .worktrees()
        .map_err(|_| ProjectError::new("GIT_WORKTREE_FAILED", "Could not list worktrees."))?;

    let mut result = Vec::new();
    for name in worktrees.iter().flatten() {
        if let Ok(worktree) = repository.find_worktree(name) {
            let path = worktree.path().to_string_lossy().to_string();

            // Try to get the branch name for this worktree
            let branch = if let Ok(wt_repo) = Repository::open(worktree.path()) {
                wt_repo
                    .head()
                    .ok()
                    .and_then(|head| head.shorthand().map(str::to_owned))
            } else {
                None
            };

            result.push(GitWorktreeInfo {
                name: name.to_string(),
                path,
                branch,
            });
        }
    }

    Ok(result)
}

fn git_worktree_create_impl(
    root: &Path,
    request: GitWorktreeCreateRequest,
) -> Result<GitWorktreeInfo, ProjectError> {
    let repository = open_repository(root)?;

    // Create worktree path
    let worktree_path = root.join(".worktrees").join(&request.name);
    if worktree_path.exists() {
        return Err(ProjectError::new(
            "GIT_WORKTREE_FAILED",
            "Worktree with this name already exists.",
        ));
    }

    std::fs::create_dir_all(&worktree_path).map_err(|_| {
        ProjectError::new(
            "GIT_WORKTREE_FAILED",
            "Could not create worktree directory.",
        )
    })?;

    let branch_name = request
        .branch_name
        .clone()
        .unwrap_or_else(|| request.name.clone());

    // Resolve the branch reference to attach the worktree to, if it exists.
    let branch_ref = repository
        .find_reference(&format!("refs/heads/{}", branch_name))
        .ok();

    let mut add_options = git2::WorktreeAddOptions::new();
    if let Some(ref reference) = branch_ref {
        add_options.reference(Some(reference));
    }

    // Create the worktree
    repository
        .worktree(&request.name, &worktree_path, Some(&add_options))
        .map_err(|e| {
            ProjectError::new(
                "GIT_WORKTREE_FAILED",
                format!("Could not create worktree: {}", e),
            )
        })?;

    Ok(GitWorktreeInfo {
        name: request.name,
        path: worktree_path.to_string_lossy().to_string(),
        branch: Some(branch_name.to_string()),
    })
}

fn git_worktree_remove_impl(root: &Path, name: String) -> Result<(), ProjectError> {
    let repository = open_repository(root)?;

    let worktree = repository.find_worktree(&name).map_err(|_| {
        ProjectError::new(
            "GIT_WORKTREE_FAILED",
            format!("Worktree '{}' not found.", name),
        )
    })?;

    // Remove the worktree directory
    let worktree_path = worktree.path();
    if worktree_path.exists() {
        std::fs::remove_dir_all(worktree_path).map_err(|_| {
            ProjectError::new(
                "GIT_WORKTREE_FAILED",
                "Could not remove worktree directory.",
            )
        })?;
    }

    // Prune the worktree from git
    worktree
        .prune(None)
        .map_err(|_| ProjectError::new("GIT_WORKTREE_FAILED", "Could not prune worktree."))?;

    Ok(())
}

// ============================================================================
// Tauri Commands for Git Write Operations
// ============================================================================

#[tauri::command]
pub async fn git_commit(
    root_path: String,
    request: GitCommitRequest,
) -> Result<GitCommitResult, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_commit_impl(&canonical, request)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Git commit failed because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn git_checkout(
    root_path: String,
    request: GitCheckoutRequest,
) -> Result<(), ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_checkout_impl(&canonical, request)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Git checkout failed because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn git_merge(
    root_path: String,
    request: GitMergeRequest,
) -> Result<GitMergeResult, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_merge_impl(&canonical, request)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Git merge failed because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn git_reset(root_path: String, request: GitResetRequest) -> Result<(), ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_reset_impl(&canonical, request)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Git reset failed because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn git_worktree_list(root_path: String) -> Result<Vec<GitWorktreeInfo>, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_worktree_list_impl(&canonical)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "List worktrees failed because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn git_worktree_create(
    root_path: String,
    request: GitWorktreeCreateRequest,
) -> Result<GitWorktreeInfo, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_worktree_create_impl(&canonical, request)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Create worktree failed because the background task stopped.",
        )
    })?
}

#[tauri::command]
pub async fn git_worktree_remove(root_path: String, name: String) -> Result<(), ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let canonical = safe_directory(Path::new(&root_path))
            .map_err(|message| ProjectError::new("INVALID_PROJECT_ROOT", message))?;
        git_worktree_remove_impl(&canonical, name)
    })
    .await
    .map_err(|_| {
        ProjectError::new(
            "GIT_TASK_FAILED",
            "Remove worktree failed because the background task stopped.",
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::{
        file_diff, git_changes, git_merge_impl, inspect_git, project_file_diff,
        project_git_changes, project_git_summary, GitMergeRequest,
    };
    use git2::{Repository, Signature};
    use std::fs;
    use std::path::Path;
    use std::thread;
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn assert_future<T: std::future::Future>(_future: T) {}

    #[test]
    fn git_commands_are_dispatched_as_async_work() {
        assert_future(project_git_summary(".".to_owned()));
        assert_future(project_git_changes(".".to_owned()));
        assert_future(project_file_diff(".".to_owned(), "README.md".to_owned()));
    }

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("astra-{label}-{suffix}"));
        fs::create_dir_all(&path).expect("create temporary directory");
        // Canonicalize so the returned path matches what validate_relative_path
        // sees after dunce::canonicalize (short path vs long path on Windows).
        dunce::canonicalize(&path).expect("canonicalize temp dir")
    }

    fn remove_temporary_directory(path: std::path::PathBuf) {
        assert!(
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("astra-")),
            "temporary cleanup must remain scoped to an Astra test directory"
        );
        for attempt in 0..40 {
            match fs::remove_dir_all(&path) {
                Ok(()) => return,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                Err(_) if attempt < 39 => thread::sleep(Duration::from_millis(50)),
                Err(error) => panic!("remove temporary repository: {error}"),
            }
        }
    }

    fn configure_repository_signature(repository: &Repository) {
        let mut config = repository.config().expect("open repository config");
        config
            .set_str("user.name", "Astra")
            .expect("configure repository user name");
        config
            .set_str("user.email", "astra@example.test")
            .expect("configure repository user email");
    }

    fn commit_file(
        repository: &Repository,
        relative_path: &str,
        contents: &str,
        message: &str,
    ) -> git2::Oid {
        let workdir = repository.workdir().expect("repository workdir");
        fs::write(workdir.join(relative_path), contents).expect("write fixture");

        let mut index = repository.index().expect("open index");
        index
            .add_path(Path::new(relative_path))
            .expect("stage fixture");
        index.write().expect("persist index");
        let tree_id = index.write_tree().expect("write fixture tree");
        let tree = repository.find_tree(tree_id).expect("find fixture tree");
        let signature = Signature::now("Astra", "astra@example.test").expect("signature");

        let parent = repository
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok());
        match parent.as_ref() {
            Some(parent) => repository
                .commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    message,
                    &tree,
                    &[parent],
                )
                .expect("create fixture commit"),
            None => repository
                .commit(Some("HEAD"), &signature, &signature, message, &tree, &[])
                .expect("create initial fixture commit"),
        }
    }

    fn delete_file(repository: &Repository, relative_path: &str, message: &str) -> git2::Oid {
        let workdir = repository.workdir().expect("repository workdir");
        fs::remove_file(workdir.join(relative_path)).expect("delete fixture");

        let mut index = repository.index().expect("open index");
        index
            .remove_path(Path::new(relative_path))
            .expect("stage deleted fixture");
        index.write().expect("persist index");
        let tree_id = index.write_tree().expect("write fixture tree");
        let tree = repository.find_tree(tree_id).expect("find fixture tree");
        let signature = Signature::now("Astra", "astra@example.test").expect("signature");
        let parent = repository
            .head()
            .expect("fixture HEAD")
            .peel_to_commit()
            .expect("fixture parent commit");

        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &[&parent],
            )
            .expect("create deletion fixture commit")
    }

    fn checkout_branch(repository: &Repository, branch_name: &str) {
        let reference_name = format!("refs/heads/{branch_name}");
        let object = repository
            .revparse_single(&reference_name)
            .expect("resolve fixture branch");
        let mut checkout_options = git2::build::CheckoutBuilder::default();
        repository
            .checkout_tree(&object, Some(&mut checkout_options))
            .expect("checkout fixture branch");
        repository
            .set_head(&reference_name)
            .expect("set fixture branch HEAD");
    }

    fn initialize_merge_repository(root: &Path) -> Repository {
        let repository = Repository::init(root).expect("initialize repository");
        configure_repository_signature(&repository);
        commit_file(&repository, "README.md", "initial\n", "initial");
        {
            let initial = repository
                .head()
                .expect("initial HEAD")
                .peel_to_commit()
                .expect("initial commit");
            repository
                .branch("feature", &initial, false)
                .expect("create feature branch");
            repository
                .branch("main", &initial, false)
                .expect("create main branch");
        }
        checkout_branch(&repository, "main");
        repository
    }

    fn read_commit_file(repository: &Repository, commit_id: git2::Oid, path: &str) -> Vec<u8> {
        let commit = repository.find_commit(commit_id).expect("find commit");
        let tree = commit.tree().expect("find commit tree");
        let entry = tree.get_path(Path::new(path)).expect("find tree entry");
        repository
            .find_blob(entry.id())
            .expect("find file blob")
            .content()
            .to_vec()
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

    #[test]
    fn non_fast_forward_merge_commits_the_merged_branch_tree() {
        let root = temporary_directory("merge-non-fast-forward");
        let repository = initialize_merge_repository(&root);

        checkout_branch(&repository, "feature");
        commit_file(
            &repository,
            "feature.txt",
            "from feature branch\n",
            "feature change",
        );

        checkout_branch(&repository, "main");
        commit_file(&repository, "main.txt", "from main branch\n", "main change");

        let result = git_merge_impl(
            &root,
            GitMergeRequest {
                branch_name: "feature".to_owned(),
            },
        )
        .expect("merge divergent branches");

        assert!(result.success);
        assert!(result.conflicts.is_empty());
        let merge_head = repository
            .head()
            .expect("merge HEAD")
            .peel_to_commit()
            .expect("merge commit");
        assert_eq!(merge_head.parent_count(), 2);
        assert_eq!(
            read_commit_file(&repository, merge_head.id(), "feature.txt"),
            b"from feature branch\n"
        );

        drop(merge_head);
        drop(repository);
        remove_temporary_directory(root);
    }

    #[test]
    fn conflicted_merge_reports_conflicts_without_moving_head() {
        let root = temporary_directory("merge-conflict");
        let repository = initialize_merge_repository(&root);

        checkout_branch(&repository, "feature");
        commit_file(
            &repository,
            "README.md",
            "feature version\n",
            "feature change",
        );

        checkout_branch(&repository, "main");
        commit_file(&repository, "README.md", "main version\n", "main change");
        let head_before = repository
            .head()
            .expect("pre-merge HEAD")
            .target()
            .expect("pre-merge HEAD target");

        let result = git_merge_impl(
            &root,
            GitMergeRequest {
                branch_name: "feature".to_owned(),
            },
        )
        .expect("report merge conflicts");

        assert!(!result.success);
        assert_eq!(result.conflicts, vec!["README.md"]);
        let head_after = repository
            .head()
            .expect("post-merge HEAD")
            .target()
            .expect("post-merge HEAD target");
        assert_eq!(head_after, head_before);
        let head_commit = repository
            .find_commit(head_after)
            .expect("unchanged HEAD commit");
        assert_eq!(head_commit.parent_count(), 1);

        drop(head_commit);
        drop(repository);
        remove_temporary_directory(root);
    }

    #[test]
    fn deleted_ours_conflict_reports_their_path() {
        let root = temporary_directory("merge-delete-modify-conflict");
        let repository = initialize_merge_repository(&root);

        checkout_branch(&repository, "feature");
        commit_file(
            &repository,
            "README.md",
            "feature version\n",
            "feature change",
        );

        checkout_branch(&repository, "main");
        delete_file(&repository, "README.md", "main deletion");

        let result = git_merge_impl(
            &root,
            GitMergeRequest {
                branch_name: "feature".to_owned(),
            },
        )
        .expect("report delete-modify conflict");

        assert!(!result.success);
        assert_eq!(result.conflicts, vec!["README.md"]);

        drop(repository);
        remove_temporary_directory(root);
    }

    #[test]
    fn merge_rejects_a_dirty_worktree_without_forcing_checkout() {
        let root = temporary_directory("merge-dirty-worktree");
        let repository = initialize_merge_repository(&root);

        checkout_branch(&repository, "feature");
        commit_file(
            &repository,
            "feature.txt",
            "from feature branch\n",
            "feature change",
        );
        checkout_branch(&repository, "main");

        let head_before = repository
            .head()
            .expect("pre-merge HEAD")
            .target()
            .expect("pre-merge HEAD target");
        fs::write(root.join("README.md"), "uncommitted local edit\n").expect("dirty worktree");

        let error = git_merge_impl(
            &root,
            GitMergeRequest {
                branch_name: "feature".to_owned(),
            },
        )
        .expect_err("reject dirty worktree");

        assert_eq!(error.code, "GIT_MERGE_DIRTY_WORKTREE");
        assert_eq!(
            repository
                .head()
                .expect("post-merge HEAD")
                .target()
                .expect("post-merge HEAD target"),
            head_before
        );
        assert_eq!(
            fs::read_to_string(root.join("README.md")).expect("read local edit"),
            "uncommitted local edit\n"
        );

        drop(repository);
        remove_temporary_directory(root);
    }
}
