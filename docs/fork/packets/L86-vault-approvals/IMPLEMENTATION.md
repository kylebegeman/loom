# L86 implementation plan

Status: In progress; local pending inbox and timed-grant milestone implemented. The sequence below describes the full packet outcome;
see README for delivered progress and remaining work.

## Delivered milestone and next work

The existing access service now atomically stores bounded durable requests, reviewed timed
decisions and grants in its existing policy. Web/desktop and mobile inboxes expose approve,
deny, cancel, expired status and revoke. MCP can create an authenticated thread request but
cannot decide it. Notification transport is a supplied stub. Existing grant enforcement applies.

Next selected work: current native-client acceptance when the no-install constraint permits,
explicit requester status/cancellation and durable waiting-operation correlation/resumption.
Allow-once, step-up authentication, notification transports/retries, queue retention and remote
relay/tunnel acceptance remain unfinished. Do not mark the full packet done.

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
