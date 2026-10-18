# L72 technical design

Design draft against `2f385ee835`. No wire schema, database migration or backend is approved.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Run bounded checks inside the actual broker or runner context. Resolve profile requirements, verify unlock and grant state, and exercise harmless provider-specific operations such as repository reads. Classify authentication, authorization, network, host-trust and missing-tool failures separately; record check time and environment identity.

## Contracts and authorization

`run` accepts environment, optional project/profile and bounded check selection; returns a run ID. `read` returns per-check state, timestamp and safe recovery guidance. `cancel` stops unfinished checks. Cancellation and network failure never rewrite credentials.

Use packet-owned `loom.vault-readiness.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
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
