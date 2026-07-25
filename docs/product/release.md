# Release 0.1.0

## Artifacts

| Artifact                                            | Purpose                           |
| --------------------------------------------------- | --------------------------------- |
| `artifacts/release/Astra-Nexus-0.1.0.exe`           | Portable Windows executable       |
| `artifacts/release/Astra-Nexus-0.1.0-x64-setup.exe` | Current-user NSIS installer       |
| `artifacts/demo/Astra-Nexus-Roadshow.pptx`          | Eight-slide roadshow deck         |
| `artifacts/demo/Astra-Nexus-backup-demo.mp4`        | 1280x720 H.264 backup walkthrough |

The Windows binaries are unsigned.

## Build

```powershell
npm ci
npm run tauri build -- --bundles nsis
```

The native outputs are created under `src-tauri/target/release/` and
`src-tauri/target/release/bundle/nsis/`.

## SHA-256

```text
2EC067339DDF3C5F70381F38403C89F02C6819ABA0C54F2229D2F2FFD6EAD5FA  Astra-Nexus-0.1.0-x64-setup.exe
9152EA850A16060760FBCA3C56C3BEA44B0FEC56B4C3C4826DDB2C92085E0FB6  Astra-Nexus-0.1.0.exe
14A9CADB534124B3A0E06D6AA417EDA4DADCE9382A7BD6F1C5BAAFB1E8243CC3  Astra-Nexus-backup-demo.mp4
D8085F94261D7F8229395B04258C7F4D4FBA1A17E187D50F9B718BE156174DD9  Astra-Nexus-Roadshow.pptx
```

## Verification Record

- Portable EXE launched with window title `Astra Nexus` and reported a responsive process.
- NSIS generation completed with current-user install mode.
- Frontend verification passed 143 unit/component tests and 26 E2E tests across both configured
  desktop viewports, including persistent Simplified Chinese selection.
- Rust formatting and all six native unit tests passed before packaging.
- Demo MP4 fully decoded and was visually sampled across all application scenes.
- PPTX was rendered and visually inspected slide by slide; speaker notes contain source blocks.
- Final frontend, E2E, Rust, and release gates are recorded in `workbench-acceptance.md`.
