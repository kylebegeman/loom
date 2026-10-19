# L75 technical design

## Implemented contract

The shared `vault-profiles.ts` contract defines named SSH/Git requirements and the
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
host trust and exact use grants. `VaultLaunch.profile` executes a named binding through the
existing signed workload SSH/Git path, preserving its cleanup and output bounds. Archive is
checked again before transport/signing. Revocation prevents new authorized use but cannot
recall an issued signature or roll back a remote command. Same-user processes are not isolated.

## Storage and failure behavior

The environment namespace is SHA-256 of the server environment ID. A project namespace is
SHA-256 of its project ID. Registry and pins use:

- `environments/<environment>/profiles/<project>/registry`
- `environments/<environment>/profiles/<project>/runs/<SHA-256 of encoded thread/run identity>`

Run pins contain references only and persist across service restart. They currently have no
automatic expiration or deletion. Operators must retain the profiles paths with backups;
retention and inspection tooling remain selected lifecycle work. No offline resolution/cache,
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

Portable declarations, other credential kinds, Library sharing,
platform accounts and retained-pin cleanup need their own reviewed contracts. Reuse existing
fork seams, keep secrets out of upstream events, and keep management separate from use rights.

## Explicit launch attachments

The shared `vault-prompt.ts` formatter/parser defines standalone Markdown links with safe
labels and environment/item IDs. Profile links additionally carry the reviewed profile version.
The web/native composer and scheduled prompt editor reuse the picker. Attach, replace and
remove edit the existing prompt, so draft restoration, queued messages, schedule persistence
and transcript summaries use the established text path. There is no secret value, new event
field or schema migration. Fenced, quoted, inline and indented code examples are not launch
requirements. Keep attachment links on their own lines; moving a link into prose detaches it.

`ext-vault-preflight` calls the environment-scoped guard before opening a provider session.
No explicit attachment means no Vault lookup. Invalid/duplicate/cross-environment links,
missing or inspect-denied references, changed profile versions and incomplete/use-denied
bindings block with a safe failed-run timeline item. A profile is pinned to that exact active
run before delivery; current checks at SSH/Git use remain authoritative. Steering rechecks
the same guard and cannot switch a pinned profile. Metadata labels never confer authority.

Scheduled agent prompts use the same guard. New scheduled threads need project grants;
host-only preview does not prove those grants. The current schedule status records dispatch
acceptance, not provider completion; inspect the thread's run timeline for a preflight failure.
End-to-end schedule-to-run completion status remains a tracked scheduler integration gap.
This is not an SSH reachability/broker-presence probe and does not configure ordinary terminals.
