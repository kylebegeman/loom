# L72 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for documentation on 2026-10-17. This packet is
**V01** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/sourceControl/GitHubHostSetup.ts:318`](../../../../apps/server/src/sourceControl/GitHubHostSetup.ts#L318): Existing host and repository status checks.
- [`apps/server/src/device/SshDeviceHost.ts:241`](../../../../apps/server/src/device/SshDeviceHost.ts#L241): Device-host forwarding already requires non-interactive SSH.

## Shared design and prior art

- [Foundation proposal](../LOOM-VAULT-FOUNDATION.md): shared contracts and candidate backend evaluation.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied, and no backend/license/dependency has been selected by this packet.
