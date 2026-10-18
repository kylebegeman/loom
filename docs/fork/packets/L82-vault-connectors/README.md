# L82: Developer service accounts and authentication connectors

Status: Selected for implementation by Kyle on 2026-10-17. Queued; full packet scope retained.

Manage GitHub and other developer service identities as tested, renewable connections.

V11 | Major system | Complexity: Large | Impact: High

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
`ext-vault` has an implemented encrypted-record boundary. Broker, identity and delivery portions
remain target designs; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Uses shared storage, grants and delivery interfaces. Starts with GitHub; other connectors register independently and do not become compulsory dependencies. Unlocks registries, deployments and infrastructure providers.

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
