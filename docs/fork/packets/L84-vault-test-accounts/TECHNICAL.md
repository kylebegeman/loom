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
entry. Re-pairing creates a different owner and requires that explicit recovery. The workload service adds requester-scoped MCP discovery/reservation; provider continuation and
automatic account selection remain unavailable.
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
persists that safe state, so no background worker or timer is required for expiry safety. The workload cleanup reactor also
persists expiry on its next successful pass. Release,
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

## Authenticated agent reservations

`VaultTestAccountWorkloads` is the narrow workload boundary over the same account registry. MCP
invocation supplies environment, thread and provider identity; inputs cannot choose an owner,
thread, run or project. The service resolves the live run and project, refuses inactive, archived,
deleted, non-full-access/default or mismatched-provider callers, and rechecks that binding across
async waits. `loom_vault_test_accounts_discover` is observational. It returns only available
references and the calling run's own reservations, with just their collection context. Other
leases, unavailable entries and unrelated collection metadata are omitted; no receipts or admin
snapshot cross this boundary. Empty discovery is not proof that a collection does not exist.
The ledger revision is a conflict token, not authority or an environment activity feed.

Discovery requires both `inspect` and `use` through the existing grant evaluator. The exact scope
is `loom:test-accounts:<collectionId>`; existing unscoped grants also match under normal evaluator
rules. This is a pool scope, not a provider host or login endpoint. Reserve/renew audit and recheck
those actions, active pinned Account version, workload identity and transport ceiling before CAS.
The sole mutation tool accepts reserve, renew and release; the CLI aliases use that same boundary. It cannot mark clean, create, archive,
retire, approve itself or return credentials. Release requires the exact owned lease but remains
possible after item grant withdrawal. Mutation results pass through the same filtered discovery;
withdrawal can hide a lease that was already committed. Inspect/reconcile before retrying.

Run ownership uses a versioned `run-v1:` JSON binding in the existing owner string: environment,
thread, provider instance, project and run IDs. It is public identity metadata, never a bearer
credential. Bindings exceeding the existing 512-character limit refuse. No optional ownership
field, ledger schema bump, access-policy field or operation-journal entry is introduced. Old
registry readers preserve the owner string and enforce expiry, but cannot enforce run/grant
cleanup. Downgrade therefore needs upgraded pool workers or explicit manager quarantine; storage
read compatibility does not imply equal lifecycle enforcement.

The scoped cleanup reactor runs on startup and every minute. It CAS-quarantines expired leases
of either owner kind and run leases whose original identity, project, provider, item/version or
inspect/use access is no longer valid. Malformed run bindings quarantine. Unavailable/corrupt
backend or identity reads fail closed without inventing a clean state; the next pass retries.
There is no broad host cleanup or provider logout. CAS is against the observed ledger version,
so cleanup never clears a newer lease after a competing manager or worker change. A conflict is
retried only by a future scan, not by replaying a stale cleanup decision. Reconciliation is
idempotent, preserves receipts, and increments the registry revision only when it changes leases.
Reads and mutations refuse current invalid identities independently of the cleanup interval.

These are local pool metadata checks, not an atomic transaction with grants, thread state or
providers. Discovery is a point-in-time observation; a reservation is not login delivery. A future
broker delivery operation must check the current owned lease, its deadline and pinned item,
exact app/environment and operation-specific destination again, then handle revocation and
external cleanup. No login, reset, continuation or L86 one-time execution gate is enabled here.

## Login delivery admission boundary

The internal `prepareLogin` method now binds the current owned account lease, pinned item,
collection app/target, canonical adapter login origin and fixed deadline. It returns safe metadata
and a revalidation effect, never a bearer token or credential. Both pool inspect/use and a
separate use scope `loom:test-login:<collectionId>:<origin>` are required. HTTPS origins are
canonical and contain no path/query/credentials; HTTP is accepted only for explicit loopback
origins. An application label never selects a destination. The future selected adapter must
supply its registered origin, rather than using a prompt URL as configuration.

Preparation is observational. Each revalidation checks current run identity, the exact lease,
Account version and scopes again, audits login use and checks the lease again after that wait.
A lease renewal cannot extend a prepared deadline; release, replacement, retirement, expiry,
withdrawal or account rotation invalidates it. All delivery/resumption/allow-once gates are
literal false, and no MCP/RPC/CLI login endpoint, live adapter, credential reveal or persisted
login intent is added. The synthetic transport proof opens only a local fixture session and
cleans it on a rejected callback; it proves no real provider logout or crash recovery.

The revalidation effect is not an atomic transaction with an external provider. Live login must
wait for a selected test app and a reviewed durable cleanup/unknown-outcome policy. A lost mint
response cannot be treated as not-started, retried into another session or refunded by lease
release. The L86 protected-item and temporal-consistency decisions remain separate owner gates;
this account boundary does not bypass them.

## Synthetic broker login-delivery contract

`testkit/SyntheticLoginDelivery.ts` is an executable test-only contract, imported only by the
workload suite. It has no runtime layer, RPC/MCP/CLI entry point, real credential input or storage.
Its adapter registration binds environment/machine, app, test target, canonical origin and a
current broker deadline. The real workload admission guard checks account/lease/item versions,
run identity, pool grants and separate login scope before dispatch and before/after a callback.
The selected adapter must validate its own registered binding again at the effect boundary;
a prior observation cannot close that race. Returned session metadata must match operation,
machine, lease and origin before the callback receives the synthetic session handle.

A local atomic claim admits one start per model instance. Concurrent refusals cannot change the
winning admission. A cleanup finalizer is registered before start, including before a failed or
interrupted response. Cleanup targets the original operation ID, never an unvalidated returned
handle. The modeled transitions are:

| State               | Meaning and allowed next action                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| pending / admitting | One caller may perform current admission. A pre-start refusal is terminal.                        |
| starting / active   | An external effect may exist. Exit always requests cleanup, even after a lost reply.              |
| closing             | One cleanup owns reconciliation; interruption cannot declare success.                             |
| cleanup-required    | Start outcome or cleanup remains unresolved. Reconcile cleanup only; no remint or callback retry. |
| closed              | Broker acknowledged a terminal operation fence; no later start with this ID may create a session. |
| refused             | No start was admitted; the model does not automatically retry.                                    |

A cleanup acknowledgement means a **terminal fence**, not merely that a lookup currently finds
no session. Synthetic race evidence includes a remote mint attempt arriving after cancellation;
the fixture fence refuses it. Reconstructing the local model cannot bypass a fence retained by
the synthetic broker. This deliberately assumes the broker retains that fence; the fixture is
in memory and proves neither real provider logout nor durable restart-safe cleanup.

`closed` describes only this synthetic delivery operation. It never marks a pool account clean,
refunds a lease, proves reset or authorizes reuse. Registry expiry/quarantine still operates
independently. Before live delivery, the owner must choose a durable cleanup/unknown-outcome
barrier, enforce it against account reset/reuse, define restart reconciliation and retention, and
prove provider-specific terminal revocation or equivalent fencing. A provider without that
capability cannot satisfy this contract by acknowledging absence. These are unresolved live
adapter decisions, not a new OpenBao permission/path/schema proposal.

All delivery, automatic-resumption and allow-once gates remain literal false. Policy3, journal1,
registry1 and existing runtime behavior are unchanged by this test/docs slice. L75 stays parked.

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
