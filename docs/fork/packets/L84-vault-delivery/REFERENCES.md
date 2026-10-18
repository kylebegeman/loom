# L84 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V13** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`packages/provider-pi/src/server/mcpExtensionSource.ts:454`](../../../../packages/provider-pi/src/server/mcpExtensionSource.ts#L454): Pi already has a real system-prompt integration point.
- [`apps/server/src/mcp/McpInvocationContext.ts:1`](../../../../apps/server/src/mcp/McpInvocationContext.ts#L1): MCP caller identity and capability scope.
- [`apps/server/src/fork/mcp/index.ts:1`](../../../../apps/server/src/fork/mcp/index.ts#L1): Fork toolkit registration.

## Hosted execution source

- [Automatic workload service](../../../../apps/server/src/fork/vault/VaultLaunch.ts) and
  [behavior tests](../../../../apps/server/src/fork/vault/VaultLaunch.test.ts).
- [Shared provider guidance](../../../../packages/provider-core/src/fork/vaultInstructions.ts),
  [Pi system-prompt delivery](../../../../packages/provider-pi/src/server/mcpExtensionSource.ts)
  and [Codex application context](../../../../apps/server/src/provider/CodexDeveloperInstructions.ts).
- [Scheduled-run launch](../../../../apps/server/src/scheduledTasks/ScheduledTaskService.ts):
  tasks use ordinary thread launches and their existing authenticated provider connection.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.

## Implemented shared boundary

- [Workload contracts](../../../../packages/contracts/src/fork/vault-workloads.ts).
- [Session authority](../../../../apps/server/src/fork/vault/VaultWorkloads.ts).
- [Signed runner](../../../../apps/server/src/fork/vault/WorkloadRunner.ts) and
  [shared HTTP client](../../../../apps/server/src/fork/vault/BrokerHttpClient.ts).
- [Broker identity milestone](../L79-vault-brokers/README.md).
