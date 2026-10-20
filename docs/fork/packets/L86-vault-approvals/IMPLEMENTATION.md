# L86 implementation plan

Status: In progress; timed approvals, requester lifecycle and bounded queue retention implemented. The sequence below describes the full packet outcome;
see README for delivered progress and remaining work.

## Delivered milestone and next work

The existing access service now atomically stores bounded durable requests, reviewed timed
decisions and grants in its existing policy. Web/desktop and mobile inboxes expose approve,
deny, cancel, expired status and revoke. MCP can create, inspect or cancel its authenticated requester's own pending request, but cannot decide it. Notification transport is a supplied stub. Existing grant enforcement applies.

Requester status and cancellation now use the trusted invocation identity. Durable correlation
stores a caller's opaque operation reference and the server's current run, without command
payloads. Approval and access reject a different captured run. Status is read-only and has no
execution token. Automatic resumption and allow-once consumption remain literal-false gates.

The current queue has a 24-hour age limit and the existing 128 cap. A scoped one-minute worker
and atomic creation cleanup reclaim aged requests plus expired approval grants; cleanup refuses
to discard a live grant's binding. Backend history/audit retention remains separate. Existing
policy writes with an approval ledger use format 3 to prevent older writers dropping correlation.

Typed read-only retry preparation now validates exact proposal scope, requester/run, item/version,
request revision and current evaluator access. Caller-retained operation digests support recovery
comparison; uncertain writes require outcome review. No adapter is called and no continuation is
persisted. Policy format stays 3.

Recovery validation now rejects concurrent policy/status changes and backend outages, reconciles
lost approval replies, and provides actionable repair guidance with focused failure/race coverage.

Next selected work: in-app notification adapter delivery contracts and bounded outcome handling
while external transports remain stubbed. Persisted delivery outcomes need an explicit storage
compatibility decision before changing the existing policy value. Automatic resumption and one-time consumption remain
gated off. Kyle owns native acceptance and the native Threads defect; do not run a parallel
simulator pass. Step-up authentication and remote relay/tunnel acceptance remain unfinished.
Do not mark the full packet done.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Define eligible approvers, decision scopes and pending-operation resumption.
2. Implement durable request deduplication, decisions, expiry and one-time consumption.
3. Expose an inbox and waiting task state across clients, then add optional platform notifications.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
