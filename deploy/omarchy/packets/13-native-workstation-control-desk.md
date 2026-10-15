# 13. Native workstation control desk

See and manage existing background work, failures and approvals from Omarchy.

Status: **completed**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#2](02-exact-item-search-opening.md), [#7](07-respectful-actionable-notifications.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Read tasks and approvals from the existing T3/Loom environment and relevant app services.
- Expose exact-thread/job navigation and only supported controls; add explicit unavailable/reverse states.
- Keep execution in the owning service and avoid introducing a replacement Core/Runner.

## Acceptance

- Inspect running, waiting, failed, completed and disconnected states.
- Verify permission/approval behavior and exact-destination handoff.
- Confirm native refresh stays bounded and opening the desk starts no job or restart.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented the native workstation control desk through the LoomOS menu, launcher, Loom actions and CLI. It reads existing Loom threads/schedules, Office health/approval metadata and bounded authorized Atlas run metadata. Refresh is explicit and limited to once every five seconds; opening starts no job, approval, inference or service restart.
- Exact destinations and reviewed controls stay with their owners. Loom exposes exact-run interruption and schedule pause/resume; Atlas cancellation requires its advertised operation and current permissions. Approvals, retries and unsupported operator controls remain in their owning app with explicit reasons. Exact Loom threads use the existing web route with encoded namespaced IDs; native desktop has no supported exact-thread ingress.
- Atlas added atlas.runs.list and enforced existing evidence/history/private permission fencing on cancellation. Source f2742e75c961ecda54b832fe2785dc03c13b6a92 is deployed as release-20261012-workbench-f2742e7-runtime with service-plan-23-workbench and commission-plan-23-workbench. Its reviewed client is installed on Workstation. Required Atlas checks passed 105 script tests with eight documented opt-in skips, 529 frontend tests, server checks and four actual PostgreSQL metadata-bound/permission-race tests. No schema, dependency or Iris release was needed.
- Atlas original-key verification, fresh encrypted pre-release capture/retrieved restore proof f0efa664dabcb2ec1ab47baf844ce65dc4aca11e5f8f1e83048ccac8a94bf3c6 and installed commissioning passed. Private HTTPS advertises release d790ffe4532452249f7a; the service and 60-second backup timer are healthy, with first tick exit 0. Retained authorities and accepted backups remain available. The current authority guide is owned by Atlas.
- All 262 pack tests pass on Mac and native x64 Linux, including running/waiting/failed/completed/disconnected states, stale exact-run checks, missing controls, owner denial and refresh limits. Final review found that T3 MCP transport sessions lack idle expiry; bounded DELETE cleanup now releases each allocated session without changing the original operation outcome. Actual native read-only proof records two initialized/two terminated sessions, zero active jobs and unchanged service PID 319427.
- Final native desk shows connected Loom, Office and bounded Atlas sources and correct completed/failed rows. Selecting the Office failure shows unavailable stop/resume reasons. Exact Loom thread opening reached the owning web client and its ordinary browser pairing gate; signed-in browser thread rendering is not claimed. The acceptance browser was closed without touching personal app windows; a fresh .43 desk is left open for review. Existing Office backlog was recorded as a separate owner follow-up without retrying jobs or making approval decisions.
- Workstation runs immutable pack 20261012.43, manifest SHA256 c00943b7494a1192efc1fd6479e94b3f6de33de18a9b2b582f4f316d7e6f53c1. All 35 members verify and match installed bytes. Actual .43 to .42 rollback and .43 reapplication passed; no activation is pending. Native compatibility and connection health report zero errors and warnings.
- Independently built Mac and Workstation recovery kits match recipe SHA256 2eb0d8f90d8c77d19d295336271c6b939728b5de72c44485602cb27d69272f69. Supported commissioning reports all 16 checks ready and preserves all 40 recorded file/mode checks, Iris Dark, gradient branding, credentials, personal bindings and DND off. The existing Loom, Office, Switchboard and server inventories are reused; the reviewed Atlas client is pinned. Pack rollback and recovery refresh preserve running T3 PID 319427 and earlier kits.
- Evidence and scoped Office follow-up: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/workbench-desk/. The desk reads bounded metadata rather than broad Atlas state or conversation/evidence history. No replacement runner or execution authority was introduced. Packet #14 remains excluded.
