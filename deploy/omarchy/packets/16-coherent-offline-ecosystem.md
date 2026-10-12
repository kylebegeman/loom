# 16. Coherent offline ecosystem

Make applicable saved reading and writing reliable in the shared Office and Atlas products.

Status: **approved**. Complexity: **Massive**. Impact: **Transformational**.

Owner: Office and Atlas with LoomOS adapters. Dependencies: [#12](12-shared-app-integration-contract.md).

## Scope

- Implement app-owned saved content, supported local edits, durable pending changes and reviewed conflicts.
- Align Linux and Mac behavior; LoomOS reports app capabilities instead of adding a separate sync engine.
- Include storage management, account separation, failure/reconnect and explicit unsupported operations.

## Acceptance

- Exercise stopped-server reading/writing, restart persistence, reconnect, conflicts and duplicate retries with isolated state.
- Verify supported workflows on Linux and Mac; do not equate browser cache with durable offline support.
- Record app-specific limitations and check migrations through the owning product workflow.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
