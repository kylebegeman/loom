# L84 technical design

Full target design was drafted against `2f385ee835`; the first local milestone is implemented
against fork main `4070ef99a2`. Kyle selected OpenBao for encrypted storage.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Overview

Organize accounts by app, environment and role, with encrypted login and optional TOTP/session material. Adapters can provision, reset, reserve and retire accounts. Reserve atomically with an expiring lease and quarantine dirty accounts until reset succeeds. Optional development inbox adapters retrieve verification messages for dedicated test domains.

## First local milestone and boundaries

The server service is `VaultTestAccounts`; thin RPC handlers use destination `access:read` for
inspection and `access:write` for mutations. Client commands use the existing guarded command
boundary and its destination permission atom. Ownership uses `client:<authenticated sessionId>`
from the server, not a client-selected label or the shared pairing subject. Renew/release require
the exact active lease ID and owner; authorized managers can quarantine or retire an abandoned
entry. Re-pairing creates a different owner and requires that explicit recovery. No agent MCP,
CLI, provider continuation or automatic account-selection surface is added in this milestone.
Management metadata grants never substitute for item-use/reveal grants or supported delivery.

The encrypted json-v1/CAS ledger is independent of access-policy format 3 and journal version 1,
at `environments/<sha256(environmentId)>/profiles/_test_accounts/registry-v1` in the existing
`loom` KV v2 mount. Existing namespace-scoped `profiles/*` capabilities cover it. No new mount,
policy permission, production provisioning or Library schema is needed. `_test_accounts/` is a
reserved non-project branch; future profiles-root enumeration must skip it and `_operations/`.
Project retirement stays below the exact hashed project prefix; a regression preserves this
registry and the journal. Older runtimes ignore the independent ledger safely for storage
compatibility, but do not coordinate its pool leases. Do not route a pool worker through an
older runtime and claim reservation enforcement. Generic credential use remains outside the
pool even on this runtime.

The ledger holds at most 32 collections and 128 account references, including archived/retired
entries. An account references an existing active `account` kind and version from VaultCore;
this service never calls reveal or stores login material. One item ID may belong to only one
pool entry in the environment, preventing accidental parallel reservation through two collections.
Accounts cannot move collections, and a collection's app/target cannot change once it owns
entries. Rename is safe; adding/editing a reference always quarantines it for review. Only
`development`, `staging` and `test` targets are accepted. The operator must explicitly attest the
account is dedicated development material. This is not automatic detection of production accounts.

A single ledger CAS serializes reservation and all pool mutations. Expected revision, a stable
operation ID and an actor-bound canonical fingerprint protect retries; CAS losers return conflict
rather than retrying into a reservation. Up to 128 mutation receipts are kept, with entries older
than 24 hours pruned on mutation. Replay returns the **current** snapshot, not a saved lease or
historical availability. Aged/evicted receipt absence cannot authorize replay because the original
expected revision is stale. A lost response can be retried with the same operation, then inspected;
its lease is neither recreated nor extended. Malformed/unknown inputs and corrupt ledgers refuse.
No payload values or private errors enter receipts or normal responses.

Reservations last five or fifteen minutes. Renewal extends to at most fifteen minutes from the
current server time and at most one hour from original lease creation, without changing owner or
lease identity. Core item availability/version is checked on registration, mark-clean, reserve
and renew. Rights and lease age are rechecked before CAS. These are metadata management checks,
not a transaction with credential delivery or downstream provider state. A future delivery path
must revalidate independently and bind to a live owned lease; current generic credential paths
are not restricted by this pool.

Reads derive expired reservations as quarantined without writing. The next successful mutation
persists that safe state, so no background worker or timer is required for correctness. Release,
manual quarantine and expiry all require a new clean review before another reservation. Retire
cancels the local lease; restore returns to quarantine. Archiving/restoring collections refuses
while they have active reservations. Nothing terminates an external login, resets app data,
revokes an upstream token or promises isolation of a full-access process. Reset/provision/mail
and browser/native login adapters remain unavailable; no first application or mail domain has
been selected for them.

Web and mobile use a shared action/expiry helper, bounded metadata snapshots and explicit
refresh. A deadline timer updates visible expiry without continuous polling. All changes have
review/cancel, and failed reviews retain the exact operation for safe retry. Users can cancel and
refresh after conflict. Reference search uses existing safe-account pagination; no raw credential
field appears in this manager. Older servers are capability-gated as unavailable. Native
interaction, remote/relay/tunnel and assistive-technology acceptance remain distinct from web
and static evidence.

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
