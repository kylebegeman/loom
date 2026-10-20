# L86 implementation plan

Status: In progress; timed approvals, requester lifecycle and bounded queue retention implemented. The sequence below describes the full packet outcome;
see README for delivered progress and remaining work.

## Delivered milestone and next work

The existing access service now atomically stores bounded durable requests, reviewed timed
decisions and grants in its existing policy. Web/desktop and mobile inboxes expose approve,
deny, cancel, expired status and revoke. MCP can create, inspect or cancel its authenticated requester's own pending request, but cannot decide it. Notification transport is a supplied stub. Existing grant enforcement applies.

Requester status and cancellation now use the trusted invocation identity. Durable correlation
stores a caller's opaque operation reference and the server's current run, without command
payloads. Approval and access reject a different captured run. Status is read-only and has no
execution token. Automatic resumption and allow-once consumption remain literal-false gates.

The current queue has a 24-hour age limit and the existing 128 cap. A scoped one-minute worker
and atomic creation cleanup reclaim aged requests plus expired approval grants; cleanup refuses
to discard a live grant's binding. Backend history/audit retention remains separate. Existing
policy writes with an approval ledger use format 3 to prevent older writers dropping correlation.

Typed read-only retry preparation now validates exact proposal scope, requester/run, item/version,
request revision and current evaluator access. Caller-retained operation digests support recovery
comparison; uncertain writes require outcome review. No adapter is called and no continuation is
persisted. Policy format stays 3.

Recovery validation now rejects concurrent policy/status changes and backend outages, reconciles
lost approval replies, and provides actionable repair guidance with focused failure/race coverage.

Bounded process-local notification observations are implemented with an explicit stub transport,
24h/128 limits, single in-process attempts, a two-second deadline, interruption cleanup and
shared web/mobile status copy. Reads and restarts never resend. Kyle selected memory storage;
policy stays 3 and no sidecar is written.

Requester status now includes only its owned request's process-local notification outcome.
Lost creation replies reconcile without alert replay, and fresh service reconstruction preserves
request/run correlation while discarding notification observations. Older restart tests now use
fresh layers so their recovery assertions exercise real service reconstruction.

Pending/all review is implemented on web/desktop and mobile using shared expiry-aware filtering,
counts and pending-first sorting. Decision and deadline races with a late adapter result retain
current request authority and never reopen pending work.

Kyle's native iOS acceptance passed on source `d849f9b20a` / nightly `0.0.99`, including pending/all
review, decision/revoke/cancel, expiry, correlation and fail-closed recovery. Evidence and
remaining surface limits are recorded in TESTING.md. No parallel simulator pass is needed.

Local explicit retry integration now composes real policy, broker/workload and operation services
with synthetic external transports. Timed approval permits a separately invoked SSH, Git-over-SSH
or GitHub API operation; revocation, stale context and uncertain writes retain their checks.
The public preparation/resumption/allow-once gates stay false and no new execution endpoint is
introduced. Live-provider and durable resumption/consumption acceptance remain open.

The durable journal is implemented as an internal service under the reserved non-project branch
`profiles/_operations/approval-journal-v1` in the existing environment namespace. It stores
versioned digest-only entries through the existing json-v1/CAS adapter, bounded at 24 hours from
request creation and 128 entries. No public endpoint, dispatcher or continuation uses it;
registration has no backend reads/writes. Reservations reconcile conservatively to unknown.
The real synthetic OpenBao proof uses only the documented minimal service-policy capabilities,
checks denied siblings and format-3 independence, and restarts the backend to verify retention
of unknown outcome and approval revocation. No production policy was inspected or changed.

Approver-context labels and accessible review are implemented with bounded current metadata,
ID fallback for older servers, changed/unavailable-context warnings, named web regions/headings
and contextual native action hints. Stable IDs/version/destination remain visible and server
decisions stay authoritative. Kyle's approver-context iOS pass accepted current/changed/missing
context, counts and UI denial/cancellation. The fixtures were direct synthetic policy CAS writes,
not request-tool creations. The follow-up's disabled hints, header roles and actual VoiceOver
speech are source-verified only; deleted-project handling is unit-test-only. TESTING.md records
the evidence and remaining surface limits.

