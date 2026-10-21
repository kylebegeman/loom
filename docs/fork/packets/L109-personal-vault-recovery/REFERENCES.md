# L109 references

Status: Designing. Current source inspected on 2026-10-21 at HEAD `36de6bbd1d3bb6fb5ad9b04252c9be05416658f5` in a shared checkout. Refresh line references before implementation. No network fetch or external code/assets used.

## Product and overlap

[Personal Vault umbrella](../LOOM-PERSONAL-VAULT.md) tracks shared proposed scope. This is new proposed scope pending Kyle's priorities, not an Old Loom P/F implementation or individually selected packet.

[L108](../L108-personal-vault-sync/) owns proposed cache/sync/device lifecycle; [L88](../L88-vault-recovery/) owns development-server recovery; [L79](../L79-vault-core/) owns server-readable encrypted records; [L81](../L81-vault-grants/) owns development policy; [L85](../L85-vault-delivery/) owns delivery gates; [L87](../L87-vault-lifecycle/) owns issuer-specific rotation/revocation. [L103 library](../L103-personal-vault-library/), [L104 imports/exports](../L104-personal-vault-imports/), [L106 sessions](../L106-personal-vault-agents/) and [L107 native](../L107-personal-vault-native/) own content/export/use limits. These links describe overlap, not completed personal APIs or circular dependencies.

## Current source

[L102 engine/format evaluation](../L102-personal-vault-custody/TECHNICAL.md#engine-format-and-keys) is authoritative for the maintained-engine comparison; KDBX 4 is the first candidate, not a selected dependency. Use actual engine-native keys, integrity, encrypted backup/sync and authority facilities; missing capabilities stay unsupported.

- [`apps/server/src/fork/vault/OpenBaoStore.ts:186`](../../../../apps/server/src/fork/vault/OpenBaoStore.ts#L186), [`apps/server/src/fork/vault/VaultCore.ts:149`](../../../../apps/server/src/fork/vault/VaultCore.ts#L149): server-readable values; personal custody cannot be inferred from backend encryption or Redacted.
- [`apps/server/src/fork/vault/OpenBaoStore.integration.test.ts:53`](../../../../apps/server/src/fork/vault/OpenBaoStore.integration.test.ts#L53), [`:149`](../../../../apps/server/src/fork/vault/OpenBaoStore.integration.test.ts#L149): existing backend restore/version and captured-revocation assertions; read only, not run.
- [`apps/server/src/fork/vault/VaultAccess.ts:270`](../../../../apps/server/src/fork/vault/VaultAccess.ts#L270): revoked development grants cannot be reactivated; this is not rollback-resistant personal authority.
- [`apps/server/src/fork/vault/VaultAccess.test.ts:233`](../../../../apps/server/src/fork/vault/VaultAccess.test.ts#L233), [`:472`](../../../../apps/server/src/fork/vault/VaultAccess.test.ts#L472): current revocation/restart tests read, not run.
- [`packages/contracts/src/fork/rpc.ts:76`](../../../../packages/contracts/src/fork/rpc.ts#L76), [`apps/server/src/fork/rpcAuthorization.ts:62`](../../../../apps/server/src/fork/rpcAuthorization.ts#L62), [`packages/contracts/src/fork/clientRpcPermissions.ts:45`](../../../../packages/contracts/src/fork/clientRpcPermissions.ts#L45): existing fork contract and scope maps.
- [`apps/server/src/fork/ForkLayer.ts:429`](../../../../apps/server/src/fork/ForkLayer.ts#L429), [`apps/server/src/fork/rpc.ts:116`](../../../../apps/server/src/fork/rpc.ts#L116): server registration points, not a recovery service.
- [`apps/server/src/fork/mcp/index.ts:33`](../../../../apps/server/src/fork/mcp/index.ts#L33), [`apps/server/src/fork/cli/index.ts:8`](../../../../apps/server/src/fork/cli/index.ts#L8): current tool/CLI registries for metadata-only additions.
- [`packages/client-runtime/src/fork/capabilities.ts:13`](../../../../packages/client-runtime/src/fork/capabilities.ts#L13): graceful capability absence.
- [`apps/desktop/src/electron/ElectronSafeStorage.ts:54`](../../../../apps/desktop/src/electron/ElectronSafeStorage.ts#L54), [`apps/mobile/src/persistence/mobile-secure-storage.ts:22`](../../../../apps/mobile/src/persistence/mobile-secure-storage.ts#L22): storage wrappers without a verified independently trusted personal recovery boundary.

## Official external references

Official evaluation sources only; links were not fetched and no implementation dependency is selected:

- [KeePass KDBX 4](https://keepass.info/help/kb/kdbx_4.html): maintained-format candidate and actual composite-key/KDF/master-seed hierarchy, not a custom per-record format.
- [KeePass synchronization](https://keepass.info/help/v2/sync.html): documented whole-database synchronization/merge behavior to verify against the selected maintained implementation; not a universal no-conflict guarantee.
- [KeePass database keys](https://keepass.info/help/base/keys.html) and [security](https://keepass.info/help/base/security.html): actual factors, portability and key-possession limits. Device unlink cannot erase copied database keys.
- [Apple Keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web): native protection/access-control properties requiring verification, not assumed same-user-agent isolation.
- [Apple Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions) and [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): trusted integration packaging/boundaries needing inventory.
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) and [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/): installed wrapper behavior/limitations, not personal custody proof.
- [OpenBao Raft snapshot API](https://openbao.org/api-docs/system/storage/raft/): separate development infrastructure recovery relevant to L88, not personal recovery factors.

No external code/assets were copied. Actual engine/binding maintenance, license, platform support and independent format-open tooling require evaluation before selection. No dependency, credential, service or deployment change is introduced by this design.
