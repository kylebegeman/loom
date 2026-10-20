# L84 testing

Status: **Local pool and authenticated run reservation milestones verified within the limits below.** Full
packet acceptance remains unfinished. Implementation base is current fork main `4070ef99a2`.

## Authenticated workload evidence

Four focused suites pass **65 tests**: 13 manager cases, 50 real-service workload/contract
cases, one MCP authorization case and real startup registration. Workload tests use the real
account registry, VaultCore and VaultAccess evaluator with synthetic external storage/thread
boundaries. They prove inspect plus use and exact pool destination filtering; no discovery writes;
no other-owner/unrelated-collection leakage; audited reserve; exact run/lease release; renewal;
run/provider/project/mode/identity refusal; permission withdrawal and account rotation at async
write checks; lost replies; restart reconciliation; durable expiry; corrupt owner quarantine;
outage refusal; and cleanup CAS loss preserving a newer reservation. Agent administration and
injected owner fields refuse. The MCP case drains toolkit result streams, verifies trusted caller
identity and refuses external clients or a runtime lowered before mutation. No login is delivered.

Ten login-admission cases prove the separate exact-origin grant, canonical origin refusal,
wrong-run/lease refusal, fixed deadlines despite renewal, replacement lease refusal, grant loss
before a synthetic callback with exactly one fixture cleanup and no continuation, changed-run
refusal, and lease release while the login access audit is committing. Preparation writes no
state and exposes no password. The scoped OpenBao integration also prepares/revalidates that
guard with existing rights. This does not prove a live provider adapter, logout, unknown mint
outcome recovery or restart-safe cleanup; those remain gated and all execution flags stay false.

```sh
./node_modules/.bin/vp test run \
  apps/server/src/fork/vault/VaultTestAccountWorkloads.test.ts \
  apps/server/src/fork/vault/test-accounts-mcp.test.ts \
  apps/server/src/fork/vault/VaultTestAccounts.test.ts \
  apps/server/src/fork/mcp/registration.test.ts
```

The scoped OpenBao proof now runs **four applicable integration cases across two backend
lifetimes** (two per phase; complementary phase cases are skipped deliberately). In addition to
the first milestone's CAS/encryption/namespace proof, it runs real inspect/use grants and a
run-owned reservation, retains that lease through backend restart, then CAS-quarantines the
stopped run without changing policy3 or registry1. It uses only the existing documented scoped
rights; no production policy is read or changed. The policy's ordinary grant/audit contents change
through VaultAccess; no new field, path or capability is introduced. The initial manager-only
phase also proves unchanged policy before agent grants are created.

Server/contracts/client-runtime/web/mobile package typechecks and focused changed-file lint pass.
The web check uses a fresh temporary incremental cache. Links, seam manifest and whitespace are
checked before commit. These are backend/tool changes; no new browser or native interaction pass
is claimed. The existing integrated web evidence below remains the manager milestone evidence.
The reactor is tested through its reconciliation service and real backend restart, not by a
live production worker or provider session cleanup.

## First manager milestone evidence

Six focused suites pass **42 tests**: 13 real-service lifecycle/failure cases, client action/expiry
logic, destination-scoped command permissions, profile cleanup isolation, exhaustive fork RPC
permission mapping and actual MCP startup registration. That first milestone added no MCP tool; the workload milestone above adds two. Behavior
covers
competing CAS writers, actor-bound replay/lost replies, expiry into quarantine without read writes,
old/new lease IDs, another session's refusal, renewal bounded to one hour, expiry during async
authorization, blocked archive while reserved, quarantine/retire/restore, duplicate item references,
collection identity/move refusal, active account/version checks, missing/wrong-kind items, ledger
corruption, malformed input, permission withdrawal and aged/evicted receipt replay. Client tests
cover reverse actions, ownership, archived state and the exact expiry boundary.

