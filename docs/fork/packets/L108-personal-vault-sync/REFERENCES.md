# L108 references

Status: Designing. Source inspected on 2026-10-21 at HEAD `36de6bbd1d3bb6fb5ad9b04252c9be05416658f5` in a shared checkout; reverify lines before implementation. No network retrieval or external code/assets used.

## Product and overlap

[Personal Vault umbrella](../LOOM-PERSONAL-VAULT.md) tracks shared proposed scope and Kyle's daily-use, autofill, scoped-agent and initial-platform priorities confirmed on 2026-10-21. This is new proposed scope, not an inherited Old Loom P/F selection or an individually selected packet. No old personal sync implementation was verified.

[L79](../L79-vault-core/) owns server records; [L81](../L81-vault-grants/) owns development grants; [L85](../L85-vault-delivery/) owns workload delivery; [L87](../L87-vault-lifecycle/) owns credential lifecycle; [L88](../L88-vault-recovery/) owns server recovery; [L109](../L109-personal-vault-recovery/) owns personal kits/restore. [L103 library](../L103-personal-vault-library/), [L104 imports/exports](../L104-personal-vault-imports/), [L105 browser](../L105-personal-vault-browser/), [L106 agents](../L106-personal-vault-agents/) and [L107 native](../L107-personal-vault-native/) own adjacent content/use flows. Overlap is coordination, not completed personal APIs or mandatory packet dependencies.

## Current source

[L102 engine/format evaluation](../L102-personal-vault-custody/TECHNICAL.md#engine-format-and-keys) is authoritative for the maintained-engine comparison; KDBX 4 is the first candidate, not a selected dependency. Use actual engine-native keys, integrity, encrypted backup/sync and authority facilities; missing capabilities stay unsupported.

- [`apps/server/src/fork/vault/VaultCore.ts:149`](../../../../apps/server/src/fork/vault/VaultCore.ts#L149): server-side reveal returns the loaded value. Personal independent custody is absent from this primitive.
- [`apps/server/src/fork/vault/OpenBaoStore.ts:186`](../../../../apps/server/src/fork/vault/OpenBaoStore.ts#L186): backend reads become server-readable data; [`:206`](../../../../apps/server/src/fork/vault/OpenBaoStore.ts#L206) provides CAS writes.
- [`packages/contracts/src/fork/vault-core.ts:80`](../../../../packages/contracts/src/fork/vault-core.ts#L80): existing archive/restore/delete input; [`:104`](../../../../packages/contracts/src/fork/vault-core.ts#L104) lists current development RPCs.
- [`apps/server/src/fork/vault/mcp.ts:45`](../../../../apps/server/src/fork/vault/mcp.ts#L45): current delete description acknowledges retained encrypted prior versions.
- [`packages/client-runtime/src/fork/capabilities.ts:13`](../../../../packages/client-runtime/src/fork/capabilities.ts#L13): feature absence handling.
- [`packages/client-runtime/src/fork/vault-core.ts:43`](../../../../packages/client-runtime/src/fork/vault-core.ts#L43): environment queries and guarded commands.
- [`packages/contracts/src/fork/clientRpcPermissions.ts:45`](../../../../packages/contracts/src/fork/clientRpcPermissions.ts#L45), [`apps/server/src/fork/rpcAuthorization.ts:62`](../../../../apps/server/src/fork/rpcAuthorization.ts#L62): matching client/server authorization maps.
- [`apps/desktop/src/electron/ElectronSafeStorage.ts:54`](../../../../apps/desktop/src/electron/ElectronSafeStorage.ts#L54): existing encrypt/decrypt wrapper, not verified same-user isolation.
- [`apps/mobile/src/persistence/mobile-secure-storage.ts:22`](../../../../apps/mobile/src/persistence/mobile-secure-storage.ts#L22): SecureStore string wrapper without a personal custody/user-presence contract.
- [`apps/server/src/fork/vault/VaultCore.test.ts:94`](../../../../apps/server/src/fork/vault/VaultCore.test.ts#L94), [`apps/server/src/fork/vault/OpenBaoStore.test.ts:226`](../../../../apps/server/src/fork/vault/OpenBaoStore.test.ts#L226): existing tests read, not executed; limited scope described in TESTING.md.

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
