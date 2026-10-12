# 3. Destination-aware capture

Capture once, choose Office or Atlas and review before saving.

Status: **approved**. Complexity: **Medium**. Impact: **High**.

Owner: Office and Atlas with LoomOS adapters. Dependencies: [#12](12-shared-app-integration-contract.md).

## Scope

- Preview clipboard/selected text and supplied links with a supported destination picker.
- Office retains reviewed Note, Reminder and Desk flows; Atlas exposes a reviewed source capture flow.
- Retain capture through login; provide loading, error, cancellation and duplicate-submission handling.

## Acceptance

- Use literal text, Unicode, links and supported length limits across both destinations.
- Cancel without writing or fetching a supplied URL.
- Verify signed-out return, server failures and supported offline behavior.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
