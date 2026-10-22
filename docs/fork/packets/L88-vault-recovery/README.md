# L88: Backup, recovery, and portability

Status: **In progress**. Offline encrypted snapshot archives and an isolated real-backend restore exercise are implemented. Full packet scope retained.

Make the self-hosted Vault recoverable and movable without losing access control.

V16 | Major system | Complexity: Large | Impact: High

## Delivered and remaining scope

Operator-only `loom vault recovery` creates a private recovery key, encrypts a previously
captured snapshot, verifies it without plaintext output and recovers it to a new private file.
The commands work offline without a Loom or OpenBao connection. They never capture a running
backend, restore a backend, revive identities or promote a destination. A real disposable
OpenBao 2.7.1 snapshot passes archive/restore and explicit post-snapshot token-revocation
reconciliation; this is isolated acceptance, not an authority barrier for production.

Recovery ownership, off-host custody and retention, consistent production capture, unattended
scheduling, management UI and independent revocation reconciliation/promotion remain open.
An authenticated archive is not proof of a fresh or safe backend. See the
[operating procedure](../../operations/vault.md#offline-encrypted-snapshot-archives) and
[verification evidence](./TESTING.md).

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

Uses backend snapshot/export, key-custody and machine-revocation interfaces. Builds on the minimum restore capability required by ext-vault rather than postponing all backups. Unlocks server migration and future hosting changes.

## Packet seams

Implementation uses the existing fork-owned Vault CLI registry. No new upstream seam or
OpenBao capability is needed; [SEAMS.md](./SEAMS.md) records the boundary.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
