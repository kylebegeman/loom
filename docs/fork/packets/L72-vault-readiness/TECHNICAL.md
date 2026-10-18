# L72 technical design

## Implemented boundary

The local milestone checks OpenBao connectivity, authenticated thread liveness and up to
16 explicit item/action/destination requirements through the execution evaluator. Results name
the Loom server context, include repair guidance and expire after 60 seconds. Web/desktop and
mobile can cancel a pending check; RPC, CLI and MCP use the same bounded service.

Use/reveal/export requests and empty requirement sets report missing broker/delivery support.
The backend check does not prove item-write privileges. An allowed grant does not prove SSH,
GitHub authentication, host trust, provider tools or unattended launch readiness.

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

Implement enrolled broker/runner context probes, profile requirement discovery, harmless
SSH/GitHub/provider checks and network/host-trust/tool failure classification. Integrate
preflight with project launches and schedules. Durable long-running check operations are not
needed by the current bounded server check, but remain required for future external probes.

The following sections retain the complete target design where it exceeds this milestone.

## Overview

Run bounded checks inside the actual broker or runner context. Resolve profile requirements, verify unlock and grant state, and exercise harmless provider-specific operations such as repository reads. Classify authentication, authorization, network, host-trust and missing-tool failures separately; record check time and environment identity.

## Contracts and authorization

`run` accepts environment, optional project/profile and bounded check selection; returns a run ID. `read` returns per-check state, timestamp and safe recovery guidance. `cancel` stops unfinished checks. Cancellation and network failure never rewrite credentials.

Use packet-owned `loom.vault-readiness.*` RPC methods if Loom transport is needed; the current schemas are in the shared contract. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Keep bounded diagnostic summaries and timestamps in the environment metadata store. Do not persist command output, environment dumps, device codes or credential values. Define freshness and retention at design review.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_readiness_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect GitHubHostSetup and runner launch preparation. Prefer adapter registration; do not insert credential probing into the pure orchestrator.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
