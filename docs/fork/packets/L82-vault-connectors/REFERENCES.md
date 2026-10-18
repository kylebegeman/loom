# L82 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V11** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/sourceControl/GitHubSetupFlow.ts:21`](../../../../apps/server/src/sourceControl/GitHubSetupFlow.ts#L21): Existing durable setup progress service.
- [`apps/server/src/sourceControl/GitHubHostSetup.ts:330`](../../../../apps/server/src/sourceControl/GitHubHostSetup.ts#L330): Current host authorization and Git helper setup.
- [`packages/source-control-github/src/server/GitHubCredentials.ts:133`](../../../../packages/source-control-github/src/server/GitHubCredentials.ts#L133): Current GitHub CLI token resolution boundary.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.
