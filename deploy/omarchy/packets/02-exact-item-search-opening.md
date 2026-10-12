# 2. Exact-item search opening

Open the selected Office record or Atlas source directly in its existing app window.

Status: **approved**. Complexity: **Medium**. Impact: **High**.

Owner: Office and Atlas with LoomOS adapters. Dependencies: [#12](12-shared-app-integration-contract.md).

## Scope

- Apps own stable authenticated record routes; retain the destination through login.
- Finder passes the selected record identity to the app without treating excerpts or queries as URLs.
- Existing app windows navigate rather than duplicate; absent/deleted/inaccessible items explain recovery.

## Acceptance

- Open each supported Office record type and Atlas source from native search.
- Check signed-out handoff, unavailable records and existing-window reuse.
- Verify route behavior in Linux and the shared web/Mac experience.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

No completion evidence yet. Approved scope remains open.
