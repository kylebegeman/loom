# L87 implementation plan

Status: Selected for implementation. The sequence below describes the full packet outcome;
see README for delivered progress and remaining work.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Settle recovery ownership, acceptable data loss and restore time at D2/D9.
2. Implement consistent export with integrity verification and configurable retention.
3. Implement isolated restore and rollback/revocation reconciliation before promotion.
4. Add recovery exercises and a maintainer runbook covering server loss and lost unlock material.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
