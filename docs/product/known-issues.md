# Known Issues And Limits

## Release

- Windows binaries are unsigned, so SmartScreen may show an unknown-publisher warning.
- The installer is current-user NSIS only. MSI and managed deployment packages are not included.
- macOS and Linux packages have not been produced or verified.

## Prototype Runtime

- Claude and Codex are deterministic mocks; Gemini is display-only. Native CLI discovery,
  execution, and Session recovery are intentionally absent.
- Theme and language selectors are display-only. System-startup integration is marked Coming soon.
- Keyboard shortcuts beyond normal browser/desktop focus behavior are deferred.
- Desktop notifications depend on Windows permission and focus policy; application notifications
  remain available when permission is denied.

## Data And Git

- Demo Sessions and diffs are frozen fixtures. Local projects provide read-only Git information but
  are not associated with real Agent Sessions in this prototype.
- Diff output is intentionally bounded, and binary files show metadata instead of a preview.
- Project removal clears registry metadata only and never deletes the directory.

## Presentation

- The backup video is a silent UI walkthrough intended for roadshow recovery, not a narrated
  tutorial.
