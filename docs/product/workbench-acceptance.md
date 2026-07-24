# Full Workbench Acceptance Matrix

Source: `AI Coding Workbench 原型产品需求.docx`

Status values: `pending`, `implemented`, `verified`, `deferred`, `excluded`.

## Product Flows

| ID     | Capability                                                                | Required evidence                  | Status   |
| ------ | ------------------------------------------------------------------------- | ---------------------------------- | -------- |
| US-001 | Add and persist a local project with Git information                      | Service, native and restart tests  | verified |
| US-002 | Expand projects and open Agent Sessions                                   | Component and E2E tests            | verified |
| US-003 | Synchronize Session status across tree and dashboard                      | Transition, selector and E2E tests | verified |
| US-004 | Render all seven Timeline event types in time order                       | Contract and component tests       | verified |
| US-005 | Render changed files, text diff and binary fallback                       | Rust, adapter and component tests  | verified |
| US-006 | Process filtered Attention items and deep-link to Session                 | Store, component and E2E tests     | verified |
| US-007 | Emit configured desktop notifications and navigate from app notifications | Adapter and E2E tests              | verified |
| US-008 | Accept or request changes and update Session/Timeline                     | Transition and E2E tests           | verified |

## Pages And Modules

| Surface         | Minimum scope                                                                                           | Status   |
| --------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| Command Center  | Header actions, four status totals, Active Sessions, Attention preview, project matrix, recent activity | verified |
| Projects        | Cards, add/remove/open, search, sort, Git/session/activity fields                                       | verified |
| Project detail  | Overview, Sessions, Changes, Activity, basic configuration                                              | verified |
| Session detail  | Header, Timeline and Changes primary tabs, Tests/Commands/Context secondary tabs                        | verified |
| Changes         | File statuses/counts, unified text diff, line numbers, review actions, binary fallback                  | verified |
| Needs Attention | Six filters and type-specific actions                                                                   | verified |
| Notifications   | Seven notification events, unread state, typed navigation target, settings                              | verified |
| Settings/About  | General, Notifications, Demo, version, description and stack                                            | verified |
| App Shell       | Primary navigation, project/Session tree, content slot, responsive optional inspector                   | verified |

## P0 Release Gates

| Requirement                         | Status   |
| ----------------------------------- | -------- |
| Application starts without crashing | verified |
| All primary pages navigate          | verified |
| Frozen demo data loads              | verified |
| Session detail opens                | verified |
| Timeline renders                    | verified |
| Diff renders                        | verified |
| Needs Attention actions work        | verified |
| Desktop notification can trigger    | verified |
| Windows installer builds            | verified |

## P1 Release Gates

| Requirement                     | Status   |
| ------------------------------- | -------- |
| Add a local project             | verified |
| Read Git branch                 | verified |
| Read Git status                 | verified |
| Read real text diff             | verified |
| Request Changes updates Session | verified |
| Notification click navigates    | verified |
| Projects persist after restart  | verified |

## P2 Polish Gates

| Requirement              | Status   |
| ------------------------ | -------- |
| Motion and visual polish | verified |
| Search and filters       | verified |
| Actionable empty states  | verified |
| Keyboard shortcuts       | verified |
| Multiple themes          | verified |
| Demo playback speed      | verified |

## Cross-Cutting Gates

| Area            | Requirement                                                                | Status   |
| --------------- | -------------------------------------------------------------------------- | -------- |
| Interaction     | Every action has feedback; async actions show loading; no dead buttons     | verified |
| Validation      | Project removal confirms; Request Changes requires text                    | verified |
| Synchronization | Status updates dashboard, tree, Session, Attention and notifications       | verified |
| Performance     | Cold start <5 s; page feedback <300 ms; 100 Sessions and 500 events usable | verified |
| Security        | No upload/key storage/Agent command execution/Git write/out-of-root reads  | verified |
| Packaging       | Source, installer, executable, README, PRD and prototype documentation     | verified |
| Demo kit        | Data guide, script, slide deck, backup video, known issues, roadmap        | verified |

## Explicit Exclusions

