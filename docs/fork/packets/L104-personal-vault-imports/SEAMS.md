# L104 seams

## Current and proposed boundaries

Documentation only; no code or upstream seams added. `ext-personal-vault` is proposed, with no
assumed import/export API. An implementing agent uses shared primitives when present and
shows unavailable otherwise. No personal archive may enter the current development importer.

| Current source                                             | Design consequence                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/server/src/fork/vault/VaultMigration.ts:231`         | Development-only server plans; no personal parser reuse.                           |
| `apps/web/src/fork/vault/MigrationSettingsSection.tsx:104` | Keep development import UI accurately scoped.                                      |
| `apps/desktop/src/ipc/methods/window.ts:384`               | Theme native-picker pattern only; no personal value transfer through this channel. |
| `apps/desktop/src/preload.ts:77`                           | Existing desktop bridge; optional fork IPC extension is absent today.              |
| `apps/mobile/app.config.ts:157`                            | Existing share extension is not personal import custody.                           |
| `apps/web/src/fork/settings/registry.ts:26`                | Non-secret trusted-client launch/status registration.                              |

## Candidate implementation layout

Schemas and pure mapping behavior use fork-owned `personal-vault-imports` paths. The actual
parser and local files belong to a reviewed trusted native/client target, not the server.
Native picker/extension and build entitlements require an inventory after that target exists;
do not predeclare a working `desktopBridge` personal-import method. General web receives an
unavailable state rather than a secret upload control.

Packet seams created: **none**. Shared boundary code is independently reviewable and does not
create numbered-packet dependencies. Future upstream lines require the
`fork: personal-vault-imports` marker and FORK.md/seams.tsv rows; JSON/native metadata gets
explicit no-marker rows. No such rows were added here.

## Merge check

No merge preview or integration rehearsal for proposed docs. Implementation records the real
merge target/tag, seams and focused results. No live migration or infrastructure change is
part of preparing these documents.
