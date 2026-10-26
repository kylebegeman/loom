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
through authenticated MCP identity; own-request status also exposes process-local notification
outcomes without sending an alert. There is no agent approval or delivery-mutation tool.
The selected environment and its access permissions remain authoritative.

A new request alerts the owner's iPhone through the Library push path when the Library sends agent
alerts; desktop and web attention for it is not wired yet. The inbox shows bounded,
per-process delivery observations, including unconfirmed attempts and requests that no longer
need an alert. Restart discards these observations without automatically resending anything. Pending requests expire after
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
Preparation now rejects concurrent policy/status changes, fails closed on backend outages and
returns actionable repair guidance. Lost approval replies reconcile without duplicating grants.
The internal digest-only operation journal now persists bounded crash/reconciliation evidence
through the existing OpenBao adapter. It adds no public execution path; no operation resumes
or consumes an allow-once approval. See TECHNICAL.md for its reserved path and downgrade behavior.
Requester-scoped recovery observations expose only owned digest/state summaries without
reconciling or writing them. Reserved or unknown outcomes need external review; missing evidence
does not prove an operation never ran. Project retirement preserves the reserved journal.
Explicit retry preparation includes recovery observations, checks retained digests and refuses
blind replay of reservations or terminal outcomes. Current denials retain precedence and journal
outages fail closed. Preparation itself creates or consumes no journal evidence.
Legacy policies remain format 3. The inbox shows current record/thread/project names with stable ID fallback and accessible
decision context. Changed or unavailable pending context requires refreshed review; deny/cancel
remain reachable. Names do not replace server-side decision checks.
The inbox opens with pending work first and shows retained/pending counts. Show all requests
restores decision review and revocation. Expiry and age-out update the client view without
changing the authoritative server checks. Kyle's native iOS acceptance passed on `0.0.99`; TESTING.md records evidence and remaining
surfaces. Local retry integration through existing SSH/Git/GitHub services also passes with
synthetic transports. Kyle's later approver-context native pass accepted current/changed/missing
context and UI deny/cancel; accessibility speech/hints remain source-only. The gated dispatcher
and consumption design now has a synthetic race/crash proof, including reserve replay, but no
runtime dispatcher or true one-time grant enforcement. Internal fresh acquisition now separates
acknowledged CAS ownership from replay, with opaque local handles and single-use validation.
It invokes no external adapter and opens no execution gate. Internal SSH/Git/GitHub admission
now compares local adapter metadata with fresh authority/journal checks; it mints no credential,
opens no workload, invokes no command/probe and returns no execution permit. Synthetic recovery
acceptance covers lost results, service reconstruction, duplicate handles, restored storage and
aged evidence without recreating an opportunity. Durable resumption/consumption and
live-provider acceptance remain open. One-time intent and downgrade-reader design now rejects
optional format-3 metadata and alternate-grant fallback using real-service counterexamples;
its eligibility model is synthetic only. The mandatory boundary design covers omitted references, delegation and alternate entry points;
its earlier classification and coverage model is now complemented by the approved internal
format-4 reader/writer contract below. No live gate changes. Temporal synthetic proof now covers handoff and
callback races, with a coherent commit explicitly assumed rather than implemented. The bounded
synthetic review is complete; [next-owner checks](../IMPLEMENT-NOW.md#vault-completion-dependencies)
identify the remaining decisions and real verification. The packet remains partial.

Kyle approved format 4 behind closed gates. Internal classification and exact-intent
preview/review/reservation now share the existing policy CAS. The evaluator and raw credential
boundary refuse protected or unclassified use, regardless of ordinary grants. Existing format-3
policies are unchanged; migration is preview-only. No public intent API, exact-operation review
UI or live dispatcher is enabled. Older runtimes reject format 4 and must not be made compatible
by lowering the version or restoring legacy authority. Journal format 1 is unchanged.

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
