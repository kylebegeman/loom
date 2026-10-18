# L80: Agent identities and persistent access grants

Status: **In progress**. Local thread/project grants milestone implemented; full packet scope retained.

Authorize recurring agent work at a useful scope without granting access to the personal vault.

V09 | Major system | Complexity: Large | Impact: Transformational

## Delivered milestone

The local milestone provides environment-owned thread/project grants, one default-deny
evaluator, exact item/action/project/destination scopes, bounded validity windows, parent
attenuation and authenticated direct-child delegation. Grant revisions and permanent revocation
survive restart and OpenBao restore. UI changes require an explicit preview and apply;
suspension is reversible. Workload identity comes from ThreadManagement, never prompt text.

Existing agent metadata, private ingress and lifecycle paths enforce the evaluator and T3's
permission ceiling. Human environment administration remains governed by access:read/write;
agent threads cannot administer root grants. Scheduled jobs may use their authenticated T3
thread, but credential-use leases and automatic external runner attestation are not delivered.
L84 now binds signed channel checks to an active run and its current item/destination use grants. L79 now provides
reviewed host enrollment and heartbeat presence, without credential-use authority.

## Remaining selected scope

Finish per-workload runner attestation, schedule attestation beyond Loom thread identity,
platform membership and role mapping, external-use leases and broker revocation propagation.
Decide which deployment boundaries require separate OS users or containers. The current
allow-list union has no explicit deny rules. Same-user full-access processes remain outside
any promise of per-item host isolation.

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
`ext-vault` has an implemented encrypted-record boundary. Reviewed host enrollment is implemented. Workload channels, platform identity and delivery
portions remain target designs; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Implements ext-vault policy and principal interfaces. Metadata readers, SSH and connectors share the evaluator. Optional approvals consume its decisions; missing approval UI means a typed denial, not automatic permission.

## Packet seams

All implementation lives in fork-owned code and existing registries. No new upstream seams
were required for this chunk. See [SEAMS.md](./SEAMS.md) for the shared boundary.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
