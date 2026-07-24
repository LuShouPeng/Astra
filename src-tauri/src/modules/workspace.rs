use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathInfo {
    name: String,
    root_path: String,
    normalized_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceError {
    code: &'static str,
    message: String,
    recoverable: bool,
}

impl WorkspaceError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable: true,
        }
    }
}

fn map_io_error(error: io::Error, fallback: &str) -> WorkspaceError {
    match error.kind() {
        io::ErrorKind::NotFound => {
            WorkspaceError::new("PATH_NOT_FOUND", "The selected folder no longer exists.")
        }
        io::ErrorKind::PermissionDenied => WorkspaceError::new(
            "PERMISSION_DENIED",
            "Astra Nexus does not have permission to access this folder.",
        ),
        _ => WorkspaceError::new("UNKNOWN", fallback),
    }
}

pub(crate) fn canonical_directory(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let metadata = fs::metadata(path)
        .map_err(|error| map_io_error(error, "The selected path could not be inspected."))?;
    if !metadata.is_dir() {
        return Err(WorkspaceError::new(
            "NOT_A_DIRECTORY",
            "Select a folder rather than a file.",
        ));
    }
    dunce::canonicalize(path)
        .map_err(|error| map_io_error(error, "The selected folder could not be normalized."))
}

pub(crate) fn safe_directory(path: &Path) -> Result<PathBuf, String> {
    canonical_directory(path).map_err(|error| error.message)
}

fn normalize_for_identity(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    let trimmed = if value.len() > 3 {
        value.trim_end_matches('\\').to_owned()
    } else {
        value
    };

    #[cfg(windows)]
    {
        trimmed.to_lowercase()
    }

    #[cfg(not(windows))]
    {
        trimmed
    }
}

#[tauri::command]
pub fn workspace_inspect_path(path: String) -> Result<WorkspacePathInfo, WorkspaceError> {
    let canonical = canonical_directory(Path::new(&path))?;
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .or_else(|| {
            canonical
                .components()
                .next_back()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
        })
        .ok_or_else(|| {
            WorkspaceError::new("UNKNOWN", "The selected folder has no display name.")
        })?;
    let root_path = canonical.to_string_lossy().into_owned();

    Ok(WorkspacePathInfo {
        name,
        normalized_path: normalize_for_identity(&canonical),
        root_path,
    })
}

#[tauri::command]
pub fn workspace_check_exists(path: String) -> Result<bool, WorkspaceError> {
    match fs::metadata(Path::new(&path)) {
        Ok(metadata) => Ok(metadata.is_dir()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(map_io_error(
            error,
            "The workspace path could not be checked.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_for_identity;
    use std::path::Path;

    #[test]
    fn removes_trailing_separators_for_identity() {
        let normalized = normalize_for_identity(Path::new("C:\\Code\\Astra\\"));
        assert!(!normalized.ends_with('\\'));
    }
}
