# L103 technical design

## Existing code and why it is a separate path

`packages/contracts/src/fork/vault-core.ts:9` has generic development kinds and `:18` sends
labels to clients. `apps/server/src/fork/vault/VaultReferences.ts:41` searches those labels on
the server. `apps/web/src/fork/vault/SettingsSection.tsx:135` calls environment reveal and
`:316` renders its result. None supplies a local personal library or a safe private metadata
index. Keep those services and existing development references unchanged.

## Proposed model and shared contracts

No personal library schema/service is implemented. Proposed schemas live in
`packages/contracts/src/fork/personal-vault-library.ts`; parsing and encrypted local writes
run in the trusted client, not `ForkRuntime` on the development host. Proposed shared
`ext-personal-vault` primitives cover current custody state, encrypted record read/write,
version receipts, local attachment access and portable encrypted export. If absent, the
library shows unavailable or fixture content; it does not import another packet's internals.

A versioned item has opaque id, local revision, type, lifecycle state, timestamps, title,
fields, related-item handles, attachment handles and protected history. All semantic fields,
including favorites, domains and history, belong inside encrypted storage. Field definitions
carry semantic type, sensitivity and fill eligibility rather than relying on a label such as
"password". Unknown fields survive round-trip as protected data and cannot become fillable
without a reviewed mapping.

| Type     | Validation contract                                                                        |
| -------- | ------------------------------------------------------------------------------------------ |
| Login    | Structured origins; distinguish username/password from arbitrary custom strings.           |
| Note     | Bounded plain text; render as text rather than active content.                             |
| Recovery | Bounded protected codes/keys; used markers are user-maintained state with undo.            |
| Card     | Preserve formatting/leading zeroes; expiry validity is feedback, not silent normalization. |
| Identity | Named address/contact/document fields plus protected extensions.                           |
| File     | Opaque encrypted content reference with bounded size/type/name and integrity check.        |

TOTP data is an explicit protected subtype: seed encoding, issuer, account and algorithm/
digits/period if available. Preserve unknown/unsupported parameters; never silently generate
a different code. No TOTP computation dependency/API is introduced here. Future [L107 platform delivery](../L107-personal-vault-native/)
uses a reviewed shared/native adapter or reports unsupported.

## Operations and consistency

Proposed trusted-local operations: list/search, create/update with expected revision, field
reveal/hide, favorite/unfavorite, archive/restore, inspect history/restore version, delete/
purge, open/save attachment and encrypted export. Stable operation identifiers and encrypted
receipts distinguish not committed, committed and outcome unknown. Cancellation before commit
leaves existing state; after commit it returns the recorded result and offers a new compensating
operation. Restoring history creates a new current version, preserving auditability.

A concurrent or offline edit cannot overwrite a newer revision silently. Keep both versions
for deliberate local resolution; stale revoked clients cannot authoritatively restore trust.
Retention/purge uses engine-supported semantics and records backup limitations. No claim of
secure physical erasure across snapshots, flash or prior exports.

## Local storage, presentation and files

Sensitive metadata indexes exist only inside the trusted unlocked process or approved encrypted
local storage. Clear indexes, detail atoms, pending results and previews on lock/revoke.
`packages/client-runtime/src/fork/personal-vault-library.ts` may contain non-secret availability
and pure behavior; secret state must not enter ordinary environment atoms, query caches,
telemetry, crash reports, app-global palettes or route URLs.

Proposed native/client implementations use fork-owned `personal-vault-library` directories.
The ordinary web renderer may launch the trusted client but does not render decrypted fields.
A native view/extension can render them only under the reviewed custody boundary. Plaintext
managed-runtime lifetime is a documented limitation, not a zeroization guarantee.

Encrypt attachment bytes, filenames and thumbnails. Verify integrity before open; no automatic
execution, remote thumbnail fetch or content indexing. Stream bounded local reads; reject
oversized content before buffering. Choose explicit destinations for save/share. Removing a
local temporary file is best-effort cleanup; external apps and share recipients retain copies.

## Transport, agents and delivery overlap

No personal search/reveal/export RPC or MCP tool. Any added non-secret
`loom.personal-vault-library.*` status RPC includes guarded scopes and
`EnvironmentAuthorizationError`; it cannot enumerate private item labels. All providers and
scheduled agent runs receive only common approved service/MCP capabilities; command jobs stay
unsupported until an explicit broker exists. A future reviewed delivery adapter may consume
one purpose-bound operation without exposing the library to an agent.

[L74](../L74-vault-references/) remains development-reference search,
[L77](../L77-vault-health/) development health, and [L79](../L79-vault-core/) server-readable
storage. Do not add personal items to their scans. [L88](../L88-vault-recovery/) does not imply
personal export/recovery exists. [L109](../L109-personal-vault-recovery/) owns broader recovery-kit/restore exercises and
[L108](../L108-personal-vault-sync/) owns sync/offline conflict delivery. Personal consumers
share reviewed primitives when available, not direct packet dependencies.

## Performance and alternatives

Use incremental local indexing and virtualized bounded lists. Debounce local expensive work,
not a server search request; no query text leaves the device. Avoid rendering hidden values
and continuous countdowns. Engine-supported encrypted attachments avoid a new bespoke blob
format. Reusing development labels/reveal is rejected because it changes the custody model.
