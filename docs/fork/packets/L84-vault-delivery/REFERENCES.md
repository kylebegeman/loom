# L84 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V13** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`packages/provider-pi/src/server/mcpExtensionSource.ts:454`](../../../../packages/provider-pi/src/server/mcpExtensionSource.ts#L454): Pi already has a real system-prompt integration point.
- [`apps/server/src/mcp/McpInvocationContext.ts:1`](../../../../apps/server/src/mcp/McpInvocationContext.ts#L1): MCP caller identity and capability scope.
- [`apps/server/src/fork/mcp/index.ts:1`](../../../../apps/server/src/fork/mcp/index.ts#L1): Fork toolkit registration.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.
