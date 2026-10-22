# L73: Headless readiness checks

Status: **In progress**. Local server-context readiness milestone implemented; full packet scope retained.

Prove an environment can perform its configured unattended work before launching a task.

V01 | Minor improvement | Complexity: Medium | Impact: High

## Delivered milestone

Readiness checks OpenBao connectivity, authenticated root-run liveness and up to
16 explicit item/action/destination requirements through the execution evaluator. Empty
requirements use the active run's retained profile, including pinned credential versions, or
the future-run default only when no pin exists. SSH/Git requirements inspect enrolled-broker
presence; configuration preflight never pretends to be a live authentication probe. Results name
the Loom server context, include repair guidance and expire after 60 seconds. Web/desktop and
mobile can cancel a pending check; RPC, CLI and MCP use the same bounded service.

Use/reveal/export requests and empty requirement sets report missing broker/delivery support.
Profiles are optional; absence does not require a profile setup or grant. The backend check
does not prove item-write privileges. An allowed policy decision does not prove SSH,
GitHub authentication, host trust, provider tools or unattended launch readiness.

## Remaining selected scope

Selected-host broker/runner execution and additional provider checks, broader failure
classification and integrated remote/platform acceptance remain. Profile discovery, retained-pin
revalidation, observational broker presence and launch/schedule configuration guards are
implemented. Explicit GitHub API/GH CLI/Git HTTPS checks use the connector readiness service. Durable long-running check operations are not
needed by the current bounded server check, but remain required for future external probes.

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
`ext-vault` has an implemented encrypted-record boundary. Broker, platform identity and delivery portions
remain target designs; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Uses shared inspection and connector-check interfaces. Can check existing GitHub setup before Vault migration; absent optional adapters report unsupported, not success. Unlocks preflight for schedules and newly enrolled machines.

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

The [GitHub terminal/readiness milestone](../L83-vault-connectors/TECHNICAL.md#github-terminal-routing-and-readiness)
adds explicit scoped gh/Git HTTPS execution and cancellable API/tool checks. Full packet scope
remains In progress; see [user guidance](../../user/vault.md#route-a-terminal-command-through-vault).
