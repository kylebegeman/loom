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

## Requester notification visibility and reconciliation

Own-request status now optionally includes the same process-local notification observation as
administrator inbox reads. The service resolves the authenticated requester and checks request
ownership before consulting notification state. It passes only that request to the observation
service, never the whole queue. Non-owners, administrator-created-on-behalf requests and aged-out
IDs retain their existing not-found boundary. Status reads and retry-preparation/recovery reads
never dispatch alerts, write encrypted policy or expose a notification mutation.

If creation commits but the storage reply is lost, the request is still available in the inbox.
Its current process may have no attempted delivery, because dispatch follows confirmed commit.
The caller can reconcile by its stable request ID or identical creation replay; replay returns
the committed request without delivering an alert. This deliberately prefers truthful
`not-delivered` observation over duplicate delivery. Rebuilding the service preserves durable
request/run correlation but discards attempt metadata. Even terminal requests may then have a
null attempted timestamp, while current state still derives `not-required`. None of these fields
prove historical delivery or human review. After the 24-hour request window, lookup returns
not-found rather than falling back to a stale process observation.

The field is optional for older-server compatibility and never enters the stored policy. Policy
remains format 3, with no sidecar or new downgrade requirement. Every execution, automatic
resumption and allow-once gate stays literal false.

## Pending review and late adapter observations

Web/desktop and mobile use a shared pure queue helper for pending/all filtering, pending-first
ordering, expiry state and cached retention filtering. Pending is the initial view; a visible
reverse action exposes all retained decisions, including revoke on approved/expired entries.
Counts derive from current client time and retained requests, without another RPC or a continuous
poll. Existing boundary timers now include each request's retention deadline. Sorting mutates
only a newly filtered array, preserving source query data and Hermes compatibility.

A notification adapter can complete after a human decides or after the request deadline.
Observations always derive `not-required` from the current request, even when an attempt reports
delivery later. This does not cancel an already dispatched external alert or imply transport
recall. Production still has no external transport. A controlled service race proves approval
can commit while its original creation call awaits an adapter; the subsequent status remains
approved with one grant and no executable continuation.

## Durable operation journal v1

Kyle authorized this separate journal within the existing KV v2 `loom/` mount and environment
namespace, without changing access-policy format 3 or opening an execution gate. The documented
minimal service policy already permits read/create/update on `profiles/*`, but does not grant a
new sibling at the environment root. Use the reserved non-project branch
`environments/<sha256(environmentId)>/profiles/_operations/approval-journal-v1`. Project profile
readers resolve only SHA-256 project IDs and their registry/run children; they never enumerate
or open `_operations`. The prefix carries a reserved-branch comment: future root enumeration
must skip `_operations/`. Run retirement stays inside the hashed project root; a regression
protects the reserved journal, the project registry and a sibling project registry. This reuse needs no new capability, mount or list/delete/destroy right.
An isolated OpenBao proof must use that existing narrow policy, demonstrate successful CAS
read/create/update, and prove a sibling outside it is denied. No production policy is read.

The existing store supplies the `json-v1` envelope. The journal body has `schemaVersion: 1`,
its environment ID, a monotonic logical revision, and at most 128 operation entries. Each entry
contains the original request ID, waiting-operation ID, requester thread/run, item/version,
request revision, canonical operation digest, server creation/update times, fixed retirement
deadline, entry revision, state, optional reservation ID and a bounded outcome classification.
No credential, argv, prompt, continuation, output, private error text or arbitrary URL is stored.
The original retained request creation time fixes retirement at 24 hours, not 24 hours after
retry. New writes prune aged entries in the same CAS; reads hide aged entries. Young entries are
never evicted. Backend versions/backups have separate operator retention, as with access-policy.

Journal states are `prepared`, `reserved`, `completed`, `unknown` and `cancelled`. Preparation
requires current requester ownership and operation-specific policy validation. Reservation saves
a stable reservation ID before any possible future dispatch. It is durable evidence of intent,
never a dispatch permit: every result keeps `canExecute`, `automaticResumption` and
`allowOnceConsumption` false. No public RPC/MCP/CLI, provider continuation, execution adapter or
background worker calls these journal mutations in this milestone. There is no environment
setting that opens a gate. Synthetic tests exercise reservation and result recording directly
through this internal journal service.

