use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use super::extensions::{
    install_local_skill, mcp_environment_allowed, save_mcp_server_with_secret, test_mcp_connection,
    validate_git_source, validate_mcp_config, validate_mcp_invocation, McpServerInput,
};

fn node_executable() -> Option<std::path::PathBuf> {
    let locator = if cfg!(windows) { "where.exe" } else { "which" };
    let output = std::process::Command::new(locator)
        .arg("node")
        .output()
        .ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(str::trim)
            .map(std::path::PathBuf::from)
    })?
}

fn temp(label: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("astra-extension-{label}-{suffix}"));
    fs::create_dir_all(&path).unwrap();
    path
}

fn remote_mcp_input() -> McpServerInput {
    McpServerInput {
        id: "exa".into(),
        name: "Exa".into(),
        transport: "streamable_http".into(),
        command: None,
        args: vec![],
        url: Some("https://mcp.exa.ai/mcp".into()),
        secret_ref: Some("credentials/exa".into()),
        secret_header: Some("x-api-key".into()),
        enabled: true,
    }
}

#[test]
fn atomic_mcp_save_validates_before_writing_a_credential() {
    let invalid = McpServerInput {
        url: Some("http://localhost.evil.example/mcp".into()),
        ..remote_mcp_input()
    };
    let mut credential_written = false;
    assert_eq!(
        save_mcp_server_with_secret(
            &invalid,
            Some("secret"),
            |_, _| {
                credential_written = true;
                Ok(())
            },
            |_, _| Ok(()),
            |_| Ok(false),
            |_| Ok(()),
        )
        .unwrap_err(),
        "The MCP URL must use HTTPS or local HTTP."
    );
    assert!(!credential_written);

    let without_reference = McpServerInput {
        secret_ref: None,
        ..remote_mcp_input()
    };
    assert_eq!(
        save_mcp_server_with_secret(
            &without_reference,
            Some("secret"),
            |_, _| {
                credential_written = true;
                Ok(())
            },
            |_, _| Ok(()),
            |_| Ok(false),
            |_| Ok(()),
        )
        .unwrap_err(),
        "The credential input is invalid."
    );
    assert!(!credential_written);
}

#[test]
fn atomic_mcp_save_persists_the_credential_then_a_secret_free_configuration() {
    let mut stored = Vec::new();
    let mut saved_config = String::new();
    let mut deleted = false;
    save_mcp_server_with_secret(
        &remote_mcp_input(),
        Some("api-key-must-not-enter-registry"),
        |reference, secret| {
            stored.push((reference.to_string(), secret.to_string()));
            Ok(())
        },
        |id, config_json| {
            assert_eq!(id, "exa");
            saved_config = config_json.to_string();
            Ok(())
        },
        |_| Ok(false),
        |_| {
            deleted = true;
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(
        stored,
        vec![(
            "AstraNexus/credentials/exa".to_string(),
            "api-key-must-not-enter-registry".to_string()
        )]
    );
    assert!(saved_config.contains("\"secretRef\":\"credentials/exa\""));
    assert!(!saved_config.contains("api-key-must-not-enter-registry"));
    assert!(!deleted);
}

#[test]
fn atomic_mcp_save_removes_only_an_unused_credential_when_registry_write_fails() {
    let mut deleted_references = Vec::new();
    assert_eq!(
        save_mcp_server_with_secret(
            &remote_mcp_input(),
            Some("secret"),
            |_, _| Ok(()),
            |_, _| Err("Registry write failed.".into()),
            |_| Ok(false),
            |reference| {
                deleted_references.push(reference.to_string());
                Ok(())
            },
        )
        .unwrap_err(),
        "Registry write failed."
    );
    assert_eq!(deleted_references, ["AstraNexus/credentials/exa"]);

    let mut deleted_shared_reference = false;
    assert_eq!(
        save_mcp_server_with_secret(
            &remote_mcp_input(),
            Some("secret"),
            |_, _| Ok(()),
            |_, _| Err("Registry write failed.".into()),
            |_| Ok(true),
            |_| {
                deleted_shared_reference = true;
                Ok(())
            },
        )
        .unwrap_err(),
        "Registry write failed."
    );
    assert!(!deleted_shared_reference);
}

#[test]
fn atomic_mcp_save_without_a_new_secret_does_not_touch_credential_storage() {
    let mut credential_written = false;
    let mut reference_checked = false;
    let mut credential_deleted = false;
    save_mcp_server_with_secret(
        &remote_mcp_input(),
        None,
        |_, _| {
            credential_written = true;
            Ok(())
        },
        |_, config_json| {
            assert!(config_json.contains("\"secretRef\":\"credentials/exa\""));
            Ok(())
        },
        |_| {
            reference_checked = true;
            Ok(false)
        },
        |_| {
            credential_deleted = true;
            Ok(())
        },
    )
    .unwrap();
    assert!(!credential_written);
    assert!(!reference_checked);
    assert!(!credential_deleted);
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
        secret_ref: Some("astra/exa".into()),
        secret_header: Some("x-api-key".into()),
        enabled: true,
    })
    .is_ok());
    assert!(validate_mcp_config(&McpServerInput {
        id: "old".into(),
        name: "Old".into(),
        transport: "sse".into(),
        command: None,
        args: vec![],
        url: Some("https://example.test/sse".into()),
        secret_ref: None,
        secret_header: None,
        enabled: true,
    })
    .is_err());

    for unsafe_url in [
        "http://localhost.evil.example/mcp",
        "http://localhost@evil.example/mcp",
        "https://user:password@example.test/mcp",
    ] {
        assert!(validate_mcp_config(&McpServerInput {
            id: "unsafe".into(),
            name: "Unsafe".into(),
            transport: "streamable_http".into(),
            command: None,
            args: vec![],
            url: Some(unsafe_url.into()),
            secret_ref: None,
            secret_header: None,
            enabled: true,
        })
        .is_err());
    }
    for local_url in ["http://localhost:3000/mcp", "http://127.0.0.1:3000/mcp"] {
        assert!(validate_mcp_config(&McpServerInput {
            id: "local".into(),
            name: "Local".into(),
            transport: "streamable_http".into(),
            command: None,
            args: vec![],
            url: Some(local_url.into()),
            secret_ref: None,
            secret_header: None,
            enabled: true,
        })
        .is_ok());
    }
}

