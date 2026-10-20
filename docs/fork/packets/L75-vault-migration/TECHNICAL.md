# L75 technical design

The initial implementation uses the existing encrypted OpenBao boundary and destination-scoped
RPC authorization. Local inventory and replacement intent are implemented; verification receipts are implemented; read-route previews are implemented; live acceptance and configuration execution remain pending.

## Implemented reviewed import boundary

`vault-migration.ts` defines private prepare/apply ingress with redacted values and literal
`developmentOnly: true` / `reviewed: true` attestations. Only `secret` and `secure-note` are
accepted. Preparation binds label, kind and value with a digest, generates a new item ID, and
stores no private value in the plan. The immutable review lasts ten minutes; a retry with the
same ID cannot extend its lifetime or alter its metadata/bytes. The attestation is a human
statement, not automatic proof of ownership or development use.

`VaultMigration.ts` stores encrypted, CAS-protected ledgers at
`environments/<sha256-environment-id>/migrations/<review-id>`. Apply durably records acceptance
before saving a new core item at expected version zero. Core receipts bind the generated item,
source reference, operation and original actor. Interrupted responses can be inspected without
private input or ledger writes, and accepted imports can be retried with matching bytes.
Cancellation cannot undo an accepted operation. Archival checks the original save receipt and
version, durably accepts its own operation, and retries using the pinned actor and operation.
Edits to the imported record conflict rather than being overwritten. Later edits that replace
the only core receipt before a failed ledger write is recovered require manual review; the
service does not infer ownership from a matching label.

List/status return only summaries in pages of 25. OpenBao key enumeration is capped at 4096
by the shared store. Plan metadata has no automatic retention/erase job; backups and encrypted
KV history follow the backend policy. Cancellation and expiry do not erase historical metadata.

RPC list/inspect require destination `access:read`; prepare/apply/cancel/archive require
`access:write`. Shared commands observe revocation. MCP and CLI only provide safe list/status
for full-access administrator clients, never agent threads or read-only MCP clients. Private
input stays in the reviewed human form; no chat/CLI inline values or personal-store fallback.
The existing full-access environment can still read process/files; this is not OS isolation.

Capability `vault-migration-imports` gates clients. Web and desktop share the settings/palette
flow; mobile has its own private form. Every request targets the selected environment. No
provider adapter or scheduled task gets implicit import, approval or use permissions.

