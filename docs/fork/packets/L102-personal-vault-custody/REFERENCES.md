# L102 references

## Current source, checked locally

- `apps/server/src/fork/vault/VaultCore.ts:104` and `:149`: server-side decrypted load/reveal.
- `apps/server/src/fork/vault/OpenBaoStore.ts:186`: OpenBao plaintext read boundary.
- `packages/contracts/src/fork/vault-core.ts:18`: development summaries include private-for-a-person labels and types.
- `packages/contracts/src/fork/identity.ts:5`: environment login metadata, not owner key custody.
- `apps/desktop/src/settings/DesktopSavedEnvironments.ts:239`: Electron token retrieval/decryption.
- `apps/desktop/src/electron/ElectronSafeStorage.ts:72`: OS-backed string encryption adapter.
- `apps/desktop/src/window/DesktopWindow.ts:395`: renderer sandbox settings; insufficient evidence for agent isolation.
- `apps/mobile/app.config.ts:216`: current iOS keychain entitlement, not a personal custodian implementation.

## Existing Loom scope

[Personal Vault](../LOOM-PERSONAL-VAULT.md), [L79](../L79-vault-core/TECHNICAL.md),
[L80](../L80-vault-brokers/TECHNICAL.md), [L81](../L81-vault-grants/TECHNICAL.md) and
[L88](../L88-vault-recovery/TECHNICAL.md) distinguish personal custody from server records,
broker identity, development grants and server backup. [Selections](../../selections.md#loom-vault)
records the older V01-V16 selection; it does not select this new packet. No old Loom personal
custody implementation is asserted or copied.

## Official external references

- [KeePass KDBX 4](https://keepass.info/help/kb/kdbx_4.html): candidate established format and hierarchy, not a chosen library.
- [KeePass security](https://keepass.info/help/base/security.html): encryption, keys and limitations to evaluate.
- [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106): Argon2 reference when evaluating an engine's KDF choices.
- [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain_services): platform storage/access-control contracts.
- [Apple LocalAuthentication](https://developer.apple.com/documentation/localauthentication): trusted presence APIs and cancellation behavior.
- [Apple hardened runtime](https://developer.apple.com/documentation/security/hardened_runtime): relevant process protections and their limits.
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage): why saved-token encryption is not an agent isolation claim.

Links are official references supplied without a network verification claim. No external code,
assets or dependencies are introduced; licenses must be checked for the actual engine/binding.
