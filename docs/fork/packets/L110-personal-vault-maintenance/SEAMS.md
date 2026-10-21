# L110 seams

## Current state

Design documents only. No code seams, extension points, FORK.md rows or seam manifest changes were made. The personal worker/receipt interfaces are proposed, not inherited from development Vault health.

## Planned fork-owned work

Packet contracts and atoms, trusted-client maintenance worker/UI, and optional metadata services under `apps/server/src/fork/personal-vault-maintenance/`. Existing fork contracts/RPC, permissions, settings and palette registries are registration points. Keep the server's `apps/server/src/fork/vault/VaultHealthChecks.ts` personal-secret-free.

## Candidate upstream/native changes

No direct upstream seam is justified for a local analysis worker. If native reminders or a companion lifecycle hook cannot use a verified extension, inventory the smallest actual file before changing it. `apps/mobile/app.config.ts` may need a plugin insertion for a native integration; `apps/desktop/src/ipc/DesktopIpcHandlers.ts` may need a shared optional metadata bridge if `ext-desktop` is still absent. Neither is an approved seam yet. Never add raw-value transport to make registration convenient.

Any actual upstream insertion requires the exact `fork: personal-vault-maintenance` or shared-extension marker and matching FORK.md/`docs/fork/seams.tsv` entries. Any JSON/native config without markers needs an explicit no-marker row and reproducible source generator. No new dependency is selected by this proposal.

## Merge evidence

No merge preview, fetch, full fork check or clean-main rehearsal run for these docs. Implementation must record actual seams and exact nightly merge evidence; main rehearsal happens only after authorized landing.
