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
EBD1DE5D7C2E65BFD447DBC73BB796835602F9656EE903CFE7F8E1F1A9A29906  Astra-Nexus-0.1.0-x64-setup.exe
6866CD66AE5B04AD1696772E62F18076F7755CA996C79950FD6E0564DF4132A0  Astra-Nexus-0.1.0.exe
14A9CADB534124B3A0E06D6AA417EDA4DADCE9382A7BD6F1C5BAAFB1E8243CC3  Astra-Nexus-backup-demo.mp4
D8085F94261D7F8229395B04258C7F4D4FBA1A17E187D50F9B718BE156174DD9  Astra-Nexus-Roadshow.pptx
```

## Verification Record

- Portable EXE launched with window title `Astra Nexus` and reported a responsive process.
- NSIS generation completed with current-user install mode.
- Frontend verification passed 124 unit/component tests and 22 E2E tests across both configured
  desktop viewports.
- Rust formatting and all five native unit tests passed before packaging.
- Demo MP4 fully decoded and was visually sampled across all application scenes.
- PPTX was rendered and visually inspected slide by slide; speaker notes contain source blocks.
- Final frontend, E2E, Rust, and release gates are recorded in `workbench-acceptance.md`.
