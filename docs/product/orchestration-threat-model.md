# Orchestration Threat Model

## Trust Boundaries

- Workflow prompts, MCP responses, Skill files, CLI output, repository content, and catalog data
  are untrusted input.
- The React frontend cannot construct shell command lines or read credential values.
- Rust owns process arguments, canonical paths, worktrees, database access, credentials, network
  policy, redaction, and audit records.

## Required Controls

- Validate every graph, identifier, URL, path, package size, checksum, and database input.
- Use parameterized SQL and executable-plus-argument process APIs; never concatenate commands.
- Constrain node processes to their managed worktree and terminate the complete process tree.
- Redact configured secrets from stdout, stderr, errors, events, and persisted logs.
- Reject archive traversal, absolute package paths, symlink escape, legacy MCP SSE, and unsigned
  catalog mutations.
- Require explicit approval for write, execute, network, install, worktree, integration, and final
  merge capabilities.
- Preserve evidence before cleanup and make destructive cleanup a separate confirmed operation.
