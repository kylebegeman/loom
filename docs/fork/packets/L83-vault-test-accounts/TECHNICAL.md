# L83 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Organize accounts by app, environment and role, with encrypted login and optional TOTP/session material. Adapters can provision, reset, reserve and retire accounts. Reserve atomically with an expiring lease and quarantine dirty accounts until reset succeeds. Optional development inbox adapters retrieve verification messages for dedicated test domains.

## Contracts and authorization

Collection/account CRUD plus reserve/renew/release/quarantine/reset/retire. Reservation returns a lease and safe account summary; login delivery is separate. Provisioning uses request IDs so retries cannot create duplicate accounts. Destructive resets apply only to dedicated test environments.

Use packet-owned `loom.vault-test-accounts.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Encrypt passwords, session cookies, TOTP seeds and recovery material as separate typed fields. Store reservation ownership, reset receipts and adapter capabilities. Bound message/session retention; never replicate cookies through Library or conversation attachments.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_test_accounts_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect browser profile/session and device test integration before adding delivery hooks. Credential fields belong in Vault, not browser evidence or test transcript fixtures.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
