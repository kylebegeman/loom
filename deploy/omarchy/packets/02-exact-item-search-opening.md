# 2. Exact-item search opening

Open the selected Office record or Atlas source directly in its existing app window.

Status: **completed**. Complexity: **Medium**. Impact: **High**.

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

- Exact-item routes and existing-window handoff are implemented in LoomOS, Office and Atlas. Apps own authorization and stable links; login preserves destinations, Office uses its ordinary resolver, and Atlas retains immutable source versions and saved output revisions. Unsent writing defers navigation with explicit open/dismiss controls.
- Focused regressions cover deleted/inaccessible records, changed editorial revisions, revoked evidence, foreign/ambiguous routes, owner isolation, election/deduplication, unsupported capabilities and uncertain delivery. Packaged synthetic app acceptance covers login return, retained Desk/Mail writing and exact selected item opening across shared browser clients.
- Workstation runs committed pack 20261012.23, manifest SHA256 c5c5323f17b64388bfa9191f718b7cc80fca5fbefe5aece140cd657bd9d5a6e0. All 25 members are reviewed; pack checks pass. Installation preserves connection configuration, Iris Dark, personal shortcuts and running t3code.service PID 1152. Original and recent retained packs remain available for recovery.
- Actual native Chromium fixtures pass cold launch, existing-window reuse, immutable Atlas source/output selection and the nonce-specific temporary-window fallback through the current Hyprland Lua API. Native Find Office selected a live Desk result and opened it in its original signed-in window. Empty Atlas search, both picker cancellations, repeated ordinary launches and the installed compatibility report pass with original business windows preserved.
- Office source 892921de26debfb4021a2eb67d44cbda401ae220 is deployed as revision 20261012-154536. Protected preparation passed 1019 UI tests, isolated database/recovery proofs, 33 browser journeys (one documented skip), image/smoke and all live release checks. Native Check for updates and Update Office delivered exact interface 550d084ce361fe5851cc with an activated worker and no waiting update.
- Office device retention failure was traced to one irrecoverable snapshot backing file. A private IndexedDB copy was retained; only that server-derived record was removed after confirming drafts/outbox were empty. Retry rebuilt it and all stores read successfully. The source regression separates optional retention errors from real connection failures; the delivered native window has neither warning. No profile, credentials, other stores or writing were cleared.
- Atlas checked source 0c42f8b740343cde5d5368b8da0b846721676b38 is deployed in the compact pinned runtime release-20261012-worker-fix-0c42f8b-runtime, with service/commission plans 18-worker-runtime. The legacy cached shell could not update because its worker URL returned HTML. The checked JavaScript compatibility route now waits for explicit APPLY_UPDATE, claims then unregisters without cache/record deletion. Required checks and failing-before-fix/lifecycle regressions pass; the compact runtime and verified full-history source bundle are retained.
- Atlas original-key verification, fresh encrypted pre-release capture/retrieved restore and installed-release commissioning passed, preserving 36 tables and two archive documents. Service and backup timer run at login; the timer reports exit 0 and maintenance has no alerts. Original keys, retained releases, accepted backups, paused intake and Files grants are preserved. Native Update delivered exact interface 8e66519e171798615b94 into the original signed-in window. A guarded normal refresh detached the compatibility controller; registration/controller counts are zero and the retained shell cache remains.
- Atlas signed-in personal workspace currently contains no saved sources or outputs. Successful immutable item opening is proven with native fixtures; personal saved-item acceptance is unavailable until suitable records exist. No personal test records or provider inference were created. Evidence and current rollout handoff: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/exact-items. Packet #3 is not started; #14 stays excluded.
