# Full Workbench Acceptance Matrix

Source: `AI Coding Workbench 原型产品需求.docx`

Status values: `pending`, `implemented`, `verified`, `excluded`.

## Product Flows

| ID     | Capability                                                                | Required evidence                 | Status   |
| ------ | ------------------------------------------------------------------------- | --------------------------------- | -------- |
| US-001 | Add and persist a local project with Git information                      | Service, native and restart tests | verified |
| US-002 | Expand projects and open Agent Sessions                                   | Component and E2E tests           | verified |
| US-003 | Synchronize Session status across tree and dashboard                      | Transition and selector tests     | pending  |
| US-004 | Render all seven Timeline event types in time order                       | Contract and component tests      | verified |
| US-005 | Render changed files, text diff and binary fallback                       | Rust, adapter and component tests | pending  |
| US-006 | Process filtered Attention items and deep-link to Session                 | Store, component and E2E tests    | verified |
| US-007 | Emit configured desktop notifications and navigate from app notifications | Adapter and E2E tests             | pending  |
| US-008 | Accept or request changes and update Session/Timeline                     | Transition and E2E tests          | pending  |

## Pages And Modules

| Surface         | Minimum scope                                                                                           | Status   |
| --------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| Command Center  | Welcome header, four status totals, active Sessions, Attention preview, project matrix, recent activity | pending  |
| Projects        | Cards, add/remove/open, search, sort, Git/session/activity fields                                       | verified |
| Project detail  | Overview, Sessions, Changes, Activity, basic configuration                                              | pending  |
| Session detail  | Header, Timeline and Changes primary tabs, Tests/Commands/Context secondary tabs                        | pending  |
| Changes         | File statuses/counts, unified text diff, line numbers, review actions, binary fallback                  | pending  |
| Needs Attention | Six filters and type-specific actions                                                                   | verified |
| Notifications   | Seven notification events, unread state, typed navigation target, settings                              | pending  |
| Settings/About  | General, Notifications, Demo, version, description and stack                                            | pending  |
| App Shell       | Primary navigation, project/Session tree, content slot, responsive optional inspector                   | verified |

## P0 Release Gates

| Requirement                         | Status   |
| ----------------------------------- | -------- |
| Application starts without crashing | verified |
| All primary pages navigate          | pending  |
| Frozen demo data loads              | verified |
| Session detail opens                | verified |
| Timeline renders                    | verified |
| Diff renders                        | pending  |
| Needs Attention actions work        | verified |
| Desktop notification can trigger    | pending  |
| Windows installer builds            | pending  |

## P1 Release Gates

| Requirement                     | Status   |
| ------------------------------- | -------- |
| Add a local project             | verified |
| Read Git branch                 | verified |
| Read Git status                 | verified |
| Read real text diff             | pending  |
| Request Changes updates Session | pending  |
| Notification click navigates    | pending  |
| Projects persist after restart  | verified |

## P2 Polish Gates

| Requirement              | Status      |
| ------------------------ | ----------- |
| Motion and visual polish | pending     |
| Search and filters       | pending     |
| Actionable empty states  | implemented |
| Keyboard shortcuts       | pending     |
| Multiple themes          | pending     |
| Demo playback speed      | pending     |

## Cross-Cutting Gates

| Area            | Requirement                                                                | Status  |
| --------------- | -------------------------------------------------------------------------- | ------- |
| Interaction     | Every action has feedback; async actions show loading; no dead buttons     | pending |
| Validation      | Project removal confirms; Request Changes requires text                    | pending |
| Synchronization | Status updates dashboard, tree, Session, Attention and notifications       | pending |
| Performance     | Cold start <5 s; page feedback <300 ms; 100 Sessions and 500 events usable | pending |
| Security        | No upload/key storage/Agent command execution/Git write/out-of-root reads  | pending |
| Packaging       | Source, installer, executable, README, PRD and prototype documentation     | pending |
| Demo kit        | Data guide, script, slide deck, backup video, known issues, roadmap        | pending |

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
