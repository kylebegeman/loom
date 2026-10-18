# L81: SSH key management and Loom SSH agent

Status: Designing. Selected for documentation by Kyle on 2026-10-17; not approved to build.

Use dedicated Loom-managed SSH keys for development connections and Git operations.

V10 | Major system | Complexity: Large | Impact: High

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

Uses storage, broker and policy interfaces plus SSH adapters. Account connectors may automate public-key registration when available; otherwise provide explicit manual registration. Unlocks remote workers and optional future commit signing.

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