| Capability                                                          | Status   |
| ------------------------------------------------------------------- | -------- |
| Real Claude or Codex CLI execution and native Session recovery      | excluded |
| Gemini CLI/runtime/adapter                                          | excluded |
| PTY terminal, workflow runtime and worktree automation              | excluded |
| Git commit/reset/checkout/merge and all repository mutation         | excluded |
| Full editor, cloud sync, collaboration, marketplace and remote host | excluded |

Gemini provider labels may remain in frozen demo fixtures because the PRD requires three-provider
visual coverage; no Gemini CLI behavior may be implemented.

## Demo And Performance Evidence

- Frozen playback has three deterministic steps and supports pause, single-step, reset, and
  `0.5x` / `1x` / `2x` speed selection.
- Playback synchronizes Session status, Timeline, Attention, and Notifications without invoking a
  provider runtime or native command.
- The performance fixture creates exactly 100 Sessions and 500 Timeline events with stable IDs and
  timestamps.
- Project trees render at most 30 Sessions per expanded project, Command Center renders six Active
  Sessions and five Attention preview items, and Timeline reveals events in batches of 100.
- The rebuilt portable executable opened a responsive `Astra Nexus` window within the 5-second
  release probe. Both configured desktop viewports completed the Command Center E2E flow without
  document overflow.

## Final Requirement Audit

| Requirement area             | Direct implementation evidence                                                                                                                                                                                             | Audit result |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Project cards                | Path, Git branch/state, last activity, Session count, active Agent count, and changed-file count have component, selector, and E2E assertions                                                                              | verified     |
| Desktop shell geometry       | Tauri minimum width is 1200 px; title bar is 48 px; sidebar is 260 px; CSS contract test enforces all three values                                                                                                         | verified     |
| Session status semantics     | Running uses blue semantic tokens and Completed uses green tokens in the tree, Command Center, and Session header                                                                                                          | verified     |
| Read-only Git responsiveness | Summary, changed-file, and diff commands are async and dispatch blocking Git work through `spawn_blocking`; Rust contract test covers all three                                                                            | verified     |
| Async feedback               | Project add, directory/file open, diff clipboard copy, persistence, review actions, settings, notification tests, demo controls, and removal expose pending/disabled state and recoverable feedback                        | verified     |
| Failure recovery             | Failed project removal retains its confirmation; failed Request Changes retains typed feedback; tests cover both retry paths                                                                                               | verified     |
| Module boundaries            | ESLint rejects cross-module deep imports; modules expose public entry points while `core` and `shared` remain common dependencies                                                                                          | verified     |
| Review event interpretation  | The PRD data contract fixes seven Timeline variants. Request Changes therefore emits `user_message` and, when needed, `status`; review state is persisted on `FileChange` instead of adding an undocumented eighth variant | verified     |
| Settings scope               | Theme and notification settings are functional; language, startup, and default-directory fields are truthful prototype representations or visibly marked `Coming soon`                                                     | verified     |
| Prohibited capabilities      | No Agent CLI, Gemini runtime, key collection, upload, shell execution, Git mutation, or project-root escape is exposed                                                                                                     | verified     |

## Release Evidence

- Frontend unit/component suite: 138 tests passed across 40 files. Coverage was 90.58% statements,
  83.50% branches, 92.08% functions, and 92.26% lines.
- E2E suite: 24 tests passed across desktop projects at 1280x720 and 1440x900, including
  browser-clock checks that each of the six primary page transitions completes in under 300 ms.
- Rust suite: 6 tests passed, covering path confinement, bounded read-only Git behavior, binary
  fallback, repository isolation, path identity, and async Git command dispatch.
- NSIS build produced a current-user installer; the portable EXE launch probe passed.
- The backup MP4 passed full decode and montage review.
- The eight-slide PPTX passed slide-by-slide visual review with no observed clipping or overlap.

- Command Center actions add projects, create deterministic simulated tasks, filter status results,
  and expose full Active Session metadata without invoking an Agent runtime.
- Session headers expose start time and duration plus message, approval, rejection, local stop,
  project-open, and review navigation actions. Stop remains a local simulation only.
- Every Attention type has a specific next action, Agent/Session/time context, and Mark Read support;
  Request Changes also creates a `review_requested` application notification.
- Dark, Light, and System themes persist locally. `Alt+1` through `Alt+6` navigate primary pages,
  and `Ctrl+,` / `Cmd+,` opens Settings while editable controls retain normal keyboard behavior.