#[test]
fn stdio_mcp_environment_does_not_inherit_application_secrets() {
    assert!(mcp_environment_allowed("PATH"));
    assert!(!mcp_environment_allowed("OPENAI_API_KEY"));
    assert!(!mcp_environment_allowed("EXA_API_KEY"));
    assert!(!mcp_environment_allowed("GITHUB_TOKEN"));
    assert!(!mcp_environment_allowed("NODE_OPTIONS"));
}

#[test]
fn rejects_unapproved_secret_headers_and_ambiguous_references() {
    let base = McpServerInput {
        id: "exa".into(),
        name: "Exa".into(),
        transport: "streamable_http".into(),
        command: None,
        args: vec![],
        url: Some("https://mcp.exa.ai/mcp".into()),
        secret_ref: Some("credentials/exa".into()),
        secret_header: Some("x-api-key".into()),
        enabled: true,
    };
    assert!(validate_mcp_config(&base).is_ok());
    assert!(validate_mcp_config(&McpServerInput {
        secret_header: Some("x-forwarded-authorization".into()),
        ..base.clone()
    })
    .is_err());
    assert!(validate_mcp_config(&McpServerInput {
        secret_ref: Some("credentials/../exa".into()),
        ..base
    })
    .is_err());
}

#[tokio::test]
async fn connects_to_stdio_mcp_and_reads_the_tool_catalog() {
    let Some(node) = node_executable() else {
        return;
    };
    let directory = temp("stdio-mcp");
    let script = directory.join("server.mjs");
    fs::write(
        &script,
        r#"import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'astra-test-mcp', version: '1.0.0' }
    } }) + '\n');
  } else if (message.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
      tools: [
        { name: 'search', description: 'Search locally', inputSchema: { type: 'object' } },
        { name: 'inspect', description: 'Inspect a record', inputSchema: { type: 'object' } }
      ]
    } }) + '\n');
  }
});
"#,
    )
    .unwrap();
    let report = test_mcp_connection(&McpServerInput {
        id: "local-test".into(),
        name: "Local test".into(),
        transport: "stdio".into(),
        command: Some(node.to_string_lossy().into_owned()),
        args: vec![script.to_string_lossy().into_owned()],
        url: None,
        secret_ref: None,
        secret_header: None,
        enabled: true,
    })
    .await
    .expect("connect and list tools");
    assert_eq!(report.tool_count, 2);
    assert_eq!(report.tools, ["inspect", "search"]);
    fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn connects_to_streamable_http_mcp_and_reads_the_tool_catalog() {
    let Some(node) = node_executable() else {
        return;
    };
    let reservation = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = reservation.local_addr().unwrap().port();
    drop(reservation);
    let directory = temp("http-mcp");
    let script = directory.join("server.mjs");
    fs::write(
        &script,
        r#"import http from 'node:http';
const port = Number(process.argv[2]);
const server = http.createServer((request, response) => {
  if (request.method === 'DELETE') {
    response.writeHead(200).end();
    return;
  }
  let body = '';
  request.on('data', (chunk) => body += chunk);
  request.on('end', () => {
    const message = JSON.parse(body);
    let result = {};
    if (message.method === 'initialize') {
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'astra-http-test-mcp', version: '1.0.0' }
      };
    } else if (message.method === 'tools/list') {
      result = { tools: [
        { name: 'fetch', description: 'Fetch locally', inputSchema: { type: 'object' } },
        { name: 'search', description: 'Search locally', inputSchema: { type: 'object' } }
      ] };
    } else if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
});
server.listen(port, '127.0.0.1');
"#,
    )
    .unwrap();
    let mut child = std::process::Command::new(node)
        .args([script.to_string_lossy().as_ref(), &port.to_string()])
        .spawn()
        .expect("start HTTP MCP server");
    let ready = (0..50).any(|_| {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            true
        } else {
            std::thread::sleep(std::time::Duration::from_millis(20));
            false
        }
    });
    assert!(ready, "HTTP MCP server did not start");
    let report = test_mcp_connection(&McpServerInput {
        id: "http-test".into(),
        name: "HTTP test".into(),
        transport: "streamable_http".into(),
        command: None,
        args: vec![],
        url: Some(format!("http://localhost:{port}/mcp")),
        secret_ref: None,
        secret_header: None,
        enabled: true,
    })
    .await
    .expect("connect and list HTTP tools");
    assert_eq!(report.tool_count, 2);
    assert_eq!(report.tools, ["fetch", "search"]);
    child.kill().unwrap();
    child.wait().unwrap();
    fs::remove_dir_all(directory).unwrap();
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

#[test]
fn validates_bounded_mcp_invocations() {
    assert!(validate_mcp_invocation("search", &serde_json::json!({"q": "astra"})).is_ok());
    assert!(validate_mcp_invocation("../search", &serde_json::json!({})).is_err());
    assert!(
        validate_mcp_invocation("search", &serde_json::json!(["not", "an", "object"])).is_err()
    );
    assert!(
        validate_mcp_invocation("search", &serde_json::json!({"q": "x".repeat(70_000)})).is_err()
    );
}
