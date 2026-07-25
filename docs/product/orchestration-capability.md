# Workflow And Multi-Agent Orchestration Capability

## Capability

Astra Nexus lets one local developer design, approve, and run bounded DAG workflows across Claude
and Codex. Agent nodes execute in isolated managed Git worktrees, MCP tools pass through one
auditable permission gateway, and Skills are installed into an Astra-managed cache and activated
per workflow.

## Fixed Policy

- Gemini remains display-only.
- A generated workflow is always a draft until the user confirms it.
- Graphs are acyclic and support bounded retries, explicit conditions, joins, and approval nodes.
- Read-only operations may run automatically. Writes, commands, network use, installations, and
  Git integration require policy approval.
- Parallel Agent nodes never share a writable working directory.
- Managed commits may enter a run integration branch; merging into the user's branch is explicit.
- Provider authentication is reused from installed CLIs. Astra never stores provider API keys.
- MCP secrets are stored in the operating-system credential vault and never written to logs.
- Skill installation never executes package scripts.

## Recovery

SQLite is the source of truth for definitions and runs. High-volume logs and artifacts are stored
under the application data directory and referenced by content hash. Running nodes found during
startup become interrupted; their logs, diffs, and worktrees remain available for recovery.

## Non-Goals

The first release excludes arbitrary graph loops, unattended triggers, Gemini execution, remote
Agent hosts, cloud collaboration, marketplace publishing, and automatic merge into a user's
branch.
