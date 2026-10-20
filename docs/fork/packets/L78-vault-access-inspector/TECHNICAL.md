# L78 technical design

## Implemented boundary

The local milestone exposes the execution evaluator through an authorized explanation
service. It shows policy/grant revisions, ancestry and recent safe decisions. A versioned preview
shows known descendant grants and item references before applying a change, with explicit
unknowns for external copies and unimplemented consumers. Abandoning a preview changes nothing.

Web/desktop Settings, a contextual item link and the active-thread command palette reach the
inspector. Mobile has equivalent settings and an item-context sheet. Updated policy hides old
results in the mounted management view; readiness expires after 60 seconds. CLI/MCP reuse the
same service. Calling threads can explain only themselves and need inspect access for item
metadata; full-access administrator clients may specify a thread.

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

The inspector now observes matching project profiles, the current provider/run, current item
workload sessions and enrolled-broker presence, and retained requests for the selected thread/item.
These bounded, read-only observations expire within 60 seconds and carry explicit omitted counts.
Inspect access bounds related metadata; async context/version drift withdraws relationship labels.
Partial or unavailable context never changes the separate evaluator decision. Profiles are labelled
as project defaults, not inferred current-run selections. No credential delivery or new storage is added.

Remaining: versioned rotation impact across those consumers, complete audit retention and platform
member visibility. Remote relay/tunnel, Electron shell and Android
interaction checks remain separate coverage. A preview cannot inventory external copies.

The following sections retain the complete target design where it exceeds this milestone.

## Overview

Expose the same policy evaluator used at execution as an authorized explanation service. Join grant provenance, bindings, recent safe usage and pending requests. Preview a versioned policy or removal against known consumers without claiming knowledge of external copies.

## Contracts and authorization

`explain` evaluates a principal/resource/action context; `previewChange` returns known impacted consumers and a policy revision. Outputs include explicit unknowns. This feature does not create a separate grant evaluator or secretly apply changes.

Use packet-owned `loom.vault-access-inspector.*` RPC methods if Loom transport is needed; the current schemas are in the shared contract. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Read shared relationships with bounded pagination. Previews are short-lived and carry revision fingerprints; no persistent copy of the access graph or raw provider output is required.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use the names listed in the implemented boundary and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Use fork-owned item details and error presenters. Keep the canonical evaluator in the proposed foundation; no client-side authorization decisions.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
