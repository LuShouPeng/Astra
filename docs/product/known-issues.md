# Known Issues And Limits

## Release

- Windows binaries are unsigned, so SmartScreen may show an unknown-publisher warning.
- The installer is current-user NSIS only. MSI and managed deployment packages are not included.
- macOS and Linux packages have not been produced or verified.

## Local Orchestration Runtime

- Claude and Codex require separately installed, authenticated CLIs. Gemini remains display-only.
- Natural-language planning falls back to a deterministic offline draft when no planning Provider
  is available.
- Conditions intentionally use a bounded grammar: boolean literals or `<node>.succeeded` /
  `<node>.failed`. Arbitrary script expressions and graph loops are rejected.
- MCP tools run through explicit workflow nodes and per-call approvals. Legacy SSE is unsupported.
- Provider resume restarts an interrupted node in its preserved worktree; transparent continuation
  of every Provider-specific conversation protocol is not guaranteed.
- Dark, Light, and System themes and the English/Simplified Chinese language selection are
  functional and persist locally. Additional languages are not included. System-startup
  integration remains marked Coming soon.
- Fixed interface copy and frozen demo content are localized. User-authored project, Session, and
  review text is intentionally preserved in its original language.
- Workbench navigation shortcuts are available, but there is no user-configurable shortcut editor.
- Desktop notifications depend on Windows permission and focus policy; application notifications
  remain available when permission is denied.

## Data And Git

- Simulation Sessions and diffs remain available as frozen fixtures when native Providers are not
  used.
- Final integration requires a clean user worktree and the same named branch that was active when
  the workflow run started.
- Diff output is intentionally bounded, and binary files show metadata instead of a preview.
- Project removal clears registry metadata only and never deletes the directory.

## Presentation

- The backup video is a silent UI walkthrough intended for roadshow recovery, not a narrated
  tutorial.
