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
and browser/native login adapters remain unavailable. Kyle selected an isolated Loom target
and Migadu. Kyle confirmed that `vault@begam.in` exists and is dedicated to Vault tests.
That confirmation does not enable the adapters or prove reader access or live delivery.

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

Lease ownership ends with the root run. Queued follow-ups and pending runtime requests retain
ownership while activeRunId identifies that run. A real waiting thread with only background
subagents has no active root run and loses its lease, even though those subagents remain live
for other platform tools. They need a new root-run or separately manager-owned reservation;
their general MCP credential does not extend the old pool lease.

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

The revalidation effect is not an atomic transaction with an external provider. Loom is the
selected test app; live login still requires a reviewed durable cleanup/unknown-outcome policy. A lost mint
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
winning admission. A returned start activates only if the operation still owns the starting
state; reconciliation that closes or fences it wins, and the delayed response cannot run a callback. A cleanup finalizer is registered before start, including before a failed or
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

## Selected Loom test target and email boundary

The operator-only [local harness](../../../../apps/server/src/fork/vault/testkit/loom_test_instance.py)
uses the existing auth CLI and authenticated HTTP API against its fixed worktree-local
`.t3/vault-app-test` home. It seeds stopped synthetic threads through the event sink, disables all
configured providers, suppresses root `.env` loading and excludes inherited identity, Vault,
relay, SSH-agent and provider variables. Child HOME, XDG and gh configuration live in a private
`sandbox-home`; provider dotfiles are resolved there. Git uses sandboxed global configuration,
no system configuration, no prompts, file-only Git transport and a fixture-parent discovery
ceiling. Git cannot invoke SSH and its passwd-based personal configuration through this target.
This is configuration isolation, not an OS sandbox against full-access host programs. Direct
non-Git SSH features (Mini offload and SSH device hosts) still use passwd-home OpenSSH paths.
This target does not configure or exercise them; do not register those connections in it. The sample
workspace gets its own local Git repository with no remotes. Isolated `rev-parse` checks require
the exact workspace toplevel and its own absolute Git and common directories at prepare, start
and proof. An explicit scandir walk refuses symlinked metadata, object alternates and any
unlistable metadata directory; silently skipped glob results are not sufficient. Start/proof refuse incomplete Git
metadata; preparation may re-run init for an empty or HEAD-less directory only with a prior
harness ownership stamp and no redirected/shared layout. Existing valid fixtures need no new
stamp until creation/repair is needed. Global/system config is disabled during the probe.
Private JSON is published by owner-only temporary file and rename. Initial home-marker staging
stays outside the new home so an interrupted publication leaves an empty, retryable home.
Malformed/wrong seed markers count as incomplete. Unmarked published databases are preserved
before reseeding, and incomplete unmarked settings can be repaired without adopting unrelated
state. SIGKILL may leave non-secret temporary JSON in userdata or an initial marker temporary
file beside the dedicated home under `.t3`. These files are never adopted; automatic sweeping
would risk a concurrent writer. Remove only an orphan positively identified from a stopped
owned run. Atomic seeder marker publication preserves an existing marker on interrupted writes,
but database and marker publication are still separate operations. A hard kill between them
can leave an unmarked database, which this harness preserves before reseeding; plain seed CLI
reset still refuses unknown databases. A live runtime refuses preparation/start before writes or exec. Canonical fixture guards permit a dedicated descendant
of the recognized worktree home while refusing installed state or escapes from that descendant.
The target accepts loopback traffic only. Proof requests refuse proxies and redirects, bind to
the persisted environment identity, and mint only five-minute `orchestration:read` sessions.

Session reset means revoke and replace, with real HTTP refusal of the old credential before
and after replacement. Final cleanup revokes only sessions bearing the invocation's unique
subject, including a successful mint whose reply was lost. Tokens are kept in subprocess output
capture/memory and never included in the proof report. A process crash can leave a session until
its five-minute TTL expires; this operator proof has no durable cleanup barrier and does not
mark any pool account clean. It is neither a live broker adapter nor proof of human OIDC/passkey
account provisioning, browser-session revocation, application data reset or worker isolation.
No Vault store, policy, journal, schema, execution flag or public transport is changed.

