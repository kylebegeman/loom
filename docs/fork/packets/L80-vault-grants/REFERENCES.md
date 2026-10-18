# L80 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for documentation on 2026-10-17. This packet is
**V09** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/mcp/McpInvocationContext.ts:1`](../../../../apps/server/src/mcp/McpInvocationContext.ts#L1): Authenticated thread/client context and capability ceilings.
- [`apps/server/src/mcp/McpToolAccess.ts:1`](../../../../apps/server/src/mcp/McpToolAccess.ts#L1): Existing transport-level access enforcement.
- [`packages/contracts/src/fork/clientRpcPermissions.ts:22`](../../../../packages/contracts/src/fork/clientRpcPermissions.ts#L22): Fork protected-method scope registry.

## Shared design and prior art

- [Foundation proposal](../LOOM-VAULT-FOUNDATION.md): shared contracts and candidate backend evaluation.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied, and no backend/license/dependency has been selected by this packet.
