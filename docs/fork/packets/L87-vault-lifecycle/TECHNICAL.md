# L87 technical design

Target design drafted against `2f385ee835`. Kyle authorized implementation and selected
OpenBao for encrypted storage. The internal durable evidence ledger is implemented behind closed gates; live issuer and
rotation contracts still need implementation review.
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

## Approved durable lifecycle evidence

Kyle approved a separate versioned CAS ledger under the existing environment-specific profiles
prefix. `CredentialLifecycleLedger.ts` writes `profiles/_operations/credential-lifecycle-v1`
inside that prefix, using the existing `json-v1` envelope and capabilities. Policy format 3 and
approval journal 1 are unchanged. There is no public transport, scheduler or live issuer worker.

Version 1 retains bounded operation records: immutable item/version and issuer references,
per-item generation, reviewed binding/consumer digests, expiry, revision, phase, a reference to
an already encrypted credential item where known, and a receipt digest. It never stores token
values or arbitrary provider response bodies. Phases are prepared, issuing, issued, validated,
revoking, revoked, cancelled and unknown. CAS makes the transition authoritative only as stored
evidence, never as permission to dispatch. Current grants, provider receipts, consumer checks
and eventual mandatory one-time enforcement remain independent requirements.

Issuing intent precedes any possible external mint. Lost acknowledgement leaves the durable
phase visible after restart; it cannot be reset to prepared. Issued references cannot redirect
later cleanup, and validation cannot replace the reviewed consumer digest. Expiry blocks new
issuance/validation but permits revocation maintenance. An unresolved issuing/revoking/unknown
record blocks overlapping generations for that item. Unknown stays blocked until a separately
verified recovery procedure exists; absence, timeout or restart never remints. Cancellation is
available only before issuing, and cannot resurrect revoked material.

All 128 records, including terminal receipts and per-item generation history, are retained;
capacity refuses rather than evicts spent issuance IDs. A future reclamation scheme requires
provider fencing/replay guarantees and a host rollback barrier. This initial ledger deliberately
does not infer safety from queue age. Older runtimes ignore the separate record; no live workflow
may be enabled under a reader that ignores it. Real issuer integration, overlapping credentials,
consumer validation and cutover, review/repair UI, complete audit and production rollout remain.
