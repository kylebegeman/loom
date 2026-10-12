# 18. Resilient private AI hub

Improve private AI availability while Switchboard remains authoritative for every route.

Status: **approved**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#4](04-guided-connections.md), [#5](05-capability-aware-availability.md).

## Scope

- Explain hub readiness, account constraints and model eligibility using centralized cached status.
- Add explicitly supported wake/readiness controls and evaluate secondary capacity when useful.
- Explore local-model routes only through Switchboard, after hardware/task-quality measurements.

## Acceptance

- Verify asleep/offline/constrained/ineligible states without polling providers from each client.
- Check wake support, cancellation, timeout and route ownership with synthetic fixtures.
- Secondary/offline routing preserves existing subscription/client restrictions and has no direct-provider fallback.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
