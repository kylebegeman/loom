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
queue. The queue retains up to 128 requests, including terminal ones, and refuses overflow.
There is no pruning or full immutable audit history. The first request sets policy schema version 2; older readers reject it before writing, preventing
queue loss or edits that bypass approval bounds. Downgrade requires a compatible reader or an
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

The request remains thread-scoped, not single-operation or single-run authorization. It does not
pause/resume a provider or deliver credentials. After approval, the caller must recheck access
and explicitly retry through ordinary authorized adapters. One-time consumption, resumable
workload correlation and step-up authentication remain separate work.

`ApprovalNotifications` is a service adapter supplied with a no-op stub at runtime construction.
Only already committed requests reach it. Notification delivery and durable delivery retries
are absent and advertised as stubbed; no external message is sent. Inbox remains discoverable
without any notification service.

Capability `vault-approvals` gates web/desktop and native mobile inboxes. They use shared guarded
commands, expiry-boundary timers, explicit refresh, loading/empty/error states, decision retry,
and read-only availability when write permission is absent. Failed refresh hides cached requests.
The MCP request tool derives the caller thread from authenticated invocation context, rejects
non-thread callers and provides no decision tool; self explanation is the existing access tool.
All providers use the shared MCP boundary where available. Adapters without MCP do not acquire
an implicit approval path. Scheduled tasks and brokers continue to use the same evaluator;
requests do not bypass runtime modes or create special policy exceptions.
