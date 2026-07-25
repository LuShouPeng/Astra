# PRD Requirement Traceability

Authority: `AI Coding Workbench 原型产品需求.docx`, 744 non-empty paragraphs in document order.
The DOCX contains no tables, populated comments, or substantive footnotes. This matrix covers its
normative scope, user stories, surfaces, state model, architecture, interaction, release gates,
performance, security, roadshow, and delivery requirements.

Status values: `verified`, `excluded`, and `resolved-conflict`.

## Scope

| PRD requirement                                     | Direct evidence                                                        | Status   |
| --------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| Command Center                                      | `CommandCenterPage`, selector tests, dual-viewport E2E                 | verified |
| Multi-project registration and display              | Workspace service, Projects page, persistence tests                    | verified |
| Project and Session tree                            | `ProjectSessionTree`, grouping/deep-link/100-Session tests             | verified |
| Claude, Codex, and Gemini identity                  | Provider contract, frozen fixtures, provider styling                   | verified |
| Session statuses                                    | Shared status contract, semantic tokens, transition tests              | verified |
| Conversation and execution Timeline                 | Seven-variant discriminated union and Timeline tests                   | verified |
| Mock Agent transitions                              | Session, Attention, Review, and Demo transition tests                  | verified |
| Needs Attention inbox                               | Six filters, five item types, type-specific action test                | verified |
| Local Git information, changed files, and text Diff | Read-only `git2` commands, Rust and adapter tests                      | verified |
| Review operations                                   | Accept, Request Changes, Mark Reviewed, Open File, Copy Diff tests     | verified |
| Desktop and in-app notifications                    | Notification bridge, service policy, navigation E2E                    | verified |
| Notification-to-Session navigation                  | Typed targets, transition tests, E2E                                   | verified |
| Local project persistence                           | Tauri Store adapter and reload/restart tests                           | verified |
| Executable installer                                | Portable EXE, NSIS installer, launch probe, SHA-256 record             | verified |
| Roadshow data                                       | Deterministic fixtures, data guide, script, deck, and backup video     | verified |
| Folder picker, real Branch/Status/Diff              | Tauri dialog plus read-only native Git commands                        | verified |
| System-open directory and file                      | Root/path-constrained opener commands and UI error tests               | verified |
| Terminal output simulation                          | Typed Command events and structured Commands tab; no command execution | verified |
| Session follow-up simulation                        | Validated follow-up transition, component and E2E tests                | verified |
| Automatic Agent status changes                      | Three-step deterministic playback with speed control                   | verified |
| Notification rules                                  | Persisted Waiting, Completed, and Failed settings                      | verified |

## Explicit Exclusions

| Excluded capability                       | Enforcement evidence                                           | Status   |
| ----------------------------------------- | -------------------------------------------------------------- | -------- |
| Real Claude, Codex, or Gemini CLI control | No process/CLI adapter exists; providers are mock/display-only | excluded |
| Native CLI Session recovery               | No recovery interface or command exists                        | excluded |
| PTY terminal                              | No PTY dependency or native command exists                     | excluded |
| Git worktree automation                   | No worktree command exists                                     | excluded |
| Multi-Agent workflow runtime              | No workflow executor exists                                    | excluded |
| MCP server integration                    | No product runtime integration exists                          | excluded |
| Skill marketplace                         | No product runtime integration exists                          | excluded |
| Node-drag workflow                        | No workflow surface exists                                     | excluded |
| Automatic Commit or Merge                 | Native Git surface is read-only                                | excluded |
| Cloud account or sync                     | No network/account dependency exists                           | excluded |
| Team collaboration                        | No remote collaboration model exists                           | excluded |
| Real token/cost accounting                | No provider runtime or billing model exists                    | excluded |
| Full editor, plugins, remote Agent host   | System-open is used instead; no such runtime exists            | excluded |

Gemini remains visible in frozen data because the PRD requires three provider identities. Its
capability is `displayOnly: true`; all Session mutation controls are disabled for Gemini.

## User Stories

| Story                        | Acceptance evidence                                                         | Status   |
| ---------------------------- | --------------------------------------------------------------------------- | -------- |
| US-001 Add project           | Picker, validation, Git inspection, tree insertion, persistence/reload      | verified |
| US-002 View project Sessions | Expandable tree shows provider, title, status, and detail links             | verified |
| US-003 View Agent status     | Text/icon semantics and synchronized tree/dashboard transitions             | verified |
| US-004 View history          | User, Agent, command, file, test, approval, and status events sort by time  | verified |
| US-005 View code changes     | Added/modified/deleted/renamed list, line Diff, binary fallback             | verified |
| US-006 Handle Attention      | Cross-project aggregation, navigation, read state, approve/reject           | verified |
| US-007 Receive notifications | Waiting/Completed policy, desktop adapter, disable setting, deep link       | verified |
| US-008 Review changes        | Accept and Request Changes persist feedback, review state, status, Timeline | verified |

