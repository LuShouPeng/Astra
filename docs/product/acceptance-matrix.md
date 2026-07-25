# Workspace P0 Acceptance Matrix

| Requirement                           | Automated evidence                      | Manual evidence                             |
| ------------------------------------- | --------------------------------------- | ------------------------------------------- |
| AC-01 cold start and empty state      | Welcome page component test             | Empty-state screenshot                      |
| AC-02 choose and open valid directory | Service adapter test; shell render test | Native picker walkthrough; shell screenshot |
| AC-03 normalized-path deduplication   | Service unit test                       | Select same folder twice                    |
| AC-04 persistence and recent ordering | Service reload test                     | Restart Tauri app                           |
| AC-05 missing path blocked            | Service and UI tests                    | Missing-state screenshot                    |
| AC-06 remove is metadata-only         | Adapter interaction test                | Verify fixture directory remains            |
| AC-07 picker cancellation             | Service unit test                       | Cancel native picker                        |
| AC-08 responsive layout               | Browser viewport assertions             | 1280x720 and 1440x900 screenshots           |
| WS-09 ActiveWorkspace boundary        | Context/shell test; import review       | Module registration walkthrough             |
| WS-10 static module registry          | Registry unit test                      | Workspace module renders in shell           |
| WS-11 loading/error/pending states    | Component tests                         | Visual review                               |
| WS-12 shared tokens/accessibility     | Token-contract and accessibility tests  | Keyboard walkthrough                        |
