# 11. Contextual actions and AI workbench

Operate on deliberately selected context and review results before handing them to an app.

Status: **approved**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#3](03-destination-aware-capture.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Support selected text, files, screenshots and app-provided context with explicit preview.
- Reuse supported Loom/app actions and Switchboard routing; show owning environment and failure/retry states.
- Allow reviewed copying, capture and app actions with retained provenance and original permissions.

## Acceptance

- Check context selection, cancellation, size/type failures and routing eligibility.
- No action silently captures unrelated app data or falls back to a direct provider.
- Verify complete explanation, summary and capture workflows with synthetic inference before authorized live acceptance.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
