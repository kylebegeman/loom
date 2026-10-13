# 16. Coherent offline ecosystem

Make applicable saved reading and writing reliable in the shared Office and Atlas products.

Status: **completed**. Complexity: **Massive**. Impact: **Transformational**.

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

- Office and Atlas now own This device screens for retained reading, supported writing, pending changes, conflicts and storage. LoomOS exposes Review Office device and Review Atlas device through native availability, launcher, Loom actions, connections and CLI. Anonymous app/origin declarations expire after exactly seven days; profile counts remain unknown outside the owning app. No OS sync engine or browser database scraping was added.
- Office retains its existing replica/outbox with storage accounting, persistence requests, pending markers and reading cleanup that preserves unsaved writing and queued workspace copies. Full-text revision conflicts require review and a new replay key only after a positively rejected conflict; uncertain requests retain their original identity. Sending, AI, Calendar saves, cloud files and other unsupported writes remain online.
- Atlas adds opt-in complete-shell availability, owner/generation-separated IndexedDB, selected immutable reading/citations, retained private-source writing, plain briefs and unsent drafts. Reading is bounded to 256 items/32 MiB; writing and queued work to 256 items/8 MiB. Exact-key uncertain writes are held after 20 hours inside the existing 24-hour server idempotency window. AI, extraction, Files/Paperless, background jobs and publication remain online.
- Isolated Mac and native Linux acceptance passed four Office and two Atlas journeys per platform, covering cold capture/writing, persistence, protected reading cleanup, revision conflicts, exact replay and committed lost replies. Both actual fixture server processes were stopped for cold saved-reading/writing and queue/reconnect checks. Atlas native-CDP reconnect used its explicit Reconnect and sync control; Mac automatic replay passed. A 390px layout check found no horizontal overflow. No fixture inference, external publication or personal synthetic writes occurred.
- Office source 7a7865dd0a5e20f2dfe41eab36fa3bf437659694 passed 1,107 frontend tests, 407 strict PostgreSQL/recovery checks and 37 browser journeys, with only documented opt-in/passkey setup skips. Exact portable staging, a fresh encrypted backup, reviewed deployment and live verification passed. Production revision 20261013-045524 serves interface 6274a94e5ff6481dfb1b; all 119 asset hashes, unchanged signed native feed, verified database TLS/role and unchanged migration head/count 202610110049/131 passed. Production master was fast-forwarded only to that checked source.
- Atlas source ae22775edd57d66f24b32c504c307c4905bce97d passed 577 frontend tests and complete partitioned backend/static/build/provider gates: 316 top-level web tests passed and six normal opt-in skips remain. Earlier fixture-space and global-timeout attempts are retained rather than represented as a successful full make check invocation. Authority24 serves release e74e610a7117051951c7. Normal escrow verification, fresh encrypted capture/retrieved restore and replacement 60-second timer commissioning passed; the original key, retained authorities and backups remain intact. Its complete runtime/history is within the existing 64 MiB recovery bound.
- Workstation runs pack 20261013.47, SHA256 6264a026a0281d76c16a0cb90a871f95a2893c98df659de8f497c402b937ce15, with all 37 members verified. The matching commissioned kit recipe is 0fd9b0fe6d7db0b660c6cbd370dccb9be2ce56859891c3ee9cc66bde4fa402ae. All 360 pack tests and independent probes passed; actual .47 to .46 rollback and .47 reapplication passed. Five component inventories and all 40 recorded file/mode checks are preserved. Final readiness reports all 16 checks ready, compatibility zero errors/warnings, Iris Dark and active T3 PID 319427 unchanged.
- Installed Office and Atlas received the exact new builds through their normal Update controls. Fresh nonce-correlated metadata and visual inspection verified signed-in This device routes, and the native What works now screen opened both owners. Eight repeated open/device actions preserved one window per app at its existing address and all nine original window addresses. Personal Atlas offline opt-in remains unchanged; selected local retention is a user-owned choice. Laptop/physical keyboard acceptance stays in its existing deferred packets.
- Obsolete duplicate recovery/dependency artifacts freed about 3.33 GiB on the Mac in the measured cleanup interval. Additional unused test binaries, captured synthetic servers/databases, the owned native fixture browser/profile and exact SSH forwards were retired with ownership receipts; source, traces, accepted backup generations and current/rollback kits remain preserved. Btrfs shared extents prevent a multi-GiB physical-space claim on Workstation. Final acceptance, app release proofs and cleanup receipts are retained under /Users/kyle/Developer/artifacts/loom-os/2026-10-12/offline/. Concurrent Office Notes and Atlas performance work remains preserved and outside these app releases.
