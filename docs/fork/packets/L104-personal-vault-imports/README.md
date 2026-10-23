# L104: Personal Vault imports and portable export

Status: **Designing**. Agent-proposed detailed scope supporting Kyle's priorities confirmed on
2026-10-21. Local personal Vault implementation is authorized; this is not a selected personal migration. L101's first
build is **In progress** elsewhere. See [Personal Loom Vault](../LOOM-PERSONAL-VAULT.md).

Bring reviewed 1Password exports into a trusted personal client, account for every item and
attachment, and produce a verified encrypted portable export. The raw source stays on the
person's trusted device and never goes to chat, an agent or the development server.

## Scope

- In: a documented local 1PUX adapter, version validation, typed mapping preview, duplicate
  decisions, complete unsupported/attachment accounting, resumable inspected results,
  cancellation, conflict-aware undo and encrypted portable export/reopen verification.
- In: private local provenance and recovery after interruption, without modifying the source.
- Out: live 1Password account/session access, headless `op` integration, automatic cutover,
  credential rotation, changing developer Git/SSH configuration or running a live migration.

CSV and other source formats remain explicit follow-on adapters; a filename alone is not
support. Missing fields, passkeys and inaccessible attachments are reported rather than
silently discarded. TOTP parameters are preserved as sensitive typed data; generation/use
requires a reviewed future shared/native adapter.

## Surfaces and extension points

Kyle confirmed Mac and iPhone as the first usable platforms on 2026-10-21. Proposed import
acceptance starts with a trusted Mac client, iPhone encrypted-result/recovery acceptance and
local iPhone import when the platform adapter supports it. Safari/Chromium may
launch trusted local management but are not file-upload paths to Loom. Android, Windows, Linux
and general web stay tracked as unavailable until their trusted local parser/storage exists.
Remote connection mode never changes where parsing occurs.

`ext-personal-vault` is proposed. Consume reviewed shared typed storage, custody and portable
format primitives when available; absence disables real import/export and leaves fixture
preview possible. No packet-to-packet implementation dependency. [SEAMS.md](./SEAMS.md) lists
candidate native/file-picker integration; no code seam exists here.

## Documents

- [PRODUCT.md](./PRODUCT.md): local import, review and export journey.
- [TECHNICAL.md](./TECHNICAL.md): parser, mapping and accounting contracts.
- [SEAMS.md](./SEAMS.md): native touchpoints and rejected server reuse.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered implementation steps.
- [TESTING.md](./TESTING.md): malformed data, interruption and privacy evidence.
- [REFERENCES.md](./REFERENCES.md): verified source and official format docs.
