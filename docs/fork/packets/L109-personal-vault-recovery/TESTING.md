# L109 testing

Status: Designing. Future acceptance targets; implementation tests/recovery exercises have not run. Parent: [Personal Vault](../LOOM-PERSONAL-VAULT.md).

## Existing evidence verified by source inspection

- `apps/server/src/fork/vault/OpenBaoStore.integration.test.ts:53` checks restored backend versions; `:149` preserves revoked grants already captured in that backup. Conditional backend tests do not establish personal recovery or latest-revocation reconciliation.
- `apps/server/src/fork/vault/VaultCore.test.ts:94` checks archive/restore/delete versions, not an offline personal restore.
- `apps/server/src/fork/vault/VaultAccess.test.ts:233` checks permanent revoke; `:472` checks service-restart persistence, not freshness after loss of the latest authority state.

These files/assertions were read, not executed. No services, credentials, browsers or dev servers were used. Tests follow [L102's maintained-engine decision](../L102-personal-vault-custody/TECHNICAL.md#engine-format-and-keys), KDBX 4 first candidate, not selected. No mandatory custom recovery key/archive/authority protocol is tested into existence.

## Proposed automated tests

| Future test file                                                               | Concrete behavior and failure cases                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/client-runtime/src/fork/personal-vault-recovery-kit.test.ts`         | Kit identifies the actual selected engine factors/format. Whole-database candidate: correct password/key-file/composite requirements, missing/wrong factor and nonportable convenience key. Record engine: its documented recovery factor/tool behavior. Independent open/read-back; cancellation and no raw factors in logs/receipts. Unsupported factor recovery remains explicit.                                       |
| `packages/client-runtime/src/fork/personal-vault-recovery-backup.test.ts`      | Engine-native consistent encrypted export independently opens with expected items/attachments/history/deletion data. Report omissions and conflict copies. Native integrity/parser rejects truncated/tampered/unsupported/oversized inputs and resource abuse without changing an existing profile; archive path defenses apply only to actual engine archive formats.                                                     |
| `packages/client-runtime/src/fork/personal-vault-recovery-restore.test.ts`     | Offline clean-device restore without server; surviving-device and all-devices-lost cases; missing factors/data unrecoverable. Storage-full, cancel, crash/restart and interrupted re-key leave controlled recoverable data, no plaintext staging files and truthful cleanup outcomes. File-write receipt alone does not mean verified backup.                                                                              |
| `packages/client-runtime/src/fork/personal-vault-recovery-authority.test.ts`   | Stale complete DB can pass integrity and contain old data/permissions; imported grants/sessions stay disabled. Missing current evidence remains isolated or uses a separately initialized/re-keyed replacement with fresh supported storage access. Old DB/key still works after unlink/metadata retirement. Record-engine revoke/recovery behavior tested only through documented supported APIs; no fabricated frontier. |
| `apps/server/src/fork/personal-vault-recovery/service.test.ts`                 | Owner-scoped metadata only; foreign operation requests denied; coordination receipts do not assert cryptographic integrity/current authority; ID/digest idempotency and unknown-outcome inspection; cancel/close cannot claim external file deletion.                                                                                                                                                                      |
| `packages/client-runtime/src/fork/personal-vault-recovery.permissions.test.ts` | Destination/read-only/metadata grant ceilings, missing engine/native capability, same manual/scheduled provider gates, no command-only jobs and no kit/export/decrypt tool.                                                                                                                                                                                                                                                |
| `packages/contracts/src/fork/personal-vault-recovery.test.ts`                  | Bounded proposed safe receipts/status, sanitized errors and no secret/factor/canary fields in serialization.                                                                                                                                                                                                                                                                                                               |

For whole-database recovery, explicitly prove that old factors may open an old backup after current database re-key. Verify the new engine-native database needs its current factors, with no automatic fallback that republishes the old file. Restored timestamps/digests/receipts do not prove current revocation state. Use controlled clocks and deterministic crash milestones, Deferreds, receipts or worker drains where relevant, never sleeps/polling. A format round trip alone is not clean-device recovery proof.

Native tests need inventory-defined targets for installation trust, arbitrary same-user agent denial, secure input/files, device lock/background, key invalidation, removable export, print/share cleanup and uninstall/reinstall. No guessed native command is presented as verified. Synthetic fixtures only.

## Exact future commands, not run

These files are **proposed and absent at design time**. Run after implementation creates them using the selected maintained engine:

```sh
vp test run packages/client-runtime/src/fork/personal-vault-recovery-kit.test.ts packages/client-runtime/src/fork/personal-vault-recovery-backup.test.ts packages/client-runtime/src/fork/personal-vault-recovery-restore.test.ts packages/client-runtime/src/fork/personal-vault-recovery-authority.test.ts packages/client-runtime/src/fork/personal-vault-recovery.permissions.test.ts packages/contracts/src/fork/personal-vault-recovery.test.ts apps/server/src/fork/personal-vault-recovery/service.test.ts
vp lint packages/contracts/src/fork/personal-vault-recovery.ts packages/client-runtime/src/fork/personal-vault-recovery.ts apps/server/src/fork/personal-vault-recovery apps/web/src/fork/personal-vault-recovery apps/mobile/src/fork/personal-vault-recovery apps/desktop/src/fork/personal-vault-recovery
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
vp run --filter @t3tools/desktop typecheck
vp run lint:mobile
```

Package names/scripts were checked in current manifests. Add actual changed registry/native files to focused lint. Independent engine/native open commands require the selected implementation/target inventory. Existing OpenBao integration tests require an authorized disposable backend and were not launched. No repository-wide checks.

## Manual and integrated acceptance, not performed

After implementation and browser/device authorization, use a disposable Mac/iPhone Vault with Safari/Chromium trusted launch routes. Prepare actual engine factors/kit, keep backup and factors independently, and recover on a clean compatible client with server unavailable. Repeat after losing every trusted device and after a storage/device revoke newer than the backup. Inspect obsolete items/permissions, isolation/replacement options and accurate missing-capability states. Test factor replacement/re-key, backup retention/removal, downstream credential repair and all inspect/cancel/close/revoke paths; restart during export/cutover.

Check supported remote status and absent/older server capabilities while proving local recovery remains independent. Record Android/Windows/Linux/standalone-web unsupported states until native acceptance exists. Separately restore development infrastructure under L88 and verify it cannot unlock personal content. Never claim per-device cryptographic revoke for a whole-database key.

## Design checks and merge safety

Check completeness, links, source anchors, engine-dependent proposal labels and whitespace after targeted formatting. No application tests or merge rehearsal were run. Implementation records focused results and reviewed merge preview; authorized clean-main rehearsal belongs to the integrating owner. No live recovery or personal migration is implied.
