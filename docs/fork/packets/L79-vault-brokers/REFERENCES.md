# L79 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V08** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Enrollment foundation implemented on the Vault branch after `4475406c04`.

- [`apps/desktop/src/shell/DesktopShellEnvironment.ts:433`](../../../../apps/desktop/src/shell/DesktopShellEnvironment.ts#L433): Desktop-only SSH socket hydration does not cover every service launch.
- [`docs/user/background-service.md:49`](../../../../docs/user/background-service.md#L49): macOS user service currently requires a logged-in session.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.

## Enrollment implementation

- [Shared contracts](../../../../packages/contracts/src/fork/vault-brokers.ts).
- [Registry service](../../../../apps/server/src/fork/vault/VaultBrokers.ts) and
  [runner](../../../../apps/server/src/fork/vault/BrokerRunner.ts).
- [Private local identity](../../../../apps/server/src/fork/vault/BrokerIdentity.ts).
- [Operator guide](../../operations/vault.md) explains custody and foreground/managed-user-service support.

## Managed lifecycle implementation

- [Host lifecycle service](../../../../apps/server/src/fork/vault/BrokerService.ts) and
  [recovery/reporting loop](../../../../apps/server/src/fork/vault/BrokerDaemon.ts).
- [Lifecycle tests](../../../../apps/server/src/fork/vault/BrokerService.test.ts) and
  [outage/recovery tests](../../../../apps/server/src/fork/vault/BrokerDaemon.test.ts).
- [Existing server background service](../../../../apps/server/src/cloud/bootService.ts):
  launchd/systemd conventions; its server/updater-specific identity is not reused for the broker.
