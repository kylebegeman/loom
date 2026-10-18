# L80 technical design

## Implemented boundary

The local milestone provides environment-owned thread/project grants, one default-deny
evaluator, exact item/action/project/destination scopes, bounded validity windows, parent
attenuation and authenticated direct-child delegation. Grant revisions and permanent revocation
survive restart and OpenBao restore. UI changes require an explicit preview and apply;
suspension is reversible. Workload identity comes from ThreadManagement, never prompt text.

Existing agent metadata, private ingress and lifecycle paths enforce the evaluator and T3's
permission ceiling. Human environment administration remains governed by access:read/write;
agent threads cannot administer root grants. Scheduled jobs may use their authenticated T3
thread, but enrollment, workload leases and external runner attestation are not delivered.

Shared contracts are in `packages/contracts/src/fork/vault-access.ts`; implementation is
`apps/server/src/fork/vault/VaultAccess.ts` and `VaultPolicy.ts`. The active contract is in
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault).

Policy is one OpenBao KV v2 CAS document at
`environments/<sha256(environmentId)>/access-policy`, separate from item records. It caps grants
at 128, resources per grant at 32, audit retention at 256 and mutation receipts at 32. Policy
revision changes only on grant edits; audit writes still CAS against the backend version.
Decisions must persist before authorizing a gated action. Four contention attempts fail closed.
This is a bounded operational history, not an immutable audit service.

RPC tags are `loom.vault-grants.catalog`, `.snapshot`, `.apply`,
`loom.vault-access-inspector.preview`, `.explain` and `loom.vault-readiness.check`. Inspection
uses access:read and mutation uses access:write. MCP names are `loom_vault_grants`,
`loom_vault_grants_apply`, `loom_vault_grants_preview`, `loom_vault_access_explain`,
`loom_vault_readiness` and `loom_vault_grants_delegate`. There is no raw-value agent tool.

## Remaining target design

Finish enrolled machine/runner identities, schedule attestation beyond T3 thread identity,
platform membership and role mapping, external-use leases and broker revocation propagation.
Decide which deployment boundaries require separate OS users or containers. The current
allow-list union has no explicit deny rules. Same-user full-access processes remain outside
any promise of per-item host isolation.

The following sections retain the complete target design where it exceeds this milestone.

## Overview

Authenticate machine and workload principals separately. Evaluate grants against immutable item IDs, actions, intended destinations, project identity and time bounds. Child tasks receive a provable subset; human approval creates a specific grant or single-use decision rather than a blanket bypass.

## Contracts and authorization

Grant create/update/suspend/resume/revoke uses expected revisions. Evaluate receives an authenticated workload context, not caller-supplied principal claims. Delegation creates an attenuated capability tied to parent lineage and current authorization ceilings.

Use packet-owned `loom.vault-grants.*` RPC methods if Loom transport is needed; the current schemas are in the shared contract. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Persist principal identity, grants, revocations and policy revisions centrally. Audit grant decisions without credential values. Define matching semantics and precedence before schema; display effective expiry and outstanding leases.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_grants_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect MCP invocation identity, child-task setup and runner launch context. Do not accept unverified identity fields from prompts; keep policy independent of provider-specific tool approval modes.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
