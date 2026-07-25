use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use http::{HeaderName, HeaderValue};
use rmcp::{
    model::CallToolRequestParams,
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    ServiceExt,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;
use url::Url;
use walkdir::WalkDir;

use super::permissions::redact;
use super::store::{OrchestrationStore, SkillPackageRecord};

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
    pub secret_header: Option<String>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionReport {
    pub tool_count: usize,
    pub tools: Vec<String>,
}

fn connection_report(tools: Vec<rmcp::model::Tool>) -> McpConnectionReport {
    let mut names = tools
        .into_iter()
        .map(|tool| tool.name.to_string())
        .collect::<Vec<_>>();
    names.sort();
    McpConnectionReport {
        tool_count: names.len(),
        tools: names,
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilityPreflightInput {
    pub run_id: String,
    pub node_id: String,
    #[serde(default)]
    pub mcp_server_ids: Vec<String>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMcpCapability {
    pub id: String,
    pub name: String,
    pub transport: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillCapability {
    pub id: String,
    pub version: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilityManifest {
    pub run_id: String,
    pub node_id: String,
    pub mcp_servers: Vec<AgentMcpCapability>,
    pub skills: Vec<AgentSkillCapability>,
}

pub fn resolve_mcp_configs<F>(ids: &[String], mut lookup: F) -> Result<Vec<McpServerInput>, String>
where
    F: FnMut(&str) -> Result<Option<McpServerInput>, String>,
{
    if ids.len() > 32 {
        return Err("An Agent node may attach at most 32 MCP servers.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut configs = Vec::with_capacity(ids.len());
    for id in ids {
        if !valid_id(id) || !seen.insert(id.as_str()) {
            return Err("Agent MCP server identifiers are invalid or duplicated.".into());
        }
        let config = lookup(id)?.ok_or_else(|| format!("MCP server '{id}' is not registered."))?;
        if !config.enabled {
            return Err(format!("MCP server '{id}' is disabled."));
        }
        validate_mcp_config(&config)?;
        configs.push(config);
    }
    Ok(configs)
}

pub fn preflight_agent_capabilities<F>(
    store: &OrchestrationStore,
    input: &AgentCapabilityPreflightInput,
    mut secret_available: F,
) -> Result<AgentCapabilityManifest, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    if !valid_skill_id(&input.run_id)
        || !valid_skill_id(&input.node_id)
        || input.skill_ids.len() > 64
        || input.skill_ids.iter().any(|id| !valid_skill_id(id))
        || input
            .skill_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != input.skill_ids.len()
    {
        return Err("Agent capability preflight input is invalid.".into());
    }
    let projection = store
        .get_run_projection(&input.run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The workflow run was not found.".to_string())?;
    if projection.run.status != "running" {
        return Err("Agent capabilities can only be prepared for a running workflow.".into());
    }
    let node_run = projection
        .nodes
        .iter()
        .find(|node| node.node.node_id == input.node_id)
        .ok_or_else(|| "The Agent node run was not found.".to_string())?;
    if node_run.node.status != "ready" {
        return Err("Agent capabilities can only be prepared for a ready node.".into());
    }
    let workflow = store
        .get_workflow(&projection.run.workflow_id, projection.run.workflow_version)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The workflow definition was not found.".to_string())?;
    let definition: serde_json::Value = serde_json::from_str(&workflow.definition_json)
        .map_err(|_| "The stored workflow definition is invalid.".to_string())?;
    let node = definition
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find(|node| {
                node.get("id").and_then(serde_json::Value::as_str) == Some(&input.node_id)
            })
        })
        .ok_or_else(|| "The stored Agent node is unavailable.".to_string())?;
    if node.get("type").and_then(serde_json::Value::as_str) != Some("agent") {
        return Err("Capabilities can only be prepared for an Agent node.".into());
    }
    let declared_ids = |field: &str| -> Result<Vec<String>, String> {
        node.get(field)
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| format!("The Agent {field} capability list is invalid."))?
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .ok_or_else(|| format!("The Agent {field} capability list is invalid."))
            })
            .collect()
    };
    let declared_mcp_ids = declared_ids("mcpServerIds")?;
    let declared_skill_ids = declared_ids("skillIds")?;
    let same_ids = |left: &[String], right: &[String]| {
        left.len() == right.len()
            && left.iter().collect::<std::collections::HashSet<_>>()
                == right.iter().collect::<std::collections::HashSet<_>>()
    };
    if !same_ids(&declared_mcp_ids, &input.mcp_server_ids)
        || !same_ids(&declared_skill_ids, &input.skill_ids)
    {
        return Err("Requested Agent capabilities do not match the saved workflow node.".into());
    }
    let snapshot_records = store
        .list_node_mcp_configs(&input.run_id, &input.node_id)
        .map_err(|error| error.to_string())?;
    let snapshot_ids = snapshot_records
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    if !same_ids(&snapshot_ids, &input.mcp_server_ids) {
        return Err("The Agent MCP capability snapshot is incomplete.".into());
    }
    let configs = resolve_mcp_configs(&input.mcp_server_ids, |id| {
        snapshot_records
            .iter()
            .find(|record| record.id == id)
            .map(|record| {
                serde_json::from_str(&record.config_json)
                    .map_err(|_| "A snapshotted MCP configuration is invalid.".to_string())
            })
            .transpose()
    })?;
    for config in &configs {
        if let Some(reference) = config.secret_ref.as_deref() {
            secret_available(&format!("AstraNexus/{reference}"))?;
        }
    }
    let skill_records = store
        .list_run_skill_refs(&input.run_id)
        .map_err(|error| error.to_string())?;
    let selected_skills = skill_records
        .into_iter()
        .filter(|record| input.skill_ids.iter().any(|id| id == &record.id))
        .collect::<Vec<_>>();
    if selected_skills.len() != input.skill_ids.len() {
        return Err("One or more selected Skills are unavailable.".into());
    }
    let manifest = AgentCapabilityManifest {
        run_id: input.run_id.clone(),
        node_id: input.node_id.clone(),
        mcp_servers: configs
            .into_iter()
            .map(|config| AgentMcpCapability {
                id: config.id,
                name: config.name,
                transport: config.transport,
            })
            .collect(),
        skills: selected_skills
            .into_iter()
            .map(|record| AgentSkillCapability {
                id: record.id,
                version: record.version,
                content_hash: record.content_hash,
            })
            .collect(),
    };
    let event = serde_json::json!({
        "type": "agent_capabilities_preflighted",
        "nodeId": manifest.node_id,
        "mcpServerIds": manifest.mcp_servers.iter().map(|item| &item.id).collect::<Vec<_>>(),
        "skillIds": manifest.skills.iter().map(|item| &item.id).collect::<Vec<_>>(),
    });
    store
        .append_event(&input.run_id, &event.to_string())
        .map_err(|error| error.to_string())?;
    Ok(manifest)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub content_hash: String,
    pub install_path: PathBuf,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPackageInput {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub source: String,
    pub source_url: Option<String>,
    pub source_revision: Option<String>,
    pub content_hash: String,
}

fn valid_skill_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

fn valid_content_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || b"-_.:/".contains(&character))
}

fn valid_secret_reference(value: &str) -> bool {
    valid_id(value)
        && !value.starts_with(['/', ':'])
        && !value.ends_with(['/', ':'])
        && !value.split(['/', ':']).any(|segment| segment == "..")
}

fn valid_secret_header(value: &str) -> bool {
    ["authorization", "x-api-key", "api-key"]
        .iter()
        .any(|allowed| value.eq_ignore_ascii_case(allowed))
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
            .is_some_and(|reference| !valid_secret_reference(reference))
        || config.secret_header.as_deref().is_some_and(|header| {
            HeaderName::from_bytes(header.as_bytes()).is_err() || !valid_secret_header(header)
        })
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
            let parsed = Url::parse(url).map_err(|_| "The MCP URL is invalid.".to_string())?;
            let has_credentials = !parsed.username().is_empty() || parsed.password().is_some();
            let is_loopback = parsed.host_str().is_some_and(|host| {
                host.eq_ignore_ascii_case("localhost")
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|address| address.is_loopback())
            });
            if url.len() > 2_048
                || parsed.host_str().is_none()
                || has_credentials
                || !(parsed.scheme() == "https" || (parsed.scheme() == "http" && is_loopback))
            {
                return Err("The MCP URL must use HTTPS or local HTTP.".into());
            }
        }
        _ => return Err("Legacy SSE is not supported; use stdio or Streamable HTTP.".into()),
    }
    Ok(())
}

