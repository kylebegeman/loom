# L87 technical design

Design draft against `2f385ee835`. No wire schema, database migration or backend is approved.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Create encrypted consistent backups covering payloads, metadata and required policy state. Keep recovery material separately managed. Restore into an isolated destination, verify decryption and policy integrity, then explicitly promote it with old-machine trust reviewed or invalidated.

## Contracts and authorization

Backup/create/status/export and restore/inspect/verify/promote are distinct operations. Recovery cannot silently revive expired or revoked identities from an older snapshot. Human exports are explicit, audited sensitive actions, not general agent tools.

Use packet-owned `loom.vault-recovery.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Version backup formats and integrity manifests; encrypt payloads and sensitive metadata. Define retention, off-host destination and deletion propagation. Recovery keys are not included beside their encrypted backup by default. Record restore provenance without secret contents.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_recovery_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Use backend export interfaces and fork CLI/UI registration. Do not fold Vault recovery into the upstream SQLite doctor command without an explicit reviewed integration.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
