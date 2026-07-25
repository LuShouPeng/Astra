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
51BAAD793661DED85B564345F9A4430B046595C69BC231CD6EFCCF5C0C99453F  Astra-Nexus-0.1.0-x64-setup.exe
3915F88C85D1D2D6ABEB08312BB42F716CE3B0D73C973BB1A1219A84E89A1B77  Astra-Nexus-0.1.0.exe
14A9CADB534124B3A0E06D6AA417EDA4DADCE9382A7BD6F1C5BAAFB1E8243CC3  Astra-Nexus-backup-demo.mp4
D8085F94261D7F8229395B04258C7F4D4FBA1A17E187D50F9B718BE156174DD9  Astra-Nexus-Roadshow.pptx
```

## Verification Record

- Portable EXE launched with window title `Astra Nexus` and reported a responsive process.
- NSIS generation completed with current-user install mode.
- Frontend verification passed 173 unit/component tests and 30 E2E tests across both configured
  desktop viewports. Coverage passed at 87.95% statements, 80.72% branches, 87.82% functions, and
  89.27% lines.
- Rust formatting and all 32 native unit and integration tests passed before packaging.
- Demo MP4 fully decoded and was visually sampled across all application scenes.
- PPTX was rendered and visually inspected slide by slide; speaker notes contain source blocks.
- Final frontend, E2E, Rust, and release gates are recorded in `workbench-acceptance.md`.
