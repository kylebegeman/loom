# L80: Enrolled machines and headless brokers

Status: In progress. Reviewed enrollment, signed presence and managed macOS/Linux user-service
startup/recovery are implemented locally. Kyle selected the full packet on 2026-10-17.
Real-host boot/logout acceptance, additional custody modes and complete runner delivery remain open.

Give each execution host a durable identity and reliable unattended credential access.

V08 | Major system | Complexity: Large | Impact: Transformational

## Delivered boundary

Web/desktop and native mobile manage invitations, fingerprint approval, cancellation and permanent
disable. The foreground macOS/Linux runner generates a private Ed25519 machine identity, proves
its invitation and renews an online registration lease. No personal credential manager is used.
Enrollment grants no item access. L85 supplies signed workload authorization checks;
L82 adds signed mediated SSH commands from the control plane. Host-local CLI controls now plan,
install, start, stop, restart, inspect and uninstall a separate broker user service. Diagnostics
separate process state, autostart, Linux linger and recent signed heartbeat state. macOS requires
a logged-in GUI user session; Linux/Pi continuity depends on an operator-configured systemd user
manager and linger. Runner-side agent sockets, other boot/custody modes, Windows support and any
selected offline policy remain open. See
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
Additional delivery modes, encrypted local custody, pre-login macOS service modes and platform
identity remain target designs. No live service was installed for this milestone.

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
