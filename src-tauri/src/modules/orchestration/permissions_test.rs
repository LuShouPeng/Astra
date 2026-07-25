use super::permissions::{classify_operation, redact, Operation, PolicyDecision};

#[test]
fn only_read_operations_are_automatically_allowed() {
    assert_eq!(classify_operation(Operation::Read), PolicyDecision::Allow);
    for operation in [
        Operation::Write,
        Operation::Execute,
        Operation::Network,
        Operation::Install,
        Operation::Worktree,
        Operation::Integrate,
        Operation::Merge,
    ] {
        assert_eq!(
            classify_operation(operation),
            PolicyDecision::RequireApproval
        );
    }
}

#[test]
fn redacts_non_empty_secrets_from_runtime_output() {
    assert_eq!(
        redact(
            "Authorization: Bearer secret-123",
            &["secret-123".into(), "".into()]
        ),
        "Authorization: Bearer [REDACTED]"
    );
}

#[test]
fn redacts_common_provider_token_patterns_without_a_secret_lookup() {
    let output = redact(
        "Authorization: Bearer sk-live-example GitHub ghp_example_token Slack xoxb-example-token",
        &[],
    );
    assert!(!output.contains("sk-live-example"));
    assert!(!output.contains("ghp_example_token"));
    assert!(!output.contains("xoxb-example-token"));
}
