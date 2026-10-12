# 7. Respectful actionable notifications

Deliver meaningful notifications once, with a precise destination and clear attention rules.

Status: **completed**. Complexity: **Medium**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#2](02-exact-item-search-opening.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Coordinate existing app/browser/native delivery to avoid duplicate notifications.
- Provide quiet previews, originating-app identity, priority and focus-time behavior.
- Use app-owned record/thread destinations and preserve authorization boundaries.

## Acceptance

- Verify reminder, source and agent-approval handoffs to existing windows.
- Test duplicate delivery, privacy/quiet modes, inaccessible destinations and cancellation.
- Preserve native Omarchy notification presentation and platform-specific settings.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- LoomOS source c52f36eaa2 adds native Notifications/focus/history controls and coordinated silent thread alerts with private title previews off by default. The existing desktop retains banner presentation, DND and history; apps retain authorization and event ownership.
- 175 focused Loom client/contracts tests, scoped web typecheck/lint and all integration pack checks passed. The installed native client is 0.0.45-loomos.20261012.2; integration pack 20261012.34 is verified on Workstation. Native focus-menu interaction passed and restored the original off DND.
- Mounted Loom browser fixture produced a private silent approval alert, rejected a click after cancellation, and opened the exact thread from a fresh alert without changing its pending command request. It used a synthetic Notification constructor and no provider execution.
- Actual native Chromium Atlas notification fixtures prove one copy across two windows, cancellation, stale-click rejection, private generic text and exact immutable source/version opening into the existing workspace. An unavailable source opens no item and shows owning-app recovery guidance. Clicks used browser Notification events rather than the OS banner widget.
- Atlas ca82270 and private Iris 0.6.54 are released. Original recovery-key verification, encrypted pre-release restore proof and replacement backup timer proof/installation passed. The final service is running and its loaded timer exited 0. A fresh signed-in installed Atlas workspace opens on Workstation; prior root-class window is Switchboard.
- Actual integration rollback/forward .34 -> .33 -> .34 passed with verified runtime hashes and original off DND preserved. Unrelated provider/Switchboard edits remain uncommitted and excluded.
- Office cbfb5eb passed all 1,038 frontend tests, required server checks, strict isolated PostgreSQL/encrypted restore proof, 33 browser journeys (one documented optional passkey skip), exact production image and TLS/restricted-role smoke. Twenty entire-file Reminders runs pass after removing unrelated Calendar accessibility scans; cold-note filing and DOM-only editor fill races are proved and corrected. Same-day encrypted backup op-20261012-230739-euz33 and reviewed deployment op-20261012-231011-ccszi promoted revision 20261012-231011. Live verification passed all 91 immutable asset digests, interface 924e49ca52398dcecc18, unchanged migration head/count and native feed.
- An actual Office server-created due reminder produced one silent private native notification across two browser windows. Clicking its browser Notification event opened the exact authorized reminder in the existing workspace and closed the read copy. Native Atlas Updates reports up to date against private feed 55a5aa24cfeae4bbeacc.
- Installed Workstation Update Office delivery passed through an actual native pointer click, retaining the original signed-in window. The offered update disappeared and published Iris 0.6.54 navigation appeared; a subsequent check finished with no further update offer or error. This pass did not directly inspect the loaded DOM build/worker. Atlas already reports up to date. Final installed pack hashes match .34, DND remains off, private Office/Atlas readiness returns 200, Atlas service and backup timer are healthy, and ordinary Loom/Office/Atlas launches retain their existing windows. T3 service PID 1152 is unchanged; no provider inference or restart was used.
- Final evidence and resume state: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/notifications/progress.json. Notification click fixtures dispatched browser events, not OS-banner widget clicks; Loom used a synthetic Notification constructor. After-Quit Apple push, Mac update, real-phone accessibility and live-provider inference remain separate acceptance. Packet #14 remains excluded.
