# L75 implementation plan

Status: **In progress; reviewed manual/typed imports, local inventory, replacement intent, independent route receipts and recovery design previews implemented locally.** The sequence below describes the full packet outcome;
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

Source-specific verification now records bounded SSH repository-read or GitHub API receipts,
with explicit contact confirmation, failure/revocation checks, cancellation and lost-write
recovery. Automated positive cases use synthetic adapters; no live SSH/provider acceptance is
claimed. Receipts never enable cutover or establish workload grants.

Per-repository read-route and hypothetical rollback previews now require fresh matching SSH
repository-read receipts. Source/item/trust/permission checks, scope rejection and explicit
non-executable inverse limitations are implemented. There is no configuration writer or captured
backup; this legacy preview does not evaluate original credentials. The preview adds no backend namespace or policy rights.

Typed development imports now validate SSH PEM/OpenSSH and GitHub App/token material locally,
bind a public review to canonical private material, commit only new typed items after a second
confirmation, and recover/guard archive through existing core receipts. Existing paths/policy
rights and legacy client schemas are preserved. Native/live/remote acceptance remains incomplete.

Original development-route verification is implemented with an explicit separate SSH record,
source user/host/port/path matching and independent expiring receipts. It leaves historical and
ambient shell authentication unknown. A design-only recovery preview binds both current route
receipts; no snapshot is captured or stored and no host configuration is written.

Next: prove the proposed journal, conflict rules and bounded capture representation against
synthetic configurations, then resolve the actual route writer and concurrent-writer strategy.
Keep real capture and cutover/rollback execution disabled until separately selected. Native,
remote and live acceptance, dedicated replacement provisioning and host rollout remain open.
Interrupted real configuration recovery and source-specific cleanup remain unfinished.
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
