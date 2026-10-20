# L86 testing

## First milestone automated acceptance

Seven focused files pass **48 tests**, including request/grant lifecycle tests, fork MCP startup
registration, authentication binding, RPC scope coverage, feature registration, destination
permission revocation and temporary-window contract validation. The five affected package
typechecks pass: server, web, mobile, client-runtime and contracts. Focused lint/format, native
mobile static checks, documentation links, seam inventory and whitespace checks also pass.
An additional focused SSH regression suite passes 11 tests after its fixture construction was
updated for the notification adapter. No repository-wide checks ran.

```sh
./node_modules/.bin/vp test run apps/server/src/fork/vault/VaultAccess.test.ts apps/server/src/fork/vault/access-mcp.test.ts apps/server/src/fork/mcp/registration.test.ts apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts packages/client-runtime/src/fork/vault-access.permissions.test.ts packages/contracts/src/fork/vault-approvals.test.ts
```

Cases cover pending-without-access, atomic timed grant creation, evaluator destination enforcement,
expiry at the server boundary, explicit expired revocation, deny/cancel without grants, stale
policy/request/item conflicts, racing approvers, permission withdrawal immediately before commit,
failed writes, lost committed replies, idempotent retry and actor substitution, notification
failure, rereading through a rebuilt service, protected temporary-grant lifetime and credential
rotation after approval. A controlled TestClock replaces real-time waiting. The MCP request binds
the authenticated thread despite injected identity fields; no approval decision tool is exposed.
Grant APIs continue to reject agent self-approval and read-only clients. Existing grant, readiness
and explanation acceptance remains green.

## Client acceptance and remaining limits

Authorized isolated Browser-panel checks use the existing loopback synthetic OpenBao/server.
They cover empty/pending request display, five/fifteen-minute approval, denial, refresh and visible
revocation, expired approval visibility and the revoke path after expiry. The 390 CSS-pixel
layout has no horizontal overflow. Expiry uses synthetic fixture timestamps; no credential or provider is contacted.
Native iOS acceptance **passed**, run by Kyle on iOS 26.5 simulator `DF1675B4`
("Loom Vault QA 2026-10-18") with Loom Dev built from `d849f9b20a`, the same source as published
`0.0.99-nightly.20261019.3348` (TestFlight `357.75.33`). The backend and synthetic loopback OpenBao
were isolated from this lane's `15684`/`7645` fixture. The Threads screen rendered without the
previous "Maximum update depth exceeded" overlay, resolving that blocker. Evidence below is
Kyle's Device QA captures in [Loom Projects Updates](t3-thread://v1/3f336eb2-b30f-401c-ad42-241fa4b12bb5).

| Native acceptance                                                                            | Evidence / read-back                               |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Empty request state                                                                          | `dqe_4aa6064d`                                     |
| Pending-first review, "4 pending of 4 retained", card details                                | `dqe_2856f64b`                                     |
| Approve 15 minutes (`a8`), deny (`87`) without a grant, approve 5 minutes then revoke (`86`) | Passed; `86` grant read back revoked at revision 2 |
| Show all / Show pending                                                                      | `dqe_14b03c0c`                                     |
| Synthetic `a8` expiry retains Revoke approval, followed by revocation                        | `dqe_698ecac2`                                     |
| Retention notice, "0 pending of 4 retained", cancel (`88`)                                   | `dqe_cc881c66`                                     |
| `a9` waiting-operation/run correlation, restored and cancelled                               | `dqe_ab5fd356`                                     |
| Invalid stored correlation fails closed with a visible inbox error, recovers after restore   | `dqe_6984b114`                                     |

Final synthetic store read-back: `86` revoked, `87` denied, `88` cancelled, `a8` revoked,
`a9` cancelled and `aa` cancelled; grants `a8` and `86` revoked. Requests used
`fixture:thread:2`. Threads `fixture:thread:4` and `fixture:thread:5` do not exist and correctly
return "This Vault operation is not permitted". For correlation fixtures, create the request
with `waitingOperationId` set before injecting a synthetic run: the stored operation ID must
match `(waitingOperationId ?? id)`. A mismatched retained record deliberately fails the whole
policy read closed; per-item recovery is not implemented or claimed.

