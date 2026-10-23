# L104 references

## Checked current source

- `apps/server/src/fork/vault/VaultMigration.ts:231` and `:273`: development-only plans and raw server save.
- `apps/web/src/fork/vault/MigrationSettingsSection.tsx:104` and `:117`: explicit single development import and submission path.
- `apps/server/src/fork/vault/OpenBaoStore.ts:186`: backend record values are readable by the server.
- `apps/desktop/src/ipc/methods/window.ts:384`, `:397` and `:406`: existing theme picker/dialog/read pattern only.
- `apps/desktop/src/preload.ts:77` and `:193`: current bridge/theme picker, not a personal importer.
- `apps/mobile/app.config.ts:157`: share-extension configuration, not a secure credential import path.
- `apps/web/src/fork/settings/registry.ts:26`: fork-owned launch/status registration.

Scoped application-source inspection found no client-local personal 1PUX adapter or portable
personal export API. This does not claim a search of generated/vendored code.

## Loom boundaries

[Personal umbrella](../LOOM-PERSONAL-VAULT.md), [L75 development migration](../L75-vault-migration/),
[L79 server core](../L79-vault-core/), [L88 server recovery](../L88-vault-recovery/) and
[proposed L109 personal recovery](../L109-personal-vault-recovery/).
[Existing V selections](../../selections.md#loom-vault) do not select this personal migration.
No old Loom personal import implementation is asserted or reused. Shared primitives are
proposed integration boundaries, not dependencies on those packet folders.

## Official external references

- [1Password export](https://support.1password.com/export/): supported export workflow and unencrypted source-file warning.
- [1Password 1PUX format](https://support.1password.com/1pux-format/): documented archive/data/attachment format and fidelity constraints.
- [KeePass KDBX 4](https://keepass.info/help/kb/kdbx_4.html): candidate established encrypted portable format to evaluate, not a selected engine.
- [Apple document picker](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller): trusted native local selection model for iPhone.
- [Apple file manager](https://developer.apple.com/documentation/foundation/filemanager): native local-file lifecycle/coordination reference.

References are official links without a network-fetch verification claim. No third-party
code, data or package is copied; actual archive/crypto bindings require version/license review.
