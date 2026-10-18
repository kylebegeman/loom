# L78 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for documentation on 2026-10-17. This packet is
**V07** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/auth/ServerSecretStore.ts:138`](../../../../apps/server/src/auth/ServerSecretStore.ts#L138): Current owner-only file store has no Vault encryption layer.
- [`apps/server/src/auth/ServerSecretStore.ts:189`](../../../../apps/server/src/auth/ServerSecretStore.ts#L189): Current persistence writes supplied bytes to files.
- [`apps/server/src/settingsSecrets.ts:35`](../../../../apps/server/src/settingsSecrets.ts#L35): Current redacted secret settings integration.

## Shared design and prior art

- [Foundation proposal](../LOOM-VAULT-FOUNDATION.md): shared contracts and candidate backend evaluation.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied, and no backend/license/dependency has been selected by this packet.