Android, Electron shell, remote/relay/tunnel, keyboard/screen-reader, live-provider and actual
explicit-retry execution acceptance remain open. No automatic resumption, external notification
delivery or allow-once consumption is claimed. Compatibility is unchanged from `0.0.98`:
access-policy format 3 with process-memory notification outcomes only. This update records
Kyle's acceptance; this lane did not run another simulator pass.

## Requester lifecycle and retention follow-up

Eight focused files pass **72 tests**, including 29 access-service cases, requester MCP identity
boundaries, contract execution gates, real fork MCP registration, RPC scopes, feature registration,
destination permissions and SSH regression coverage. All five affected package typechecks,
focused lint/format, native mobile static checks, documentation links, 390 seam rows and whitespace
pass. No repo-wide checks run. Kyle owns the native pass; this slice does not open, drive, build
or install a simulator client. Isolated Browser-panel acceptance passed the retention notice,
legacy/unbound status, a synthetic stored run/operation reference, cancellation and the 390-pixel
layout without horizontal overflow. Injected metadata was restored before cancellation; this
UI evidence is not proof of a real provider operation or native acceptance.

```sh
./node_modules/.bin/vp test run apps/server/src/fork/vault/VaultAccess.test.ts apps/server/src/fork/vault/access-mcp.test.ts apps/server/src/fork/mcp/registration.test.ts apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts packages/client-runtime/src/fork/vault-access.permissions.test.ts packages/contracts/src/fork/vault-approvals.test.ts apps/server/src/fork/vault/VaultSsh.test.ts
```

New cases prove read-only own-request status with no store writes, cross-thread and non-owner
not-found responses, cancellation fixed independently of injected decision/target fields,
request revision/idempotency without exposing the current policy revision, lost committed replies,
approval/cancellation races, authorization withdrawal at commit and unchanged grants on cancel.
Correlation survives rebuilding the service; duplicated operations in the same run conflict,
changed/ended runs invalidate pending approval and granted access, and changed items report stale
context. Status can report explicit-retry readiness, but all execution/resumption/consumption gates
remain false. Contracts reject substituted correlation and executable status claims.

Controlled-clock retention tests cover 23-hour preservation, exact 24-hour age-out, read-only
logical filtering, deferred cleanup during write failure, atomic reclamation of request plus
expired grant, idempotent sweeps, unchanged storage paths and the existing 128 cap. A fresh
request safely trims a full aged queue in its own CAS and increments the policy revision.
No backend clock is slept, provider is probed, continuation is dispatched or Library path touched.
Old encrypted backend versions and audit history are deliberately outside queue pruning.

## Full packet acceptance still required

Local explicit-retry integration through existing adapters is proven below with synthetic external
transports. Live explicit-retry execution and durable resumption/one-time consumption still need
acceptance before exposing those new execution flows. Requester status/cancellation and correlation are implemented,
with execution gates still disabled. Exercise
notification failure/retry with an actual approved adapter. Retention is bounded by 24 hours and 128 entries; do not claim permanent idempotency or
erasure of backend history. Verify approved devices over relay/tunnel, stale-client capability
handling and disconnect/reconnect races. Fresh human authentication and approver account
eligibility remain design decisions.

L75 is parked at **waiting on host policy**: its next managed-route/capture-codec section starts
only once CW-1 selects a real write primitive and L79 policy is in place. All L75 host writes
remain refused. L77 restricted acceptance remains unchanged. This milestone adds no Library
change, OpenBao namespace or policy permission. Approval-ledger writes now use existing access-policy format 3, intentionally blocking format-2
writers from dropping correlation and retention fields.

## Typed retry preparation and recovery validation

