# L79: Enrolled machines and headless brokers

Status: In progress. Reviewed public-key enrollment and online heartbeat foundation implemented.
Kyle selected the full packet on 2026-10-17; workload delivery and unattended boot remain pending.

Give each execution host a durable identity and reliable unattended credential access.

V08 | Major system | Complexity: Large | Impact: Transformational

## Delivered boundary

Web/desktop and native mobile manage invitations, fingerprint approval, cancellation and permanent
disable. The foreground macOS/Linux runner generates a private Ed25519 machine identity, proves
its invitation and renews an online registration lease. No personal credential manager is used.
Enrollment grants no item access. L84 now supplies signed workload authorization checks;
L81 adds signed mediated SSH commands from the control plane. Runner-side agent sockets, boot/logout
startup, Windows support and offline credential delivery remain selected work. See
[user help](../../user/vault.md) and the [operator guide](../../operations/vault.md).

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
`ext-vault` has implemented records, reviewed enrollment, workload proofs and mediated SSH.
Additional delivery modes, boot custody and platform identity remain target designs.

## Dependencies and future opportunities

Implements the broker portion of ext-vault; optional delivery adapters register capabilities. Unlocks SSH, CI and runner integrations. Must work without V14 interactive approvals by accepting already granted access or returning a precise denial.

## Packet seams

The enrollment slice uses existing fork-owned registries, with no new upstream code seam.
[SEAMS.md](./SEAMS.md) records the shared boundary and remaining integration review.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
