# 17. Coordinated updates and recovery

Present compatible component updates and their recovery mechanisms without surprising active work.

Status: **completed**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#9](09-omarchy-compatibility-checks.md), [#10](10-reproducible-loomos-setup.md), [#13](13-native-workstation-control-desk.md).

## Scope

- Describe component versions, channels, compatibility and expected restart/interruption.
- Preserve existing component release ownership and custom fork origin; coordinate supported maintenance around active work.
- Expose stage/apply/verify/recover states and appropriate rollback boundaries per component.

## Acceptance

- Check incompatible versions, offline metadata, interrupted updates, active jobs and recovery.
- Never silently replace the fork with upstream or restart an active environment.
- Separate pack rollback, client update and system/package recovery guarantees.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented native Updates and recovery through the LoomOS Maintenance menu, searchable actions, app launcher and CLI. Compact cached status and manual refresh show actual component identities, unknown channels and recovery-kit alignment. Verified local pack/kit candidates support reviewed stage/apply/verify, exact interrupted retry, pack rollback and unapplied discard; receipts bind the candidate, baseline, displayed component plan and rollback identity.
- 345 focused pack tests pass on Mac and native Linux. Isolated fixtures and independent probes cover offline/incompatible metadata, tampered and stale receipts, active or unknown work, interrupted owner recovery before snapshot publication and refusal to overwrite separately advanced releases. Component-changing kits require a full authenticated local Loom work inventory, including archived threads and schedules; a bounded desk cannot prove idleness.
- Workstation runs verified pack 20261012.46, SHA256 ca25fdcdae453f85b5b2aec7046a9c7c163dd9013729ae6aa78c32fd9f94e8d2, with all 37 runtime members matching. Native candidate discovery, cached details, Cancel-first staging, Keep current before apply, reviewed apply/verify and actual .46 -> unmodified historical .43 -> .46 passed. Reapplication uses the newer trusted bundle manager. A legacy installer retired-record ownership defect discovered during this cycle was corrected and independently probed.
- Independent Mac and Workstation recovery kits match recipe SHA256 7882b57c32d966f480e9bef68f0564629305b96f075179e1d9cd97f5759faaa9 and preserve all five existing component inventories. Native kit staging, exact-plan review, apply and verification passed; all 16 commissioning checks report ready and all 12 native compatibility checks pass with zero errors.
- All 40 recorded file/mode checks, credentials, personal configuration, Iris Dark, gradient branding, DND off and active T3 service PID 319427 are preserved. Existing Office and Atlas windows were reused through owner handoffs; the stock system maintenance menu opened without mutation. These handoffs used the .45 UI, whose frozen bytes are identical in .46; the installed .46 entry point was inspected during final kit acceptance.
- Maintenance owns local integration packs and recovery kits. Hosted apps, system packages, provider accounts and server releases retain their existing owners and backup/recovery requirements; pinned server activation is separate. No real-provider inference, live component/server upgrade, forced interruption or new physical-machine acceptance was performed. Physical keyboard/readability acceptance remains open in packet #6; laptop/suspend checks are deferred and packet #14 remains excluded.
- Final acceptance and exact supporting receipts: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/maintenance/native-acceptance-final46.json. Independent recovery and ownership proofs are in recovery/source-receipt-20261012.46.json, review-probes.json and ownership-review-probes.json in that artifact directory. Unrelated T3/Switchboard edits remain preserved and outside this release.