| Crash boundary                                                          | Recovery behavior                                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before prepare commits                                                  | No journal entry; fresh explicit preparation still needs the retained approved request.                                                                                      |
| Prepare commits, reply lost                                             | Same ID/digest reconciles to the prepared entry; changed context conflicts.                                                                                                  |
| Before reservation commits                                              | Remains prepared; no dispatch is authorized by a failed write.                                                                                                               |
| Reservation commits, reply lost, or process dies before/during dispatch | Treat reservation as unknown and never redispatch automatically, even if an external effect probably never started.                                                          |
| External result arrives but completion write/reply is lost              | A saved completed entry is readable; an unsaved result remains unknown. No journal state proves an external write did not occur.                                             |
| Competing reservations                                                  | One CAS winner; a losing or repeated reservation never creates another dispatch opportunity.                                                                                 |
| Approval revoked, run/item changes, or request expires                  | New preparation/reservation is refused. Existing outcome evidence cannot restore access.                                                                                     |
| Missing/corrupt/unsupported journal, outage or age-out                  | Journal mutations fail closed; the observer reports missing evidence or an error. Ordinary approvals remain usable. Missing evidence cannot recreate an execution allowance. |

Reconciliation of a retained reserved entry conservatively commits `unknown`. Completion accepts
only the exact retained reservation identity and expected entry revision. Completed, unknown or
cancelled states cannot return to prepared/reserved. Stable operation IDs and CAS protect retained
retries, not permanent idempotency after age-out. There is no atomic transaction with policy:
validate before and immediately before journal CAS, and any future dispatcher must recheck policy
at its adapter boundary after reservation. A race may consume an opportunity without execution;
it must never grant an opportunity after revocation. An eventual provider-side idempotency key
or verified result could improve recovery but is not claimed here.

Downgrade: older runtimes never open this reserved record and continue reading/writing policy
format 3 and ordinary project profiles. They cannot safely continue a journal-bound operation;
resumption/one-time paths remain unavailable. Re-upgrade requires reconciliation with current
policy and request/run state; never delete the journal to manufacture a retry. The proof checks
an unchanged format-3 reader alongside the journal. No policy format 4 or capability escalation
is introduced. This journal is separate from memory-only notification observations.

## Approver context and accessible review

Inbox responses optionally include current thread/project/item metadata keyed by request ID.
The access service resolves only retained-request references, deduplicates each ID set, and
bounds parallel lookups (four per category). The existing `access:read` inbox boundary is
unchanged; no new lookup endpoint or grant is introduced. Metadata errors/missing references
produce unavailable labels without hiding the durable request or blocking deny/cancel/revoke.
Labels are response metadata and never enter the access-policy or journal.

Each result distinguishes current, changed and unavailable context. Current names do not attest
account identity or replace decision-time checks. A changed project/run, deleted/archived thread,
retired project or changed/archived item is flagged. Clients disable pending approval for changed
or unavailable context, retain the reverse actions, and continue showing the exact stored IDs,
version, destination and run. Older servers omit the field; clients retain ID fallback and normal
server-enforced decisions. A mismatched response request ID cannot relabel another card.

Web cards have named regions and record headings; decision accessible names include current
record/thread/project names and request ID, retaining distinct five/fifteen-minute actions.
Native cards have accessible headings and contextual action hints. Pending counts use polite
status semantics on TalkBack via `accessibilityLiveRegion`. iOS uses
`AccessibilityInfo.announceForAccessibility` when the pending/retained count changes after the
first loaded value; first load is silent. No control is hidden inside an accessible group that
would swallow its child buttons. Both clients show context warnings only while the request is
pending; decided cards show neither warnings nor decision actions. Kyle's native interaction
acceptance covers current/changed/unavailable context and decisions. Header roles, disabled
approval hints and actual VoiceOver count speech remain source-verified only; see TESTING.md.

## Requester recovery observation

`loom_vault_access_recovery_status` derives requester identity from the authenticated thread,
checks retained request ownership before opening the journal, then refreshes request status after
the read. It returns a bounded summary of that request's retained entry, without reservation IDs
or other requesters' metadata. Journal/request operation, run, item and version bindings must
match; a mismatched record fails closed. It never calls mutating reconciliation or writes,
prunes, reserves, consumes or dispatches work. The existing inbox and decision paths do not
depend on this read and remain usable if the journal is corrupt or unavailable.

A reservation or unknown outcome always requires external outcome review. Prepared evidence
records intent only; current policy/run/item status remains separate and adapter checks still
apply. A completed receipt or cancelled preparation is historical evidence, not current authority.
No retained entry means evidence is missing or aged, never proof that an operation did not run.
Aged requests remain not-found; no status read resurrects them. Every recovery result keeps the
three execution/resumption/consumption gates false. This additive MCP response changes neither
journal version 1 nor access-policy format 3 and needs no new path or policy capability.

The transport is shared by provider adapters and remote authenticated thread sessions. This
milestone adds no client UI or separate desktop/mobile entry point. Existing requester status remains available. Public explicit retry preparation now includes an
optional recovery observation, checks retained preparation digests, and narrows otherwise valid
proposals using durable history. A reserved, unknown or completed entry requires outcome review
even when the caller claims not-started. A cancelled preparation requires a new request and
operation reference. Current policy/operation denials retain precedence; context changes during
the recovery lookup require refresh. Corrupt/unavailable evidence fails closed. Missing evidence
never proves non-execution, and preparation creates no entry or consumption receipt.

