use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use rmcp::{
    transport::{ConfigureCommandExt, StreamableHttpClientTransport, TokioChildProcess},
    ServiceExt,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use walkdir::WalkDir;

const MAX_SKILL_BYTES: u64 = 10 * 1024 * 1024;
const MAX_SKILL_FILES: usize = 256;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    pub secret_ref: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub content_hash: String,
    pub install_path: PathBuf,
    pub file_count: usize,
    pub total_bytes: u64,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"-_.:/".contains(&character))
}

pub fn validate_mcp_config(config: &McpServerInput) -> Result<(), String> {
    if !valid_id(&config.id)
        || config.name.trim().is_empty()
        || config.name.len() > 120
        || config.args.len() > 64
        || config.args.iter().any(|argument| argument.len() > 4_096)
        || config
            .secret_ref
            .as_deref()
            .is_some_and(|reference| !valid_id(reference))
    {
        return Err("MCP server metadata is invalid.".into());
    }
    match config.transport.as_str() {
        "stdio" => {
            let command = config
                .command
                .as_deref()
                .ok_or_else(|| "A stdio MCP server requires an executable.".to_string())?;
            let path = Path::new(command);
            if !path.is_absolute() || !path.is_file() {
                return Err("The MCP executable must be an existing absolute path.".into());
            }
        }
        "streamable_http" => {
            let url = config
                .url
                .as_deref()
                .ok_or_else(|| "A Streamable HTTP server requires a URL.".to_string())?;
            if url.len() > 2_048
                || !(url.starts_with("https://") || url.starts_with("http://localhost"))
            {
                return Err("The MCP URL must use HTTPS or local HTTP.".into());
            }
        }
        _ => return Err("Legacy SSE is not supported; use stdio or Streamable HTTP.".into()),
    }
    Ok(())
}

pub async fn test_mcp_connection(config: &McpServerInput) -> Result<(), String> {
    validate_mcp_config(config)?;
    let connect = async {
        if config.transport == "stdio" {
            let executable = config.command.as_deref().expect("validated command");
            let transport = TokioChildProcess::new(Command::new(executable).configure(|command| {
                command.args(&config.args);
            }))
            .map_err(|_| "The MCP process could not be started.".to_string())?;
            let mut client = ().serve(transport).await.map_err(|_| {
                "The MCP server did not complete protocol initialization.".to_string()
            })?;
            client
                .close()
                .await
                .map_err(|_| "The MCP connection could not be closed.".to_string())?;
        } else {
            let transport = StreamableHttpClientTransport::from_uri(
                config.url.as_deref().expect("validated URL"),
            );
            let mut client = ().serve(transport).await.map_err(|_| {
                "The MCP server did not complete protocol initialization.".to_string()
            })?;
            client
                .close()
                .await
                .map_err(|_| "The MCP connection could not be closed.".to_string())?;
        }
        Ok(())
    };
    tokio::time::timeout(Duration::from_secs(10), connect)
        .await
        .map_err(|_| "The MCP connection test timed out.".to_string())?
}

fn skill_files(source: &Path) -> Result<Vec<(PathBuf, PathBuf, u64)>, String> {
    let source = source
        .canonicalize()
        .map_err(|_| "The Skill source directory is unavailable.".to_string())?;
    if !source.join("SKILL.md").is_file() {
        return Err("The Skill package must contain SKILL.md at its root.".into());
    }
    let mut files = Vec::new();
    let mut total = 0_u64;
    for entry in WalkDir::new(&source).follow_links(false) {
        let entry = entry.map_err(|_| "The Skill package could not be inspected.".to_string())?;
        if entry.file_type().is_symlink() {
            return Err("Skill packages may not contain symbolic links.".into());
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&source)
            .map_err(|_| "The Skill package path is invalid.".to_string())?
            .to_path_buf();
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err("The Skill package contains an unsafe path.".into());
        }
        let size = entry
            .metadata()
            .map_err(|_| "The Skill package could not be inspected.".to_string())?
            .len();
        total = total.saturating_add(size);
        files.push((entry.path().to_path_buf(), relative, size));
        if files.len() > MAX_SKILL_FILES || total > MAX_SKILL_BYTES {
            return Err("The Skill package exceeds the installation limits.".into());
        }
    }
    files.sort_by(|left, right| left.1.cmp(&right.1));
    Ok(files)
}

pub fn install_local_skill(source: &Path, cache: &Path) -> Result<InstalledSkill, String> {
    let files = skill_files(source)?;
    let mut hasher = Sha256::new();
    let mut total_bytes = 0_u64;
    for (path, relative, size) in &files {
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(path).map_err(|_| "A Skill file could not be read.".to_string())?);
        total_bytes += size;
    }
    let content_hash = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    fs::create_dir_all(cache).map_err(|_| "The Skill cache could not be created.".to_string())?;
    let install_path = cache.join(&content_hash);
    if !install_path.exists() {
        let staging = cache.join(format!(".{content_hash}.partial-{}", std::process::id()));
        if staging.exists() {
            fs::remove_dir_all(&staging)
                .map_err(|_| "A stale Skill staging directory could not be cleared.".to_string())?;
        }
        fs::create_dir(&staging)
            .map_err(|_| "The Skill cache entry could not be created.".to_string())?;
        let copy_result = files.iter().try_for_each(|(path, relative, _)| {
            let target = staging.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| "The Skill cache directory could not be created.".to_string())?;
            }
            fs::copy(path, target)
                .map(|_| ())
                .map_err(|_| "A Skill file could not be cached.".to_string())
        });
        if let Err(error) = copy_result {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        fs::rename(&staging, &install_path)
            .map_err(|_| "The Skill cache entry could not be finalized.".to_string())?;
    }
    Ok(InstalledSkill {
        content_hash,
        install_path,
        file_count: files.len(),
        total_bytes,
    })
}

#[cfg(target_os = "windows")]
fn store_secret(reference: &str, secret: &str) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut target = reference.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut blob = secret.as_bytes().to_vec();
    let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = target.as_mut_ptr();
    credential.CredentialBlobSize = blob.len() as u32;
    credential.CredentialBlob = blob.as_mut_ptr();
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential.UserName = ptr::null_mut();
    let result = unsafe { CredWriteW(&credential, 0) };
    blob.fill(0);
    if result == 0 {
        return Err("The credential could not be stored in Windows Credential Manager.".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn store_secret(_reference: &str, _secret: &str) -> Result<(), String> {
    Err("System credential storage is not available on this platform.".into())
}

#[tauri::command]
pub async fn orchestration_test_mcp_connection(input: McpServerInput) -> Result<(), String> {
    test_mcp_connection(&input).await
}

#[tauri::command]
pub fn orchestration_store_secret(reference: String, secret: String) -> Result<(), String> {
    if !valid_id(&reference) || secret.is_empty() || secret.len() > 16_384 {
        return Err("The credential input is invalid.".into());
    }
    store_secret(&format!("AstraNexus/{reference}"), &secret)
}

#[tauri::command]
pub async fn orchestration_install_local_skill(
    app: AppHandle,
    source_path: String,
) -> Result<InstalledSkill, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache = app
            .path()
            .app_data_dir()
            .map_err(|_| "The application data directory is unavailable.".to_string())?
            .join("skills");
        install_local_skill(Path::new(&source_path), &cache)
    })
    .await
    .map_err(|_| "The Skill installation task stopped unexpectedly.".to_string())?
}
