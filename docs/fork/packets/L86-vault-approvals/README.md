# L86: Remote approvals and temporary access

Status: **In progress; first local approvals milestone implemented.** Kyle selected the full
packet on 2026-10-17. Notification delivery, allow-once consumption, automatic resumption,
step-up authentication and broader acceptance remain selected work.

Resolve exceptional Vault access requests from the device Kyle is using.

V14 | Major system | Complexity: Large | Impact: High

## Delivered milestone

Pending requests can be viewed and approved for five or fifteen minutes, denied or cancelled
in web/desktop Settings > Loom > Vault access and its native mobile equivalent. Active and
expired approvals retain a visible revoke action. Decisions atomically save the request and
ordinary evaluator-enforced grant in the existing encrypted access policy. Agents can request
access only for their authenticated thread through MCP; there is no agent approval tool.
The selected environment and its access permissions remain authoritative.

Notification delivery is explicitly stubbed behind an adapter. Pending requests expire after
ten minutes. An approval covers one thread, item/version at review, action and destination
scope, and does not resume work automatically. Credential use still rechecks item availability,
thread activity, runtime permissions, grants and server time. No external login or provider-side
revocation is implied by a human approval.

The queue is bounded to 128 retained requests and refuses overflow. No automatic deletion or
retention control ships in this milestone. This extends the existing policy ledger without a
new OpenBao path or permission; the first request upgrades the policy format to version 2, which older runtimes cannot read.
There is no Library change or production action. See TESTING for verified surfaces and limits.

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
have partial implementations; inspect their packets before consuming them.

## Dependencies and future opportunities

Uses the shared grant evaluator and durable request interface. Existing grants work without this packet. Notification transports are adapters, so absence does not block viewing requests in Loom. Unlocks step-up access for sensitive operations.

## Packet seams

No upstream code seams were added. [SEAMS.md](./SEAMS.md) records fork-owned integration.
Milestone baseline: `b0cfe6a63f`.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
