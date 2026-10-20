# L84 implementation plan

Status: **In progress; local collections and authenticated run reservation lifecycle implemented.** Full packet
scope remains selected. This section is committed on its own branch for the release owner's
landing review; production and release actions remain outside this lane.

## Delivered milestone

Dedicated development/staging/test collection management, searchable existing-account references,
exclusive session-owned leases, bounded renewal, expiry/release quarantine, explicit clean review
and retire/restore are implemented through a service, guarded RPC, shared client logic and web/
mobile settings. Account values stay in VaultCore; the registry contains metadata/references only.
The internal login guard also binds an exact canonical adapter origin, a separate login-use
grant and the current lease deadline; synthetic callback cleanup passes without enabling login.
Agents now discover only granted references and their own leases, reserve/renew/release for the
authenticated live run, and receive no login material. A CAS cleanup reactor quarantines invalid
run leases on startup and every minute. The existing profiles-subtree policy covers the reserved registry. Real disposable OpenBao proof
covers CAS, denied siblings, unchanged policy, encrypted persistence and lease retention over
backend restart. TESTING records focused checks and integrated web evidence.

## Remaining selected work

1. Finish separate broker-delivered login access bound to the current lease, item version,
   collection app/environment and grant. Include loss/restart/revocation handling before claiming
   parallel worker isolation; raw credential release is not part of this milestone.
2. Build the selected Loom adapter around scoped client sessions. The operator-only local
   target now proves real session issue, access, revocation, replacement and final cleanup. It is
   not integrated with pool leases or broker login delivery. Add durable idempotent creation,
   cancellation/late-result reconciliation and reset-before-reuse before enabling that adapter.
   Manual mark-clean remains an operator attestation until then.
3. Implement the selected Migadu inbox adapter after dedicated mailbox-scoped credentials are
   available. `vault@begam.in` and per-run plus addressing are the proposed configuration, not
   a verified live mailbox. The [operator handoff](../../operations/vault.md#dedicated-migadu-test-mailbox-handoff)
   keeps organization-management credentials out of workers. Message deletion/retention policy,
   session/TOTP/recovery field structures, fixture selectors and optional browser/native test
   integration remain to build.
4. Complete native iOS/Android, Electron shell, remote/tunnel, assistive-technology and live QA
   acceptance with independently authorized synthetic accounts. Shared-account semantics remain
   open; the first milestone is exclusively reserved.

The synthetic admission and broker login-delivery contract are implemented as test-only models.
They cover exact broker binding, callback revalidation, concurrent dispatch, ambiguous start/cleanup,
cancellation fencing and model reconstruction with a retained synthetic fence. No live delivery
implementation or durable cleanup storage is added.
Loom and Migadu are selected; no further app/provider selection is needed. The next live
section needs a durable cleanup barrier that also blocks reset/reuse. Keep delivery unavailable
until its adapter, unknown-outcome recovery and cleanup behavior are proven. The local harness
has five-minute sessions and invocation-scoped cleanup, but no durable worker journal or
restart reconciliation; it cannot clear that gate. L86's execution gates and L75's host-policy park remain unchanged.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Define app/environment ownership and test-only adapter boundaries.
2. Implement collection management and atomic reservation, expiry, quarantine and release.
3. Add one selected app provisioning/reset adapter plus optional development inbox integration.
4. Integrate browser/native test login through broker delivery and expose deterministic fixture selection to agents.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
