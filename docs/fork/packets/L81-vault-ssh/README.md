# L81: SSH key management and Loom SSH agent

Status: In progress. OpenBao-backed Ed25519 keys, signed mediated SSH commands and web/mobile key/trust management with authenticated probes implemented; full packet scope retained.

Use dedicated Loom-managed SSH keys for development connections and Git operations.

V10 | Major system | Complexity: Large | Impact: High

## Delivered boundary

Web/desktop and native mobile users with Vault write access can generate a dedicated key,
copy its public identity, review fingerprints and pin, replace or remove host trust. The
thread command palette opens the selected environment's Vault settings. Authenticated
administrator MCP/CLI clients use the same services. Existing Vault item actions archive, restore and delete
the key. No private key is returned by SSH tools. A signed runner request binds a command,
timeout and item version to the authenticated workload session. The Loom server executes it
using a private operation-scoped SSH agent, strict host verification and host-bound Ed25519
authentication. Private key material stays in server memory and OpenBao.

An explicit administrator connection test runs only `/usr/bin/true` with the current item
version and pin, returning safe authentication evidence. It requires Vault write access and
does not give workloads a use grant. The target must be reachable from the Loom server.
Existing provider launches now expose authenticated SSH/Git tools with automatic workload
setup/release. Git supports ref listing and fetch into the thread checkout using an exact
repository grant. Ordinary terminal routing, clone/push, imports, general runner sockets,
Windows and unattended boot remain pending.
See [user help](../../user/vault.md#manage-ssh-keys-and-test-a-connection) and [TESTING.md](./TESTING.md).

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
