# L85: Remote approvals and temporary access

Status: Designing. Selected for documentation by Kyle on 2026-10-17; not approved to build.

Resolve exceptional Vault access requests from the device Kyle is using.

V14 | Major system | Complexity: Large | Impact: High

## Scope

The complete selected outcome is described in [PRODUCT.md](./PRODUCT.md). Shared guarantees,
backend choices and design gates are in [Loom Vault](../LOOM-VAULT.md) and the
[proposed foundation](../LOOM-VAULT-FOUNDATION.md). This packet does not authorize deployment,
credential imports or changes to the personal vault.

## Surfaces

Web, desktop, mobile and remote management are required. CLI/MCP availability and any
OS-specific execution constraints are defined in the product and technical documents.

## Extension points used

Existing fork core, HTTP, settings, palette, CLI and MCP registrations as applicable.
Proposed `ext-vault` is a design boundary, not an existing extension to copy or deploy.

## Dependencies and future opportunities

Uses the shared grant evaluator and durable request interface. Existing grants work without this packet. Notification transports are adapters, so absence does not block viewing requests in Loom. Unlocks step-up access for sensitive operations.

## Packet seams

No code seams have been added. [SEAMS.md](./SEAMS.md) identifies review areas rather than
claiming an approved seam inventory. Source baseline: `2f385ee835`.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
