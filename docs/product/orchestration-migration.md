# Orchestration Storage Migration

## Schema v2

The desktop application upgrades `orchestration.sqlite3` from schema v1 to v2 during startup.
Before the first upgrade it creates `orchestration.sqlite3.v1.backup` beside the database. Fresh v2
databases do not create a backup.

The migration runs in one SQLite transaction and adds runtime evidence, timestamps, artifacts,
workflow templates, Skill lifecycle state, and run-to-Skill version references. A failed migration
rolls back and leaves the backup untouched.

## Recovery

Active runs and nodes become `interrupted` on startup. Logs, managed branches, node worktrees,
external Provider session identifiers, and uncommitted diffs remain in place. Resume resets only
interrupted nodes to `pending`; cleanup is a separate confirmed action.

The v1 snapshot/localStorage projection remains a UI cache for simulation mode. In desktop mode,
SQLite is authoritative and the run page reconstructs its projection after reload.

## Rollback

1. Exit Astra Nexus.
2. Preserve the current database for diagnosis.
3. Replace `orchestration.sqlite3` with `orchestration.sqlite3.v1.backup`.
4. Start a build that understands schema v1.

Never copy a database while Astra Nexus is running.
