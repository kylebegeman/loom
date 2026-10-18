# L72 implementation plan

Status: design documentation only. The following is an implementation sequence for later use,
not permission to begin coding.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Implementation starts only after
Kyle selects it into [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Implement check adapters with explicit supported, unavailable and failed results; never invoke an interactive login as a check.
2. Run adapters under the same principal, environment and tool configuration as the intended workload.
3. Expose cancellable results through RPC, CLI and MCP, then add environment and project preflight UI.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