Eight focused suites pass **80 tests**. Added service cases prove typed operation/destination,
item/version and request revision matching, cross-requester denial, current runtime/run/expiry,
restart recovery, changed-command digests, conservative unknown-write handling, Git fetch versus
ref-listing classification, and GitHub API versus SSH transport separation. Store writes are
forced unavailable during successful preparation and restart validation; records remain unchanged.
No execution adapter is present in the access-service layer. Contract tests reject unsupported
continuations/outcome claims and non-false execution gates; MCP tests reject injected identities
and non-thread callers. The real MCP registration test passes.

Server, contracts, client-runtime, web and mobile typechecks pass. Focused lint, format,
documentation-link/seam checks and whitespace pass. No new UI is introduced, no browser or
simulator pass is run, and no external service is contacted. These are metadata/policy validation
proofs, not host trust, broker, GitHub credential or actual retry acceptance. Policy format remains
3 with its existing downgrade caveat; no storage path or permission is added.

## Recovery failure and repair-guidance acceptance

Four targeted suites pass **49 tests**, including the real MCP registration test. New cases cover
backend read failure and recovery, an approval committed with a lost reply, no duplicate grant
on reconciliation, and a deterministic concurrent revocation between the initial policy read
and the final observation. The race uses Deferred barriers and fiber joining, never sleeps or
polling. Run replacement, item rotation, expiry and pending/changed/unknown-write/runtime repair
steps also have focused coverage. All execution gates remain false; policy format stays 3.

Server, contracts, client-runtime, web and mobile typechecks pass. Focused lint/format,
documentation links, 390 seam rows and whitespace pass. Native acceptance remains with Kyle; no simulator, production,
Library, OpenBao path or policy-permission change is part of this follow-up.

## Bounded in-app notification outcome milestone

Six focused suites pass **58 tests** including real MCP registration, notification service,
access-service integration, requester transport boundaries, approval contracts and shared client
status wording. New tests cover explicit stub versus delivery, one reserved attempt under
concurrency, two-second timeout, interruption cleanup, adapter failure, the 128 cap without young
entry eviction, exact 24-hour age-out, fresh service restart and status reads that never send.
The restart test uses `Layer.fresh` so Effect cannot reuse a memoized process instance. Service
integration proves an unconfirmed attempt does not prevent approval and inbox reads do not
write encrypted policy. Shared client tests ensure expiry/terminal state overrides cached sending
copy and adapter delivery never implies human approval.

Server, contracts, client-runtime, web and mobile typechecks, focused lint/format, native mobile
static checks, documentation links, 390 seam rows and whitespace pass. An isolated Browser-panel
pass refreshed the existing synthetic cancelled/revoked/denied requests, verified terminal
notification wording and no errors, and confirmed no horizontal overflow at 390 CSS pixels.
No new browser fixture records were written. Pending/failure/restart behavior is covered by
service tests, not claimed as browser interaction acceptance. Kyle retains the native pass.

Outcomes are memory-only. Policy format stays 3 and no sidecar is written, so a sidecar corruption
or compatible-policy-reader test does not apply to this milestone. No external notification,
automatic replay, persistent duplicate guarantee, production, Library or OpenBao action is added.

## Requester outcome visibility and replay reconciliation

Five focused suites pass **58 tests**: access service, notification service, requester MCP,
real MCP registration and approval contracts. New service cases prove own-request notification
visibility with no send or encrypted-policy write, cross-requester not-found, terminal-state
derivation, lost creation-reply lookup, replay without notification delivery, and restart with
durable run correlation but no retained delivery observation. Backend outage fails the status
read; the exact retention boundary returns not-found. All restart tests now rebuild with
`Layer.fresh`, including prior policy/retry recovery cases, so memoization cannot conceal missing
reconstruction. Approved-request recovery correctly retains terminal state while dropping the
old process's attempted timestamp.

