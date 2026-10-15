# 15. Laptop/workstation continuity

Preserve access to work across devices while background jobs remain on their owning workstation.

Status: **verification_pending**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#2](02-exact-item-search-opening.md), [#4](04-guided-connections.md), [#5](05-capability-aware-availability.md), [#16](16-coherent-offline-ecosystem.md).

## Scope

- Extend existing T3 remote access and app links with explicit handoff and profile-aware behavior.
- Support suspend/reconnect and graceful offline availability with no duplicate running agents.
- Keep laptop background/battery behavior configurable and workstation hosting explicit.

## Acceptance

- Verify laptop/phone handoff, workstation continuity, revoked device and reconnect.
- Perform physical sleep/wake, Wi-Fi transitions and battery checks on applicable hardware.
- Different clients never open competing servers against the same live database.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented Device continuity in the native launcher, Loom actions and AI/connections menu. It pins the workstation public T3 environment identity to a private HTTPS tailnet origin and checks it again before open or exact thread handoff. Config contains no credentials. Identity changes, outages, unreadable settings and revoked/absent owner access do not substitute a host or start a local server. Forget removes only the shortcut; device revocation remains in Loom Settings > Connections.
- The control desk and CLI expose reviewed exact thread/Office/Atlas handoff with Cancel-first link copying and QR output. Threads must match the saved owning environment; app destinations reuse existing authorized item resolvers and same-origin validation. Destination login, pairing, grants and permissions remain with the owning products. No credentials, data or local databases move between devices, and handoff starts no agent.
- Laptop mode starts no background host; explicit existing workstation hosting and pairing remain owner-controlled. Native power selection discovers only installed advertised powerprofilesctl modes, confirms the reviewed current state and normal desktop unlock, then verifies the OS result. Unsupported tools retain the ordinary OS power menu. Refresh/reconnect and existing suspend-aware availability do not replay work; app-local offline state stays in the owning profiles.
- All 381 pack tests and scoped lint pass. The continuity, shortcut, desk and exact-item suites pass 62 tests on Workstation against frozen .50 code. Fixtures prove constrained private origins, reviewed host identity changes, network failures, refusal/invalid/oversized metadata, exact environment-bound links, app permission refusal, cancel-first clipboard input, unsupported power tools, changed/locked power state and no laptop pairing or automatic work replay. Restore absence and interrupted restoration have focused regressions.
- Workstation runs verified pack 20261013.51 with 39 members, SHA256 a9fbcc5e59a89bd42f2e6988e260d3fec08783c55d0d4d2318e821815faddf9f, and ready commissioned recipe 501bda61ae369178e25f5c03efd1266951ec3475dc947ed9070b594d9d9603ef. Independent Mac/Linux kit verification and normal owner staging/apply passed with no changed component inventory. Native reviewed save pins Workstation to its actual existing environment; exact thread review and QR rendering, native menu opening and .51 to .50 rollback/reapplication passed. The existing Atlas window, 39 recorded file/mode checks, Iris Dark, power profile and T3 PID 1154 are preserved.
- An isolated Mac receiving client inspected the real private HTTPS descriptor, pinned the same host and generated exactly the same thread URL. The owner web route loaded HTTP 200; the receiving client remained unauthenticated and the protected read returned 401/403. This proves the link grants no access; no credential or server was copied and no inference occurred. Physical phone scanning, revoked-device UI recovery, laptop/phone authenticated handoff, lid/suspend/wake, Wi-Fi transition and battery acceptance remain unverified on applicable hardware. Native virtual-input and display-scale proof are recorded with packet #6, separately from physical keyboard acceptance.
- Isolated running-server pairing and recovery acceptance passes: unpaired reads return 401, one-time pairing grants protected reads, credential replay returns 401, owner revocation closes the existing WebSocket and refuses reads/new tickets, fresh pairing restores the same project/thread workspace, and the old grant remains revoked. Test grants are cleaned up. This is actual server protocol proof, not authenticated physical device handoff or recovery UI proof. T3 Browser panel snapshot attempts timed out twice, so browser UI recovery remains unverified. Workstation remains at user-requested scale 1 with pack 20261013.52; physical phone scan/handoff, laptop lid/wake, Wi-Fi, battery and keyboard checks remain pending because no hands-on hardware is available.
