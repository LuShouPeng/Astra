# Product Roadmap

## Phase 1 - Controlled Provider Adapters

- Add real Claude and Codex adapters behind explicit capability discovery.
- Require confirmation for privileged operations and record an immutable audit trail.
- Preserve deterministic mocks as offline and regression-test providers.

## Phase 2 - Session Recovery And Execution Safety

- Recover native Session metadata without importing secrets or unrestricted shell state.
- Introduce command policy, working-directory confinement, output redaction, and cancellation.
- Add PTY support only after permissions, logging, and failure recovery are verified.

## Phase 3 - Daily Operator Experience

- Add configurable shortcuts, multiple themes, saved filters, and richer notification rules.
- Add accessible bulk actions and performance telemetry for large portfolios.
- Connect local project activity to real provider Sessions and review provenance.

## Phase 4 - Platform And Collaboration

- Package and verify macOS and Linux builds.
- Evaluate opt-in remote hosts, shared workspaces, and collaboration after local security controls
  are mature.
- Evaluate MCP and a Skill marketplace as separate product decisions, not implicit runtime access.

Gemini runtime, Git mutation, autonomous worktrees, cloud sync, and multi-Agent workflow execution
remain outside the current committed scope until their permission and audit models are defined.
