# L100 implementation

Prerequisites: L89 landed; L93 and L99 for remote batches and steps. Read
[TECHNICAL.md](./TECHNICAL.md) first.

**Local only.** Build and test against a local Library authority. Do not deploy to the Library
VPS, enroll or reconfigure any computer, change Kyle's Library credentials, or start a server
against `~/.t3/userdata`. Kyle approves any rollout separately.

## Steps

1. **Contracts.** In `packages/contracts/src/fork/bots.ts` add the constants, `BotLibraryLink`,
   `BotVaultSlot`, `BotTarget`, `BotTargetReadiness`, `BotRemoteSettings`, the optional keys on
   `BotDefinition`, `BotDefinitionInput`, `BotRun`, `BotsRunInput`, `BotsBatchInput` and
   `BotPipelineStep`, the eight RPCs, and the Library wire schemas (publish, list, status,
   request, result messages). Scope rows in `clientRpcPermissions.ts`; `bots-anywhere` in
   `apps/server/src/fork/features.ts`.
2. **Migration 12.** Append `Anywhere` to `BotsMigrations` (next free id if another bots
   migration landed first). Store functions for links, bindings, settings, remote run columns and
   the Library tables. Add `target_environment_id IS NULL` to `listUnfinishedRuns`.
3. **Library service.** `apps/server/src/fork/bots/BotLibraryService.ts` on the authority:
   revisioned publish and delete, list by sequence, status reports, both mailboxes with leases,
   expiry and cleanup. Model the lease code on `PageLibraryService` rather than sharing it; the
   two mailboxes have different payloads and retention.
4. **Library routes.** `apps/server/src/fork/bots/libraryHttp.ts` with the pages route's
   authentication and body caps; register in `ForkLayer.ts`.
5. **Library client.** `apps/server/src/fork/bots/BotLibraryClient.ts`: one method per route
   over `resolveLibraryConnection`, calling the service directly when this computer is the
   authority; a feature check from `/api/loom/library/info`.
6. **Sharing and sync.** `share`, `unshare`, linked saves with `expectedRevision`, and
   `BotLibrarySync` under `forkParked`. Resolve workspaces through ready working copies.
7. **Vault slots.** Bindings, the picker RPCs over `VaultReferences`, and adding bound links to
   the first message in the run path for local and remote runs alike.
8. **Status and targets.** The 60-second status reporter, `loom.bots.targets` merging the
   directory listing, status reports and local readiness, and `best` selection.
9. **Requester.** Remote branch in `BotsService.run` and `startRunWith`, `BotRemoteResults`,
   cancel, the deadline sweep, and remote windows in the L93 feeder and L99 driver.
10. **Target.** `BotRemoteExecutor` with dedupe, revision check, ceiling, budgets, ack and result
    posting; inbox exclusion for `requestedBy` runs.
11. **RPC and MCP.** Handlers that decode, call one service method and map errors; MCP
    `loom_bots_targets`, `loom_bots_share`, and `target` on the run tools.
12. **Client runtime and web.** Atoms and commands; Share, badge, target picker, Vault slots
    group, Remote runs section, run row labels.

Checkpoint: after step 5, a test with two in-process computers and one local authority can
publish and list. After step 10, a run submitted on one completes on the other.

## Checks

```sh
vp test run apps/server/src/fork/bots/BotLibraryService.test.ts \
  apps/server/src/fork/bots/libraryHttp.test.ts \
  apps/server/src/fork/bots/BotLibrarySync.test.ts \
  apps/server/src/fork/bots/BotRemoteRuns.test.ts
```

Then targeted lint and typecheck for `apps/server`, `packages/contracts`,
`packages/client-runtime` and `apps/web`. No repo-wide checks.

## Done when

- A bot shared on one test computer appears linked on another and edits round-trip with
  conflicts refused.
- A run with a target executes on the target with that target's Vault bindings and returns its
  reply, verdict and usage to the requester.
- Restarting either side mid-run neither loses nor duplicates the run.
- With the Library feature absent, the Bots page and every L89 to L99 path behave as before.
- Nothing was deployed; the final report says what Kyle must approve to roll it out.
