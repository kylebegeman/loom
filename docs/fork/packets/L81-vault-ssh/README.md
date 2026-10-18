# L81: SSH key management and Loom SSH agent

Status: In progress. OpenBao-backed Ed25519 key management and signed mediated SSH commands implemented; full packet scope retained.

Use dedicated Loom-managed SSH keys for development connections and Git operations.

V10 | Major system | Complexity: Large | Impact: High

## Delivered boundary

Full-access administrator MCP clients can generate a dedicated key, inspect its public identity
and pin, replace or remove host trust. Existing Vault item actions archive, restore and delete
the key. No private key is returned by SSH tools. A signed runner request binds a command,
timeout and item version to the authenticated workload session. The Loom server executes it
using a private operation-scoped SSH agent, strict host verification and host-bound Ed25519
authentication. Private key material stays in server memory and OpenBao.

The target must be reachable from the Loom server. This is a bounded command operation, not
an agent socket on Dorothy or a Git credential helper. New web/mobile SSH management, automatic
provider launch attachment, Git integration, imports, Windows and unattended boot remain pending.
See [user help](../../user/vault.md#run-a-mediated-ssh-command) and [TESTING.md](./TESTING.md).

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
`ext-vault` now includes encrypted records, host/workload authorization and the mediated SSH
operation boundary. Other delivery adapters remain target designs.

## Dependencies and future opportunities

Uses storage, broker and policy interfaces plus SSH adapters. Account connectors may automate public-key registration when available; otherwise provide explicit manual registration. Unlocks remote workers and optional future commit signing.

## Packet seams

All new code uses fork-owned contracts, services and existing HTTP/MCP/CLI registries. No new
upstream seam or application dependency is needed. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