Server, contracts, client-runtime, web and mobile typechecks plus focused lint/format,
documentation links, 390 seam rows and whitespace pass. This follow-up adds no UI or simulator
pass. Policy stays format 3; no sidecar, Library, OpenBao path, permission or external action is
introduced. All canExecute/automaticResumption/allowOnceConsumption gates remain false.

## Pending review ergonomics and late-delivery acceptance

Five focused suites pass **59 tests** including real MCP registration. Shared queue tests cover
pending-first order, pending/all filtering, immutable input, exact request/approval expiry and
retention boundaries. Notification service tests refuse terminal/expired dispatch and derive
`not-required` after an adapter returns beyond the deadline. Access-service acceptance uses a
Deferred barrier: approval commits while notification dispatch is pending; a late delivered
result does not change approved state, create another grant or enable execution.

Affected server, client-runtime, web and mobile typechecks plus focused lint/format, doc links,
390 seam rows and whitespace pass. Focused lint caught unsupported Hermes `toSorted`; sorting
now uses the newly filtered array. The isolated Browser-panel pass verified 0-pending/4-retained
copy, Show all revealing the four synthetic decisions, the reverse pending action and no
horizontal overflow at 390 CSS pixels. Native testing remains owner-led. No notification is sent,
fixture written, policy format bumped, sidecar introduced or production action taken.

## Explicit retry through existing operation services

Four focused suites pass **26 tests**: `VaultApprovalRetry.test.ts`, `VaultGitHub.test.ts`,
`VaultLaunch.test.ts` and real MCP registration. New acceptance composes the actual encrypted-store
boundary (an in-memory test store), access evaluator, timed-approval ledger, enrolled broker,
workload signing, SSH/Git launch service and GitHub connector. Only external transports and
host identity/project lookup boundaries use synthetic fixtures. No live SSH command, Git
transport, GitHub API or host configuration is contacted.

The SSH and Git-over-SSH cases fail before approval without calling the transport, obtain human
timed approval, prepare the exact proposal, explicitly invoke the ordinary launch service and
release its workload session. Revocation prevents a subsequent invocation. Additional cases
change the run, runtime permission, item version/trust or expiry after preparation and prove no
transport call occurs. A Deferred barrier withdraws approval at the transport authorization
boundary, preventing the synthetic effect. A synthetic SSH timeout produces one attempt, releases
the session and leaves recovery at `requires-outcome-review`; status/preparation do not repeat it.
GitHub API acceptance likewise fails before approval, executes through the current connector
only after explicit invocation, rejects revocation and rejects runtime withdrawal after
preparation but before the CLI effect.

Preparation remains observational and all `canExecute`, `automaticResumption` and
`allowOnceConsumption` fields remain literal false. Tests call the already available operation
services explicitly; no new retry/resume endpoint or dispatch engine is enabled. This is local
integration acceptance, not live-provider proof, durable duplicate suppression or crash-safe
one-time consumption. Server typecheck, focused lint/format, documentation links, 392 seam rows
and whitespace pass. No production, Library, OpenBao-path/policy, install or release action occurs.

## Gated durable journal and crash reconciliation

Six focused suites pass **84 tests**, including 11 journal cases, access-service behavior,
OpenBao store boundaries, explicit-retry acceptance, feature registration and real MCP registration.
Crash cases simulate failures before/after prepare, reservation and completion commits, rebuilding
services over retained storage. They prove unknown-reservation refusal, stable replay receipts,
one winner under concurrent CAS, terminal cancellation, ownership denial, revocation before
reservation, corrupt/unsupported/unavailable isolation, 128-entry refusal without young eviction,
atomic age reclamation and original-request-based retirement. A synthetic transport that dies if
called demonstrates the journal never executes an operation. Every observation's execution,
automatic-resumption and allow-once gates remain false.

