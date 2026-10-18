# L81 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. Packet-specific contracts still need implementation review.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Generate or explicitly import keys, keep private material behind the broker signing interface, and track public-key registrations and host trust independently. Give workloads a restricted identity set through platform-appropriate agent transport. Validate destination constraints using supported SSH mechanisms or a mediated connection, not an assumed hostname in generic signing requests.

## Contracts and authorization

Key generate/import/list/publicKey/test/archive/remove and host-trust inspect/accept/remove are separate operations. Signing endpoints accept an authenticated workload and authorized identity; they never return private key bytes. Do not promise remote revocation until registration removal is confirmed.

Use packet-owned `loom.vault-ssh.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Store encrypted versioned key material and fingerprints centrally. Keep known-host trust scoped to Loom environments. Local sockets and temporary public-key/config files have private ownership and bounded lifetimes; forwarding is disabled unless deliberately supported.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_ssh_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect packages/ssh, device-host SSH and MiniSshTransport independently. Prefer a shared credential adapter; do not rewrite base SSH arguments globally or relax host-key checking.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
