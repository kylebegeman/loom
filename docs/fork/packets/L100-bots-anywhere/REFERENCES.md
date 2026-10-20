# L100 references

- `apps/server/src/fork/project-library/LibraryConnection.ts:34-55`: connection kinds, `send`,
  `resolveLibraryConnection`, `LOOM_LIBRARY_AUTHORITY`.
- `apps/server/src/fork/project-library/http.ts:178-226`: the Library's own routes;
  `apps/server/src/fork/project-library/LibraryPublisher.ts:313,459-530`: client calls over
  `endpoint` (projects, briefs, previews, pages).
- `apps/server/src/fork/preview-pages/libraryHttp.ts:71-90,163-176` and
  `apps/server/src/fork/preview-pages/PageLibraryService.ts:96,452-466`: publisher-only routes and
  the leased reply mailbox; `apps/server/src/fork/preview-pages/PreviewPagesService.ts:388-410`:
  the computer-side long-poll loop under `forkParked`.
- `packages/contracts/src/fork/preview-links.ts:354` `LIBRARY_REPLY_WAIT_MAX_MS`.
- `packages/contracts/src/fork/project-library.ts:92-108` `LibraryWorkingCopy`
  (`rootLocalProjectId`), `:166-178` `LibraryComputerRegistration`, `:191-202` `LibraryInfo`.
- `apps/server/src/fork/project-library/LibraryLaunchCandidates.ts:23-36`: the online window and
  why launch candidates offer no Mini.
- `apps/server/src/fork/project-library/LibraryProfileReadiness.ts:42,168` and
  `packages/contracts/src/fork/project-library-readiness.ts:44-59` (L73 tool readiness).
- `apps/server/src/fork/vault/VaultAccess.ts:176-178`, `packages/contracts/src/fork/vault-access.ts:142-170`
  (readiness needs a thread); `apps/server/src/fork/vault/VaultReferences.ts:16-28`,
  `packages/contracts/src/fork/vault-references.ts:25-26`, `packages/contracts/src/fork/vault-prompt.ts:20`
  (L74 references and prompt links); `docs/fork/packets/L74-vault-references/TECHNICAL.md`
  "Explicit launch attachments".
- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts:394-400` `ext-vault-preflight`.
- `apps/server/src/fork/directory/DirectoryService.ts:48-64` and
  `packages/contracts/src/fork/directory.ts:97-175`: environments, providers and LoomOS machines.
- `packages/contracts/src/fork/mini-offload.ts:63-87,185-200`: offload jobs are commands;
  `nativeServerRunning`.
- `apps/server/src/fork/bots/BotsStore.ts` `listUnfinishedRuns`;
  `apps/server/src/fork/bots/BotsService.ts` `recover`, `awaitRun`.
- `docs/fork/packets/L93-bots-batches/TECHNICAL.md`, `docs/fork/packets/L99-bots-pipelines/TECHNICAL.md`:
  the feeder and driver that consume remote runs unchanged.
- Prior art: GitHub Actions self-hosted runners (runners poll for jobs; secrets stay with the
  runner's configuration), Buildkite agents and queues, SQS visibility timeouts for leased
  delivery.
