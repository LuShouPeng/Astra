# Astra Nexus

Astra Nexus is a local-first AI Coding Workbench prototype built with Tauri 2, React, TypeScript,
and Rust. It brings projects, deterministic Agent Sessions, attention items, notifications,
read-only Git inspection, and review decisions into one desktop control plane.

## Prototype Boundary

- Claude and Codex use deterministic local mocks. No Agent CLI is launched.
- Gemini is display-only and has no runtime adapter.
- Git operations are read-only. Review actions update prototype metadata only.
- Project content is not uploaded, API keys are not collected, and file access is confined to a
  registered project root.

## Included Workflows

- Command Center with status totals, six bounded Active Sessions, Attention preview, Project
  Matrix, and Recent Activity.
- Local project registration, persistence, search, sort, Git summary, safe open, and removal of
  registry metadata.
- Project detail with Overview, Sessions, Changes, Activity, and Configuration views.
- Session detail with Timeline, Changes, Tests, Commands, and Context deep links.
- Seven Timeline event types and deterministic Session/Attention/Notification synchronization.
- Unified text diff, binary fallback, Accept, Mark Reviewed, and Request Changes.
- Application and desktop notifications with per-event settings.
- Three-step demo playback with pause, single-step, reset, and `0.5x` / `1x` / `2x` speeds.

## Requirements

- Node.js 20 or newer and npm 10 or newer
- Rust 1.77.2 or newer with the MSVC toolchain on Windows
- WebView2 on Windows

## Install And Run

```powershell
npm ci
npm run tauri dev
```

Frontend-only development:

```powershell
npm run dev
```

## Five-Minute Demo

1. Open the populated demo workspace and review the Command Center.
2. Open Needs Attention and approve the dependency request.
3. Open the Claude timeout Session and inspect Timeline and Changes.
4. Open Settings > Demo, reset, then advance all three deterministic steps.
5. Open the completion notification, request changes, and return to Command Center.

The full talk track is in `docs/product/demo-script.md`. Frozen data and state transitions are
documented in `docs/product/demo-data.md`.

## Verification

```powershell
npm run format
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:e2e

cd src-tauri
cargo fmt --check
cargo test
```

Build the Windows release:

```powershell
npm run tauri build -- --bundles nsis
```

## Release Artifacts

- Portable executable: `artifacts/release/Astra-Nexus-0.1.0.exe`
- Current-user NSIS installer: `artifacts/release/Astra-Nexus-0.1.0-x64-setup.exe`
- Roadshow deck: `artifacts/demo/Astra-Nexus-Roadshow.pptx`
- Backup demo video: `artifacts/demo/Astra-Nexus-backup-demo.mp4`

The Windows binaries are unsigned. Checksums and reproducible build notes are in
`docs/product/release.md`.

## Architecture

- `src/core/contracts`: shared domain contracts
- `src/core/data`: versioned prototype persistence
- `src/core/events`: typed application event bus
- `src/modules`: public business-module boundaries
- `src/app/shell`: navigation and workbench layout
- `src-tauri/src/modules`: confined workspace and read-only Git adapters

Product scope, acceptance evidence, known issues, and the implementation roadmap live in
`docs/product/`.
