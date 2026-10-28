# L74 technical design

## Implemented shared boundary

`vault-references.ts` exposes environment/item reference text and metadata-only search/describe
under `loom.vault-references.*`. References use `loom-vault:<encoded-environment-id>:<item-id>`.
Renames, archive and item version changes preserve that identifier. References grant no access.
The current environment selects the inventory; clients cannot substitute another environment ID.

Human RPC inspection requires access:read. Agent search uses `VaultAccess.listForThread` and
returns only inspect-authorized metadata. Describe requires the same inspect decision; forbidden
and unknown valid IDs both return null. Backend failures propagate as typed errors. Responses
contain item summaries, never values or private-key material.

## Search and refresh

Queries match safe label/kind metadata, item IDs or canonical reference prefixes in the
selected environment. Search delegates query, kind and archive filtering to VaultCore before
its 25-item page is selected in label order. Inspect policy then removes forbidden records
for thread callers; those pages retain their continuation cursor and omit global counts.
The bounded inventory is read with concurrency 4; no persistent or process-local index exists.

Shared queries subscribe to the existing environment-scoped item-change signal. Core lifecycle
and SSH changes refresh mounted search/describe consumers across factories. Web/native pickers
show loading, empty, failure/retry and archived states; failed/stale results cannot be selected.
Profiles store selected IDs and inspect current labels, making missing bindings repairable.

## Entry points and limits

Web/desktop Settings, palette navigation, native mobile computer settings and MCP/CLI expose
search. The profile editor reuses the picker to choose/replace/unbind SSH keys. Copy returns
only the stable reference; it does not reveal or deliver a credential. CLI tools use the existing
authenticated MCP boundary and preserve the caller's permissions.

Composer and scheduled-prompt attachments are implemented below. CLI completion, role/account metadata,
more configuration consumers and explicit cross-environment discovery remain selected work.
Any future attachment must retain the destination environment and recheck use authority at
execution. Do not serialize credential values into prompts, settings or conversation events.
Reference management uses existing seams; launch integration adds the marked guards and
client controls below. No database migration or production dependency is introduced.

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

Scheduled agent prompts use the same guard. In restricted mode, new scheduled threads need
project grants; personal owner-trusted use needs no recurring grant. Host-only preview does
not prove run access. The current schedule status records dispatch
acceptance, not provider completion; inspect the thread's run timeline for a preflight failure.
End-to-end schedule-to-run completion status remains a tracked scheduler integration gap.
This is not an SSH reachability/broker-presence probe and does not configure ordinary terminals.
