# L81 technical design

## Implemented boundary

The policy supports two environment access modes. Existing and shared environments retain
restricted default-deny thread/project grants. An authenticated human owner can explicitly
declare a personal environment owner-trusted once, enabling metadata inspection and supported
brokered use for authenticated active full-access/default agent runs without recurring
thread/project/provider grants. Profiles are optional connection selections. Both modes use
the same evaluator and current item, run, destination and adapter checks.

The declaration is bound durably to the environment and the human subject that first sets it.
There is no verified platform multi-owner identity or membership model. Another person who can
launch agents in that environment is not distinguished from its owner by a prompt or provider
label; shared environments must keep restricted mode. Owner trust does not authorize a task,
elevate plan/runtime permissions, administer policy/trust, reveal/export values or bypass
format-4 one-time protection. Disabling returns to restricted evaluation without deleting
records, grants or recovery material. Existing authenticated sessions may continue.

Restricted grants retain exact item/action/project/destination scopes, bounded validity,
parent attenuation, authenticated direct-child delegation and permanent revocation. UI grant
changes require preview/apply; suspension is reversible. Workload identity comes from
ThreadManagement, never prompt text. Manage/private-ingress actions remain grant-controlled.
Human environment administration remains governed by access:read/write; agents cannot set
owner policy or administer their own root grants. Signed workload checks, hosted SSH/Git and
GitHub operations consume the same policy rather than a provider-specific bypass.

Shared contracts are in `packages/contracts/src/fork/vault-access.ts`; implementation is
`apps/server/src/fork/vault/VaultAccess.ts` and `VaultPolicy.ts`. The active contract is in
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault).

Policy is one OpenBao KV v2 CAS document at
`environments/<sha256(environmentId)>/access-policy`, separate from item records. It caps grants
at 128, resources per grant at 32, audit retention at 256 and mutation receipts at 32. Policy
revision changes on grant or owner-mode edits; audit writes still CAS against the backend version.
Decisions must persist before authorizing a gated action. Four contention attempts fail closed.
This is a bounded operational history, not an immutable audit service.

RPC tags are `loom.vault-grants.catalog`, `.snapshot`, `.apply`,
`loom.vault-access-inspector.preview`, `.explain` and `loom.vault-readiness.check`. Inspection
uses access:read and mutation uses access:write. MCP names are `loom_vault_grants`,
`loom_vault_grants_apply`, `loom_vault_grants_preview`, `loom_vault_access_explain`,
`loom_vault_readiness` and `loom_vault_grants_delegate`. There is no raw-value agent tool.

## Durable owner policy and compatibility

The existing environment access-policy path stores a version-5 outer envelope once owner
policy is first changed. It retains the complete legacy policy (formats 1/2/3) or protected
format-4 policy inside it, plus the environment/owner binding and bounded idempotent receipts.
Grant edits, approval cleanup and audit writes preserve the owner envelope and protected
classifications/intents. The mode has no expiry; current authorization is still evaluated online.

Only authenticated human owner RPC administration can call `setOwnerPolicy`; agent MCP,
broker/host and generic CLI clients cannot establish the owner. First setup binds the human
subject; later changes require that same subject and a current policy revision. Matching retries
observe current state rather than replaying an earlier enable after a later disable. Decisions
retain their grant or owner-trusted basis without secret values.

Older runtimes reject the version-5 envelope. Disabling personal mode keeps the envelope and
owner binding; it does not make a downgrade safe. Never strip it, drop format-4 protection or
restore stale policy just to run an older evaluator. Restore in isolation and reconcile later
mode changes, grants and revocations before permitting work. No item/schema rebootstrap or new
OpenBao path is required. See the [operating
limits](../../operations/vault.md#personal-environment-access).

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

Persist principal identity, access mode, grants, revocations and policy revisions centrally.
Audit grant decisions without credential values. Define matching semantics and precedence before
schema; display effective expiry and outstanding leases.

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