pub(super) fn mcp_environment_allowed(key: &str) -> bool {
    const ALLOWED: &[&str] = &[
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "LANG",
        "LC_ALL",
    ];
    ALLOWED
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(key))
}

fn stdio_mcp_command(executable: &str, args: &[String]) -> Command {
    let mut command = Command::new(executable);
    command.args(args).env_clear();
    for (key, value) in std::env::vars_os() {
        if key.to_str().is_some_and(mcp_environment_allowed) {
            command.env(key, value);
        }
    }
    command
}

pub async fn test_mcp_connection(config: &McpServerInput) -> Result<McpConnectionReport, String> {
    validate_mcp_config(config)?;
    let connect = async {
        if config.transport == "stdio" {
            let executable = config.command.as_deref().expect("validated command");
            let transport = TokioChildProcess::new(stdio_mcp_command(executable, &config.args))
                .map_err(|_| "The MCP process could not be started.".to_string())?;
            let mut client = ().serve(transport).await.map_err(|_| {
                "The MCP server did not complete protocol initialization.".to_string()
            })?;
            let tools = client
                .peer()
                .list_all_tools()
                .await
                .map_err(|_| "The MCP server did not return its tool catalog.".to_string());
            let closed = client
                .close()
                .await
                .map_err(|_| "The MCP connection could not be closed.".to_string());
            let report = connection_report(tools?);
            closed?;
            return Ok(report);
        } else {
            let mut transport_config =
                rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig::with_uri(
                    config.url.as_deref().expect("validated URL"),
                );
            if let Some(reference) = config.secret_ref.as_deref() {
                let header = config.secret_header.as_deref().unwrap_or("authorization");
                let secret = read_secret(&format!("AstraNexus/{reference}"))?;
                if header.eq_ignore_ascii_case("authorization") {
                    transport_config = transport_config.auth_header(secret);
                } else {
                    transport_config.custom_headers.insert(
                        HeaderName::from_bytes(header.as_bytes())
                            .map_err(|_| "The MCP secret header is invalid.".to_string())?,
                        HeaderValue::from_str(&secret).map_err(|_| {
                            "The MCP credential cannot be used as a header.".to_string()
                        })?,
                    );
                }
            }
            let transport = StreamableHttpClientTransport::from_config(transport_config);
            let mut client = ().serve(transport).await.map_err(|_| {
                "The MCP server did not complete protocol initialization.".to_string()
            })?;
            let tools = client
                .peer()
                .list_all_tools()
                .await
                .map_err(|_| "The MCP server did not return its tool catalog.".to_string());
            let closed = client
                .close()
                .await
                .map_err(|_| "The MCP connection could not be closed.".to_string());
            let report = connection_report(tools?);
            closed?;
            return Ok(report);
        }
    };
    tokio::time::timeout(Duration::from_secs(10), connect)
        .await
        .map_err(|_| "The MCP connection test timed out.".to_string())?
}

