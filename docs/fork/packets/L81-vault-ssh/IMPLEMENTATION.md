# L81 implementation plan

Status: design documentation only. The following is an implementation sequence for later use,
not permission to begin coding.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Implementation starts only after
Kyle selects it into [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Settle supported key types, OS agent transports and enforceable destination controls.
2. Implement key lifecycle, agent protocol subset and authenticated signing dispatch.
3. Add explicit host-trust and public-key registration workflows with independently testable adapters.
4. Integrate Git and SSH consumers through workload launch configuration and verify restart behavior.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
