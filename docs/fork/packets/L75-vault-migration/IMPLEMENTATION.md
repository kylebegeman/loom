# L75 implementation plan

Status: **In progress; reviewed imports, local inventory and replacement intent implemented locally.** The sequence below describes the full packet outcome;
see README for delivered progress and remaining work.

## Delivered slice and next work

The service, redacted contracts, guarded shared commands, web/desktop and mobile forms, safe
administrator MCP/CLI status, and synthetic failure/recovery checks implement one manually
entered development secret/note. No personal credential source is read or changed.
Production readiness waits on the reviewed migration-subtree policy; the host owner applies
[the exact commands](../../operations/vault.md#development-import-operating-policy).

Local metadata inventory and reviewed replacement intent are implemented. They retain unknown
identity/global/alias coverage and never authorize cutover. SSH Git and GitHub API/gh plans
have distinct scope. The replacement namespace adds an operator-owned policy prerequisite.

Next: explicit source-specific access verification, bound to the reviewed source/item version,
then per-repository cutover with guarded rollback. SSH checks must distinguish connection
success from Git repository access, and GitHub API checks cannot stand in for Git transport.
Recheck source, item, trust and permissions immediately before any future operation. Typed import adapters, native/remote acceptance, interrupted
cutover, unrelated personal-repository preservation and source-specific cleanup remain open.
Full scope is retained; the manual import slice does not complete L75.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Build source discovery that records dependency metadata and never bulk-exports personal credentials.
2. Implement preview, conflict detection, verified replacement and guarded rollback.
3. Add reviewed migration UI and CLI reporting; include existing SSH Git remotes as an explicit choice.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
