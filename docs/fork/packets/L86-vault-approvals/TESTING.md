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
Native iOS acceptance is **pending and owner-led**. The earlier pass stopped at the Threads-screen
"Maximum update depth exceeded" overlay before Vault. Kyle has since rebuilt the client and
owns reproduction, the fix and native L86 acceptance. This lane does not run a simulator pass.
Native typecheck/static evidence is not native interaction acceptance. Android,
Electron shell, remote/relay/tunnel, keyboard/screen-reader and live-provider acceptance remain
open. No automatic resumption, notification delivery or allow-once consumption is claimed.

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

Prove actual explicit retry execution and durable resumption/one-time consumption before
exposing those execution flows. Requester status/cancellation and correlation are implemented,
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
