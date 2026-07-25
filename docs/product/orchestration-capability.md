# Workflow And Multi-Agent Orchestration Capability

## Capability

Astra Nexus lets one local developer design, approve, and run bounded DAG workflows across Claude
and Codex. A Rust Run Coordinator owns durable scheduling; the React surface renders the persisted
run projection, listens for run events, and recovers missed events by cursor. Agent nodes execute in
isolated managed Git worktrees. MCP and Skills attach to Agent nodes rather than existing as
standalone workflow nodes.

## Fixed Policy

- Gemini remains display-only.
- A generated workflow is always a draft until the user confirms it.
- Graphs are acyclic and support bounded retries, explicit conditions, joins, and approval nodes.
- Read-only operations may run automatically. Writes, commands, network use, installations, and
  Git integration require policy approval.
- Parallel Agent nodes never share a writable working directory.
- Managed commits may enter a run integration branch; merging into the user's branch is explicit.
- A final merge requires a persisted approval record. Only the request that atomically claims that
  approval may perform the merge.
- Node integration and final-merge conflicts create a high-priority Attention record and pause the
  run instead of silently treating a conflict as an ordinary node failure.
- Provider authentication is reused from installed CLIs. Astra never stores provider API keys.
- MCP secrets are stored in the operating-system credential vault and never written to logs.
- Skill installation never executes package scripts.
- A selected MCP configuration is snapshotted per run and mounted as a managed Claude MCP config at
  launch. Codex MCP execution remains unavailable until its installed CLI configuration contract is
  verified.

## Recovery

SQLite is the source of truth for definitions, approvals, attentions, events, and run projections.
Events are persisted before notification. High-volume logs and artifacts are stored under the
application data directory and referenced by content hash. Running nodes found during startup become
interrupted; their logs, diffs, and worktrees remain available for recovery.

## Non-Goals

The first release excludes arbitrary graph loops, unattended triggers, Gemini execution, remote
Agent hosts, cloud collaboration, marketplace publishing, automatic merge into a user's branch,
standalone MCP workflow nodes, PTY terminal emulation, and an unverified Codex MCP mount.
