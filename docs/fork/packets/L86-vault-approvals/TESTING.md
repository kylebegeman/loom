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
modified. Browser pairing was recovered only against this lane's isolated backend; this lane
ran no simulator pass and touched no production service. Kyle's later native acceptance is
recorded below; full keyboard/screen-reader acceptance remains open.

This additive response metadata changes no policy/journal format, path, grant scope, execution
or resumption gate. The earlier timed-approval native milestone remains documented above.

### Owner-run approver-context native acceptance

Kyle reports **PASS** for `54fa8d66af` plus the `8715558dc0` follow-up. Setup used Loom Dev on an
iOS simulator, an isolated backend on a copied development DB and disposable loopback OpenBao.
Four pending requests were seeded by a **direct synthetic CAS write** to the access-policy
record with a 45-minute request expiry. None came from the request MCP tool; this is fixture
acceptance, not evidence that the normal request path accepts that duration.

| Fixture/result                                                                                                                                                                                          | Device QA evidence                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `c1` current: record “SSH health settings QA”, thread “Summarize Four Repository READMEs”, project “AspectAvy QA”; no warning and approval enabled                                                      | `dqe_ba743d23-37c1-488c-b0d8-051b46fb198e` |
| `c2` record version bumped to 2: “Context has changed. Deny or cancel this request and ask for a fresh one.” Both Approve buttons disabled; Deny and Cancel enabled                                     | `dqe_afc8179c-ee4a-43b8-8058-9fe8e0d0af84` |
| `c4` missing thread/project: fallback “Thread qa:missing-thread · Project qa:missing-project”, record name retained; “Some request context is unavailable. Refresh before approving.” Approval disabled | `dqe_bb6cd31a-53ad-44f9-a7c5-2cfbfb4420d7` |
| Show all: decided cancelled/denied/revoked headers, no context warning or action buttons                                                                                                                | `dqe_8d324ba8-0bd6-43d9-9946-0f4219c170f3` |

