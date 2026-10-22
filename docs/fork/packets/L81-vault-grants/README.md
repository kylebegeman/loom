# L81: Agent identities and persistent access grants

Status: **In progress**. Personal owner-trusted and restricted grant modes implemented; full
packet scope retained.

Authorize recurring agent work at a useful scope without granting access to the personal vault.

V09 | Major system | Complexity: Large | Impact: Transformational

## Delivered milestone

The policy supports two environment access modes. Existing and shared environments retain
restricted default-deny thread/project grants. An authenticated human owner can explicitly
declare a personal environment owner-trusted once, enabling metadata inspection and supported
brokered use for authenticated active full-access/default agent runs without recurring
thread/project/provider grants. Profiles are optional connection selections. Both modes use
the same evaluator and current item, run, destination and adapter checks.

The declaration is bound durably to the environment and the human subject that first sets it.
There is no verified platform multi-owner identity or membership model. Another person who can
launch agents in that environment is not distinguished from its owner by a prompt or provider
label; shared environments must keep restricted mode. Owner trust does not authorize a task,
elevate plan/runtime permissions, administer policy/trust, reveal/export values or bypass
format-4 one-time protection. Disabling returns to restricted evaluation without deleting
records, grants or recovery material. Existing authenticated sessions may continue.

Restricted grants retain exact item/action/project/destination scopes, bounded validity,
parent attenuation, authenticated direct-child delegation and permanent revocation. UI grant
changes require preview/apply; suspension is reversible. Workload identity comes from
ThreadManagement, never prompt text. Manage/private-ingress actions remain grant-controlled.
Human environment administration remains governed by access:read/write; agents cannot set
owner policy or administer their own root grants. Signed workload checks, hosted SSH/Git and
GitHub operations consume the same policy rather than a provider-specific bypass.

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
`ext-vault` has implemented records, grants, host enrollment, workload proofs and mediated SSH.
Platform identity and additional delivery portions remain target designs; inspect the exact
specification before consuming them.

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
