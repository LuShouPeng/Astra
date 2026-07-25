use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use super::extensions::{
    install_local_skill, validate_git_source, validate_mcp_config, McpServerInput,
};

fn temp(label: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("astra-extension-{label}-{suffix}"));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn validates_stdio_and_streamable_http_without_accepting_legacy_sse() {
    assert!(validate_mcp_config(&McpServerInput {
        id: "exa".into(),
        name: "Exa".into(),
        transport: "streamable_http".into(),
        command: None,
        args: vec![],
        url: Some("https://mcp.exa.ai/mcp".into()),
        secret_ref: Some("astra/exa".into())
    })
    .is_ok());
    assert!(validate_mcp_config(&McpServerInput {
        id: "old".into(),
        name: "Old".into(),
        transport: "sse".into(),
        command: None,
        args: vec![],
        url: Some("https://example.test/sse".into()),
        secret_ref: None
    })
    .is_err());
}

#[test]
fn installs_a_valid_skill_into_content_addressed_cache() {
    let source = temp("source");
    let cache = temp("cache");
    fs::write(source.join("SKILL.md"), "---\nname: test\n---\n# Test\n").unwrap();
    fs::create_dir(source.join("references")).unwrap();
    fs::write(source.join("references/guide.md"), "guide").unwrap();
    let installed = install_local_skill(&source, &cache).expect("install");
    assert!(installed.install_path.join("SKILL.md").is_file());
    assert_eq!(installed.content_hash.len(), 64);
    fs::remove_dir_all(source).unwrap();
    fs::remove_dir_all(cache).unwrap();
}

#[test]
fn rejects_skill_packages_without_skill_markdown() {
    let source = temp("invalid");
    let cache = temp("invalid-cache");
    fs::write(source.join("README.md"), "not a skill").unwrap();
    assert!(install_local_skill(&source, &cache).is_err());
    fs::remove_dir_all(source).unwrap();
    fs::remove_dir_all(cache).unwrap();
}

#[test]
fn validates_https_git_sources_without_embedded_credentials() {
    assert!(validate_git_source("https://github.com/example/skill.git", Some("v1.2.0")).is_ok());
    assert!(validate_git_source("https://token@github.com/example/skill.git", None).is_err());
    assert!(validate_git_source("file:///C:/outside", None).is_err());
    assert!(validate_git_source(
        "https://github.com/example/skill.git",
        Some("--upload-pack=bad")
    )
    .is_err());
}
