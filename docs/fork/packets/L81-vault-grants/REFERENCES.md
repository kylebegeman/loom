# L81 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V09** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/mcp/McpInvocationContext.ts:1`](../../../../apps/server/src/mcp/McpInvocationContext.ts#L1): Authenticated thread/client context and capability ceilings.
- [`apps/server/src/mcp/McpToolAccess.ts:1`](../../../../apps/server/src/mcp/McpToolAccess.ts#L1): Existing transport-level access enforcement.
- [`packages/contracts/src/fork/clientRpcPermissions.ts:22`](../../../../packages/contracts/src/fork/clientRpcPermissions.ts#L22): Fork protected-method scope registry.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.

## Implemented source

- [Shared access contract](../../../../packages/contracts/src/fork/vault-access.ts)
- [Policy evaluator](../../../../apps/server/src/fork/vault/VaultPolicy.ts)
- [Access service](../../../../apps/server/src/fork/vault/VaultAccess.ts)
- [Behavior tests](../../../../apps/server/src/fork/vault/VaultAccess.test.ts)
- [User guide](../../user/vault.md)
- [Operating guide](../../operations/vault.md)
