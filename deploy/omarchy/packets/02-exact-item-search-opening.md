# 2. Exact-item search opening

Open the selected Office record or Atlas source directly in its existing app window.

Status: **verification_pending**. Complexity: **Medium**. Impact: **High**.

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

- Exact-item routes and origin-local existing-window handoff are implemented across LoomOS, Office and Atlas. Office reuses its ordinary item resolver; Atlas resolves immutable source versions and saved output revisions through existing scoped readers. Sign-in retains the destination.
- Focused tests cover deleted or inaccessible records, changed editorial revisions, revoked evidence, foreign or ambiguous routes, owner isolation, receiver election, deduplication and uncertain-delivery refusal. Incoming items defer while writing or an editor is open.
- Required Office make check passed with 1,017 UI tests and 65 scripted cases; Atlas make check passed with 502 UI tests. Scoped PostgreSQL-backed Atlas exact-item/search race tests passed. Real producer declarations and installed search/capture/exact-item dispatch passed.
- Pack checks passed with 129 tests, and 91 focused Linux ARM tests passed. Compiled ARM clients validate the actual resolver argv and payloads. Actual retained .14 upgrade, rollback and return passed on Mac and Linux with custom preferences, configuration and synthetic data preserved.
- Packaged synthetic browser acceptance passed for both apps: signed-out destination retention and missing items, existing-window navigation, exact source versions, unsent Desk/Mail preservation and explicit pending-result opening. Browser-refused temporary-window closing is handled by a nonce/class-specific Linux adapter; live Hyprland acceptance is pending.
- Prepared immutable pack 20261012.20, SHA256 39c7775ba31b3310b327df05e2b404665e9657569838a4b49f071a91f25e47ae. Office next and Atlas next contain their owning implementation. App-service publication through existing protected release workflows and Workstation deployment/native acceptance remain pending; Workstation SSH timed out. Source pushes and compiled clients are not deployed app releases.
- Runtime, portable clients, source backups and rollout evidence are retained in /Users/kyle/Developer/artifacts/loom-os/2026-10-12/exact-items. No inference, production-record changes, networking changes, new runtime or live agent/hub restart was used.
