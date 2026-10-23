# L110 technical design

Proposed work against `36de6bbd1d`; new paths/methods below are not existing APIs.

## Existing work to preserve

`apps/server/src/fork/vault/VaultHealthChecks.ts:27` checks declared expiry and development SSH/GitHub authentication. Its `:107` sweep is server-side work and must not be repurposed to unlock personal records. `packages/client-runtime/src/fork/vault-health.ts:37` explicitly describes development identity issues. Keep [L77](../L77-vault-health/) and [L87](../L87-vault-lifecycle/) distinct from personal analysis and account change.

`apps/server/src/fork/vault/VaultCore.ts:149` reveals server-readable values; it is not this packet's input API. `apps/server/src/fork/vault/OperationJournal.ts:25` offers reservation/unknown-outcome concepts, not an approved personal receipt service.

## Local analysis

Proposed personal-native maintenance worker consumes an unlocked, versioned local view through a verified custody interface. If absent, return unsupported. In an agent-host process it must not decrypt records; prefer an independent device or demonstrated OS isolation. No plaintext enters shared JavaScript atoms, RPC, MCP, telemetry or environment storage.

Compute reuse using a fresh keyed digest only within the trusted process, with the per-scan key kept ephemeral. Never persist/release deterministic password hashes, reuse fingerprints or a lookup oracle; equality groups can themselves be sensitive and remain encrypted locally. Compare exact password bytes, not normalized/case-folded passwords. Duplicate-record candidates use canonical origin/account identity plus selected exact fields and require human review. Usernames may normalize per actual provider policy; never assume every site is case-insensitive. Records differing only in metadata remain separate until reviewed.

Weakness is an explainable local estimate using a reviewed offline rule set/estimator. Password length/common-pattern flags are not entropy measurements or proof of safety. Package choice, dictionaries, licenses and resource budget are unresolved; evaluate existing generator primitives only if they exist and fit, without claiming their API. No leak-service query, including k-anonymity hash prefixes, is part of this scope. Scan in bounded batches, cancel on lock, invalidate a result when its input versions change and expose progress by completed count rather than a fabricated percentage.

## Reminder and finding storage

Use the selected maintained engine's supported encrypted local metadata/record facilities; missing persistence support means device-session-only analysis or unsupported retention, not a new crypto format. Proposed local records contain finding id/type, affected item IDs+versions, rule version, observed time, dismissal/snooze state and explicit expiry evidence source. Device notification payloads are generic; the local decrypted report is reachable only after unlock. Clean stale group indexes and pending notifications when records are removed or a device cache is wiped. Define retention and clear/reset analysis before enabling persistence. If encrypted sync primitives are available, sync encrypted finding preferences, not plaintext reports; otherwise stay device-local and explain it. No shell snapshot or Library integration.

## Rotation state machine

Proposed trusted-client journal separates two axes: remote operation state (unattempted/submitted/confirmed/failed/unknown) and local draft/save state (prepared/saved/conflict/failed/discarded). Bind plan id, item+version, exact origin/account, adapter+version, parameter digest, nonce, deadline and independent authority epoch. Reserve before one side effect; revalidate authority/version immediately before it. A provider receipt records what was changed and how it was verified without embedding credentials, response bodies or secret-bearing URLs. A user-confirmed manual step is labeled as such.

Save-after-remote success failure keeps the new value encrypted locally until repaired or explicitly discarded after a recovery warning. Save conflicts never overwrite the other device's edit. If the adapter permits overlap, record both credential versions and an explicit retire-old step; if not, explain interruption before commit. Cancel before submit discards the draft; cancel after submit requests stop only where supported and then reconciles. Revocation stops new operations and does not reverse a committed external change. Crash recovery looks up the existing operation rather than generating another replacement or resubmitting an unknown write.

## Contracts, clients and optional tools

Proposed `packages/contracts/src/fork/personal-vault-maintenance.ts` and matching client-runtime module model metadata status/cancellation only. Nonstreaming `loom.personal-vault-maintenance.status`/`.cancel` RPCs, if useful, carry opaque operation ID and expected revision, return redacted receipt status and include `EnvironmentAuthorizationError` plus unsupported/denied/locked/conflict/unavailable/unknown errors. Use the existing fork permission map, `createEnvironmentRpcCommand` and `permissionAtom` for environment mutations; that grant cannot approve a personal rotation.

Proposed web/mobile setup/status UI lives in their `src/fork/personal-vault-maintenance/` folders. Actual private report and approval UI stays in trusted custody. An optional common MCP status/cancel tool for all providers and scheduled agents requires explicit operation-level inspect/cancel authority; no list-all-personal-findings, reveal, scan or approval tool. Command-only jobs remain unsupported. Capability/version plus trusted-local availability gates actions. Missing proposed shared primitives produce unavailable, without imports from another packet's internals or assumptions about its schedule.

## Alternatives

Reject remote breach lookups, server-decrypted scans, automatic bulk rotation, and a green saved label standing in for a remote receipt. Native scheduled notifications and on-unlock scanning avoid host access and repeated network work. Critical personal custody and rotation require independent security review before real adoption.
