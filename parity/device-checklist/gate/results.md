# Old-client gate checks (H-FMT-2), results

Verification 06 §C. One line per check and device: `DEV-id | device | OS | build | pass/fail | note`.
Aggregates only, no board content, ids or accounts (verification 06 §1).

## Round 1: dev, 2026-10-18 (owner)

The dev backend is kashi-human on this workstation: lbs 722f443 and lekhjs 4b66731 (round BF1, `MCP_GENERATOR_FORM` unset, so `lua`), with the format gate on.
The owner reported the results in chat. The old app was the **Mac Catalyst** app (3.5.x, exact build not stated). The new client was the TS web app under development, on this branch.

| DEV-id | device | OS | build | pass/fail | note |
|---|---|---|---|---|---|
| DEV-11 | Mac | macOS (not stated) | Mac Catalyst 3.5.x + TS web | pass (partial) | Owner: "The old client could connect and collaborate"; "The new and old clients could collaborate"; "The old client could add Lua shapes and could work on that board". No refusal, no kick on the 4.x board. The `doc.info.version` test-hook frame was not run |
| DEV-08 (Mac Catalyst variant) | Mac | macOS (not stated) | Mac Catalyst 3.5.x | pass | Owner: "Once the new client opened the board containing lua shapes, the old client was not able to load that with the correct error." kashi log: 2 `format_stamped{origin:'ws', version:'5.0'}` (TS web), then 3 `format_gate_refused{compat:4}` on those 2 boards. No MCP-origin stamp |
| DEV-08 | iPhone/iPad | — | iOS 3.5.3 | not run | — |
| DEV-09 | Android | — | Android 3.5.x | not run | — |
| DEV-10 (Mac Catalyst variant) | Mac | macOS (not stated) | Mac Catalyst 3.5.x + TS web | pass | Owner: "The live kick also worked on Mac". The old app had the board open when the TS client stamped it 5.0, and it was kicked with the gate message at once. iOS not run |
| DEV-12 (Mac Catalyst) | Mac | macOS (not stated) | Mac Catalyst 3.5.x | pass | "Download a copy" of a 5.0 board: the app shows its generic error, "Unable to download" (the OQ-23 default). Recorded in the KB changeset, `/backend/subsystems/documents.md` §3.4.1. iOS and Android not run |
| DEV-17 (Mac Catalyst) | Mac | macOS (not stated) | Mac Catalyst 3.5.x | pass | The old app renders text from a TS-created shape (`fontfamily: "Noto Sans"`) in the system default font, as expected. The owner's iOS-specific result (DEV-17 asks for iOS) and Android are not run |

Observation: opening a Lua board with write access in the TS client was enough to stamp it 5.0 (the conversion on load). The owner accepted this on 2026-10-18 ("If new clients stamp a board with version 5 and this board does not open in old client then that should be acceptable").

## Round 2: production, after H-FMT-1

Not run yet.
