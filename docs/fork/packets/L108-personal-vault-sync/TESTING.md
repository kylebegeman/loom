# L108 testing

Status: Designing. Acceptance targets, not executed implementation tests. Parent: [Personal Vault](../LOOM-PERSONAL-VAULT.md).

## Existing evidence verified by source inspection

- `apps/server/src/fork/vault/VaultCore.test.ts:94` covers archive/restore/delete version preconditions, not personal replication or anti-resurrection.
- `apps/server/src/fork/vault/OpenBaoStore.test.ts:226` tests service-token reread after rotation, not personal engine re-key.
- `packages/client-runtime/src/fork/vault-core.permissions.test.ts:42` covers destination-scoped write permission and revocation for current environment commands.

These tests/assertions were read, not run. No services, credentials, browsers or dev servers were used. [L102](../L102-personal-vault-custody/) evaluates maintained engines, KDBX 4 first candidate; tests must target the selected engine's actual format/key hierarchy/sync behavior, never a custom replacement protocol.

## Proposed automated tests

| Future test file                                                           | Concrete behavior and failure cases                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/client-runtime/src/fork/personal-vault-sync-engine.test.ts`      | Whole-database/KDBX: independently open encrypted engine output, verify actual factors/KDF/native re-key and supported conflict-copy/merge/deletion behavior. Maintained record engine: exercise its native cache, sync, conflicts, delete and device/rotation facilities. Missing capability returns unsupported; no record-key/DAG/signature protocol is invented for the adapter.                    |
| `packages/client-runtime/src/fork/personal-vault-sync-cache.test.ts`       | No synthetic plaintext labels/values at rest; trusted offline unlock; lock/sleep/background clear views; corrupt engine data, missing custody, clock continuity loss, quota/eviction and interrupted native save report durable versus unsaved work accurately.                                                                                                                                         |
| `packages/client-runtime/src/fork/personal-vault-sync-reconcile.test.ts`   | Whole-file races retain both encrypted copies; test documented engine merge for conflicting passwords, attachments, history and delete-versus-edit. Returning stale complete DB may contain deleted items/old permissions: block automatic republishing and report unknown/unsupported reconciliation when necessary. Record-engine tests use its actual native conflict/tombstone/retention semantics. |
| `apps/server/src/fork/personal-vault-sync/service.test.ts`                 | Opaque engine ciphertext only; cross-owner/storage-object requests denied; owner-scoped inspect/cancel/close; bounded transfer buffers/pages; ID/digest idempotency; disconnect after accepted write inspects receipt before retry; receipt never asserts engine integrity, current personal authority or all-device convergence.                                                                       |
| `apps/server/src/fork/personal-vault-sync/lifecycle.test.ts`               | Supported enrollment cancel/expiry and storage-session revoke; complete DB copied key remains usable for old copies after unlink. Native re-key crash/cutover preserves recoverable data with no automatic old-key fallback. Device-specific cryptographic revoke is unsupported where absent; record-engine guarantees tested only through its real API.                                               |
| `packages/client-runtime/src/fork/personal-vault-sync.permissions.test.ts` | Read-only sessions cannot mutate; destination checked at execution; engine/format/native absence unsupported; manual and scheduled providers share metadata/outcome service gates; command-only jobs denied.                                                                                                                                                                                            |
| `packages/contracts/src/fork/personal-vault-sync.test.ts`                  | Proposed coordination payload/transfer bounds, unknown adapter/version, invalid storage references and sanitized errors; no key/factor/raw-value fields or secret canaries.                                                                                                                                                                                                                             |

Controlled clocks cover rollback/forward jumps, suspend, reboot without continuity and local unlock deadlines. A whole-database key does not expire because a local timer elapsed. A valid stale database can pass integrity: test comparison with a known independent version and explicit freshness-unknown when no evidence remains. No test may claim a cryptographic revocation frontier the engine lacks. Use Deferreds, receipts or worker drains where relevant, never sleep/poll to establish a milestone.

Native/extension acceptance additionally tests installation identity, arbitrary same-user client denial, app/extension replacement, user-presence cancellation, locked-device behavior, QR exposure and uninstall/reinstall. Native target names remain unknown pending inventory; TypeScript cannot prove OS isolation. Use synthetic secrets only.

## Exact future commands, not run

These paths are **proposed and absent at design time**. Run after implementation creates them, against the actual selected engine adapter:

```sh
vp test run packages/client-runtime/src/fork/personal-vault-sync-engine.test.ts packages/client-runtime/src/fork/personal-vault-sync-cache.test.ts packages/client-runtime/src/fork/personal-vault-sync-reconcile.test.ts packages/client-runtime/src/fork/personal-vault-sync.permissions.test.ts packages/contracts/src/fork/personal-vault-sync.test.ts apps/server/src/fork/personal-vault-sync/service.test.ts apps/server/src/fork/personal-vault-sync/lifecycle.test.ts
vp lint packages/contracts/src/fork/personal-vault-sync.ts packages/client-runtime/src/fork/personal-vault-sync.ts apps/server/src/fork/personal-vault-sync apps/web/src/fork/personal-vault-sync apps/mobile/src/fork/personal-vault-sync apps/desktop/src/fork/personal-vault-sync
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
vp run --filter @t3tools/desktop typecheck
vp run lint:mobile
```

Lint actual modified registries/native files once enumerated. Installed-engine/native interoperability commands require that engine/target inventory; none is guessed here. Current package names/scripts were verified. No repository-wide checks.

## Manual and integrated acceptance, not performed

After implementation and browser/device authorization, use a disposable Mac/iPhone Vault with Safari/Chromium trusted integrations. Exercise supported engine offline saves, conflicting edits and delete-versus-edit; inspect conflict copies and unsupported merge states. Remove a device while offline, confirm old whole-database keys still open old copies, perform supported re-key/storage cutover and inspect reconnection. Repeat clock rollback and server loss. L109 must recover a native backup without this relay; L88 infrastructure restore must contain no personal factors. Check every inspect/cancel/close/lock/pause/resume path, accessibility, remote modes and absent/older capabilities. Record Android/Windows/Linux/web unsupported outcomes until their native acceptance exists.

## Design checks and merge safety

Check seven-file completeness, relative links, precise source anchors, engine-dependent proposal labels and whitespace. Targeted formatting and link/reference results are returned with the design. No application tests or merge rehearsal were run. Implementation records focused results and the reviewed merge preview; the integrating owner handles authorized clean-main rehearsal. No live migration is part of this acceptance.
