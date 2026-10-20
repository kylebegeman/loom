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

Rollback is a hypothetical inverse of the proposed Vault-mediated read route. It declares that
original access is unverified, no restorable configuration snapshot was captured, and a future
writer must match the exact source and applied forward route. A fresh replacement read receipt
binds the preview context only; it cannot prove the old identity works. Execution remains
unavailable in contracts, service and clients (`canCutover`, `canRollback` and
`configurationWrites` are literal false). This is not a Git configuration patch or a recovery
bundle. Workload authorization and later provider revocation are explicitly unknown.
