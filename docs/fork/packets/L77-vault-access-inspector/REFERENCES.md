# L77 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V06** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/mcp/McpToolAccess.ts:1`](../../../../apps/server/src/mcp/McpToolAccess.ts#L1): Existing MCP access guards remain a separate ceiling.
- [`packages/contracts/src/clientRpcPermissions.ts:53`](../../../../packages/contracts/src/clientRpcPermissions.ts#L53): Client RPC permissions must also be honored.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.
