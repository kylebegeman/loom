# L79 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Enroll a host through a reviewed, expiring challenge, then issue a renewable machine identity held outside projects. A local broker exposes authenticated per-workload channels and obtains bounded use leases. Report boot, unlock, reconnect, disable and re-enrollment states explicitly.

## Contracts and authorization

Enrollment start/claim/approve/complete and machine list/disable/re-enroll are distinct operations. Broker handshake binds host, workload and protocol version; a local socket path alone is not proof of caller identity. Status never returns enrollment secrets.

Use packet-owned `loom.vault-brokers.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Keep machine bootstrap material in a private service-owned location, rotate it after enrollment and exclude it from project clones. Use encrypted local cache only if an offline policy is selected. Pending challenges and identities have expiry and explicit cleanup.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_brokers_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect CLI/service launch environments and desktop shell hydration. Keep broker startup independent of an Electron window; use a fork CLI registration rather than a second app-specific credential service.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
