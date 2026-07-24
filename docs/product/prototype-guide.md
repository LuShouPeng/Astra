# Astra Nexus Prototype Guide

## Purpose

Astra Nexus validates a desktop control plane for developers coordinating multiple local projects
and Agent tasks. It is designed to answer three questions quickly: what is running, what needs a
decision, and what changed.

## Primary Surfaces

| Surface         | Purpose                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Command Center  | Global status, active work, Attention preview, project matrix, and activity |
| Projects        | Register, search, sort, open, inspect, and remove local project metadata    |
| Project Detail  | Review project Sessions, changes, activity, and configuration               |
| Session Detail  | Inspect Timeline, Changes, Tests, Commands, and Context                     |
| Needs Attention | Process Approval, Input, Review, Failure, and Completed items               |
| Notifications   | Track unread state and navigate to typed targets                            |
| Settings        | Configure notification rules and deterministic demo playback                |

## State Synchronization

Session transitions update the Command Center, project tree, Session detail, Attention queue, and
Notifications from one versioned snapshot. Opening an Attention item can mark it read, but
resolution remains explicit. Review decisions are persisted as prototype metadata and do not
modify a Git repository.

## Local Project Behavior

The native layer canonicalizes selected paths, rejects invalid or missing directories, and confines
relative file operations to the registered root. Git branch, status, changed-file, and diff reads are
bounded and recoverable. Removing a project deletes only local registry metadata.

## Provider Behavior

- Claude: deterministic mock, no CLI process.
- Codex: deterministic mock, no CLI process.
- Gemini: display-only fixture label with `runtimeAvailable: false`.

The prototype does not collect credentials, execute Agent commands, upload project data, or expose
Git write operations.

## Deep Links

The application uses hash routes so desktop navigation does not depend on an HTTP fallback:

```text
#/command-center
#/projects/:projectId
#/sessions/:sessionId?tab=timeline|changes|tests|commands|context
#/attention
#/notifications
#/settings
```

## Recovery

- Corrupt prototype state falls back to frozen demo data with a warning.
- Missing projects remain visible but cannot invoke file or Git actions.
- Notification permission denial leaves application notifications available.
- Demo reset restores stable IDs, timestamps, ordering, and status.
