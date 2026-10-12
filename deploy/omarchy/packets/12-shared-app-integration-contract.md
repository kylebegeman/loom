# 12. Shared app integration contract

Apps describe their supported OS capabilities instead of making LoomOS guess their internals.

Status: **approved**. Complexity: **Large**. Impact: **High**.

Owner: Office and Atlas with LoomOS adapters. Dependencies: None.

## Scope

- Extend existing app-owned registries/contracts for actions, stable links, search, capture, notifications and availability.
- Keep authorization, validation and business operations inside each owning app.
- Provide version negotiation, unavailable-capability behavior and reusable adapters without a second product runtime.

## Acceptance

- Verify compatible, older, missing and malformed capability declarations.
- Typecheck and behavior-test affected producers and consumers across supported surfaces.
- Integrate at least Office and Atlas through the same contract without weakening their permissions.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
