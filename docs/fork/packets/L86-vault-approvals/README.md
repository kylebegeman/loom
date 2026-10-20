# L86: Remote approvals and temporary access

Status: **In progress; timed approvals, requester lifecycle and explicit-retry preparation implemented.** Kyle selected the full
packet on 2026-10-17. Notification delivery, allow-once consumption, automatic resumption,
step-up authentication and broader acceptance remain selected work.

Resolve exceptional Vault access requests from the device Kyle is using.

V14 | Major system | Complexity: Large | Impact: High

## Delivered milestone

Pending requests can be viewed and approved for five or fifteen minutes, denied or cancelled
in web/desktop Settings > Loom > Vault access and its native mobile equivalent. Active and
expired approvals retain a visible revoke action. Decisions atomically save the request and
ordinary evaluator-enforced grant in the existing encrypted access policy. Agents can request access, inspect their own status and cancel their own pending requests
through authenticated MCP identity; there is no agent approval tool.
The selected environment and its access permissions remain authoritative.

Notification delivery is explicitly stubbed behind an adapter. Pending requests expire after
ten minutes. An approval covers one thread, item/version at review, action and destination
scope and, for newly run-bound requests, the captured server run. It does not resume work automatically. Credential use still rechecks item availability,
thread activity, runtime permissions, grants and server time. No external login or provider-side
revocation is implied by a human approval.

The current queue retains entries for 24 hours, caps at 128 and refuses overflow. A scoped
one-minute maintenance pass removes aged entries and their expired approval grants; reads hide
aged entries immediately, and creation can reclaim them atomically. This does not erase encrypted
backend version history or the separate bounded audit. Status and cancellation evidence age out
with the queue. Use fresh request/operation IDs afterward; a replay cannot automatically approve
or execute anything.

New requests capture an opaque waiting-operation reference and the server's current run. Status
reports waiting, stale context, terminal decisions or the need for an explicit retry. It never
returns an execution token; automatic resumption and one-time consumption remain disabled.
Requests without a captured run remain explicitly unbound. This extends the existing policy
value to format 3 on a write with an approval ledger; format 1/2 readers remain supported, while
older runtimes reject format 3 rather than dropping correlation metadata.
There is no Library change or production action. See TESTING for verified surfaces and limits.

Typed SSH, Git-over-SSH and GitHub API proposals now have read-only, requester-scoped retry
preparation and recovery comparison. Changed operations, stale context and unknown write outcomes
are blocked or require review. Every result still requires normal adapter validation and keeps
all execution gates false. Proposals are not captured continuations or stored credentials.
Policy format remains 3. Native acceptance stays owner-led.

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
