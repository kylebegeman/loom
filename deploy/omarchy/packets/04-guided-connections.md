# 4. Guided connections

One resumable flow explains app sessions, private network and shared AI setup.

Status: **approved**. Complexity: **Medium**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#1](01-discoverable-loom-action-menu.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Discover existing app and CLI authorizations without copying browser credentials.
- Open required app approval pages automatically and guide private network/hub setup.
- Expose connected, approval-needed, unavailable, retry and revoke/forget states.

## Acceptance

- Resume partial setup after cancellation or restart without repeating completed approvals.
- Check expired device codes, revoked sessions, server/hub outage and unavailable Secret Service.
- A person can complete ordinary setup without entering shell commands or pasting scripts.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
