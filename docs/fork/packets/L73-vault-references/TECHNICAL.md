# L73 technical design

## Implemented shared boundary

`vault-references.ts` exposes environment/item reference text and metadata-only search/describe
under `loom.vault-references.*`. References use `loom-vault:<encoded-environment-id>:<item-id>`.
Renames, archive and item version changes preserve that identifier. References grant no access.
The current environment selects the inventory; clients cannot substitute another environment ID.

Human RPC inspection requires access:read. Agent search uses `VaultAccess.listForThread` and
returns only inspect-granted metadata. Describe requires the same inspect decision; forbidden
and unknown valid IDs both return null. Backend failures propagate as typed errors. Responses
contain item summaries, never values or private-key material.

## Search and refresh

Queries match label substrings, item IDs or exact canonical references in the selected
environment, with optional kind and archive filters. Search is bounded to four existing
25-record pages per request, stopping after matching results appear. Sparse/no-match pages
retain their next cursor; consumers continue until it is null. The bound is not a global
result limit and does not establish an index or constant-time search for large inventories.

Shared queries subscribe to the existing environment-scoped item-change signal. Core lifecycle
and SSH changes refresh mounted search/describe consumers across factories. Web/native pickers
show loading, empty, failure/retry and archived states; failed/stale results cannot be selected.
Profiles store selected IDs and inspect current labels, making missing bindings repairable.

## Entry points and limits

Web/desktop Settings, palette navigation, native mobile computer settings and MCP/CLI expose
search. The profile editor reuses the picker to choose/replace/unbind SSH keys. Copy returns
only the stable reference; it does not reveal or deliver a credential. CLI tools use the existing
authenticated MCP boundary and preserve the caller's permissions.

Composer attachments and transcript summaries, CLI completion, role/account metadata,
more configuration consumers and explicit cross-environment discovery remain selected work.
Any future attachment must retain the destination environment and recheck use authority at
execution. Do not serialize credential values into prompts, settings or conversation events.
No new upstream seam, database migration or production dependency is introduced.
