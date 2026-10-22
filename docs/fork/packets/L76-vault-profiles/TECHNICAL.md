# L76 technical design

Profiles are optional saved connection selections. Direct resource-name selection uses the
shared resolver without a profile; either path rechecks the environment access policy.

## Implemented contract

The shared `vault-profiles.ts` contract defines named SSH/Git/GitHub requirements and the
`loom.vault-profiles.list/apply/preview` RPCs. Administrator management requires environment
access:read/access:write. The service validates project ownership, mutation shape, expected
revision, unique names and bounded profile counts. Profiles store references and Git paths,
never credential values. Worktrees use the authenticated thread's owning project.

Registry changes use CAS, actor-bound mutation fingerprints and the latest 32 operation
receipts. An exact replay returns the current snapshot; changed actor/payload or stale edits
conflict. Limits are 32 profiles per project and 16 required bindings per profile. Archived
profiles must be restored before editing; archive clears the default, restore does not select it.
Incomplete bindings may be saved. A preview with no target thread reports host checks only,
never proof of authorization. Selecting a default grants no access.

## Run selection and execution

`VaultProfiles.resolve` derives project/provider/run identity from the authenticated active
full-access/default thread. First successful resolution writes a CAS-created OpenBao run pin
containing profile revision, label, names, item IDs, key versions and exact destinations.
Resolution of all bindings must succeed. A concurrent first resolution uses the persisted
winner. Changing the profile in the same run conflicts; later registry edits/default changes
do not switch an existing pin. A new run may resolve a new profile or key version.

Every resolve rechecks current profile archive state, live run/provider/project, key version,
host trust and current use authorization under the environment access mode.
`VaultLaunch.profile` executes a named binding through the existing signed workload SSH/Git
path, preserving its cleanup and output bounds. Archive is checked again before
transport/signing. Revocation prevents new authorized use but cannot recall an issued signature
or roll back a remote command. Same-user processes are not isolated.

## Storage and failure behavior

The environment namespace is SHA-256 of the server environment ID. A project namespace is
SHA-256 of its project ID. Registry and pins use:

- `environments/<environment>/profiles/<project>/registry`
- `environments/<environment>/profiles/<project>/runs/<SHA-256 of encoded thread/run identity>`

Run pins contain references only and persist across service restart. Administrator inspection and
manual retirement are implemented below. There is no automatic expiration or physical deletion.
Operators must retain the profiles paths and tombstones with backups; automatic retention
remains selected lifecycle work. No offline resolution/cache,
SQL migration, platform replication or service token change is performed automatically.
Backend denial/unavailability fails closed. Operators must provision the documented policy.

## Clients and adapters

Shared client-runtime atoms refresh mounted profile lists across factories after successful
changes. Web/desktop Settings and mobile computer settings support complete management for
this milestone, including repair and read-only states. Palette actions navigate to the selected
environment. MCP derives the calling thread's project and forbids agents from editing bindings;
human full-access clients can manage explicit projects. CLI uses the same authenticated tools.
Common provider instructions mention profiles only when the tools are exposed. Scheduled agent
runs can call them; command-only jobs do not acquire a profile automatically.

## Remaining selected design

Other credential kinds, Library sharing,
platform accounts and automatic pin-retention policies need their own reviewed contracts. Reuse existing
fork seams, keep secrets out of upstream events, and keep management separate from use rights.

## Explicit launch attachments

The shared `vault-prompt.ts` formatter/parser defines standalone Markdown links with safe
labels and environment/item IDs. Profile links additionally carry the reviewed profile version.
The dedicated attachment buttons have been removed from web/native composers and scheduled
prompt editors. Existing standalone links remain ordinary prompt text, so draft restoration,
queued messages, schedule persistence and transcript summaries use the established text path. There is no secret value, new event
field or schema migration. Fenced, quoted, inline and indented code examples are not launch
requirements. Keep attachment links on their own lines; moving a link into prose detaches it.

`ext-vault-preflight` calls the environment-scoped guard before opening a provider session.
No explicit attachment means no Vault lookup. Invalid/duplicate/cross-environment links,
missing or inspect-denied references, changed profile versions and incomplete/use-denied
bindings block with a safe failed-run timeline item. A profile is pinned to that exact active
run before delivery; current checks at SSH/Git/GitHub use remain authoritative. Steering rechecks
the same guard and cannot switch a pinned profile. Metadata labels never confer authority.

Scheduled agent prompts use the same guard. Restricted mode requires project grants for new
scheduled threads; personal owner-trusted use does not. Host-only preview does not prove run
access. This is not an SSH reachability/broker-presence probe and does not configure ordinary
terminals.

## Scheduled outcomes and recovery

The scheduler records the exact generated message ID before dispatching a prompt with explicit
Vault requirements, including rendered webhook prompts. A fork-owned SQLite ownership row is
bound to task ID, task creation timestamp, firing timestamp and owning project. It contains no
prompt, requirement values, keys or tokens. There is one row per task; new firings replace the
previous ownership and reconciliation removes deleted/recreated task rows.

