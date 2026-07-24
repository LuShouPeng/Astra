# AI Coding Workbench Capability Contract

## Capability

AI Coding Workbench gives a local developer one desktop control plane for registered projects,
mock Agent sessions, attention items, notifications, read-only Git changes, and review decisions.
The prototype must support a five-minute offline demo without executing an Agent CLI or changing a
Git repository.

## Product Promises

- A user can register local projects and recover them after restart.
- Command Center summarizes running, waiting, completed, and failed work across all projects.
- A user can navigate from a project, attention item, or notification to one Session detail view.
- Session Timeline displays user, Agent, command, file-change, test, approval, and status events.
- Changes displays a changed-file list and text diff, then records review decisions locally.
- Attention and notification state stays synchronized with Session state transitions.
- Desktop notifications can be enabled or disabled and are only emitted for configured events.
- Local Git inspection is read-only and failures never crash the application.
- The Windows prototype can be built into an installable artifact.

## Fixed Constraints

### Product Policy

- No project content is uploaded.
- No API key is collected or persisted.
- No Agent-provided command is executed.
- Demo approval changes local simulation state only.
- Git operations are read-only: no commit, reset, checkout, merge, stash, clean, or write.
- Paths are canonicalized and every file operation is constrained to its registered project root.
- Project removal deletes registry metadata only.
- Errors shown to users are structured and do not expose raw stacks or sensitive file content.

### Runtime Scope

- Claude and Codex are simulated providers in this prototype; their CLIs are not launched.
- Gemini may appear as a provider label in frozen demo data, but Gemini CLI, adapter, discovery,
  execution, and session recovery are explicitly excluded by the user.
- No PTY, full editor, worktree automation, workflow engine, cloud account, or remote Agent host.
- Unsupported future actions must be visibly marked `Coming soon` and disabled.

### Architecture Policy

- Shared domain types live only in `src/core/contracts`.
- Cross-module notifications use the typed app event bus.
- Modules import public module entry points or shared contracts, never another module's internals.
- The App Shell owns layout and module mounting, not product data.
- Command Center owns no source data; it renders derived selectors from domain repositories.
- Native behavior is isolated behind typed adapters and prefixed Tauri commands.

## Module Ownership

| Module           | Owns                                                           | May consume                 |
| ---------------- | -------------------------------------------------------------- | --------------------------- |
| `workspace`      | project registry, canonical root paths, active project         | read-only Git summary       |
| `command-center` | dashboard composition and derived views                        | all public read models      |
| `sessions`       | sessions, timeline, mock state transitions, follow-up messages | active project              |
| `changes`        | changed-file records, text diffs, review decisions             | selected session            |
| `attention`      | attention items, filters, read/resolved state                  | session events              |
| `notifications`  | app notifications, unread state, desktop adapter               | session events and settings |
| `settings`       | notification and demo preferences                              | no module internals         |
| `demo`           | frozen fixtures, simulation clock and reset                    | public domain commands      |
| `app/shell`      | primary navigation, project tree slot, page slot               | module manifests            |

Each business module exports through `index.ts`. A module manifest is the only App Shell mounting
contract. Gemini has no runtime module.

## Actors And Surfaces

### Actors

- Local developer: registers projects, inspects state, handles attention, and reviews changes.
- Demo runtime: produces deterministic mock state transitions without system command execution.
- Rust core: validates paths, inspects Git, opens approved local paths, and emits notifications.

### Surfaces

- Command Center
- Projects list and Project detail
- Persistent project and Session tree
- Session detail with Timeline and Changes tabs
- Changes / Diff Review
- Needs Attention
- Notifications
- Settings and About

## State And Transitions

### Session

```text
idle -> running -> waiting -> running -> completed
                  |                    |
                  +-> stopped          +-> failed
running -> failed
running -> stopped
```

- `waiting` creates an Attention item, app notification, and Timeline event.
- Approval resolves the related Attention item and returns the Session to `running`.
- Rejection records an approval event and moves the Session to `stopped`.
- Completion creates changed files, a test result, a notification, and Review attention.
- Request Changes requires non-empty feedback, records a user message and review event, and moves
  the Session to `running` when immediate rerun is selected, otherwise `waiting`.

### Attention

```text
unread/open -> read/open -> read/resolved
```