The original disposable OpenBao 2.7.1 proof passed one applicable case in each phase.
The expanded workload proof above adds a second case in each phase. It uses only the documented existing environment-scoped service policy,
including profiles/*; no production policy is read. It proves a single reservation CAS winner,
denied sibling namespace, unchanged format-3 policy, core item-list independence and matching-owner
release into quarantine after a backend restart. Synthetic account plaintext is absent from the
stopped Raft files. The fixture captures/stops its own process and removes its temporary state.
This is restart/encryption evidence, not a production backup or provider reset exercise.

```sh
./node_modules/.bin/vp test run \
  apps/server/src/fork/vault/VaultTestAccounts.test.ts \
  packages/client-runtime/src/fork/vault-test-accounts.test.ts \
  packages/client-runtime/src/fork/vault-test-accounts.permissions.test.ts \
  apps/server/src/fork/vault/VaultProfiles.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/mcp/registration.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 \
  apps/server/src/fork/vault/testkit/test_accounts_proof.py \
  --bao /path/to/verified/openbao-2.7.1/bao
```

Server, contracts, client-runtime and mobile package typechecks pass. Web typecheck passes with
fresh incremental build info using the package's tsc-rs compiler; the ordinary TypeScript compiler
also passes. Initial upstream dependency-link and stale build-info failures were resolved by
reusing already installed packages and a fresh local cache. No install, lockfile change or
compiler/source workaround is included. Mobile native static checks pass. Focused lint/format,
changed links, seam manifest and whitespace are checked before commit; no repo-wide check runs.

## Integrated web evidence

The authorized test-t3-app Browser-panel pass used a new isolated Loom home, private disposable
loopback OpenBao and a synthetic Account item. No production database, personal credential or
existing Vault QA server was used or stopped. The backend used a disposable broad fixture policy
for that empty UI environment, separate from the narrowly scoped real-service policy proof above.

Observed through UI and real RPC: empty state; collection create and rename; safe account picker;
reference creation into quarantine; explicit clean review; reserve with correct connection owner;
release into quarantine; retire/restore; reference role edit back into quarantine; collection
archive/restore; and visible conflict/refusal when archiving an actively reserved collection.
The 1280px and 390px layouts render the account actions and safe references; the narrow document
width matches its viewport with no horizontal overflow. Review/cancel and labels are present.
No console error was observed in the checked flow. Expiry/races, offline/backend corruption,
permission withdrawal and retry outcomes have focused service/client evidence, not a claimed
manual/browser pass for every failure.

Browser artifacts (local evidence only, not committed):

- Desktop: `browser-screenshot-localhost-mvgvlbtd-2bfd18ca.png` in Kyle's browser-artifacts folder.
- Narrow viewport: `browser-screenshot-localhost-mvgvpe0q-872ab27d.png` in the same folder.

The native mobile implementation shares the guarded commands and expiry/action logic but has
not had an iOS/Android interaction pass in this slice. Native testing remains with the designated
owner. Electron shell/IPC, remote/relay/tunnel, keyboard-only and screen-reader behavior, live
application accounts and multi-worker login remain unverified. Desktop uses the shared web UI;
the browser pass does not imply Electron-specific acceptance.

## Scope and remaining acceptance

No raw password, cookie, TOTP or login session is returned or copied into the registry. This is
reference-only pool management; quarantine/retirement prevent reservations but do not revoke
external sessions or block generic Vault account access. Provisioning, automatic reset, mail
and login delivery remain unavailable. Authenticated agent reservations are exposed.
Manual clean review is an operator attestation, never adapter-reset proof. Full-access process
isolation and exactly-once provider effects are not claimed.

Continue with a synthetic separate login-delivery contract bound to the live lease and its
failure/revocation checks, then a chosen disposable app adapter, real reset/provision failure/cancellation recovery,
mail ownership/cleanup and browser/native login verification. These remain the full selected
PRODUCT outcomes. Policy3/journal1 and L86's false execution/resumption/allow-once gates stay
unchanged. L75 stays parked behind CW-1/L79. No Library schema, production, SSH, install or release
action is included. This branch is prepared for the release owner's landing review.

## Landing-review regressions

Queued follow-ups and pending runtime requests do not end an active reserving root run. Two
real-service cases preserve the same lease through discovery and reconciliation, then renew and
release it with status queued or running plus pendingRuntimeRequest. A reachable waiting state
with activeRunId null and a background subagent ends that lease and quarantines the account. The binding trusts activeRunId,
provider/project identity and permission modes rather than the thread's presentation status.

Each client has a mounted clock regression: an empty manager waits twelve minutes, receives a
new five-minute lease, then renews twice. Fresh snapshot.checkedAt rebases the clock and explicit
renew-eligibility deadlines wake it after a fifteen-minute extension. Both renew and release
withdraw at expiry, leaving clean review/retire and no timer. A callback that fires before the wall
clock reaches its deadline reschedules; both mounted hook regressions cover that clock behavior. This is unit evidence for both
web/native hooks, not a simulator pass. The card's lease line now uses that computed state, and
mobile rename disables application and target edits. Both clients show and can copy the exact
collection grant scope; the guide states full-access/default run requirements.

The isolated browser pass verifies the visible scope, Copy action and success notice, and the
quarantined card without a stale lease banner. Evidence: browser-screenshot-localhost-mvgz70ja-5a6d3d01.png
in the local browser-artifacts directory. No synthetic wall-clock mutation or native interaction
is claimed. Four affected package typechecks, focused lint, mobile static checks and seam/link
checks pass. The release owner's landing review remains separate from these local checks.

Lease identity regressions release and replace a lease before the original preparation deadline,
then prove that a fresh preparation succeeds while the old one fails. Removing the lease-id guard
makes this regression fail. Separate renewal coverage enforces the original deadline. Audit-write
hooks change the run, archive the account item or advance past expiry during access.require;
post-await revalidation refuses each case. These are synthetic service tests, not login delivery.

## Synthetic broker contract

The server package-CWD workload suite passes 50 tests, including 24 broker-contract cases.
It uses the real account/grant admission service and a fake broker, with no credential reveal.
Cases cover environment/machine/app/target/origin mismatch, offline/expired presence, registered
origin changes at the adapter boundary, forged return correlation, grant/run/lease/expiry changes,
callback failure, duplicate admission, lost start replies and cleanup refusal/errors. Deferreds
interleave cancellation and a late remote mint; the fixture's terminal operation fence prevents
that late creation. Reconstructing the model with the same fixture fence cannot mint again.
Concurrent cleanup ownership and interrupted reconciliation are covered.
Only the original operation ID reaches cleanup. Confirmed cleanup does not mark the account
clean; unresolved cleanup blocks model redispatch and can only retry cleanup.

The contract is in testkit and imported only by this suite. Server typecheck, changed-file lint,
links and 398 seams pass. Client contracts and runtime surfaces do not change in this slice.
No synthetic broker assertion proves a real provider's fence, process isolation, durable cleanup
or account-reset/reuse safety. Those remain explicit live adapter gates in TECHNICAL.md.

```sh
cd apps/server
../../node_modules/.bin/vp test run src/fork/vault/VaultTestAccountWorkloads.test.ts
```

The landing-review regression also changes the root run during a reservation audit write and
proves the post-require identity check refuses before registry CAS. The final Math.min deadline
recheck has no isolated mutation proof; expiry during the earlier audit wait is covered, and no
stronger coverage is claimed for that non-blocking review note.
