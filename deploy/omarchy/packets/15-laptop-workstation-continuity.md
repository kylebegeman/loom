# 15. Laptop/workstation continuity

Preserve access to work across devices while background jobs remain on their owning workstation.

Status: **approved**. Complexity: **Large**. Impact: **High**.

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

No completion evidence yet. Approved scope remains open.