The dedicated proof runs two phases against a fresh loopback OpenBao 2.7.1 using a service token
with exactly the documented minimal policy, not root. Root is used only for disposable fixture
setup. First phase proves journal create/read/update and stale CAS conflict under existing
`profiles/*` rights, denies a sibling path with no grant, reads the unchanged format-3 policy
alongside the journal, and revokes approval despite a corrupt journal. It restores the journal's
unknown record, stops the captured backend process, restarts/unseals its retained synthetic Raft
data, then proves unknown outcome and approval revocation survive. Both phase tests pass; each
phase skips only its counterpart. Tokens and unseal shares are private fixture data and the
runner removes its temporary directory/process afterward. No existing dev backend is touched.

```sh
./node_modules/.bin/vp test run apps/server/src/fork/vault/OperationJournal.test.ts apps/server/src/fork/vault/VaultAccess.test.ts apps/server/src/fork/vault/OpenBaoStore.test.ts apps/server/src/fork/vault/VaultApprovalRetry.test.ts apps/server/src/fork/mcp/registration.test.ts apps/server/src/fork/features.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 apps/server/src/fork/vault/testkit/journal_proof.py --bao /absolute/path/to/bao
```

Server typecheck, focused lint/format, Python syntax, documentation links, 392 seam rows and
whitespace pass. No client or public transport changed; no additional simulator/browser pass
is needed. Policy remains 3; notification observations remain memory-only. Journal-based dispatch,
exactly-once effects and actual one-time grant consumption are not implemented or claimed.
Older runtimes ignore the separate reserved record, as described in TECHNICAL.md.

## Approver context and accessibility follow-up

Five focused suites pass **73 tests**: access-service metadata derivation, shared review labels,
client permission behavior, server RPC authorization and real MCP registration. New cases prove
current label resolution without policy writes, current-run change detection, unavailable project
fallback with request still readable/deniable, ID fallback for older servers, mismatched response
ID isolation and changed/unavailable approval blocking. The isolated journal proof also passes
both phases after its project-store fixtures were completed for the new metadata lookup.

All five affected package typechecks and focused lint/format, documentation links, 392 seam rows
and whitespace pass. Isolated web acceptance verifies named card headings, readable names plus
stable IDs, distinct five/fifteen-minute decision accessible names, pending/all toggle, and
390-pixel layout without horizontal overflow. One synthetic request was created with a matching
waiting-operation reference through the authenticated service and cancelled using its labelled
control; no approval grant or pending QA request was left. Existing terminal requests were not
modified. Browser pairing was recovered only against this lane's isolated backend; no simulator
pass or production service was touched. Full keyboard/screen-reader and new native interaction
acceptance remain open rather than inferred from DOM semantics or typechecks.

This additive response metadata changes no policy/journal format, path, grant scope, execution
or resumption gate. The previously accepted native milestone remains documented above; it is
not claimed as acceptance of these later UI additions.

## Requester recovery observation and project cleanup isolation

Five focused suites pass **32 tests**: operation journal, profile cleanup, authenticated access
MCP handlers, real fork MCP registration and feature registry. New cases cover read-only
missing/prepared/reserved/unknown/completed/cancelled observations, reconstruction, safe summary
projection, revoked approval alongside historical completion, owner checks before journal reads,
corruption/outage isolation, age-out without writes and mismatched request correlation. The MCP
boundary ignores injected identity/reconcile/execute fields and rejects outside-thread clients
before touching the service. Synthetic transports still fail if execution is attempted.

The existing real profile retirement case now saves a reserved journal sentinel and a second
project registry, verifies their payloads and backend versions remain unchanged, and confirms
only the stopped run becomes a tombstone. Both project registries remain readable. The profiles
prefix documents that future enumeration must skip the reserved `_operations/` branch.

Server, contracts, client-runtime, web and mobile typechecks pass, as do focused lint/format,
changed documentation links, 392 seam rows and whitespace. No client UI changed, so no browser
or simulator pass was run for this slice. Policy format 3, journal version 1, existing paths and
policy capabilities are unchanged. All execution/resumption/consumption gates remain false;
L86 stays partial and no Library or production rollout is included.
