# 13. Native workstation control desk

See and manage existing background work, failures and approvals from Omarchy.

Status: **approved**. Complexity: **Large**. Impact: **High**.

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

No completion evidence yet. Approved scope remains open.
