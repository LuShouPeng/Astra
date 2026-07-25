use serde::Serialize;
use std::collections::HashMap;
use std::process::Command;

/// 单个 Provider 的能力探测结果，字段与前端 `ProviderCapability` 对齐。
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredCapability {
    provider: &'static str,
    label: &'static str,
    runtime_available: bool,
    display_only: bool,
    version: Option<String>,
}

/// 从 `--version` 输出提取首个非空行作为版本串。
fn parse_version(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let first = text.lines().find(|line| !line.trim().is_empty())?;
    Some(first.trim().to_owned())
}

/// 探测某个 CLI 是否可执行并取其版本。Windows 经 `cmd /C` 解析 .cmd/.bat 包装器。
fn probe_version(name: &str) -> Option<String> {
    #[cfg(windows)]
    let mut command = {
        let mut c = Command::new("cmd");
        c.args(["/C", name, "--version"]);
        c
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut c = Command::new(name);
        c.arg("--version");
        c
    };

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version(&output.stdout).or_else(|| parse_version(&output.stderr))
}

fn build(
    provider: &'static str,
    label: &'static str,
    cli: &str,
    gate_display: bool,
) -> DiscoveredCapability {
    let version = probe_version(cli);
    let available = version.is_some();
    DiscoveredCapability {
        provider,
        label,
        runtime_available: available,
        // gemini 之前是 display-only；仅当真的探测到才解禁。其余 provider 恒为 false。
        display_only: gate_display && !available,
        version,
    }
}

/// 探测本机三个 Agent CLI 的安装与版本，返回 provider → 能力 映射。
/// 同步执行（Tauri 在线程池调度命令）；探测失败的 provider 记为不可用而非报错。
#[tauri::command]
pub fn discover_agent_capabilities() -> HashMap<String, DiscoveredCapability> {
    let mut map = HashMap::new();
    map.insert(
        "claude".to_owned(),
        build("claude", "Claude", "claude", false),
    );
    map.insert("codex".to_owned(), build("codex", "Codex", "codex", false));
    map.insert(
        "gemini".to_owned(),
        build("gemini", "Gemini", "gemini", true),
    );
    map
}

#[cfg(test)]
mod tests {
    use super::{build, parse_version};

    #[test]
    fn parses_first_non_empty_line() {
        assert_eq!(
            parse_version(b"\n  1.2.3 \nextra"),
            Some("1.2.3".to_owned())
        );
        assert_eq!(parse_version(b"   "), None);
        assert_eq!(parse_version(b""), None);
    }

    #[test]
    fn missing_cli_is_unavailable_and_gemini_stays_display_only() {
        // 一个几乎不可能存在的可执行名，确保走「未安装」分支。
        let cap = build("gemini", "Gemini", "astra_nonexistent_cli_xyz", true);
        assert!(!cap.runtime_available);
        assert!(cap.display_only);
        assert!(cap.version.is_none());
    }

    #[test]
    fn missing_non_gated_cli_is_not_display_only() {
        let cap = build("claude", "Claude", "astra_nonexistent_cli_xyz", false);
        assert!(!cap.runtime_available);
        assert!(!cap.display_only);
    }
}
