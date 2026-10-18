# L85 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
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