The OpenBao service policy requires read/create/update on the migration data subtree and list
on its metadata directory. [Host commands](../../operations/vault.md#development-import-operating-policy)
are a handoff to the host owner, not an executed deployment. No Library service change is needed.

## Inventory and replacement intent boundary

`MigrationGitMetadata` runs bounded, read-only Git configuration reads through ProcessRunner.
It uses `--local --no-includes`, disables system/global config and prompts, and replaces the
child environment with a small allowlist. Selected remote URL values are transient redacted
input: URL authentication, query/fragment data, helper bodies and SSH command strings are never
returned or stored in a plan. Safe SSH paths retain their leading slash and `.git` suffix;
canonical repository hints alone cannot identify the path for future Git verification. HTTP,
file/remote-helper schemes and ambiguous paths stay unsupported. Git configuration is never
executed as a shell command, and SSH configuration is neither read nor evaluated.

`VaultMigrationInventory` limits inventory to ten registered project roots, two reads at once,
with 40 dependency entries per project. Reads have a five-second/256 KB limit and show
unavailability instead of trusting partial output. This excludes other checkouts, global or
included settings, environment overrides, personal identity and external consumers. An absent
push URL is only the absence of an explicit local setting, not proof of no push dependency.

Replacement preparation rechecks the displayed descriptor, resolves safe candidate adapter
metadata, and binds the current project ID/root, selected local configuration and exact item
version. Only active typed SSH keys or GitHub connections matching the reported destination
are accepted. Local URL rewrites block preparation. Raw config fingerprints stay encrypted and
are never returned. The development-only statement is attestation, not source classification.

Plans use a separate `migration-replacements/<review-id>` subtree under the environment namespace,
so existing import ledger readers cannot confuse the two formats. OpenBao CAS and an immutable
request fingerprint protect retries. Reviews expire after ten minutes. Recording human review
rechecks source and item freshness and never widens permissions. Cancelling prepared, expired
or reviewed plans makes no provider/configuration changes; restart and read-only status retain
the receipt. Lists return 25 stored summaries without project scans; explicit inspect rechecks
freshness. There is no automatic retention/physical erase job and the shared 4096-key bound applies.

RPC inventory/list/inspect require destination `access:read`; prepare/review/cancel require
`access:write` with revocation checks. Administrator-only MCP/CLI expose the safe reads, not
review or mutation. Capability `vault-migration-inventory` gates both clients. No provider adapter
or scheduled workload receives implicit migration access. GitHub connection metadata is for API
and `gh` use and never establishes Git transport readiness. Every result has literal
`verification: required` and `canCutover: false`; reviewed intent cannot authorize future writes.

The separate data/metadata subtree needs an operator-owned policy extension, documented in
[operations](../../operations/vault.md#replacement-plan-operating-policy). It remains gated by
L79 production readiness. No Library deployment, SQL migration or application dependency is added.

## Source-specific verification receipts

An optional field in the existing encrypted replacement ledger stores one current attempt,
its actor and expected prior operation ID. Old records decode without it. The separate
`replacement-verify` RPC requires destination write access and literal provider-contact consent;
`replacement-verification` is read-only. Capability `vault-migration-verification` gates client
controls. Existing replacement result schemas keep `verification: required` and `canCutover:
false`; clients that cannot read the new receipt API remain compatible.

Only reviewed, unexpired plans with current source/item metadata can accept a check. Acceptance
is persisted before contacting a provider. Source/item and environment permissions are checked
before credential use and again before recording success. SSH signs through the existing pinned
host-bound transport and uses an isolated Git working directory to exclude repository-local URL
or executable configuration. The fixed operation is `ls-remote`, with an eight-second SSH limit;
raw refs are discarded. GitHub uses the existing scoped connection test and token cleanup, which
may also report normal health observations. It proves repository API access, not Git transport
or the local CLI. No personal key agent, helper, account store or CLI login is a fallback.

Provider work has a thirty-second deadline. Success evidence expires after at most sixty seconds,
or earlier at plan/token expiry, and records its exact scope, item/version, destination, SSH
path and pinned host fingerprint. It does not evaluate workload grants or passively detect
later upstream revocation. Read-only status checks local source/item freshness and cannot
re-contact a provider. Failed refresh hides cached evidence in clients. No cutover writer exists.

The process lock is held only for receipt acceptance/completion, allowing cancellation while
network work runs. CAS prevents stale completion overwriting a newer attempt or cancelled plan.
The operation ID, actor and expected prior receipt make immediate retry idempotent; older
requests conflict after a later attempt. A persisted running attempt whose final write fails
remains unknown and becomes interrupted at its deadline. Retrying it never reruns the probe;
reconciliation is a fresh, explicitly confirmed read attempt. No success is inferred from a
missing receipt. Only the latest attempt is retained in the current record; backend KV history
and backup retention remain operator-owned, not a complete immutable audit log.

Administrator MCP/CLI expose receipt inspection and read-route previews. Agents cannot approve or start these
human verification requests. The shared query invalidates after review, cancellation and every
verification settlement, with no background probes or polling. There are no new storage paths,
OpenBao rights, application dependencies, SQL migrations or Library changes beyond the previously
deferred replacement subtree. The optional field needs no live data migration.

## Overview

Inventory configured credential sources without extracting personal vault contents. Prepare a reviewed change set for dedicated key generation, service reconnection, explicit imports and optional repository configuration updates. Record prior non-secret configuration for rollback and test replacement access before cutover.

## Contracts and authorization

Current inventory reports selected project-local dependency hints; import `inspect` reads one import receipt and replacement inspect rechecks local source/item metadata. `prepare` produces an immutable, expiring plan with configuration fingerprints. `apply` requires that reviewed plan and idempotency key. `rollback` restores only unchanged configuration owned by the migration.

Existing `loom.vault-migration.*` RPC methods serve the initial import. Cutover/rollback schemas
remain a follow-up design output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Store non-secret plan summaries, fingerprints and per-step receipts. Secret imports enter the private-ingress path directly. Exclude exports, key material and original credential values from migration records; erase temporary import files.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_migration_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Inspect GitHubHostSetup and SSH configuration writers. Prefer explicit per-repository configuration; no global rewrite of personal SSH or Git defaults.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.

## Preview-only repository routing

`replacement-preview` is a destination-read RPC, with administrator MCP/CLI access through
`loom_vault_migration_preview` / `loom vault migration-preview`. Capability
`vault-migration-previews` gates clients. Each request names the plan, forward/inverse view and
exact expected receipt operation. Both views require a reviewed, unexpired plan and a current
passed SSH repository-read receipt for the same item/version, destination and preserved Git path.
Pinned host evidence is compared with current adapter metadata. Push entries and GitHub API scope
are ineligible even after a passing check. Embedded authentication, omitted metadata and local
URL rewrites block previews; original helper/SSH/global/included configuration remains unknown.

The service rechecks local source/item metadata and permission, and rereads the ledger before
returning a bounded preview. Its SHA-256 identifier binds environment, source fingerprint, plan,
receipt and direction. The preview expires with its receipt or plan; it is not an execution token.
Only the selected sanitized dependency and public replacement reference leave the service.
Neither preview contacts providers or writes a ledger, file, profile, grant or account. No new
OpenBao path or permission is needed; the replacement subtree remains a deferred host-owner
step behind L79.

The legacy single-receipt rollback view is a hypothetical inverse of the proposed Vault-mediated read route. It declares that
original access is unverified, no restorable configuration snapshot was captured, and a future
writer must match the exact source and applied forward route. A fresh replacement read receipt
binds the preview context only; it cannot prove the old identity works. Execution remains
unavailable in contracts, service and clients (`canCutover`, `canRollback` and
`configurationWrites` are literal false). This is not a Git configuration patch or a recovery
bundle. Workload authorization and later provider revocation are explicitly unknown.

## Typed credential imports

Typed operations extend `VaultMigration` through a protocol-two lifecycle helper in the same
existing `migrations` subtree; actual credentials use the existing `items` subtree. There are
no new OpenBao paths, permissions, SQL migrations or Library changes. Protocol-one manual
reviews remain readable. Separate typed RPC/list/status schemas keep typed metadata out of
older client decoders; paginated lists skip the other protocol while retaining bounded raw-key
cursors. `vault-migration-typed-imports` gates the new controls. Private prepare/apply stay in
human RPC forms; administrator MCP/CLI expose typed list/status only.

Preparation locally normalizes a dedicated key/connection using the adapters' existing stored
schemas. SSH keys are canonicalized to Ed25519 PKCS#8 PEM. OpenSSH parsing rejects encryption,
multiple keys, malformed checks/padding and mismatched public/private material; the public key
is independently derived from the seed. GitHub token format and App RSA key type/size are
checked without opening a session. The expected account is declared, unverified metadata;
existing connector execution still authenticates and compares the actual account on use.
No import receipt establishes API or Git transport evidence.

A fingerprint binds label, typed adapter metadata and canonical private material. The review
ledger contains safe details, allocated item ID, actor and fingerprint, not private bytes.
Apply requires separate reviewed/development literals and matching reentry, actor and unexpired
review. It persists acceptance, then saves a newly allocated item at expected version zero.
Current destination write authorization is rechecked before commit; no existing item is replaced.
The existing core mutation receipt recovers committed items after a lost final ledger write,
without a read-side write. Guarded archive retains the expected initial item version and never
archives a later edit. CAS and operation IDs retain idempotency. Both typed result execution
gates and configurationWrites remain literal false; workload authorization is not evaluated.

A typed review requires a runtime that understands protocol two. Upgraded servers preserve older
client APIs, but downgrading to an older server does not teach it to read new typed ledgers.
Keep a compatible runtime for review history; do not delete history to make a downgrade appear
compatible. L79's host-owner rollout/recovery gates still apply.

## Independent original development-route verification

`original-verify` is a destination-write RPC with development, original-route-review and contact
literals. It selects an active SSH item/version distinct from the replacement item. The selected
key must match the explicit SSH username, host and port at the reviewed fetch entry, with the
exact original Git path preserved. The bounded private metadata parser extracts only an explicit
username; it never resolves defaults, includes, helpers, SSH config or an agent. Missing users,
local SSH-command overrides, omitted entries, embedded authentication and URL rewrites are refused.
Personal and production credentials must not be supplied to this development-only flow.

The existing verifier now uses independent original/replacement receipt slots within the same
replacement record. Old records decode without the optional original slot. Actor, expected prior
receipt and selected item/version bind retries; concurrent original and replacement checks do
not replace one another. Acceptance is persisted before any provider read. Repeated source/item
and permission checks, pinned host transport, thirty-second provider deadline, eight-second SSH
limit, sixty-second evidence bound and interrupted-outcome behavior apply to both roles. Status
reads never rerun probes. Cancellation invalidates both roles, including late completion.

The new original status identifies an `explicit-development-selection` and leaves ambient
terminal authentication unevaluated. A passing receipt proves that selected key can read the
original repository route; it does not discover historical shell-key use or provide a workload
grant. API receipts and the replacement record cannot substitute for this evidence.

`recovery-preview` requires current matching original and replacement receipt IDs, item versions,
host pins, source fingerprint and reviewed plan. Its stable design hash binds those inputs and
the environment, and its lifetime ends with the earlier receipt/plan deadline. It performs no
provider call or ledger/configuration write. The capability is `vault-migration-recovery-design`;
administrator MCP/CLI expose original status and the design preview only. Shared client queries
invalidate both receipt roles after review, cancellation or a verification settlement. Older
preview APIs retain their original unevaluated-original-access semantics.

## Proposed recoverable snapshot format and journal

This is a design, not a stored field or capture implementation. The proposed optional artifact
belongs in the existing encrypted replacement ledger, reusing its permissions and CAS revision.
It would bind a versioned snapshot ID, environment/project/resolved-worktree identity, resolved
Git-directory identity, selected key and ordinal, explicit absence/presence, duplicate ordering,
nonsecret preimage, planned route references, preimage/postimage digests, operation/actor and
journal phase. Current metadata fingerprints alone cannot restore configuration.

The capture scope is the selected nonsecret local fetch entry and an explicitly selected managed
route manifest. Do not copy whole Git files, global/personal SSH configuration, includes, hooks,
helper bodies or private credential material. Preserve unrelated entries when rendering a future
patch. If an exact bounded owned span, ordering or nonsecret value cannot be established, refuse
capture. The actual managed-route writer and its manifest representation must be selected before
this proposed format is finalized; changing a remote URL alone does not install Vault mediation.

Proposed phases, all unimplemented:

| Phase               | Required durable evidence                                                    | Interrupted recovery decision                                                               |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Captured            | Validated nonsecret preimage, identity and intended route                    | No host mutation has started. Reverify and explicitly retry or abandon.                     |
| Applying            | Intent stored before any host write; expected preimage and planned postimage | Preimage match means unapplied; postimage match means applied; neither means conflict.      |
| Applied             | Actual postimage confirmed before completion is recorded                     | Preserve the artifact and require fresh original-route evidence before rollback.            |
| Rolling back        | Explicit rollback intent and exact applied postimage guard                   | Preimage match means restored; postimage match means still applied; neither means conflict. |
| Rolled back         | Original preimage confirmed after the guarded inverse                        | Retain the receipt; do not repeat host writes on an identical retry.                        |
| Conflict or unknown | Both expected digests, observed category and last accepted intent            | Stop automatic mutation. Preserve evidence and request explicit reconciliation.             |

Every future transition must recheck source identity, item versions, trust and applicable grants.
A no-op must be recognized before intent; identical preimage/postimage cannot distinguish an
interrupted write. An unavailable ledger blocks new writes. Future retention must preserve the
last recoverable artifact through conflict/unknown outcomes; backup and revocation semantics
remain subject to L79/L88 rather than being inferred from a preview.

### Concurrent writers: explicit open decision and safe default

**Open decision CW-1:** no real-host compare-and-write primitive has been selected. The safe
operating default is **refuse every host configuration write**, including rollback. The wire
preview keeps `concurrentWriterStrategy: unresolved`; this is deliberate, not implicit permission
to use a lock. An advisory Git lock, a content hash, a final pre-write reread, or an atomic rename
alone cannot exclude an uncooperative editor between comparison and replacement. Post-write
conflict detection cannot undo another editor's lost write safely.

The synthetic proof assumes an atomic compare-and-swap on each resource with a monotonic revision
that changes on every external modification, including an edit that restores identical bytes
(ABA). It rejects mismatched identity, content or revision, even for unrelated edits. This is an
assumption of the executable model, not a property of normal files. A future host proposal must
prove an equivalent exclusion/transaction boundary against external writers, or retain refusal
for that configuration class. An environment-wide Loom mutex is insufficient. Worktree/common-Git
directory resolution, symlinks, file replacement, crash durability and platform-specific behavior
remain host-design gates. No actual capture or writer is authorized by this proof.

### Bounded synthetic representation

The [executable model](../../../../apps/server/src/fork/vault/MigrationRecovery.testkit.ts) is
imported only by its focused test suite. It has no filesystem, process, Git, SSH, Vault/backend,
RPC or client integration. Its input and artifacts are explicitly synthetic; identities use
`synthetic-` tokens, and SSH endpoint fixtures allow only `.invalid` hosts. Nothing enumerates,
reads, captures or changes host configuration. The real `captureEngine` remains `unimplemented`;
`canCutover`, `canRollback` and `configurationWrites` stay literal false.

The model captures the selected fetch **key's bounded ordered vector**, replacing one selected
ordinal. Capturing only that value cannot restore duplicates and ordering unambiguously. Absence
is `null`, distinct from a present nonempty vector; empty/ambiguous vectors are refused. There
are at most eight values; the input also has at most sixteen opaque unrelated-entry sentinels,
which are included in the whole-resource conflict digest but excluded from the snapshot. Each
SSH value is structured nonsecret user/host/port/path data with explicit SCP-relative,
SCP-absolute or SSH-URL syntax. The grammar deliberately excludes authentication, queries,
fragments, helpers and ambiguous paths; paths are at most 256 ASCII characters. Identifiers and
individual fields are bounded, unknown fields are rejected recursively, and the canonical
snapshot has a 16 KiB UTF-8 ceiling. No truncation is allowed. The route manifest contains only
the selected route/item/version and repository-read operation references.

The postimage uses an abstract `synthetic-route-token`, **not a valid Git URL or an implemented
Vault route writer**. The proof preserves structured values, absence, duplicate order and exact
inverse state. It does not prove byte-preserving edits of real Git syntax, comments, includes,
line endings, ownership or file modes. A real capture codec and managed-route representation
remain separate open decisions. Before choosing them, prove that the desired representation can
be installed without copying personal material or silently dropping unsupported configuration.

### Executable journal semantics and proof limits

Snapshot digests bind protocol/mode, identity, source/item binding token, selected ordinal,
preimage/postimage and both expected resource revisions. Journal integrity digests detect
accidental corruption; they are not signatures or authorization. The test-only controls and
receipt facts are synthetic assertions; live receipt/grant validation remains owned by the
existing service and must be integrated again before any real execution.

Acceptance checks the expected journal revision, actor, operation and fresh independent evidence
before producing an intent. Identical intent retries do not advance it; changed actors, direction,
evidence or revision conflict. Durable intent is assumed to exist before the first resource step.
The apply sequence is **manifest, then Git**; rollback is **Git, then manifest**, so the model
never switches Git toward a missing route manifest. Each step returns a new immutable synthetic
image without acknowledging completion, permitting restart after every possible write boundary.
Reconciliation recognizes only a contiguous completed prefix. An impossible mixed image, any
unexpected edit/revision or a changed resource identity stops in conflict. Unchanged resources
are skipped, and a whole-operation no-op cannot create intent.

Unavailable observation becomes `unknown`; conflict/unknown are sticky and preserve preimages
and accepted intent. A returning original-looking image never resumes mutation automatically.
Read-only inspection can explain an interrupted completion after evidence expiry, but no further
step can proceed without valid authorization/evidence and an available ledger. If the ledger is
unavailable or authorization is denied, observed completion is not recorded as durable journal
progress. Rollback after expiry requires a new explicit operation and fresh bound receipts.
Mid-operation evidence refresh, explicit conflict resolution, retention, multi-process durable
journal CAS and real host crash recovery remain follow-up integration work. The proof does not
make an interrupted real migration recoverable.

All proof data lives in memory; JSON round-trip acceptance tests use no files. There is no stored
snapshot field, new OpenBao path/policy permission, Library change, production action or rollout.
The existing migration/replacement subtree rollout remains a host-owner step behind L79.