These are Device QA captures in [Loom Projects Updates](t3-thread://v1/3f336eb2-b30f-401c-ad42-241fa4b12bb5), stored as `<evidence-id>.png` under `/Users/kyle/.t3/userdata/fork/device-qa/evidence/3f336eb2-b30f-401c-ad42-241fa4b12bb5/`. `c3` was originally intended as unavailable but reused the existing `fixture:thread:2`/`fixture:project` records; it correctly resolved current with approval enabled. `c4` supplies the actual missing-reference case.
The count line changed from “3 pending of 9” to “4 of 10” after Refresh, then “0 of 10” after
UI decisions. Kyle cancelled `c1`/`c4` and denied `c2`/`c3`. OpenBao read-back showed request
revision 2, `grantId: null` and no new grant for every fixture. `decidedBy: one-time-token` is the
pairing session label, not an attested personal account identity. No approval grant was created
in this context-specific pass. The deleted-project case is unit-test-only because this copied
DB had no soft-deleted projects.

Source-only verification, **not observable through agent-device or a VoiceOver interaction pass**:
header `accessibilityRole`, disabled Approve `accessibilityHint`, and iOS count announcements.
`accessibilityLiveRegion` reaches TalkBack only; iOS calls
`AccessibilityInfo.announceForAccessibility` on count changes after the first loaded count and
is silent on first load. Both web and mobile render context warnings only for pending requests.
This lane did not rerun the simulator. Android, Electron, remote/relay/tunnel and full
keyboard/screen-reader interaction acceptance remain open.

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

## Journal-aware explicit retry preparation

Four focused suites pass **41 tests**: journal/recovery composition, requester MCP boundaries,
real fork MCP registration and existing operation-specific retry integration. New cases prove
missing/prepared observations create no journal data, retained digests detect changes without
a client-supplied digest, and reservations/unknown/success/failure override a not-started claim
after service reconstruction. Cancelled preparation cannot reopen, current revoked/stale request
checks retain precedence, unavailable/corrupt evidence fails closed, and a run changing during
recovery lookup yields context-changed. All returned gates remain false and no transport runs.

The isolated real OpenBao proof passes both phases under the unchanged documented minimal
service policy, one applicable test per phase. It now exercises public retry preparation with no
journal, confirms a reserved-entry observation leaves the backend version unchanged, and reads
unknown evidence alongside revoked format-3 authority after backend restart. Its temporary
loopback fixture is stopped and removed by the harness; no existing QA or production backend
is used. Older policy readers remain independent and no path or capability is added.

All five affected package typechecks, focused lint/format, documentation links, 392 seam rows
and whitespace pass. This is a service/MCP follow-up with no UI change or native pass. The only
wire addition is optional recovery metadata in retry reports. Policy format stays 3, journal
version stays 1, and L86 remains partial behind the same closed gates. After integrating the
concurrent deleted-project/VoiceOver fixes from main, 78 tests pass across access, journal,
requester MCP and real MCP registration; server/web/mobile typechecks, affected lint and mobile
native static checks also pass. Native interaction acceptance remains owner-led.

## Gated dispatcher design and synthetic consumption proof

Four focused files pass **44 tests**: the dispatcher proof, real journal behavior,
operation-specific retry integration and real MCP startup registration. The design model explores
all 70 order-preserving interleavings of two callers' read/claim/handoff/finish steps, plus a
second handoff attempt. It inserts withdrawal, expiry, context change, outage, corruption,
age-out and prepared cancellation at every position (4,410 fault schedules), and process loss
for either caller at every position (1,260 crash/recovery schedules). Separate traces cover lost
reservation acknowledgement, pre-commit write failure, completion-write outage/restoration,
unknown external outcomes and closed gates. No sleeps, polling, host commands or adapters run.
The counter models a possible future adapter handoff; it does not measure real external effects.

The model asserts at most one simulated start, no start when the final authorization boundary
observes denied/unreadable/aged context, no terminal reopening, no restored/replayed opportunity,
and no start with closed gates. It also demonstrates a successful no-fault path, so refusal of
every candidate is not the safety proof. These are bounded synthetic schedules, not a proof of
distributed exactly-once behavior or revocation of an already-authorized remote operation.

Two real-service cases use the shared synthetic journal fixture. An identical reserve replay
after service reconstruction returns exactly the first observation, including false gates;
mandatory reconciliation records unknown and subsequent reserve/retry is refused or requires
review. The existing evaluator still allows the timed grant after journal reservation, proving
that request-bound opportunity consumption cannot be advertised as one-time grant enforcement.
The fixture's transport dies if invoked. No runtime acquisition/dispatcher was added.

The digest-only storage assertion now recursively checks persisted object fields, including
inside entries, and excludes the proposal's command value. The cancellation/age case now seeds
an existing entry with an elapsed retirement deadline while its request is still approved and
retained; reconcile returns not-found without changing the stored evidence. It no longer relies
on request age-out to reach not-found.

Server typecheck, focused lint/format, documentation links, 392 seam rows and whitespace pass.
No client code changed, so no additional client typechecks, browser or native pass was run.
The prior real OpenBao policy/restart proof is not rerun because persistence/runtime code is
unchanged; its accepted scope remains above. Access-policy format 3, journal version 1, paths,
policy capabilities and all gates are unchanged. L86 remains partial. No Library, production,
install, SSH, tag or release action is included.

## Internal fresh acquisition and single-use validation

Five focused suites pass **70 tests**, including 26 acquisition-service cases, existing journal
behavior, the dispatcher design model, operation-specific retry integration and real fork MCP
startup registration. Contention tests hold both writers at a Deferred barrier after they read
the prepared record. Same-ID and different-ID competitors yield one acknowledged CAS winner;
the loser reconciles unknown and the winner's handle then fails validation. A second barrier
proves a concurrent check is refused while the first check remains suspended, because handle
identity is discarded before asynchronous work. No sleeps or polling are used.

Other cases cover failed pre-commit writes, lost committed acknowledgements, unavailable
reconciliation, interruption after commit, interruption during checking, restart/replay,
JSON/copy/other-instance handle refusal, caller mutation after capture, current authority
withdrawal, run/item changes, corruption/outage, expired approval, aged journal evidence while
the request is still retained, stale revision, changed operation and mismatched item/operation
bindings. A replay racing between initial journal lookup and policy validation is rejected by
the final journal-version reread. Refusal never refunds an identity, and every successful
observation has execution/resumption/allow-once gates false. The synthetic transport dies if
called. Existing policy bytes/versions remain unchanged by successful acquisition/checking.

The real loopback OpenBao proof passes both phases under the existing minimal service token.
It now acquires through the fresh service boundary, refuses a handle in a reconstructed service,
checks it once in its original service without opening a gate, refuses a repeated check, and
reconciles replay to unknown. Existing CAS conflict, denied sibling, format-3 independence and
backend restart/revocation cases still pass. The fixture stops its captured process and removes
temporary data; no existing QA backend or production policy is touched.

```sh
./node_modules/.bin/vp test run apps/server/src/fork/vault/OperationAcquisition.test.ts apps/server/src/fork/vault/OperationJournal.test.ts apps/server/src/fork/vault/OperationDispatch.proof.test.ts apps/server/src/fork/mcp/registration.test.ts apps/server/src/fork/vault/VaultApprovalRetry.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 apps/server/src/fork/vault/testkit/journal_proof.py --bao /absolute/path/to/bao
```

Server typecheck, focused lint/format, documentation links, 392 seam rows and whitespace pass.
No wire/client code changed, so no client typechecks, browser or simulator pass was added.
Access-policy stays format 3, journal body stays version 1, and no new path/capability or Library
change is included. Construction/registration remains inert. No public acquisition tool or
execution endpoint is exposed. Internal handle validation does not consume a timed grant or
implement adapter admission, remote effects, automatic resumption or true one-time enforcement;
those limitations and the existing downgrade/recovery requirements remain explicit. L86 is partial.

## Metadata-only adapter admission and revalidation

Six focused suites pass **73 tests**: 23 admission cases, fresh acquisition, normal launch,
workload and GitHub behavior, plus real MCP startup registration. The new coordinator composes
real journal/access/workload/launch/connector services. GitHub provider/command transports throw
if invoked; SSH uses the existing transport that throws on execution. GitHub fixtures are direct
synthetic connection seeds, including a non-signable App key, not verified provider accounts.
Real metadata methods are wrapped only to insert deterministic post-observation fault barriers;
no wrapper fabricates an admission verdict.

Happy paths cover SSH, Git-over-SSH, GitHub token and GitHub App proposals. They require two
matching metadata observations, return three false gates and required-live-validation, leave
stored payloads/versions unchanged and create no workload session. Reusing the consumed handle
fails. Changed proposal binding fails before metadata. Other cases cover repository allowlist
refusal, authority withdrawal during checks, provider/worktree changes between observations,
replayed journal reconciliation, cancellation while paused, expired broker lease, disabled
machine, broker environment mismatch, exact pinned host key and absolute Git working directory.
Failures reconcile owned reservation evidence without reopening execution.

The first checks caught existing execution authorization writing its normal audit record;
metadata admission now uses the same evaluator's read-only explanation. Existing execution and
networked readiness retain audited authorization. The unchanged normal-service suites cover
that distinction. Broker age is derived from the actual fixture lease, and revoke fixtures use
the existing required duration contract. No sleeps, provider probes or personal host actions run.

Server typecheck, focused lint/format, documentation links, 392 seam rows and whitespace pass.
No wire/client code changed, so no UI verification or client typechecks were added. The separate
OpenBao journal proof is unchanged and was not rerun: this slice adds no persistence format,
path, policy permission or backend operation. Constructor/registry assembly remains inert.
All methods are internal; no MCP, RPC, CLI, provider or scheduled execution path is exposed.
Live session capacity, signing/proofs, credential/provider validity, tool/file/repository state
and actual network access remain unverified. One-time grant enforcement, live dispatch, L79
host policy/production and broader client/remote acceptance remain open; L86 stays partial.

## Synthetic admission result loss and recovery follow-up

Three focused suites pass **59 tests**: 32 adapter-admission cases, fresh acquisition and real
MCP registration. The added coverage reconstructs journal and admission services over the same
retained synthetic store and dependencies. It deliberately does not claim a full process/host,
provider, notification, workload-service or OpenBao backend restart.

Across SSH, Git-over-SSH and GitHub, successful metadata observation followed by a lost internal
result cannot resume. Serialized observations and the original handle are refused by the new
instance; explicit acquire reconciles reserved evidence to unknown and retry preparation requires
review. Constructors leave retained records unchanged and no extra metadata/provider call occurs.
All three adapters also pass interruption at a deterministic metadata barrier without transport
execution, session allocation or handle restoration.

A concurrent duplicate is denied while the original metadata call is paused; it leaves the
original reservation usable for that observation, whose result still has false gates. Storage
outage after admission leaves ordinary approval review usable, preserves records and yields no
acquisition; restoration forces reconciliation rather than replay. An elapsed entry is unavailable
while its request remains approved/retained, without erasing or recreating evidence. Withdrawal
after a successful result stays authoritative on reconstruction, and the old observation never
becomes permission. The existing 26 fresh-acquisition cases remain green.

Server typecheck, focused lint/format, changed documentation links, 392 seam rows and whitespace
pass. This follow-up changes only tests and packet evidence, so client checks, browser/native
passes and the unchanged real OpenBao persistence proof were not repeated. No production,
Library, host-owner, SSH, install, release, surface, policy/path/format or gate action is included.
L86 remains partial; full one-time intent/enforcement and compatibility design, actual adapter
admission/execution, fresh human authentication and broader surface acceptance are still open.

## One-time intent and downgrade-reader design proof

The new `OperationIntent.proof.test.ts` passes seven tests. Real current-service counterexamples
show that format-3 policy, request and grant-definition intent fields are accepted, authorization
remains repeatable, and the normal audited writer removes those fields. A separate synthetic
unsupported-policy-version fixture is refused by the actual reader and audited authorization
without rewriting it. This is not a persisted format bump or historical-binary acceptance.
The real pure evaluator still permits an alternate thread, project or delegated grant after
removing/revoking the approval grant. No external operation or credential delivery runs.

A design-only eligibility model checks 672 intent/reader/binding/human-review/evidence/authority
combinations, each with and without an ordinary matching grant. Only a supported explicit
one-time intent, aware reader, exact human-reviewed binding, prepared evidence and current
authority are eligible in that model; an ordinary grant never repairs missing authority. It is
not the production evaluator, a fresh acquisition or dispatch permission. The existing journal,
access and dispatcher proofs remain green.

Server typecheck and focused lint pass after correcting a nonexistent schema helper in the new
test harness and hoisting its decoders. Changed-document links, seam manifest and whitespace are
checked before landing. No runtime, contract, client, MCP or backend format/path/policy changes
are included, so no browser/native or unchanged real OpenBao proof is repeated. Access-policy
format 3, journal version 1 and all literal-false gates remain unchanged. L86 is partial. Future
persisted intent/schema and host-controlled downgrade/backup rollback protection need separate
Kyle/host-owner review; live providers and broader client/remote acceptance remain open.
