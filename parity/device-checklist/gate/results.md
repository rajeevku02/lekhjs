# Old-client gate checks (H-FMT-2), results

Verification 06 §C. One line per check and device: `DEV-id | device | OS | build | pass/fail | note`.
Aggregates only, no board content, ids or accounts (verification 06 §1).

## Round 1: dev, 2026-10-18 (owner)

The dev backend is kashi-human on this workstation: lbs 722f443 and lekhjs 4b66731 (round BF1, `MCP_GENERATOR_FORM` unset, so `lua`), with the format gate on.
The owner reported the results in chat. They didn't name the device, OS or old-app build, so those are recorded as "not stated".

| DEV-id | device | OS | build | pass/fail | note |
|---|---|---|---|---|---|
| DEV-11 | not stated | not stated | old app 3.5.x + TS client | pass (partial) | Owner: "The old client could connect and collaborate"; "The new and old clients could collaborate"; "The old client could add Lua shapes and could work on that board". No refusal, no kick on the 4.x board. The `doc.info.version` test-hook frame was not run |
| DEV-08 / DEV-09 | not stated | not stated | old app 3.5.x | pass (platform not stated) | Owner: "Once the new client opened the board containing lua shapes, the old client was not able to load that with the correct error." kashi log: 2 `format_stamped{origin:'ws', version:'5.0'}` (TS client), then 3 `format_gate_refused{compat:4}` on those 2 boards. No MCP-origin stamp. Whether Reload / Go Back behaved as specified was not stated |
| DEV-10 | — | — | — | not run | Kick of an old client that has the board open at the moment of the stamp: not reported separately |
| DEV-12 | — | — | — | not run | "Download a copy" of a 5.0 board (409 `board_requires_newer_app`, OQ-23 text): not reported |
| DEV-17 | — | — | — | not run | Old app showing a TS-created shape with `fontfamily: "Noto Sans"`: not reported |

Observation: opening a Lua board with write access in the TS client was enough to stamp it 5.0 (the conversion on load). The owner accepted this on 2026-10-18 ("If new clients stamp a board with version 5 and this board does not open in old client then that should be acceptable").

## Round 2: production, after H-FMT-1

Not run yet.
