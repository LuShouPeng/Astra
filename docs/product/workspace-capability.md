# Workspace Capability Contract

## Capability

Local developers can select, remember, reopen, and safely remove recent workspace references, then enter a stable desktop workbench whose only cross-module project context is `ActiveWorkspace`.

## Constraints

- The app reads path metadata only. It never edits, deletes, renames, or writes metadata into a selected project.
- Native folder selection uses Tauri Dialog; persistence uses Tauri Store; path inspection is owned by Rust commands prefixed `workspace_`.
- `normalizedPath` is the uniqueness key. Windows drive-letter case, separator differences, and trailing separators cannot create duplicates.
- Missing directories cannot become active. Removing a recent item cannot touch the directory.
- Agent, session, terminal, Git, diff, editor, account, cloud, plugin marketplace, and multi-window capabilities are non-goals.
- Shell modules consume `ActiveWorkspace` and shared contracts only. No module may read the workspace store directly.

## Implementation Contract

- Actors: local developer; future workbench modules.
- Surfaces: Projects welcome page; native folder picker; recent workspace list; workbench shell.
- States: loading, empty, ready, selected, pending, warning, missing, active.
- Transition: Projects -> choose/reopen -> validate -> persist -> active shell -> close -> Projects.
- Store: `workspaces.v1.json`, schema version 1, ISO 8601 timestamps.
- Failures: structured workspace errors; corrupt store falls back to an empty list with a non-blocking warning.

## Non-goals

No editor, terminal, AI process, source control, diff, project file tree mutation, remote workspace, or project creation flow.

## Evidence Required

- AC-01 through AC-08 automated where possible and manually verified in Tauri for native dialogs/restart.
- `format`, `lint`, `typecheck`, unit coverage, production build, and `cargo check` pass.
- Screenshots at empty, populated, shell, and missing states for 1280x720 and/or 1440x900.

## GitHub Implementation References

- Tauri React TypeScript template: https://github.com/tauri-apps/create-tauri-app/tree/dev/templates/template-react-ts
- Tauri v2 Dialog plugin: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/dialog
- Tauri v2 Store plugin: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/store
- IntelliJ recent-project language and behavior: https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources-en/src/messages/ActionsBundle.properties
- VS Code activity bar layout: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/activitybar/activitybarPart.ts
- VS Code Explorer failure/refresh behavior: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/views/explorerView.ts
- Eclipse Theia workspace/module boundaries: https://github.com/eclipse-theia/theia/tree/master/packages/workspace

These sources inform API usage, state semantics, and module boundaries. No brand assets or source implementation are copied.
