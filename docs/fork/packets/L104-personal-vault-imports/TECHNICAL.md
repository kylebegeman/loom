# L104 technical design

## Existing development import is not the target

`apps/server/src/fork/vault/VaultMigration.ts:231` marks plans `developmentOnly: true` and
`:273` passes raw imported value into server `VaultCore.save`.
`apps/web/src/fork/vault/MigrationSettingsSection.tsx:104` explicitly limits its UI to one
development secret/note. Do not extend that route to accept personal 1Password archives.

No client-local 1PUX parser or personal portable format API exists in the inspected source.
`apps/desktop/src/ipc/methods/window.ts:384` is a theme-file picker/read flow, not a credential
import API. Its native-dialog pattern is reference only; personal bytes must stay in the
reviewed trusted client.

## Proposed local parser contract

Proposed schemas belong in `packages/contracts/src/fork/personal-vault-imports.ts` and pure
mapping helpers in a fork-owned module executed by the trusted client. Parsers and temporary
files must not run in the Loom server, MCP process, agent workspace or an agent-hosted bundle.
The proposed `ext-personal-vault` supplies custody, typed encrypted writes, receipts and
portable format support if implemented; absent interfaces mean unavailable real import/export.
No dependency on another numbered packet's internal API is assumed.

For 1PUX, validate the documented archive/attributes/data structure and supported version
against synthetic fixtures. Treat account/vault/item/attachment content as untrusted data.
Do not infer supported versions from a `.1pux` suffix. Reject unsafe paths, traversal,
absolute paths, symlinks, duplicate/conflicting archive entry names and decompression bombs.
Bound entry count, expanded total size, per-entry size, nesting, JSON depth and string/field
length before allocating. Use reviewed archive/parser support; no new production dependency
is selected by this document. No raw extraction into an agent-readable temporary directory.

## Typed mapping and preservation

| Source concept                                      | Proposed local result                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Login URLs and login fields                         | Structured origin hints plus semantically typed username/password; ambiguous fields require review.           |
| Notes and custom sections                           | Protected note/custom fields with original meaning retained.                                                  |
| Cards, identities and documents                     | Typed fields where supported, protected unknown fields otherwise.                                             |
| Recovery material                                   | Protected data and source used markers when present; no claim of current validity.                            |
| TOTP                                                | Preserve exact sensitive seed/parameters; unsupported variants remain stored and visibly unavailable for use. |
| Favorites, archive and source timestamps            | Encrypted local metadata with source provenance separate from local revision time.                            |
| Attachments                                         | Encrypted content, verified byte length/integrity, private filename/type and source linkage.                  |
| Non-exported passkeys/history or unknown categories | Explicit omission/unsupported status; no fabricated credential or history.                                    |

A preview records supported, preserved-with-limitations and unsupported fields per record.
Field collisions and multiple candidate passwords require an explicit local mapping. Rich
notes are plain text or sanitized inert content; imports never execute scripts or open URLs.
Source identifiers and duplicate fingerprints stay encrypted locally.

## Plan, commit and exact accounting

A local encrypted plan binds the source fingerprint, adapter/version, mapping decisions,
destination owner/Vault, expected item revisions and operation id. Editing any binding
invalidates the review. Duplicate signals are candidates only: an exact source id/reimport
receipt can prove prior ingestion, while title/domain/username resemblance cannot authorize
updates. Never send fingerprints or labels to a server index.

For every source item assign exactly one terminal result: created, updated, skipped,
unsupported, failed or cancelled. Their counts must equal parsed source items. Invalid files
that prevent enumeration are archive-level failures, not invented item counts. Attachment
accounting is separate: imported, intentionally omitted, missing, unsupported, failed or
cancelled, each linked to its item. Per-field limitations remain visible even for a created
item. Show pending separately until all work is resolved.

Atomic batches/receipts make resumable progress explicit. After a lost response inspect the
local receipt before retrying. Cancellation stops uncommitted work; committed records remain
listed. Undo records preimages encrypted locally and restores/archives only when the current
revision still matches this import's write, otherwise returns conflict. No undo overwrites
later user edits. Closing a preview clears its plaintext buffers; locking/revocation cancels
outstanding access and discards late parser results.

## Encrypted export and storage

Use the selected reviewed engine's portable encryption/serialization rather than a new ZIP
with custom crypto. A versioned manifest inside protected storage lists record versions,
attachments, preservation limits and restore requirements. Unknown formats/engines report
unsupported. The final file has no plaintext titles, filenames or field metadata outside its
required opaque envelope. Write to a trusted-local temporary destination, authenticate/reopen
and atomically finalize. Interrupted/unknown outcomes can be inspected and cancelled/cleaned.

Export unlock material is established locally, distinct from server sign-in. Recovery testing
must reopen without relying on the original device's transient keys. Retain only encrypted
plans/receipts needed by the selected undo policy; avoid raw parser dumps and crash logs.
Do not promise secure deletion of the user's original export or copies in backups.

## Agents, scope and performance

No MCP/RPC import-value, preview-data or export-value operation. Common service/MCP state, if
exposed, is coarse unsupported/available only for every provider and scheduled agent run.
Command jobs remain unsupported without an explicit broker. Any added safe environment RPC
uses guarded scopes and `EnvironmentAuthorizationError`, with no personal input schema.

[L75](../L75-vault-migration/) retains development replacement/cutover work;
[L79](../L79-vault-core/) remains server storage. [L88](../L88-vault-recovery/) server backup
is not portable personal export. [L109](../L109-personal-vault-recovery/) extends the recovery
kit/restore exercises; this packet owns source fidelity and import/export accounting. Share
reviewed primitives if present, not packet internals.
Stream bounded input, batch local writes and virtualize review rows. Progress is event-driven
and contains no personal content on Loom transport; no per-item server round trips.
