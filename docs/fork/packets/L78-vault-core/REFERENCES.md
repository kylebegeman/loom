# L78 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V07** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/auth/ServerSecretStore.ts:138`](../../../../apps/server/src/auth/ServerSecretStore.ts#L138): Current owner-only file store has no Vault encryption layer.
- [`apps/server/src/auth/ServerSecretStore.ts:189`](../../../../apps/server/src/auth/ServerSecretStore.ts#L189): Current persistence writes supplied bytes to files.
- [`apps/server/src/settingsSecrets.ts:35`](../../../../apps/server/src/settingsSecrets.ts#L35): Current redacted secret settings integration.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.

## Implemented source and verification

- [Shared record contracts](../../../../packages/contracts/src/fork/vault-core.ts).
- [Shared Vault services and tests](../../../../apps/server/src/fork/vault/).
- [Disposable OpenBao proof](../../../../apps/server/src/fork/vault/testkit/openbao_proof.py).
- [Shared client commands](../../../../packages/client-runtime/src/fork/vault-core.ts).
- [OpenBao v2.7.1 release](https://github.com/openbao/openbao/releases/tag/v2.7.1), MPL 2.0.

Source baseline above describes the original design research; implementation authorization and
engine selection supersede documentation-only status in older notes.