pub fn validate_mcp_tool_call(
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<(), String> {
    if tool_name.is_empty()
        || tool_name.len() > 160
        || tool_name.contains("..")
        || tool_name.starts_with('/')
        || tool_name.starts_with(':')
        || !tool_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/".contains(&byte))
        || !arguments.is_object()
        || serde_json::to_vec(arguments)
            .map_err(|_| "MCP tool arguments are invalid.".to_string())?
            .len()
            > 64 * 1024
    {
        return Err("MCP tool call input is invalid.".into());
    }
    Ok(())
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
    for entry in WalkDir::new(&source)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != ".git")
    {
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

pub fn validate_git_source(source_url: &str, revision: Option<&str>) -> Result<(), String> {
    let url = Url::parse(source_url).map_err(|_| "The Skill Git URL is invalid.".to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || source_url.len() > 2_048
    {
        return Err("Skill Git sources must use HTTPS without embedded credentials.".into());
    }
    if revision.is_some_and(|value| {
        value.is_empty()
            || value.len() > 160
            || value.starts_with('-')
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_. /".contains(&byte))
    }) {
        return Err("The Skill Git revision is invalid.".into());
    }
    Ok(())
}

fn git_output(root: Option<&Path>, args: &[&str]) -> Result<(), String> {
    let mut command = std::process::Command::new("git.exe");
    command.args(["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false"]);
    if let Some(root) = root {
        command.arg("-C").arg(root);
    }
    let output = command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|_| "Git could not be started.".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr)
            .lines()
            .next()
            .unwrap_or("The Skill repository operation failed.")
            .to_string())
    }
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

#[cfg(target_os = "windows")]
fn read_secret(reference: &str) -> Result<String, String> {
    use std::{ptr, slice};
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target = reference.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut credential: *mut CREDENTIALW = ptr::null_mut();
    let result = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if result == 0 || credential.is_null() {
        return Err("The credential could not be read from Windows Credential Manager.".into());
    }
    let value = unsafe {
        let record = &*credential;
        let bytes =
            slice::from_raw_parts(record.CredentialBlob, record.CredentialBlobSize as usize);
        String::from_utf8(bytes.to_vec())
    };
    unsafe { CredFree(credential.cast()) };
    value.map_err(|_| "The stored credential is invalid.".to_string())
}

#[cfg(target_os = "windows")]
fn delete_secret(reference: &str) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target = reference.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let result = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if result == 0 {
        if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            return Ok(());
        }
        return Err("The credential could not be deleted from Windows Credential Manager.".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn store_secret(_reference: &str, _secret: &str) -> Result<(), String> {
    Err("System credential storage is not available on this platform.".into())
}

#[cfg(not(target_os = "windows"))]
fn read_secret(_reference: &str) -> Result<String, String> {
    Err("System credential storage is not available on this platform.".into())
}

#[cfg(not(target_os = "windows"))]
fn delete_secret(_reference: &str) -> Result<(), String> {
    Ok(())
}

async fn call_mcp_tool(
    config: &McpServerInput,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    validate_mcp_config(config)?;
    if !config.enabled {
        return Err("The MCP server is disabled.".into());
    }
    validate_mcp_tool_call(tool_name, &arguments)?;
    let arguments = arguments
        .as_object()
        .cloned()
        .ok_or_else(|| "MCP tool arguments must be an object.".to_string())?;
    let request = CallToolRequestParams::new(tool_name.to_string()).with_arguments(arguments);
    let call = async {
        if config.transport == "stdio" {
            let executable = config.command.as_deref().expect("validated command");
            let transport = TokioChildProcess::new(stdio_mcp_command(executable, &config.args))
                .map_err(|_| "The MCP process could not be started.".to_string())?;
            let mut client = ().serve(transport).await.map_err(|_| {
                "The MCP server did not complete protocol initialization.".to_string()
            })?;
            let result = client
                .call_tool(request)
                .await
                .map_err(|_| "The MCP tool call failed.".to_string())?;
            client
                .close()
                .await
                .map_err(|_| "The MCP connection could not be closed.".to_string())?;
            serde_json::to_value(result)
                .map_err(|_| "The MCP tool result could not be serialized.".to_string())
        } else {
            let mut transport_config =
                rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig::with_uri(
                    config.url.as_deref().expect("validated URL"),
                );
            let secret = config
                .secret_ref
                .as_deref()
                .map(|reference| read_secret(&format!("AstraNexus/{reference}")))
                .transpose()?;
            if let Some(secret) = secret.as_deref() {
                let header = config.secret_header.as_deref().unwrap_or("authorization");
                if header.eq_ignore_ascii_case("authorization") {
                    transport_config = transport_config.auth_header(secret);
                } else {
                    transport_config.custom_headers.insert(
                        HeaderName::from_bytes(header.as_bytes())
                            .map_err(|_| "The MCP secret header is invalid.".to_string())?,
                        HeaderValue::from_str(secret).map_err(|_| {
                            "The MCP credential cannot be used as a header.".to_string()
                        })?,
                    );
                }
            }
            let transport = StreamableHttpClientTransport::from_config(transport_config);
            let mut client = ().serve(transport).await.map_err(|_| {
                "The MCP server did not complete protocol initialization.".to_string()
            })?;
            let result = client
                .call_tool(request)
                .await
                .map_err(|_| "The MCP tool call failed.".to_string())?;
            client
                .close()
                .await
                .map_err(|_| "The MCP connection could not be closed.".to_string())?;
            let value = serde_json::to_value(result)
                .map_err(|_| "The MCP tool result could not be serialized.".to_string())?;
            let redactions = secret.into_iter().collect::<Vec<_>>();
            let redacted = redact(&value.to_string(), &redactions);
            serde_json::from_str(&redacted)
                .map_err(|_| "The MCP tool result could not be redacted.".to_string())
        }
    };
    tokio::time::timeout(Duration::from_secs(120), call)
        .await
        .map_err(|_| "The MCP tool call timed out.".to_string())?
}

pub fn resolve_run_mcp_config(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
    server_id: &str,
) -> Result<McpServerInput, String> {
    let snapshot = store
        .list_node_mcp_configs(run_id, node_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|record| record.id == server_id);
    let record = if let Some(record) = snapshot {
        record
    } else {
        // Runs created before MCP snapshots were introduced bind the current config once.
        let current = store
            .get_mcp_config(server_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "The MCP server is not registered for this run.".to_string())?;
        store
            .snapshot_node_mcp_configs(run_id, node_id, &[server_id.to_string()])
            .map_err(|error| error.to_string())?;
        current
    };
    let config: McpServerInput = serde_json::from_str(&record.config_json)
        .map_err(|_| "The run MCP configuration is invalid.".to_string())?;
    validate_mcp_config(&config)?;
    if !config.enabled {
        return Err("The MCP server snapshot is disabled.".into());
    }
    Ok(config)
}

pub fn authorize_workflow_mcp_call(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
    server_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<(), String> {
    let projection = store
        .get_run_projection(run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The workflow run was not found.".to_string())?;
    if projection.run.status != "running" {
        return Err("The workflow run is not ready for MCP execution.".into());
    }
    let node_run = projection
        .nodes
        .iter()
        .find(|node| node.node.node_id == node_id)
        .ok_or_else(|| "The MCP workflow node was not found.".to_string())?;
    if node_run.node.status != "ready" {
        return Err("The MCP workflow node is not ready.".into());
    }
    let network_approved = projection.approvals.iter().any(|approval| {
        approval.node_run_id == node_run.node.id
            && approval.capability == "network"
            && approval.status == "approved"
    });
    if !network_approved {
        return Err("The MCP network capability has not been approved.".into());
    }
    let workflow = store
        .get_workflow(&projection.run.workflow_id, projection.run.workflow_version)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The workflow definition was not found.".to_string())?;
    let definition: serde_json::Value = serde_json::from_str(&workflow.definition_json)
        .map_err(|_| "The stored workflow definition is invalid.".to_string())?;
    let node = definition
        .get("nodes")
        .and_then(serde_json::Value::as_array)
        .and_then(|nodes| {
            nodes
                .iter()
                .find(|node| node.get("id").and_then(serde_json::Value::as_str) == Some(node_id))
        })
        .ok_or_else(|| "The stored MCP workflow node is unavailable.".to_string())?;
    if node.get("type").and_then(serde_json::Value::as_str) != Some("mcp_tool")
        || node.get("serverId").and_then(serde_json::Value::as_str) != Some(server_id)
        || node.get("toolName").and_then(serde_json::Value::as_str) != Some(tool_name)
        || node.get("arguments") != Some(arguments)
    {
        return Err("The MCP call does not match the approved workflow node.".into());
    }
    Ok(())
}

pub fn authorize_and_audit_workflow_mcp_call(
    store: &OrchestrationStore,
    run_id: &str,
    node_id: &str,
    server_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
) -> Result<(), String> {
    authorize_workflow_mcp_call(store, run_id, node_id, server_id, tool_name, arguments).map_err(
        |error| {
            let event = serde_json::json!({
                "type": "mcp_tool_denied",
                "nodeId": node_id,
                "serverId": server_id,
                "toolName": tool_name
            });
            store.append_event(run_id, &event.to_string()).map_or_else(
                |_| "The denied MCP call could not be audited.".to_string(),
                |_| error,
            )
        },
    )
}

#[tauri::command]
pub async fn orchestration_test_mcp_connection(
    input: McpServerInput,
) -> Result<McpConnectionReport, String> {
    test_mcp_connection(&input).await
}

#[tauri::command]
pub fn orchestration_save_mcp_server(
    store: State<'_, OrchestrationStore>,
    input: McpServerInput,
) -> Result<(), String> {
    validate_mcp_config(&input)?;
    let json = serde_json::to_string(&input)
        .map_err(|_| "The MCP configuration could not be serialized.".to_string())?;
    store
        .save_mcp_config(&input.id, &json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_list_mcp_servers(
    store: State<'_, OrchestrationStore>,
) -> Result<Vec<McpServerInput>, String> {
    store
        .list_mcp_configs()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|record| {
            serde_json::from_str(&record.config_json)
                .map_err(|_| "A stored MCP configuration is invalid.".to_string())
        })
        .collect()
}

#[tauri::command]
pub fn orchestration_delete_mcp_server(
    store: State<'_, OrchestrationStore>,
    id: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("The MCP server identifier is invalid.".into());
    }
    let config = store
        .get_mcp_config(&id)
        .map_err(|error| error.to_string())?
        .map(|record| {
            serde_json::from_str::<McpServerInput>(&record.config_json)
                .map_err(|_| "A stored MCP configuration is invalid.".to_string())
        })
        .transpose()?;
    store
        .delete_mcp_config(&id)
        .map_err(|error| error.to_string())?;
    if let Some(reference) = config.and_then(|item| item.secret_ref) {
        let still_in_use = store
            .mcp_secret_reference_in_use(&reference)
            .map_err(|error| error.to_string())?;
        if !still_in_use {
            delete_secret(&format!("AstraNexus/{reference}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn orchestration_store_secret(reference: String, secret: String) -> Result<(), String> {
    if !valid_secret_reference(&reference) || secret.is_empty() || secret.len() > 16_384 {
        return Err("The credential input is invalid.".into());
    }
    store_secret(&format!("AstraNexus/{reference}"), &secret)
}

#[tauri::command]
pub fn orchestration_preflight_agent_capabilities(
    store: State<'_, OrchestrationStore>,
    input: AgentCapabilityPreflightInput,
) -> Result<AgentCapabilityManifest, String> {
    preflight_agent_capabilities(&store, &input, |reference| {
        read_secret(reference).map(|secret| {
            drop(secret);
        })
    })
}

#[tauri::command]
pub async fn orchestration_install_local_skill(
    app: AppHandle,
    source_path: String,
    approved: bool,
) -> Result<InstalledSkill, String> {
    if !approved {
        return Err("Skill installation requires explicit approval.".into());
    }
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

#[tauri::command]
pub async fn orchestration_install_git_skill(
    app: AppHandle,
    source_url: String,
    revision: Option<String>,
    approved: bool,
) -> Result<InstalledSkill, String> {
    if !approved {
        return Err("Skill installation requires explicit approval.".into());
    }
    validate_git_source(&source_url, revision.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|_| "The application data directory is unavailable.".to_string())?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "The system clock is unavailable.".to_string())?
            .as_nanos();
        let staging = app_data
            .join("skill-staging")
            .join(format!("git-{}-{nonce}", std::process::id()));
        fs::create_dir_all(staging.parent().expect("staging parent"))
            .map_err(|_| "The Skill staging directory could not be created.".to_string())?;
        let staging_text = staging.to_string_lossy().into_owned();
        let result = (|| {
            git_output(
                None,
                &[
                    "clone",
                    "--no-checkout",
                    "--filter=blob:none",
                    "--",
                    &source_url,
                    &staging_text,
                ],
            )?;
            git_output(
                Some(&staging),
                &[
                    "checkout",
                    "--detach",
                    revision.as_deref().unwrap_or("HEAD"),
                ],
            )?;
            install_local_skill(&staging, &app_data.join("skills"))
        })();
        if staging.starts_with(app_data.join("skill-staging")) {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    })
    .await
    .map_err(|_| "The Git Skill installation task stopped unexpectedly.".to_string())?
}

#[tauri::command]
pub async fn orchestration_call_mcp_tool(
    store: State<'_, OrchestrationStore>,
    run_id: String,
    node_id: String,
    server_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if !valid_id(&run_id) || !valid_id(&node_id) || !valid_id(&server_id) {
        return Err("MCP run identifiers are invalid.".into());
    }
    validate_mcp_tool_call(&tool_name, &arguments)?;
    authorize_and_audit_workflow_mcp_call(
        &store, &run_id, &node_id, &server_id, &tool_name, &arguments,
    )?;
    let config = resolve_run_mcp_config(&store, &run_id, &node_id, &server_id)?;
    store
        .update_node_status(&run_id, &node_id, "running", None)
        .map_err(|error| error.to_string())?;
    match call_mcp_tool(&config, &tool_name, arguments).await {
        Ok(result) => {
            let output = mcp_completion_evidence(&server_id, &tool_name);
            store
                .update_node_evidence(&run_id, &node_id, None, Some(&output), None)
                .map_err(|error| error.to_string())?;
            store
                .update_node_status(&run_id, &node_id, "succeeded", None)
                .map_err(|error| error.to_string())?;
            let event = serde_json::json!({
                "type": "mcp_tool_completed",
                "nodeId": node_id,
                "serverId": server_id,
                "toolName": tool_name
            });
            store
                .append_event(&run_id, &event.to_string())
                .map_err(|error| error.to_string())?;
            Ok(result)
        }
        Err(error) => {
            store
                .update_node_evidence(&run_id, &node_id, None, None, Some(&error))
                .map_err(|store_error| store_error.to_string())?;
            store
                .update_node_status(&run_id, &node_id, "failed", None)
                .map_err(|store_error| store_error.to_string())?;
            let event = serde_json::json!({
                "type": "mcp_tool_failed",
                "nodeId": node_id,
                "serverId": server_id,
                "toolName": tool_name
            });
            store
                .append_event(&run_id, &event.to_string())
                .map_err(|store_error| store_error.to_string())?;
            Err(error)
        }
    }
}

pub(super) fn mcp_completion_evidence(server_id: &str, tool_name: &str) -> String {
    serde_json::json!({
        "completed": true,
        "serverId": server_id,
        "toolName": tool_name
    })
    .to_string()
}

#[tauri::command]
pub fn orchestration_register_skill(
    app: AppHandle,
    store: State<'_, OrchestrationStore>,
    input: SkillPackageInput,
) -> Result<(), String> {
    if !valid_skill_id(&input.id)
        || input.name.trim().is_empty()
        || input.name.len() > 120
        || input.version.is_empty()
        || input.version.len() > 160
        || input.description.len() > 4_096
        || !matches!(input.source.as_str(), "catalog" | "git" | "local")
        || !valid_content_hash(&input.content_hash)
    {
        return Err("Skill package metadata is invalid.".into());
    }
    let cache_entry = app
        .path()
        .app_data_dir()
        .map_err(|_| "The application data directory is unavailable.".to_string())?
        .join("skills")
        .join(&input.content_hash);
    if !cache_entry.join("SKILL.md").is_file() {
        return Err("The Skill cache entry is unavailable.".into());
    }
    let json = serde_json::to_string(&input)
        .map_err(|_| "Skill package metadata could not be serialized.".to_string())?;
    store
        .save_skill_package(&input.id, &input.version, &input.content_hash, &json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn orchestration_list_skills(
    store: State<'_, OrchestrationStore>,
) -> Result<Vec<SkillPackageInput>, String> {
    store
        .list_skill_packages(false)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|record| {
            serde_json::from_str(&record.package_json)
                .map_err(|_| "Stored Skill package metadata is invalid.".to_string())
        })
        .collect()
}

#[tauri::command]
pub fn orchestration_uninstall_skill(
    store: State<'_, OrchestrationStore>,
    id: String,
    content_hash: String,
) -> Result<(), String> {
    if !valid_skill_id(&id) || !valid_content_hash(&content_hash) {
        return Err("Skill uninstall input is invalid.".into());
    }
    store
        .uninstall_skill(&id, &content_hash)
        .map_err(|error| error.to_string())
}

fn skill_context(
    app: &AppHandle,
    packages: Vec<SkillPackageRecord>,
    selected: &[String],
) -> Result<String, String> {
    let cache = app
        .path()
        .app_data_dir()
        .map_err(|_| "The application data directory is unavailable.".to_string())?
        .join("skills");
    let mut context = String::new();
    for package in packages
        .into_iter()
        .filter(|package| selected.iter().any(|id| id == &package.id))
    {
        if !valid_content_hash(&package.content_hash) {
            return Err("A referenced Skill content hash is invalid.".into());
        }
        let markdown = fs::read_to_string(cache.join(&package.content_hash).join("SKILL.md"))
            .map_err(|_| "A referenced Skill is unavailable.".to_string())?;
        if context.len().saturating_add(markdown.len()) > 200_000 {
            return Err("Selected Skills exceed the runtime context limit.".into());
        }
        context.push_str(&format!(
            "\n\n<astra-skill id=\"{}\" version=\"{}\">\n{}\n</astra-skill>",
            package.id, package.version, markdown
        ));
    }
    Ok(context)
}

#[tauri::command]
pub fn orchestration_build_skill_context(
    app: AppHandle,
    store: State<'_, OrchestrationStore>,
    run_id: String,
    skill_ids: Vec<String>,
) -> Result<String, String> {
    if !valid_id(&run_id) || skill_ids.len() > 32 || skill_ids.iter().any(|id| !valid_skill_id(id))
    {
        return Err("Skill runtime selection is invalid.".into());
    }
    let packages = store
        .list_run_skill_refs(&run_id)
        .map_err(|error| error.to_string())?;
    skill_context(&app, packages, &skill_ids)
}

#[tauri::command]
pub async fn orchestration_export_skill(
    app: AppHandle,
    store: State<'_, OrchestrationStore>,
    id: String,
    content_hash: String,
    target_directory: String,
    overwrite: bool,
    approved: bool,
) -> Result<PathBuf, String> {
    if !approved || !valid_skill_id(&id) || !valid_content_hash(&content_hash) {
        return Err("Skill export requires explicit approval and valid metadata.".into());
    }
    let registered = store
        .list_skill_packages(true)
        .map_err(|error| error.to_string())?
        .into_iter()
        .any(|package| package.id == id && package.content_hash == content_hash);
    if !registered {
        return Err("The Skill package is not registered.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|_| "The application data directory is unavailable.".to_string())?;
        let source = app_data.join("skills").join(&content_hash);
        let files = skill_files(&source)?;
        let target_root = PathBuf::from(target_directory)
            .canonicalize()
            .map_err(|_| "The Provider target directory is unavailable.".to_string())?;
        if !target_root.is_dir() {
            return Err("The Provider target must be a directory.".into());
        }
        let destination = target_root.join(&id);
        if destination.exists() && !overwrite {
            return Err("The Provider target already contains this Skill.".into());
        }
        if destination.exists() {
            fs::remove_dir_all(&destination)
                .map_err(|_| "The existing Provider Skill could not be replaced.".to_string())?;
        }
        fs::create_dir(&destination)
            .map_err(|_| "The Provider Skill directory could not be created.".to_string())?;
        for (path, relative, _) in files {
            let target = destination.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| "A Provider Skill directory could not be created.".to_string())?;
            }
            fs::copy(path, target)
                .map_err(|_| "A Skill file could not be exported.".to_string())?;
        }
        Ok(destination)
    })
    .await
    .map_err(|_| "The Skill export task stopped unexpectedly.".to_string())?
}
