# L73 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V02** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Implemented against parent `6e3301e02f`; these current source links define the local milestone.

- [`packages/contracts/src/fork/vault-references.ts`](../../../../packages/contracts/src/fork/vault-references.ts)
- [`apps/server/src/fork/vault/VaultReferences.ts`](../../../../apps/server/src/fork/vault/VaultReferences.ts)
- [`packages/client-runtime/src/fork/vault-profiles.ts`](../../../../packages/client-runtime/src/fork/vault-profiles.ts)
- [`apps/web/src/fork/vault/ReferencePicker.tsx`](../../../../apps/web/src/fork/vault/ReferencePicker.tsx)
- [`apps/mobile/src/fork/vault/ProfileSettingsSection.tsx`](../../../../apps/mobile/src/fork/vault/ProfileSettingsSection.tsx)

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.
