# Astra Nexus Workspace Shell

A Tauri 2 desktop prototype for selecting, remembering, and reopening local workspaces before entering a modular AI coding workbench shell.

## Scope

This repository implements the Workspace and App Shell P0 from `AI-Coding-Workbench-Workspace-PRD (1).md`. It deliberately does not implement an editor, terminal, Git, diff, chat, or AI agent execution.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Rust 1.77.2 or newer with the MSVC toolchain on Windows
- WebView2 on Windows

## Install and Run

```powershell
npm install
npm run tauri dev
```

Frontend-only checks can run without Rust:

```powershell
npm run format
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
```

Native validation:

```powershell
cd src-tauri
cargo check
cargo test
```

## Architecture

- `src/core/contracts`: frozen cross-module data contracts
- `src/core/events`: typed notification bus
- `src/core/registry`: static workbench module registry
- `src/modules/workspace`: recent workspace service, adapters, Context, and UI
- `src/app/shell`: layout-only title bar, activity rail, slots, and status bar
- `src-tauri/src/modules/workspace.rs`: read-only path inspection and availability checks

The UI talks only to `WorkspaceService`. Tauri Dialog, Store, and Rust commands are isolated behind adapters. The selected project directory is never written to or deleted.

## Manual Acceptance

1. Delete the app data `workspaces.v1.json` and start the app. Verify the empty Recent Workspaces state.
2. Select **Open Folder**, cancel the native dialog, and verify the page does not change or show an error.
3. Select a readable local folder. Verify the shell displays its name and path.
4. Return to Projects, select the same folder again, and verify only one recent row exists with a newer timestamp.
5. Add a second folder, restart the app, and verify both rows persist in newest-first order.
6. Move one folder outside the app, restart, and verify the row is marked Missing and cannot open.
7. Use **Remove from Recent** and verify the confirmation says local files are not deleted. Confirm and verify the folder still exists on disk.
8. At 1280x720 and 1440x900, verify there is no horizontal scrollbar and long paths truncate with a native title tooltip.
9. Navigate the Projects screen by keyboard and verify visible focus indicators.

## Dependencies

- `@tauri-apps/plugin-dialog`: native directory selection
- `@tauri-apps/plugin-store`: recent workspace metadata persistence
- `lucide-react`: accessible, consistent interface icons
- Vitest and Testing Library: service and user-visible component tests
- Playwright: viewport and screenshot acceptance tests

Implementation references and requirement evidence live in `docs/product/`.
