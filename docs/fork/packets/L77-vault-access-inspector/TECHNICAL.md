# L77 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Expose the same policy evaluator used at execution as an authorized explanation service. Join grant provenance, bindings, recent safe usage and pending requests. Preview a versioned policy or removal against known consumers without claiming knowledge of external copies.

## Contracts and authorization

`explain` evaluates a principal/resource/action context; `previewChange` returns known impacted consumers and a policy revision. Outputs include explicit unknowns. This feature does not create a separate grant evaluator or secretly apply changes.

Use packet-owned `loom.vault-access-inspector.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
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
ordinary T3 behavior. Agent tools use `loom_vault_access_inspector_*` names if exposed and
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
