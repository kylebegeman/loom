# L104 product

## Problem and proposed behavior

A person leaving a password manager needs evidence that their records and files arrived,
not a success toast for the subset a parser understood. The proposed flow imports a reviewed
local 1Password export without giving an unattended development host the export or personal
master keys. It does not retire 1Password or change any live credential configuration.

## Import journey

1. On a trusted client, read how to make an official 1Password export and choose that local
   file. Explain that a 1PUX export is unencrypted and remains the person's responsibility;
   never ask for it in chat or upload it to Loom.
2. Validate supported format/version and bounds before preview. Show source account/vault
   grouping only inside the trusted client. Unsupported input gets a precise local result.
3. Review type/field mapping, archived records, custom/protected fields, TOTP parameters,
   attachments and unavailable data such as non-exported passkeys. Inspect source versus
   proposed record without exposing either to a server.
4. Review duplicate candidates. Choose keep separate, skip or explicitly update a selected
   existing item; equal titles/usernames alone never authorize an overwrite. Bulk choices
   remain inspectable and reversible before commit.
5. Apply the reviewed selection. Cancel outstanding work, inspect committed/remaining
   results, retry only known failed work and resume a crashed operation without duplicates.
6. Review complete per-item and per-attachment accounting. Recover from partial failure or
   undo this import's unchanged writes; subsequent edits create conflicts for deliberate
   resolution. The source is untouched and remains usable for reconciliation.

## Encrypted portability and reverse actions

Choose records, include required files/history according to an explicit policy, and create
an encrypted portable export through reviewed engine support. A trusted local UI establishes
its unlock method and verifies reopening before marking export verified. Inspect/cancel the
operation and clean up incomplete outputs. A completed export cannot be recalled; deleting
it locally does not revoke copies or source credentials.

Library/history restore and owner/device recovery use shared primitives if present. Missing
support must say unavailable rather than fabricate a backup. Imported used recovery codes
retain their status where available; import cannot verify provider-side validity.

## Entry points and states

Trusted Vault home > Import/export, local file-open action, trusted-client palette/shortcut
and an opaque launch action from Loom. Close/cancel preview, inspect operation history, undo
eligible writes and clear private local diagnostics. Ordinary Loom routes contain no source
path, item title, field value or mapping report.

States: no file, parsing, review required, unsupported format/version/field, unsafe archive,
duplicate conflict, attachment missing/oversized/corrupt, ready, applying, cancelled,
partially committed, interrupted/outcome unknown, complete with omissions, verified export,
locked/revoked and recovery required. Completion always includes omissions; zero imported
items is never silently called success.

## Surfaces and unresolved priorities

Mac and iPhone are Kyle's confirmed first platform targets as of 2026-10-21. The proposed
first local parser runs on a trusted Mac; iPhone must be able to consume/recover the encrypted
result, with full local import only after its parser adapter passes. Android,
Windows/Linux and browser-only flows remain tracked and unsupported for raw personal input.
No LAN, tailnet, relay, tunnel, selected environment or upstream server is an import target.

Kyle still needs to prioritize source format/version coverage, acceptable attachment sizes,
history fidelity, duplicate defaults and import undo retention. A synthetic fixture preview
can start now. Real personal migration is not implied; critical custody requires independent
security review and proven recovery before relying on the imported copy.
