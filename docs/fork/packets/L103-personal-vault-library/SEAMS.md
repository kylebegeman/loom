# L103 seams

## Present state

Seven design documents only. No code, new extension point or upstream seam. The proposed
`ext-personal-vault` library/custody operations do not exist; missing ones leave personal
features unavailable. Existing development UI is reference material, not a backing service.

## Candidate touchpoints

| Current path                                             | Intended role                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/web/src/fork/settings/registry.ts:26`              | Non-secret trusted-client launch/status entry.                                           |
| `apps/web/src/fork/vault/SettingsSection.tsx:135`        | Existing server reveal, deliberately excluded from personal library data flow.           |
| `apps/mobile/src/fork/vault/VaultSettingsSection.tsx:48` | Selected-computer development UI; a personal local view must be distinct.                |
| `packages/client-runtime/src/fork/vault-core.ts:43`      | Environment RPC atoms, not a place for personal search/detail state.                     |
| `apps/desktop/src/preload.ts:77`                         | Native bridge integration only after the optional desktop fork extension is implemented. |

Proposed code belongs under fork-owned `personal-vault-library` paths with a reviewed trusted
native/client target. A web settings route, if needed, uses the existing fork naming scheme
and generated route tree; it must not acquire decrypted content. Native target/navigation
seams cannot be finalized before custody topology selection. No new upstream packet seam is
currently justified or added.

## Fork records and merge proof

FORK.md/seams.tsv rows added: none. Future upstream touches need exact inventory, marked
`fork: personal-vault-library` lines and no-marker JSON records where required. Shared boundary
implementation is separate from numbered packet internals. No merge preview/rehearsal was run
for design-only work; implementing code records its actual tag and check results.