The policy-only access-service check remains independent for internal reservation validation;
public MCP preparation calls the journal service's read-only composition. This avoids a circular
service dependency. The optional response field is absent on older runtimes, whose preparation
does not inspect durable journal evidence. Downgrade never enables continuation of journal-bound
work. Future dispatch must consult durable recovery state as well as fresh access and adapter
validation; an observation cannot close an external effect race or authorize execution.

## Gated dispatcher and consumption boundary

This is an approved dispatcher design and synthetic proof, with the internal acquisition
boundary implemented below. No dispatcher or acquisition transport is registered. Every public
`canExecute`, `automaticResumption` and `allowOnceConsumption` gate stays false. Policy, schema,
path, mount, capability and external adapters are unchanged. Candidate dispatch transitions live
only in `OperationDispatch.proof.test.ts`; its counter represents a simulated adapter handoff,
not an external effect.

### What is consumed

Use the existing retained request as the attempt scope: environment, request/grant ID, requester,
run, opaque waiting-operation ID, item/version, request revision and canonical proposal digest.
The `prepared -> reserved` CAS consumes one dispatch opportunity for that scope. Completion,
refusal, cancellation, crash or uncertain outcome never refunds it. A new reservation ID or
changed proposal cannot create another opportunity on the same request. The original 24-hour
retirement and 128 cap remain; no young entry is evicted. Once the request ages out, refuse
continuation even if the journal has been pruned. Missing evidence is not proof of non-execution.

This is **at-most-one request-bound dispatch attempt**, not exactly-once external effects or
consumption of today's timed grant. The existing evaluator can still authorize normal adapter
operations with that timed grant after journal reservation. The real-service proof demonstrates
that fact without executing anything. There is no one-time approval mode in the current
format-3 grant definition, and a journal entry must never silently convert a timed approval.
Full-access agents can also use credentials or tools outside a Loom dispatcher; this feature
does not claim to isolate a full-access process.

### Fresh acquisition and replay

A future dispatcher needs a dedicated acquisition boundary. **The existing `reserve` response
is insufficient**: an identical replay returns the same observation as the first CAS winner.
Never branch from `entry.state === reserved` or a caller-supplied reservation ID to execution.
It is not a capability, even in the same process.

The proposed boundary performs these steps in the same invocation:

1. Require a new explicit typed operation, trusted requester identity and matching retained
   request. Run the existing evaluator and operation-specific preparation; validate broker,
   destination, host key/repository, item version and provider workload through the normal adapter.
2. Observe the journal and bind the exact digest and prepared revision. Only a freshly
   acknowledged `prepared -> reserved` CAS may create an opaque, process-local, single-use
   opportunity. It must come directly from the successful CAS branch, never a cached response,
   read-back, transport reply or serialized token. No worker/outbox event stores it.
3. If CAS fails, its reply is uncertain, or any lookup/replayed reserve observes `reserved`,
   run reconciliation before any further attempt: `reserved -> unknown`. If reconciliation
   fails or conflicts, refuse and require recovery inspection. Unknown/completed/cancelled
   observations never create an opportunity. This applies even when a lost reply probably
   preceded any effect. A competing replay may conservatively suppress a live winner.
4. Immediately before adapter handoff, recheck current evaluator authority, requester/run,
   item/digest/destination, broker readiness, reservation identity/revision and readable evidence.
   Burn the process-local opportunity before invoking the synthetic/external adapter, including
   when these checks refuse. No timeout, cancellation, restored connection or process restart
   regenerates it. It may be checked repeatedly for authorization, but may start at most one
   adapter operation. SSH signing callbacks and pre-dispatch token refresh are not new starts.
   Adapters must not transparently retry uncertain writes without proven provider idempotency;
   otherwise report unknown. A logical-start bound alone does not bound remote side effects.
5. Record only bounded outcome classification with the exact reservation/revision. A lost
   completion write leaves reserved evidence for reconciliation to unknown. A confirmed receipt
   can be read repeatedly but cannot dispatch. Late completion cannot reopen unknown state.

The existing `reserve` remains an idempotent receipt API. Internal `acquire` now implements the
fresh CAS distinction, and `checkAcquisition` provides single-use validation with no handoff.
The production adapter does not consume either result. An old reserve receipt cannot be upgraded
into an acquisition, and a successful handle check is an observation with false gates, never an
execution permit.

### Authority and concurrency limits

Policy and journal CAS are separate records, so they cannot atomically consume authority and
start an external effect. Validation before reservation plus fresh adapter checks narrow that
race. The model's handoff is the final authorization boundary: withdrawal observed before it
prevents a start; withdrawal after it cannot undo an in-flight/remote operation. Real adapters
must retain their repeated authorization checks where available. Do not claim a global
transaction, a lock against direct host access, or strict cancellation of already-started work.
A journal opportunity may be consumed without any effect; recover by inspection and a new human
reviewed request, never by resetting evidence.

