# L78 implementation plan

Status: design documentation only. The following is an implementation sequence for later use,
not permission to begin coding.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Implementation starts only after
Kyle selects it into [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Compare OpenBao, Infisical and a narrow custom service against D1 acceptance criteria using disposable data.
2. Settle key custody, bootstrap recovery and platform identity mapping; promote the shared extension specification.
3. Implement the chosen adapter and core item lifecycle with atomic receipts, minimal audit and baseline restore.
4. Add cross-client management and a deployment runbook without changing the live VPS until rollout is separately authorized.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