Task list/subscribe and Run now project the matching V2 message/run outcome into the existing
status contract. Queued/preparing/waiting runs remain running; failed, interrupted, cancelled,
rolled-back or missing/deleted runs report failure; completed runs report success. A completed
foreign-project run cannot establish success. Raw scheduler rows, run count, next cadence and
webhook delivery logs retain their existing dispatch semantics. A background source on the
existing scheduler emits a refresh only when outcome metadata changes. It does not replay work,
change grants, automatically retry or wait for provider completion in the dispatch handler.

The migration set is registered with the fork ledger and bootstrapped idempotently by scheduler
construction, which precedes ForkLayer. Read-only projection joins survive server restart without
OpenBao availability; the upstream event and task schemas are unchanged. Old firings without an
ownership row retain their original dispatch status. Only the latest firing is shown, rather
than a new run-history product. Normal scheduler concurrency/cadence remains unchanged.

Web recovery opens the existing task editor and offers an explicit retry; native shows review
and Run now guidance. Webhook recovery requires a new request, so a delivery is never silently
replayed. Editing/removing requirements does not retroactively change an earlier run's outcome.

## Portable requirements and local bindings

`VaultProfileRequirements` is a `loom-vault-requirements` declaration containing a
label and 1 to 16 unique SSH/Git/GitHub requirement names/kinds. SSH/Git-only exports use version 1;
exports containing GitHub use version 2. Version 1 rejects GitHub requirements. Export omits profile/environment/item
IDs, connection/key versions, repositories, grants, defaults and run pins. Labels are user-authored metadata;
review them before sharing. The bounded text importer rejects unknown fields, unsupported kinds,
unsupported versions and duplicate names.

Clients import into a new unsaved local editor with all item/repository bindings null, then use
the existing preview/save flow. Existing local profiles and defaults remain intact. The service
also accepts a create-only import mutation through the authorized profile API/MCP, with the same
CAS, idempotency and administrator checks as other profile mutations. Reusing a profile ID
conflicts rather than clearing its bindings. Local binding repair uses the existing profile edit
flow and current authorization at resolution. No portable declaration grants use rights or selects a
run automatically.

`loom_vault_profile_requirements` and `loom vault profile-requirements` export declarations.
Agents remain restricted to their own project and cannot import/change bindings. Human full-access
administrators may import through profiles-apply. Existing saved profile storage stays compatible;
Library publication, project-file discovery and additional connector kinds remain separate work.

## Retained selection inspection and retirement

The access:read `pins` query returns 25 records per page for one owning project, including
profile revision, exact item/key versions, destination, authenticated thread/run and selection
time. Legacy pins may have no timestamp. The OpenBao listing is bounded to the backend's existing
4096-key limit; growth beyond that requires a storage/pagination design rather than silent truncation.

The access:write `retirePin` command requires a confirmed terminal V2 run, current CAS version,
actor and operation ID. Active or unavailable runs cannot be retired. It replaces the current
snapshot with a schemaVersion 2 tombstone retaining identity, timestamps and the retiring actor/
operation. Replaying that actor/operation is safe; a changed actor or stale operation conflicts.
A tombstoned run fails closed on resolution forever, including after restart. New runs can resolve
normally. Retaining the tombstone prevents cleanup from silently selecting a different credential.

Web/desktop and native management offer inspection, explicit irreversible confirmation and cancel.
MCP/CLI inspection/retirement are human-administrator operations; agents cannot inspect other runs
or retire themselves. Capability `vault-profile-history` hides the flow on older servers.
OpenBao older versions remain: this is neither secure erasure nor credential/provider revocation.

## GitHub profile binding and mediated execution

Kind `github` binds a dedicated connection item ID plus an allowlisted `owner/repository`.
Preview reads saved active connection metadata, checks the normalized repository allowlist and,
when a target thread is supplied, its current `https://github.com/owner/repo` use authorization.
With no thread it reports unchecked. This performs no live provider call, CLI probe or token
issuance. Missing bindings are repairable, unsupported/wrong-kind/archived records are
unavailable and repository/access denial blocks resolution. The original SSH host-trust checks
still apply to SSH/Git.

Run resolution pins the connection version and repository alongside the profile revision. Later
profile edits apply to new runs; replacing connection credentials invalidates existing pins.
Named execution accepts `operation:{kind:"github",operation:{action:"pr-list"}}` and delegates
to VaultGitHub using the pinned connection/repository. It needs no SSH broker enrollment. The
launch guard preserves the originating run/provider/project identity and current profile archive
state through token acquisition and the final CLI authorization. Current connection
state/version, repository allowlist and current access policy remain live checks. Token release
and unknown write-outcome rules are inherited from the GitHub service; secrets never enter
profiles.

`vault-profile-github` enables GitHub choices and imports in web/native clients. Existing SSH/Git
profiles and version 1 declarations remain readable. A client paired with an older server hides
GitHub choices and rejects GitHub imports. Older servers cannot decode a registry/pin containing
the new kind; do not downgrade a server with such data without a reviewed backup/restore plan.
Portable GitHub imports create fresh profiles with null connection/repository bindings. They
carry no local IDs, account/repository names, defaults, grants or pinned versions. Labels remain
user-authored metadata and should be reviewed before sharing. Library distribution remains open.