| Boundary                                        | Safe result                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Competing prepared readers                      | Only a fresh acknowledged CAS winner can hold an opportunity; a loser/replay reconciles and never gains one. |
| Reservation commits but acknowledgement is lost | No process-local opportunity; reconciliation records unknown, even if nothing ran.                           |
| Crash before handoff or after remote start      | The process-local opportunity is gone. Reconcile retained reserved evidence before considering new work.     |
| Current authority or context fails at handoff   | Refuse and burn the opportunity. No retry on the same reservation.                                           |
| Completion write/reply is lost                  | Saved completion is historical; unsaved outcome becomes unknown. Neither permits replay.                     |
| Outage/corruption/age-out or disabled gate      | Refuse. Storage recovery does not regenerate an opportunity or restart work.                                 |

### One-time grant enforcement remains an explicit decision

The attempt protocol is a prerequisite, not the full allow-once feature. Before enabling it,
choose a downgrade-safe way to distinguish one-time intent from timed access within the existing
approved storage boundary, and make the evaluator plus **every** SSH/Git/GitHub, CLI/MCP,
scheduled-run, provider and broker credential-delivery entry point enforce that intent. Alternate
grants must not silently satisfy a request advertised as one-time. Decide whether consumption
means one adapter start, one credential release or one provider-acknowledged operation, including
SSH multi-sign/connection attempts, Git fetch writes and HTTP/provider retries. The proposed safe
unit is one adapter start with no transparent replay of uncertain effects; provider idempotency
or independently verified results can improve recovery later.

Those eligibility/enforcement and downgrade decisions are open. Safe default: refuse the
one-time/resumption paths and preserve existing timed-grant behavior. No mode field, format bump,
new path or policy right is selected or written here. A future strategy needing one requires
Kyle's explicit approval. Cross-client/evaluator acceptance and live-adapter crash/revocation
proofs are required before asking to open a gate; the abstract model alone cannot justify it.

### Implemented internal acquisition contract

`OperationJournal.acquire` accepts a typed proposal, prepared revision and reservation identity,
with requester identity supplied by the trusted service caller. It snapshots proposal/mutation
values, checks ownership before reading the journal and validates the complete request, operation,
thread/run, item/version and canonical digest binding. A retained reservation is reconciled to
unknown and returns conflict. Terminal, aged, mismatched, denied or unreadable evidence refuses
acquisition. An acknowledged fresh CAS alone creates a frozen opaque handle. A failed CAS never
retries into acquisition; it reconciles then returns failure. If reconciliation is unavailable,
refusal is preserved and a later attempt must reconcile before obtaining anything.

Handles are keyed by object identity in a service-instance-local `WeakMap`; their symbol brand
has no serializable payload. JSON decoding, copying the symbol or reconstructing the service
cannot reproduce ownership. Captured proposal and reservation data are independent snapshots
in process memory, never added to the journal. A dropped handle may be garbage collected;
retained handles remain subject to the original request/journal expiry and cannot extend it.
Construction and registration perform no backend reads or writes.

`checkAcquisition` deletes that identity before any asynchronous check, even when the requester
is wrong, validation refuses or the fiber is interrupted. It verifies current request authority,
reservation identity/revision/digest/retirement and current workload/item state, then rereads the
journal and retirement clock after policy validation. Any journal version change, including a
competing replay's reconciliation, refuses the observation. Concurrent checks of the same
handle cannot both succeed. Success returns only the reserved observation and three false
gates; it never releases credentials, invokes an adapter or returns another handle. After owner
binding succeeds, a failed or interrupted check attempts reconciliation without refunding the
identity. Unknown or wrong-owner handles are
refused before reading or mutating the journal.
Interrupted reservation writes also attempt reconciliation; a process crash or failed cleanup
can leave reserved evidence, which every later acquire must reconcile. No unknown state becomes
prepared or reserved again.

A losing contender can reconcile the acknowledged winner to unknown, invalidating its handle.
This sacrifices availability to preserve refusal on uncertainty. Policy/journal records still
have no shared transaction; the final reread narrows races but is not a lock against later
withdrawal, host changes or remote effects. A future dispatcher still needs its normal adapter
readiness/authorization boundary and explicitly approved gate changes. Neither this handle nor
its consumed observation supplies that permission. No public MCP/RPC/CLI, queue worker or
provider continuation calls acquisition in this milestone. Existing timed grants remain timed.
Access-policy stays format 3 and journal body version 1 at the same existing path. Old runtimes
cannot recover a handle; restart/downgrade retains only reservation evidence requiring review.
