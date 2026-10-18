# L73 technical design

Design draft against `2f385ee835`. No wire schema, database migration or backend is approved.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Use opaque stable IDs and a shared metadata picker. Search authorized labels, account roles and environments with bounded queries. Renames preserve bindings; a new secret version does not change the reference. Resolving a reference still checks the destination principal at execution.

## Contracts and authorization

`search` takes a bounded query and optional kind/project filter; `describe` takes an item ID. Return authorized summaries and cursors only. Attachment and binding mutations belong to the consuming feature, with the item ID validated at execution.

Use packet-owned `loom.vault-references.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Persist opaque references with consumer configuration. Keep search results short-lived in client-runtime state; exclude secret values and unauthorized item existence. Retired items keep a safe tombstone for existing references.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_references_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Reuse composer, settings and palette registries. Inspect the current typed attachment path before extending provider turn inputs; never serialize secret material there.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