Requester-safe journal recovery status is implemented as a read-only authenticated-thread MCP
service call. Reserved/unknown entries require outcome review, missing/aged evidence never proves
non-execution, and current request authority is returned separately. Ownership precedes journal
reads; corrupt or unavailable evidence does not block ordinary approvals. Project cleanup
regression coverage protects the reserved journal and sibling registries.

Public explicit retry preparation now composes the policy check with durable recovery
observations. Retained reservations/terminal outcomes override a not-started claim, prepared
digests detect changed proposals even without a client receipt, cancelled preparations cannot
reopen, and current denials remain authoritative. Lookup failures fail closed; observation
creates or consumes nothing. The isolated existing-policy OpenBao proof covers the public
composition and read-only reservation observation across restart.

The gated dispatcher/consumption design and synthetic proof are recorded in TECHNICAL.md.
Fresh CAS acknowledgement, a non-serializable single-use in-process opportunity, mandatory
reconciliation of every replay and final adapter authorization define the proposed boundary.
The model explores both contenders and failure placement; real services prove that reserve
replays are indistinguishable and that reservation does not consume a timed grant. No runtime dispatcher, one-time approval
discriminator or evaluator enforcement has been implemented. All public gates stay false; schema, paths and policy capabilities stay put.

Internal fresh acquisition is now implemented in the existing journal service. Only an
acknowledged prepared-to-reserved CAS yields a service-instance-local opaque handle. Replay,
CAS loss or uncertain writes reconcile and refuse. The handle is discarded before asynchronous
validation; current policy/bindings plus a final journal-version/age check remain required.
Copied, serialized or reconstructed handles cannot recover ownership. Every returned observation
keeps false gates. No transport, continuation, worker or adapter calls this internal boundary.
Controlled service races and the existing-policy synthetic OpenBao proof cover it.

Internal adapter admission and revalidation is implemented for SSH, Git-over-SSH and GitHub API
proposals. It consumes the local handle, binds the proposal digest, compares real adapter metadata
observations and rechecks current authority/journal state. Success writes nothing, opens no
workload and returns only false gates plus a required-live-validation limit. SSH broker/key/cwd
checks and GitHub repository/run checks execute locally; no command, signing, provider session
or probe occurs. Existing execution authorization remains audited; admission uses the same
read-only evaluator. No MCP/RPC/CLI or other dispatch surface was added.

Synthetic admission recovery acceptance now covers all three adapters' interruption and lost
results, reconstructed journal/admission services, copied results, concurrent use of one handle,
backend outage/restoration, still-approved requests with aged evidence and withdrawal after a
successful observation. It creates no runtime delta or new execution capability.

One-time intent/evaluator and downgrade-reader design now includes real format-3 reader/writer
counterexamples, alternate-grant bypasses and an abstract eligibility proof. Optional intent
metadata and journal-only enforcement cannot constrain today's timed grants. A future exact
human-reviewed intent needs mandatory entry-point enforcement and fail-closed reader/writer
compatibility; a schema change, persisted contract and gate proposal are not selected. Backup
rollback protection and historical-reader coverage remain explicit host-owner dependencies.

Next unblocked synthetic work: review the adapter-start consumption unit against SSH signing,
Git subprocesses and GitHub retries, with failure/replay counterexamples. No live transport,
persisted intent, format/path/policy change or gate proposal is authorized by that proof.
Real adapter/provider/host verification remains owner-gated. True one-time eligibility,
cross-adapter enforcement and downgrade safety remain prerequisites before any gate can open.
The journal must
remain behind closed execution/resumption/allow-once gates; enabling a gate still needs Kyle's
approval. Journal-bound dispatch, durable allow-once grant consumption and external outcome
reconciliation remain unfinished. Policy stays at format 3.
Fresh step-up authentication, Android/Electron and remote
relay/tunnel acceptance remain unfinished. L75 stays waiting on CW-1/L79 host policy.
Do not mark the full packet done.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Steps

1. Define eligible approvers, decision scopes and pending-operation resumption.
2. Implement durable request deduplication, decisions, expiry and one-time consumption.
3. Expose an inbox and waiting task state across clients, then add optional platform notifications.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
