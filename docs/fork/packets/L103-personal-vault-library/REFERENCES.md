# L103 references

## Verified current source

- `packages/contracts/src/fork/vault-core.ts:9` and `:18`: generic development types and exposed item summaries.
- `packages/contracts/src/fork/vault-core.ts:136`: current small secure-file wire shape, not a private file library.
- `apps/server/src/fork/vault/VaultReferences.ts:41`: server-side label search to exclude personal metadata from.
- `apps/web/src/fork/vault/SettingsSection.tsx:135` and `:316`: existing environment reveal and rendering.
- `packages/client-runtime/src/fork/vault-core.ts:43` and `:68`: environment commands and current 512 KiB development-file limit, not a selected personal limit.
- `apps/mobile/src/fork/vault/VaultSettingsSection.tsx:48`: selected-computer development settings.
- `apps/web/src/fork/settings/registry.ts:26`: existing fork-owned settings registration.

## Scope boundaries

[Personal Vault umbrella](../LOOM-PERSONAL-VAULT.md), [L74 references](../L74-vault-references/),
[L77 health](../L77-vault-health/), [L79 core](../L79-vault-core/) and
[L88 recovery](../L88-vault-recovery/). Existing [V selections](../../selections.md#loom-vault)
are development scope, not approval of this new design. No matching old Loom personal-library
implementation is asserted. [Proposed L107](../L107-personal-vault-native/) covers platform/TOTP delivery only after
reviewed shared/native support exists.

## Official references

- [KeePass KDBX 4](https://keepass.info/help/kb/kdbx_4.html): evaluate protected metadata/attachments in an established format; no engine selected here.
- [1Password categories](https://support.1password.com/item-categories/): reference for familiar typed item tasks, not a copied data model.
- [1Password 1PUX format](https://support.1password.com/1pux-format/): data-preservation considerations for personal records.
- [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238): exact TOTP semantics for a future reviewed adapter, not an invitation to implement crypto in this packet.
- [Apple AuthenticationServices](https://developer.apple.com/documentation/authenticationservices): later platform credential presentation/delivery boundary.

Official links were supplied without network fetching. No dependency or external code is
introduced; any chosen engine/binding requires version and license review.
