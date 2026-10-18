# Old-client gate checks (H-FMT-2), results

Verification 06 §C. One line per check and device: `DEV-id | device | OS | build | pass/fail | note`.
Aggregates only, no board content, ids or accounts (verification 06 §1).

## Round 1: dev, 2026-10-18 (owner)

The dev backend is kashi-human on this workstation: lbs 722f443 and lekhjs 4b66731 (round BF1, `MCP_GENERATOR_FORM` unset, so `lua`), with the format gate on.
The owner reported the results in chat. The old apps were the **Mac Catalyst** app (3.5.x, exact build not stated) and the store releases **iOS 3.5.9** and **Android 3.5.9** (owner: "I tested with the version that is live on app store i.e. 3.5.9 for both iOS and Android"). Verification 06 asks for iOS 3.5.3. The owner waived it on 2026-10-18: "waive 3.5.3, mark it on my word". Every C++ build since 3.3.5 sends compat=4, so the gate treats them alike. The new client was the TS web app under development, on this branch.

| DEV-id | device | OS | build | pass/fail | note |
|---|---|---|---|---|---|
| DEV-11 | Mac | macOS (not stated) | Mac Catalyst 3.5.x + TS web | pass (partial) | Owner: "The old client could connect and collaborate"; "The new and old clients could collaborate"; "The old client could add Lua shapes and could work on that board". No refusal, no kick on the 4.x board. The `doc.info.version` test-hook frame was not run |
| DEV-08 (Mac Catalyst variant) | Mac | macOS (not stated) | Mac Catalyst 3.5.x | pass | Owner: "Once the new client opened the board containing lua shapes, the old client was not able to load that with the correct error." kashi log: 2 `format_stamped{origin:'ws', version:'5.0'}` (TS web), then 3 `format_gate_refused{compat:4}` on those 2 boards. No MCP-origin stamp |
| DEV-08 | iPhone/iPad (not stated) | iOS (not stated) | iOS 3.5.9 (App Store; 3.5.3 waived by the owner) | pass | Owner: "I can confirm the same behavior on iOS as well" (the same checks as the Mac rows): refused on a board the TS web stamped 5.0, with the gate message |
| DEV-10 (iOS) | iPhone/iPad (not stated) | iOS (not stated) | iOS 3.5.9 | pass | Owner: "I can confirm the same behavior on iOS as well" (the same checks as the Mac rows): kicked live when the TS client stamped the open board |
| DEV-11 (iOS) | iPhone/iPad (not stated) | iOS (not stated) | iOS 3.5.9 + TS web | pass (partial) | Owner: "I can confirm the same behavior on iOS as well" (the same checks as the Mac rows): co-editing a 4.x board, Lua shapes added from the old app. Test-hook frame not run |
| DEV-12 (iOS) | iPhone/iPad (not stated) | iOS (not stated) | iOS 3.5.9 | pass | Owner: "I can confirm the same behavior on iOS as well" (the same checks as the Mac rows): the generic download error on a 5.0 board (OQ-23 default) |
| DEV-17 | iPhone/iPad (not stated) | iOS (not stated) | iOS 3.5.9 | pass | Owner: "I can confirm the same behavior on iOS as well" (the same checks as the Mac rows): text of a TS-created shape in the system default font |
| DEV-09 | Android (not stated) | Android (not stated) | Android 3.5.9 (Play) | pass | Owner: "I can confirm same behavior on android as well": refused on a board the TS web stamped 5.0, with the gate message |
| DEV-10 (Android) | Android (not stated) | Android (not stated) | Android 3.5.9 | pass | Owner: "I can confirm same behavior on android as well": kicked live |
| DEV-11 (Android) | Android (not stated) | Android (not stated) | Android 3.5.9 + TS web | pass (partial) | Owner: "I can confirm same behavior on android as well": co-editing a 4.x board with Lua shapes. Test-hook frame not run |
| DEV-12 (Android) | Android (not stated) | Android (not stated) | Android 3.5.9 | pass | Owner: "I can confirm same behavior on android as well": the generic download error (OQ-23 default) |
| DEV-17 (Android) | Android (not stated) | Android (not stated) | Android 3.5.9 | pass | Owner: "I can confirm same behavior on android as well": the system default font (Roboto expected) |
| DEV-10 (Mac Catalyst variant) | Mac | macOS (not stated) | Mac Catalyst 3.5.x + TS web | pass | Owner: "The live kick also worked on Mac". The old app had the board open when the TS client stamped it 5.0, and it was kicked with the gate message at once. |
| DEV-12 (Mac Catalyst) | Mac | macOS (not stated) | Mac Catalyst 3.5.x | pass | "Download a copy" of a 5.0 board: the app shows its generic error, "Unable to download" (the OQ-23 default). Recorded in the KB changeset, `/backend/subsystems/documents.md` §3.4.1. |
| DEV-17 (Mac Catalyst) | Mac | macOS (not stated) | Mac Catalyst 3.5.x | pass | The old app renders text from a TS-created shape (`fontfamily: "Noto Sans"`) in the system default font, as expected. |

Observation: opening a Lua board with write access in the TS client was enough to stamp it 5.0 (the conversion on load). The owner accepted this on 2026-10-18 ("If new clients stamp a board with version 5 and this board does not open in old client then that should be acceptable").

## Round 2: production, after H-FMT-1

Not run yet.
