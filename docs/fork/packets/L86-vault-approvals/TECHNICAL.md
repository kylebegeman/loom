# L86 technical design

First local milestone is implemented from `b0cfe6a63f`. Kyle authorized implementation and
selected OpenBao for encrypted storage. Later full-packet targets below remain design scope.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Persist a request bound to principal, item/action, destination, policy revision and expiry. Notify eligible approvers through the platform; allow once, grant a bounded duration, deny or cancel. Resume only the still-valid requesting operation after the decision is committed.

## Contracts and authorization

Request/create/read/cancel and decision/allowOnce/allowUntil/deny use request IDs and expected revisions. Approver identity is verified centrally. One-time decisions are atomically consumed; a timed grant is visible and revocable through ordinary grant management.

Use packet-owned `loom.vault-approvals.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Store only safe request context, decision provenance and operation correlation. Enforce expiry centrally; notification payloads contain safe summaries and authenticated deep links. No password-manager dialog capture or biometric bypass is involved.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_approvals_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Reuse the private-input/request lifecycle patterns, but keep approval decisions distinct from secret entry and desktop SSH password prompts. Integrate resumption through services/effects after commit.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.

## Implemented request and timed-grant boundary

The existing `VaultAccess` service owns request creation, inbox and decisions. Requests and
latest decision fingerprints are optional additions to the existing `access-policy` value;
no new backend paths or policy permissions are needed. Existing records decode with an empty
queue. The current queue retains up to 128 requests for at most 24 hours and refuses overflow.
There is no full immutable audit history. The first milestone introduced format 2. This requester lifecycle writes format 3 whenever an
approval ledger is persisted; older readers reject it before writing, preventing loss of correlation
or edits that bypass approval bounds. New readers accept formats 1/2/3. Downgrade requires a compatible reader or an
operator-reviewed pre-feature backup with explicit revocation reconciliation. No older runtime
may share this policy.

A request binds a stable ID, server-resolved thread/project, item/version, action, destination,
requester, creation policy revision and ten-minute deadline. Creation grants no access. The
request ID and actor/input fingerprint make retries idempotent; a different request or actor
with the same ID conflicts. Administrator RPC mutations require destination `access:write`,
while inbox requires `access:read`. Authorization is repeated before CAS persistence.
Approvers are the existing environment clients with that permission, not a new platform account
or proof of fresh human presence. Full-access agents remain able to access their host process
and files; this feature does not claim OS isolation.

Decisions require the displayed policy and request revisions plus a stable operation ID.
Approve rechecks current project and item/version, then commits its fixed five/fifteen-minute
thread grant and request decision in one existing-policy CAS. Deny/cancel commit no grant.
Racing decisions retry only CAS interference and reject stale logical revisions. Actor/input
fingerprints protect the most recent decision retry; clients preserve the pending operation
on uncertain errors. Explicit refresh reconciles state and discards the pending client command.
The existing bounded grant audit records decision provenance without credential material.

Approval grants cannot be edited to extend lifetime or broaden scope through ordinary grant
management; only revocation is accepted there. The existing evaluator enforces exact non-null
destination, action and item scope, grant expiry and lineage; its normal execution paths retain
runtime/activity and item checks. Approval-bound grants also require the approved item version at use. A null destination means unrestricted destination scope and
is labelled explicitly. Revocation does not remove other independent grants or terminate an
already executing external operation. Expiry is enforced by server time at use, without a job,
background poll or client timer. Inbox derives expired/revoked state; both active and expired
approvals can be durably revoked. Pending expiry is terminal; submit a new request to ask again.

Legacy requests remain thread-scoped. New run-bound requests also require the captured run;
the opaque operation reference is correlation, not single-operation authorization. It does not
pause/resume a provider or deliver credentials. After approval, the caller must recheck access
and explicitly retry through ordinary authorized adapters. One-time consumption, resumable
workload correlation and step-up authentication remain separate work.

`ApprovalNotifications` owns bounded, per-process attempt observations and uses an independently
supplied transport adapter. Production supplies an explicit stub, never a delivery receipt.
Only a newly committed pending request can initiate an attempt; inbox reads, identical request
replays, service restarts and decisions never dispatch notifications. No external message is sent.
The authoritative inbox stays usable when an attempt fails or no delivery observation exists.

Capability `vault-approvals` gates web/desktop and native mobile inboxes. They use shared guarded
commands, expiry-boundary timers, explicit refresh, loading/empty/error states, decision retry,
and read-only availability when write permission is absent. Failed refresh hides cached requests.
The MCP request tool derives the caller thread from authenticated invocation context, rejects
non-thread callers and provides no decision tool; self explanation is the existing access tool.
All providers use the shared MCP boundary where available. Adapters without MCP do not acquire
an implicit approval path. Scheduled tasks and brokers continue to use the same evaluator;
requests do not bypass runtime modes or create special policy exceptions.

## Requester status, cancellation and durable waiting correlation

`loom_vault_access_request_status` and `loom_vault_access_request_cancel` derive the thread
from trusted MCP invocation context. No caller-supplied target thread is accepted. The service
checks both thread ID and the original requester actor; an administrator-created request on
behalf of a thread is not automatically owned by that thread. Another requester and an unknown
or aged-out ID both produce `not-found`. Administrator inbox/decision RPC rights are unchanged.
No approval or grant mutation tool is added for requesters.

A new request records `waitingOperation`, containing the optional opaque `waitingOperationId`
(or the request ID by default) and the active run ID resolved by the server. Caller-provided run
identities are never trusted. There is no command/argv/prompt payload or arbitrary continuation.
A retained operation reference is unique within its thread/run; duplicate new request IDs for
that same operation conflict. A thread with no current run gets an explicitly unbound request.
Existing requests without correlation remain unbound, never retroactively attached to a run.

The server rechecks the captured run before approval and filters its grant from execution
when that run changes or stops. Independent grants can still permit access. Requester status
survives service restart and reports `waiting`, `stale-run`, `stale-item`, terminal outcomes,
`access-denied`, or `retry-requires-explicit-operation` after a fresh evaluator check. The
returned `canExecute`, `automaticResumption` and `allowOnceConsumption` are literal false.
The result is a point-in-time observation, not a bearer token or permission to replay work.
The normal operation must recheck its complete policy and runtime inputs before an explicit retry.

Requester cancellation accepts only ID, request revision and a stable cancellation-operation ID.
It does not require or expose a current global policy revision. The private service path fixes
the action to cancellation, rechecks ownership and authorization, and uses the same request/grant
CAS as administrator decisions. Races with approval can commit only one transition. Lost replies
can be reconciled by status or an identical retry; changed operation/actor/revision conflicts.
An approved/expired request cannot be cancelled through this path; administrator revocation is
separate. Cancelling a request never terminates an already executing external operation.

## Bounded queue retention and compatibility

Retention is measured from server `requestedAt`, with a fixed 24-hour limit. Inbox and requester
reads exclude aged entries immediately, without writes. A scoped worker runs a bounded single-
policy sweep on startup and once per minute, and new-request creation can prune aged entries in
its own CAS. Cleanup increments the logical policy revision, preserves unrelated concurrent
changes, and retries backend CAS interference at most four times. Cleanup is not an unbounded
scan. An unavailable/locked backend defers physical cleanup until a later successful sweep;
logical age filtering still applies to successful reads. It does not claim offline data erasure.

Aged requests and their expired associated approval grants are removed together so stale
item/run constraints cannot disappear while a live grant remains usable. If an inconsistent
ledger contains a still-live associated grant, cleanup refuses it. Unrelated grants are not
removed. Descendants of a removed parent cannot regain access through a missing lineage. The
existing 128-entry queue cap applies after safe age cleanup; young entries are never silently
evicted to make room. This also reclaims expired approval-grant slots, rather than exhausting
the separate 128-grant cap indefinitely.

Retry/ownership evidence is retained for the same finite window. After it ends, status/cancel
return `not-found`; callers must use fresh IDs for new work. Reusing a forgotten legacy request
ID can at most create a fresh pending request, requiring a new current-revision human decision.
It cannot restore an approval or trigger execution. The monotonic policy revision prevents an
old administrator decision from becoming current after cleanup. This is bounded idempotency,
not permanent duplicate suppression.

Only the latest access-policy value is pruned. OpenBao KV version history, backups and the
separate capped audit retain their operator-owned policies. No delete/destroy permission,
OpenBao subtree, Library integration or production action is added. Format 3 prevents a format-2
writer from silently stripping run binding and retention metadata. Downgrade requires a compatible
reader or reviewed recovery with post-backup revocation reconciliation, never a silent format edit.

## Explicit-retry preparation and recovery validation

`loom_vault_access_retry_prepare` is a read-only requester capability on the existing access
service. It accepts the retained request ID, waiting-operation reference, expected request
revision and one typed proposal using the existing SSH, Git-over-SSH or GitHub API command
contracts. Unknown command kinds and unbounded inputs fail decoding. Ownership still requires
both authenticated thread and original requester actor. Request state and evaluator checks use one policy snapshot, without an audit write or any call
to execution adapters. Before returning, a second policy read and fresh requester status reject
a concurrent policy version or operation-state change as `context-changed`. An outage on either
read returns an error; no cached preparation is offered. This bounded observation is not atomic
with later execution, so normal adapter checks remain mandatory.

Preparation requires an approved, unexpired, run-bound request, matching item/version, `use`
action, exact derived destination and current full-access/default runtime. API repository scope
cannot authorize Git transport. The item must have the corresponding SSH-key or service-connection
kind. Pending/terminal, unbound, stale, changed or denied contexts remain blocked. The returned
`policy-valid-recheck-adapter` state describes only this point-in-time policy check: the caller's
SSH target has not been compared with the encrypted key, host trust, broker availability, provider
permissions and connector configuration have not been tested, and normal adapters must revalidate
all inputs and current grants before a separate explicit attempt. There is no readiness token.

A schema-encoded SHA-256 digest covers the exact typed proposal and its environment, requester,
request and captured run/operation correlation. Recovery supplies the previous digest and the
proposal again; a changed command, repository, timeout, target or context does not silently become
the old operation. This digest is caller-retained comparison metadata, not a signed receipt, an
external idempotency key, evidence of execution or proof of human review. Neither proposals nor
digests are persisted. The original approval covers resource/action/destination scope, not an
exact command. Never put credentials in proposals; the existing command interfaces are not private
secret-input channels. Existing queue age-out bounds recovery lookup.

The caller declares `not-started` or `unknown`, never a claimed retry-safe failure. All arbitrary
SSH commands conservatively have unknown remote effects; Git fetch has local writes; GitHub
comment/create has remote writes. An unknown result for any of these requires outcome review,
even with valid policy. Git ref listing and the typed GitHub read operations are classified as
reads. These classifications do not observe external state or undo effects. A false caller claim
of not-started grants nothing: every result keeps `canExecute`, `automaticResumption` and
`allowOnceConsumption` literal false and requires independent adapter validation. No execution,
continuation, provider dispatch, consumption or notification side effect is introduced.

This slice is additive/read-only and leaves policy format 3 unchanged. No OpenBao path or policy
permission, Library change or production rollout is introduced.

Preparation returns an actionable `nextStep` plus fixed safe repair text: refresh a changed
request/context, wait for a human decision, request fresh access for stale/terminal work, review
the changed proposal, select a supported connector, restore runtime, review access, inspect an
uncertain outcome, or recheck through the normal adapter. The guidance does not expose command
bodies, trigger external inspection, mutate runtime modes, approve a request or assert that a
write is safe. A backend outage never returns a successful prepared response. Policy revision in
the response names the final observation, not a capability to reuse it indefinitely.

## Process-local notification observations

Kyle selected memory storage for this milestone. No correctness guarantee depends on a delivery
receipt surviving restart: there is no external transport and no automatic replay. Policy remains
format 3; no sidecar, path, permission or new downgrade caveat is introduced. A future transport
requiring durable duplicate prevention must select an independent versioned ledger rather than
changing access-policy. That work includes compatible-policy reader proof and missing/corrupt
ledger handling; it is not implemented by this milestone.

The notification service reserves at most one attempt per request per process. Its map has a
128-entry cap and lazy 24-hour expiry measured from request creation, matching the request queue.
Young entries are not evicted to admit more attempts. A full observation map suppresses additional
attempts while the request remains visible and decidable. The adapter receives only request,
thread, project and item IDs, the requested action and deadline, without secret values, command
bodies, destination URLs or approval grants. The current production adapter returns `stubbed`.

Concurrent duplicates observe one reservation. Attempts are limited to two seconds; typed failure,
timeout and interruption cleanup produce `unconfirmed`, never a false delivered receipt. These
observations do not prove a human saw an alert. Reads derive terminal/expired `not-required` from
the current request rather than an old attempt, and filter aged requests before returning at most
128 observations. A restart defaults pending requests to `not-delivered` for this process without
sending anything. This means no current-process evidence, not proof that a prior process never
sent an alert. No background retry, reminder schedule or durable exactly-once claim is made.

Inbox outcomes are an optional additive RPC field for older-server compatibility. Web/desktop
and mobile use shared status wording and derive terminal copy using their current expiry state,
so a cached in-flight result cannot outlive the visible pending request. A failed refresh still
hides stale data. Approval persistence, grants and every literal-false execution/resumption/
allow-once gate stay independent of observations.