## Surfaces

| Surface                 | Required contents and actions                                                                                    | Status   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- |
| Primary navigation      | Command Center, Projects, Needs Attention, Notifications, Settings; Changes is an additional direct review entry | verified |
| Command Center header   | Product, current date, Add Project, Create Simulated Task                                                        | verified |
| Status metrics          | Running, Attention, Completed Today, Failed; each links to a result                                              | verified |
| Active Sessions         | Maximum six; provider, title, project, status, action, duration, file count                                      | verified |
| Attention preview       | Priority-ordered and bounded to five items                                                                       | verified |
| Project Matrix          | Running, Waiting, Completed, Failed, changed-file totals                                                         | verified |
| Recent Activity         | Session/status, command, file, test, waiting/completion, and derived Review activity                             | verified |
| Projects                | Add/remove/open, search/sort, all eight required project-card fields                                             | verified |
| Project detail          | Overview, Sessions, Changes, Activity, Configuration                                                             | verified |
| Session header          | Title, provider, project, status, action, start, duration, files, tests                                          | verified |
| Session actions         | Send Message, Approve, Reject, Stop, Open Project, Review Changes                                                | verified |
| Session tabs            | Timeline, Changes, Tests, Commands, Context                                                                      | verified |
| Command details         | Command, status, exit code, duration, output summary                                                             | verified |
| File-change details     | Relative path, status, additions, deletions                                                                      | verified |
| Test details            | Command, passed, failed, duration                                                                                | verified |
| Approval details        | Request, risk, decision                                                                                          | verified |
| Changes list and viewer | Status/path/line counts/review state, unified Diff, line numbers, context                                        | verified |
| Review controls         | Accept, Request, Mark Reviewed, Open File, Copy Diff                                                             | verified |
| Request Changes dialog  | Required feedback, severity, immediate rerun option                                                              | verified |
| Attention               | All/Approval/Input/Review/Failure/Completed and every specified shortcut                                         | verified |
| Notifications           | Seven event types, title/message/time/project/session/read/target, read/clear tools                              | verified |
| Settings General        | Theme and English/Simplified Chinese language persist; default directory is truthful; startup is Coming Soon     | verified |
| Settings Notifications  | Desktop enable plus Waiting, Completed, and Failed rules                                                         | verified |
| Settings Demo           | Reset, play/pause/step, `0.5x`/`1x`/`2x` speed                                                                   | verified |
| Settings About          | Version, description, technology stack, provider runtime scope                                                   | verified |

## State And Data

| Requirement                                                      | Direct evidence                                                            | Status   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| `idle/running/waiting/completed/failed/stopped`                  | Shared `SessionStatus` contract and transition tests                       | verified |
| Waiting creates Attention, Notification, Timeline                | Demo step-one transition test                                              | verified |
| Approval resumes Running                                         | Attention and Demo transition tests                                        | verified |
| Completion creates changes, Test, Notification, Review Attention | Demo completion test                                                       | verified |
| Failure remains recoverable                                      | Frozen failure, retry/dismiss actions, Git error handling                  | verified |
| Project model                                                    | Shared contract adds source/status/normalized path needed for local safety | verified |
| Agent and Session models                                         | Shared contracts match PRD fields                                          | verified |
| Seven Timeline types                                             | Exhaustive discriminated union and renderer                                | verified |
| FileChange model                                                 | Status, line counts, text/binary data, review state                        | verified |
| Attention model                                                  | Five types, four priorities, read/resolved state                           | verified |
| Notification model                                               | Tone plus seven semantic events and typed navigation target                | verified |

The Request Changes section says “Review Event”, while the data-model section fixes exactly seven
Timeline types and contains no `review` variant. The implementation keeps the authoritative union:
review feedback is a `user_message`, state movement is a `status` event, `FileChange.reviewStatus`
stores the review decision, and Command Center derives the visible Review activity label.

## Architecture And Modularity

| Requirement                               | Direct evidence                                                                                  | Status   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| Tauri 2, React, TypeScript, Vite, Rust    | Manifests and production build                                                                   | verified |
| Router, Lucide, lightweight Diff renderer | Dependencies and module implementations                                                          | verified |
| Local JSON-style persistence              | Versioned snapshot through Tauri Store                                                           | verified |
| Rust core isolation                       | Workspace and Project native modules behind typed adapters                                       | verified |
| Frontend module ownership                 | `workspace`, `projects`, `sessions`, `changes`, `attention`, `notifications`, `settings`, `demo` | verified |
| Public module boundaries                  | Module `index.ts` APIs plus ESLint deep-import prohibition                                       | verified |
| Shared contracts                          | Domain contracts live under `src/core/contracts`                                                 | verified |
| Typed cross-module events                 | `appEventBus` contract and tests                                                                 | verified |
| No framework-for-framework substitution   | React Context/services replace optional Zustand; CSS tokens replace optional Tailwind            | verified |

