# L84 implementation plan

Status: In progress. Dual-proof checks plus automatic hosted SSH/Git workload setup and cleanup are implemented.
The sequence below retains the full packet outcome;
see README for delivered progress and remaining work.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Next execution integration

The approved section uses the authenticated MCP channel already attached to provider/task
launches. Hosted SSH and Git ref listing/fetch acquire and release their sessions automatically.
Ordinary terminal agent sockets, clone/push, GitHub account adapters and general SDK/CLI delivery
remain selected. Next suggested section for Kyle's approval: Project environment profiles and searchable references (L75/L73), starting with selecting approved SSH/Git bindings for a project without repeatedly supplying item IDs and destination strings.
A check cannot authorize a later operation from a cached response. No live credential or
deployment change was made.

## Steps

1. Specify supported delivery modes and resource cleanup contracts.
2. Implement broker adapters and CLI exec with exit-code, signal and cancellation propagation.
3. Integrate provider/task launch and MCP access using existing permission ceilings.
4. Add SDK examples with synthetic secrets and per-provider support reporting.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