Resolution is explicit. Opening an item may mark it read but does not silently resolve it.

### Notification

```text
unread -> read -> cleared
```

Opening a notification marks it read and navigates to its typed target when available.

### Review

```text
unreviewed -> reviewed
unreviewed|reviewed -> accepted
unreviewed|reviewed -> changes_requested
```

Review decisions persist as prototype metadata and never mutate the Git working tree.

## Data Contract

The PRD models are represented by shared contracts for:

- `Project`
- `AgentProvider`
- `SessionStatus`
- `AgentSession`
- discriminated `TimelineEvent` variants
- `FileChange`
- `AttentionItem`
- `AppNotification`
- `NotificationSettings`
- `DemoRuntimeState`

Opaque `Record<string, unknown>` event metadata is not used for product behavior. Event-specific
fields are modeled as a discriminated union so rendering and transitions remain type-safe.

Persistence uses a versioned local schema. Project root paths remain in the workspace registry;
other modules reference `projectId`, `sessionId`, and project-relative paths.

## Native Interfaces

All commands return structured errors and use module prefixes.

```text
workspace_inspect_path(path)
workspace_check_exists(path)
project_git_summary(root_path)
project_git_changes(root_path)
project_file_diff(root_path, relative_path)
system_open_directory(root_path)
system_open_file(root_path, relative_path)
notification_send(title, body)
```

Native implementation requirements:

- Canonicalize project roots before use.
- Reject absolute, parent-traversal, and symlink-escape relative file paths.
- Bound Git diff output and return a binary-file marker where text diff is unavailable.
- Run potentially slow Git inspection off the UI thread.
- Never accept an arbitrary shell command from the frontend.

## Failure And Recovery

- Corrupt local state falls back to frozen demo data plus a non-blocking warning.
- Missing projects remain visible, are marked missing, and cannot invoke Git/file actions.
- Git errors produce `unknown` summary state and a recoverable message.
- Desktop-notification denial leaves app notifications functional.
- Demo reset restores the same deterministic IDs, timestamps, ordering, and state.
- Async controls disable repeated submission and always clear pending state on failure.

## Performance Contract

- Cold start target: less than 5 seconds on the reference Windows machine.
- Page transition feedback: less than 300 ms.
- Project and Session lists remain usable with 100 Sessions.
- Timeline remains responsive with 500 events.
- Git inspection does not block rendering or input.
- Long lists use bounded rendering, pagination, or virtualization when fixture tests exceed limits.

## Verification Contract

Every functional commit must include proportionate automated evidence:

- Unit tests for transitions, selectors, validation, and adapters.
- Component tests for visible states and actions.
- E2E coverage for the five-minute demo path and deep-link navigation.
- Rust tests for path confinement and read-only Git behavior.
- Format, lint, typecheck, unit coverage, production build, and Cargo checks before release.
- Windows installer generation and launch verification before completion.

## Delivery Slices

Each slice is committed independently after its focused tests pass.

1. Capability contract and frozen requirement matrix.
2. Shared domain contracts, versioned prototype repository, and deterministic demo fixtures.
3. Hash-routed App Shell, primary navigation, project tree, and Command Center.
4. Projects management, search/sort, read-only Git summary, and safe system-open actions.
5. Session detail, Timeline events, follow-up input, and mock state transitions.
6. Needs Attention filters, navigation, approval/rejection/retry/dismiss actions.
7. Changed files, bounded text diff, Accept, Mark Reviewed, and Request Changes.
8. App notifications, desktop notification adapter, notification settings, and deep links.
9. Demo reset/playback/speed controls and performance fixtures.
10. Installer, executable, route/demo documentation, known issues, and release verification.

## Open Decisions

These are implementation preferences, not unresolved product blockers:

- Use `HashRouter` so Tauri deep links do not depend on an HTTP server fallback.
- Keep the existing CSS-token system rather than introducing Tailwind.
- Prefer the existing service/context boundaries until a module demonstrably needs Zustand;
  state libraries are not part of the user-visible contract.
- Prefer `git2` for bounded read-only inspection unless an official Tauri pattern proves safer or
  substantially simpler.

## Handoff

The capability is ready for direct implementation in the delivery-slice order above. Any change to
Git write policy, real CLI execution, project-root confinement, or Gemini runtime scope requires a
new product decision before code changes.
