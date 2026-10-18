# L81 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V10** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`packages/ssh/src/auth.ts:1`](../../../../packages/ssh/src/auth.ts#L1): Existing askpass and SSH authentication abstraction.
- [`apps/server/src/device/SshDeviceHost.ts:241`](../../../../apps/server/src/device/SshDeviceHost.ts#L241): Device-host SSH consumer.
- [`apps/server/src/fork/mini-offload/MiniSshTransport.ts:27`](../../../../apps/server/src/fork/mini-offload/MiniSshTransport.ts#L27): Worker SSH uses batch mode and verified host keys.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.
