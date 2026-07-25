use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Read,
    Write,
    Execute,
    Network,
    Install,
    Worktree,
    Integrate,
    Merge,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyDecision {
    Allow,
    RequireApproval,
}

pub fn classify_operation(operation: Operation) -> PolicyDecision {
    match operation {
        Operation::Read => PolicyDecision::Allow,
        Operation::Write
        | Operation::Execute
        | Operation::Network
        | Operation::Install
        | Operation::Worktree
        | Operation::Integrate
        | Operation::Merge => PolicyDecision::RequireApproval,
    }
}

pub fn redact(value: &str, secrets: &[String]) -> String {
    let explicitly_redacted = secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(value.to_string(), |redacted, secret| {
            redacted.replace(secret, "[REDACTED]")
        });
    redact_common_tokens(&explicitly_redacted)
}

fn redact_token_after_prefix(value: String, prefix: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let prefix_lower = prefix.to_ascii_lowercase();
    let mut cursor = 0;
    let mut output = String::with_capacity(value.len());
    while let Some(offset) = lower[cursor..].find(&prefix_lower) {
        let start = cursor + offset;
        let token_start = start + prefix.len();
        let token_end = value[token_start..]
            .char_indices()
            .find_map(|(offset, character)| {
                character
                    .is_whitespace()
                    .then_some(token_start + offset)
                    .or_else(|| {
                        matches!(character, '"' | '\'' | ',' | ';' | '&')
                            .then_some(token_start + offset)
                    })
            })
            .unwrap_or(value.len());
        if token_start == token_end {
            cursor = token_start;
            continue;
        }
        output.push_str(&value[cursor..token_start]);
        output.push_str("[REDACTED]");
        cursor = token_end;
    }
    if cursor == 0 {
        value
    } else {
        output.push_str(&value[cursor..]);
        output
    }
}

fn redact_common_tokens(value: &str) -> String {
    let bearer = redact_token_after_prefix(value.to_string(), "Bearer ");
    ["sk-", "ghp_", "gho_", "github_pat_", "xoxb-"]
        .iter()
        .fold(bearer, |redacted, prefix| {
            redact_token_after_prefix(redacted, prefix)
        })
}
