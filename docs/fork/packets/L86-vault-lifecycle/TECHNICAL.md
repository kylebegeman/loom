# L86 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Adapters issue expiring credentials or certificates where supported. Rotation prepares a replacement, validates selected consumers, cuts over bindings, then retires the old version when the provider permits overlap. Track partial results and reconcile retries; providers allowing only one valid secret require an explicit interruption strategy.

## Contracts and authorization

Issue/renew/revoke leases and prepare/validate/cutover/retire/cancel rotation plans use versioned receipts. Renewal eligibility is re-evaluated against current grants. Cancellation cannot resurrect a provider credential already revoked.

Use packet-owned `loom.vault-lifecycle.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Persist issuance IDs, expiry, planned consumers and a recoverable rotation state machine. Keep old encrypted versions only for the accepted overlap/recovery window. Record provider revocation receipts and purge expired temporary material.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_lifecycle_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Register recoverable service workers through fork composition. If a database issuer is chosen, obtain schema/administration authorization and load the Postgres skill before authoring database-side resources.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