The PRD command names and folder tree are architectural suggestions. The implemented commands use
module-prefixed names and narrower arguments while preserving each required capability.

## Interaction, Visual, Performance, Security

| Requirement                                                                  | Direct evidence                                                            | Status   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| Every click has feedback; no demo dead buttons                               | Navigation/actions covered by component and E2E tests                      | verified |
| Every user-triggered async action has Loading and duplicate-click prevention | Local pending labels/spinners or global Saving status; pending-state tests | verified |
| Remove requires confirmation                                                 | Shared confirmation dialog and tests                                       | verified |
| Request Changes requires content                                             | Disabled submit plus transition validation                                 | verified |
| Status synchronization                                                       | Event bridge and transition/E2E assertions                                 | verified |
| Attention deep-links to Session                                              | Typed routes and tests                                                     | verified |
| Empty states offer next action                                               | Projects, Changes, Attention, Notifications tests                          | verified |
| Understandable errors                                                        | Structured native errors and recoverable component tests                   | verified |
| Coming Soon is explicit                                                      | Startup setting badge; unsupported runtimes are disabled/display-only      | verified |
| Dark, dense desktop-tool visual language                                     | Default token theme and fixed shell layout                                 | verified |
| Status/provider color semantics                                              | Token contract test and provider classes                                   | verified |
| 1200 minimum, 260 sidebar, 48 title bar                                      | Tauri/CSS geometry contract test                                           | verified |
| 1280x720 and 1440x900 usability                                              | Dual-viewport E2E with overflow assertions                                 | verified |
| Cold start below five seconds                                                | Rebuilt EXE launch probe                                                   | verified |
| Page transition below 300 ms                                                 | Browser-clock E2E across all six primary destinations                      | verified |
| 100 Sessions usable                                                          | Deterministic fixture and bounded tree/dashboard tests                     | verified |
| 500 Timeline events usable                                                   | Batch-render test exposes 100 at a time                                    | verified |
| Git does not block UI                                                        | Three native Git commands use `spawn_blocking`; Rust contract test         | verified |
| Git failure does not crash                                                   | Structured error/fallback tests                                            | verified |
| No uploads, keys, Agent shell, or real Approval execution                    | Static command/dependency audit and absent interfaces                      | verified |
| No reads outside project relative path                                       | Canonical roots, component rejection, symlink/path traversal Rust tests    | verified |
| Git is read-only                                                             | Only repository/status/diff APIs exist; no mutation command is registered  | verified |
| No sensitive file-content logging                                            | No application logging sink exists                                         | verified |

## Demo And Deliverables

The detailed Demo Scenario defines six Sessions as 2 Running, 1 Waiting, 2 Completed, and 1 Failed.
The later roadshow shorthand says 3 Running, 2 Waiting, and 1 Failed for the same six Sessions. Both
cannot be true simultaneously. The implementation follows the more specific per-project/per-Session
scenario and preserves two Completed Sessions needed by Completed Today and review flows. This is a
`resolved-conflict`, not an omitted state.

| Requirement                                                            | Direct evidence                                     | Status   |
| ---------------------------------------------------------------------- | --------------------------------------------------- | -------- |
| Three named projects and six named Sessions                            | Frozen fixture and data guide                       | verified |
| Claude timeout flow, four changes, approval, tests, completion, review | Three-step playback and tests                       | verified |
| Codex dependency approval and status synchronization                   | Attention E2E                                       | verified |
| Five-minute seven-step roadshow                                        | `demo-script.md` and backup video                   | verified |
| Tauri source                                                           | Repository                                          | verified |
| Windows installer                                                      | `artifacts/release/Astra-Nexus-0.1.0-x64-setup.exe` | verified |
| Portable executable                                                    | `artifacts/release/Astra-Nexus-0.1.0.exe`           | verified |
| README and product PRD                                                 | Repository root                                     | verified |
| Prototype guide and demo data guide                                    | `docs/product`                                      | verified |
| Roadshow PPT and demo script                                           | `artifacts/demo` and `docs/product/demo-script.md`  | verified |
| Backup demo video                                                      | `artifacts/demo/Astra-Nexus-backup-demo.mp4`        | verified |
| Known issues and roadmap                                               | `docs/product/known-issues.md`, `roadmap.md`        | verified |

Release artifact hashes and the latest test totals are recorded in `release.md`. The complete gate
summary is recorded in `workbench-acceptance.md`.
