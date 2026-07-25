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
    secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(value.to_string(), |redacted, secret| {
            redacted.replace(secret, "[REDACTED]")
        })
}