Migadu is selected independently of Loom runtime pairing, which has no email verification step.
Kyle confirmed `vault@begam.in` exists and is dedicated to Vault tests. A dedicated read
credential and real delivery check are still required. Migadu plus recipients normally route to
auto-created `loom-<run-id>` folders, unless the mail owner applies the reviewed Pattern Rewrite
to Inbox. Reader correlation, retention and cleanup must cover the chosen routing. Use IMAP for
message reads; Migadu's management API manages mailboxes and aliases and is not the inbox
transport. Live credential custody remains Kyle-only in 1Password until L79 backend/custody/audit
approval. Never put that credential into the disposable OpenBao proof backend, fixtures, chat or
git. Keep management credentials out of worker access.
The [mail handoff](../../operations/vault.md#dedicated-migadu-test-mailbox-handoff) records the
remaining external setup. No personal mailbox, DNS or production identity was accessed.

## Gated Migadu inbox contract

The [read-only transport contract](../../../../apps/server/src/fork/vault/testkit/migadu_inbox.py)
is imported only by synthetic tests. It has no runtime registration, background worker, product
CLI/RPC/MCP endpoint, credential-file reader or live default connector. Calling it without an
explicit test connection refuses before authentication. Its fixed-host verified-TLS transport
is exercised against a disposable loopback server; no live Migadu session is opened. Python
3.13 or newer is required for strict address parsing, with an explicit refusal on older versions.

A request binds a fresh 32-hex run ID, the derived `vault+loom-<run-id>@begam.in` recipient, an
expected sender and a fifteen-minute window. It EXAMINEs the exact tag folder, then Inbox if that
folder is unavailable; it never enumerates folders. UID SEARCH covers at most the latest 64
possible UIDs below the observed UIDNEXT. Header PEEK filters sender, recipient and server
INTERNALDATE before fetching a bounded body. Conflicting run aliases refuse selection; sender
Date headers do not set freshness. INTERNALDATE has second precision, so arrival filtering
floors the request start to its second; no wider clock-skew allowance is implied. Malformed
address-header objects refuse correlation, including semicolon-separated or trailing-dot aliases.
A final STATUS observes UIDVALIDITY independently of the cached EXAMINE response. Changed epoch,
routing headers, body metadata or expiry across reads and logout withdraw the result. This is an observation, not an atomic verification transaction.

The result distinguishes usable messages from per-candidate outcomes. An unusable matched MIME
body, part/encoding/text limit or oversized message is visible as `unusable`, while another UID's
usable text remains available. With no usable message, such candidates produce `unusable-candidates`,
not pending. Oversized in-window headers are skipped as `unclassified`; arrival filtering happens
first so old unrelated mail produces no candidate. A missing UID or FETCH NO becomes
`unavailable`, without assuming that NO proves expungement. With no usable/unusable message,
these observations produce `incomplete-in-bounded-window`. All candidate reasons are fixed
codes, with no provider error or unusable body content. Candidate outcomes are bounded by the
64-UID scan; at most three usable messages are returned.

Other bounds are 256 KiB per body, 16 KiB per header, 32 visited MIME parts and 64 KiB decoded
plain text per message. The transport caps literals and aggregate logical bytes, plus stdlib
socket read-ahead, and verifies the certificate and hostname for `imap.migadu.com:993`. It uses
a ten-second socket inactivity timeout and checks a thirty-second elapsed budget at logical
read boundaries. This is not a hard wall-clock bound: one imaplib read with continuous slow
progress can outlast it. A custom deadline-aware receive layer is not implemented; this remains
a live-read acceptance limit. The stdlib TLS handshake has its own timeout. The reader never
downgrades to plaintext or accepts a prompt-selected host. MIME multipart subtypes, including
signed/unknown ones, are traversed as mixed without validating signatures. Plain text is decoded
without rendering HTML, fetching resources or descending into attachments or message/rfc822
forwarded bodies. HTML-only messages produce empty text; no OTP or link is selected or used.

The result identifies its bounded coverage. An empty scan does not prove absence from older
mail, Spam or other folders. Sender-header matching is correlation, not authenticated sender
identity. `canReadLive`, `canExecute`, automatic resumption, automatic verification and allow-once
consumption stay literal false. No STORE, MOVE, COPY, APPEND, CLOSE, EXPUNGE or flag mutation is
issued. Provider failures disclose only fixed errors. The transcript and message tests use only
synthetic credentials and message content.

Kyle confirmed that the dedicated mailbox exists; live reader identity, custody/audit controls,
authenticated-sender handling, mailbox routing/header acceptance and broker/Vault-reference/grant
integration remain unfinished. Custody stays Kyle-only in 1Password until L79 approval, as the
[operator handoff](../../operations/vault.md#dedicated-migadu-test-mailbox-handoff) requires. The
prototype adds no live credential export and does not clear the pool cleanup/reuse barrier.
Policy3, journal1, registry1, existing gates and Library behavior are unchanged.

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
