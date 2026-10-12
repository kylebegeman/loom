# 5. Capability-aware availability

Show what can actually be used when parts of the ecosystem are unavailable.

Status: **approved**. Complexity: **Medium**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#4](04-guided-connections.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Extend the existing status widget using app-owned offline and pending-change capability reports.
- Distinguish cached reading, supported writing, live search, AI and owning workstation availability.
- Reject stale status after suspend and offer explicit recovery without resubmitting work.

## Acceptance

- Verify disconnected, partially connected, revoked and reconnect states against app-owned contracts.
- Inspect status with keyboard and pointer; do not rely only on color.
- Polling stays bounded and never refreshes provider usage or performs inference.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
