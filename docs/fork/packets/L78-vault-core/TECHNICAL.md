# L78 technical design

Design draft against `2f385ee835`. No wire schema, database migration or backend is approved.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Provide authenticated metadata and encrypted versioned payload storage behind a backend adapter. Host the authority alongside the begam.in/Loom platform on the VPS if that deployment is selected. Separate human platform identity, machine enrollment, storage-key custody and workload grants.

## Contracts and authorization

Propose `loom.vault-core.*` metadata and management methods plus private value ingress. Keep backend service APIs versioned independently of Loom RPC. Separate inspect, manage and use rights. Human reveal/export is a distinct sensitive action, never a normal list or agent response.

Use packet-owned `loom.vault-core.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Choose the backend and key-custody model at D1/D2 before schemas. Use a maintained encrypted engine or vetted primitives through supported libraries, authenticated encryption and explicit key versions. Define sensitive metadata treatment, size limits, immutable payload versions and deletion/retention semantics.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_core_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Reuse fork RPC, HTTP and service registries. Review ServerSecretStore/settingsSecrets only for explicit adapter or migration boundaries; do not silently replace upstream auth storage or relocate provider sessions.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
