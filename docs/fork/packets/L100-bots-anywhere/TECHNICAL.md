# L100 technical design

## Overview

```text
Dorothy (requester)                     Library authority (VPS)                  Mini 2 (target)
share ─▶ BotLibraryClient.publish ───▶ fork_bots_library_bots (revisions) ◀── BotLibrarySync pull
                                                                              ─▶ linked local bot
                                        fork_bots_library_status ◀──────────── status every 60 s
run { target } ─▶ run row (remote) ───▶ requests/submit ─▶ request mailbox ──▶ requests/next (lease)
                                                                              ─▶ startRunWith (L89)
results/next (lease) ◀──────────────── result mailbox ◀───── results/post ◀── run changes
   ─▶ finish run row ─▶ changes PubSub ─▶ awaitRun, L93 feeder, L99 driver unchanged
```

The Library stores shared definitions, target status reports and two leased mailboxes. It never
launches anything. Computers only talk to the Library, over the publisher session they already
use for history and pages.

## Library connection and feature

Every call goes through `resolveLibraryConnection`
(`apps/server/src/fork/project-library/LibraryConnection.ts:55`):

- `none` or `unavailable`: the feature reports `library: "none"`; sharing and targets are hidden.
- `authority`: this computer is the Library; the client calls the bots Library service directly.
- `remote`: requests use `endpoint` and `send` (`LibraryConnection.ts:34-48`), which attach the
  publisher bearer token and fail `blocked` without one, `io` on transport.

The Library advertises `bots-anywhere` in `LibraryInfo.features`
(`packages/contracts/src/fork/project-library.ts:200`); computers read it from
`/api/loom/library/info` as `LibraryPublisher` already does (`LibraryPublisher.ts:313`). Without
it, the Bots page shows "Your Library does not support shared bots yet."

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_ANYWHERE_FEATURE = "bots-anywhere"`, `BOTS_MAX_VAULT_SLOTS = 16` (the
  `VaultReadinessInput` requirement cap, `packages/contracts/src/fork/vault-access.ts:142-146`).
- `BotLibraryLink = { libraryBotId, revision, libraryProjectId: NullOr(LibraryId), syncedAt,
modelOverride: NullOr(ModelSelection) }`. `BotDefinition` gains `library:
optionalKey(NullOr(BotLibraryLink))`. An optional key, not a new `BotOrigin` member, because
  a new union member fails to decode on older clients.
- `BotVaultSlot = { name (slug, at most 40), label (at most 80), action: VaultAccessAction,
destination: optionalKey(...) }`. `BotDefinitionInput` gains `vaultSlots:
optionalKey(Array(BotVaultSlot))`, at most 16.
- `BotTarget = Union({ type: "here" }, { type: "environment", environmentId }, { type: "best" })`,
  a new struct used only in inputs. `BotsRunInput`, `BotsBatchInput` (L93) and `BotPipelineStep`
  (L99) gain `target: optionalKey(BotTarget)`; absent means here.
- `BotRun` gains `ranOn: optionalKey(NullOr({ environmentId, label, threadId: NullOr(ThreadId)
}))` on the requester and `requestedBy: optionalKey(NullOr({ environmentId, label }))` on the
  target.
- `BotTargetReadiness = { environmentId, label, isThisComputer, online, ready, freeSlots,
reasons: Array(String) }`.

| Tag                           | Payload                                | Success                | Scope                   |
| ----------------------------- | -------------------------------------- | ---------------------- | ----------------------- |
| `loom.bots.share`             | `{ botId }`                            | `BotDefinition`        | `orchestration:operate` |
| `loom.bots.unshare`           | `{ botId }`                            | `BotDefinition`        | `orchestration:operate` |
| `loom.bots.syncLibrary`       | `{}`                                   | `{ pulled, refused }`  | `orchestration:operate` |
| `loom.bots.targets`           | `{ botId, projectId? }`                | `{ library, targets }` | `orchestration:read`    |
| `loom.bots.vaultBindings`     | `{ botId }`                            | `{ bindings }`         | `orchestration:read`    |
| `loom.bots.bindVaultSlot`     | `{ botId, slot, itemId: NullOr }`      | `{ bindings }`         | `orchestration:operate` |
| `loom.bots.remoteSettings`    | `{}`                                   | `BotRemoteSettings`    | `orchestration:read`    |
| `loom.bots.setRemoteSettings` | `{ acceptRemote, runtimeModeCeiling }` | `BotRemoteSettings`    | `orchestration:operate` |

`library` is `"none" | "unsupported" | "available"`. Refusals use existing `BotsError` reasons
with the specific text in `message`.

## Shared definitions

`share(botId)` publishes the definition input to `POST /api/loom/library/bots/publish` and stores
the returned link. Local fields stay local: `scopeProjectId` and a project workspace become
`libraryProjectId`, the Library project of the working copy that owns the local project
(`LibraryWorkingCopy.rootLocalProjectId`, `packages/contracts/src/fork/project-library.ts:100`).
A project bot whose project has no Library copy cannot be shared ("Add this project to the
Library first").

Saving a linked bot publishes first with `expectedRevision`; the Library answers
`revision-conflict` (an existing `LibraryError` reason) when another computer saved since, and
the local save is refused with the computer's label. When the Library is unreachable, linked
saves are refused rather than diverging. `unshare` removes the Library record and clears the
link on this computer; other computers keep their copy and clear their link on the next pull.

`BotLibrarySync` (under `forkParked`) pulls `POST /api/loom/library/bots/list` with a sequence
cursor at start, every 5 minutes, and after this computer publishes. Each newer revision is
applied as a local save of the linked definition (so L98 records a version), with the workspace
resolved to this computer's ready copy of `libraryProjectId`, or left unrunnable with a reason
when there is none. `modelOverride` keeps a per-computer model when the shared model's provider
instance is not installed here; it is never published.

## Vault slots

A bot declares slots; each computer binds them to its own Vault items in
`fork_bots_vault_bindings`, never synced. When a run starts, the bound items are added to the
rendered first message as standalone Vault links (`vaultPromptLink`,
`packages/contracts/src/fork/vault-prompt.ts:20`; reference text `loom-vault:<environment>:<id>`,
`vault-references.ts:25-26`). The existing `ext-vault-preflight` guard
(`apps/server/src/orchestration-v2/ProviderTurnStartService.ts:394-400`) then checks use
authority before the provider session opens, and a block ends the run with its safe message.
Local and remote runs behave the same.

The picker uses `VaultReferences.search` and `describe`
(`apps/server/src/fork/vault/VaultReferences.ts:16-28`), metadata only. Readiness before a run
reports only that each slot is bound and the Vault backend is reachable. `VaultAccess.readiness`
(`apps/server/src/fork/vault/VaultAccess.ts:176-178`) needs a `threadId`, which a run does not
have until it launches, so the decisive check stays the preflight guard.

## Targets and readiness

`loom.bots.targets` merges three sources:

- the directory listing from `DirectoryService.computers`
  (`apps/server/src/fork/directory/DirectoryService.ts:62`): per environment `supportsExecution`,
  `loomFeatures`, provider states and `reportedAt` (`packages/contracts/src/fork/directory.ts:97-119`);
- target status reports from `POST /api/loom/library/bots/targets`: `acceptRemote`, the
  runtime mode ceiling, free slots (`BOTS_MAX_ACTIVE_RUNS` minus active runs), and per shared bot
  `{ ready, reasons }` computed on that computer: project copy ready, required tools from
  `LibraryWorkspace.readiness` (the L73 tool probes, `TOOL_PROBES` and
  `makeProfileReadinessReader`, `LibraryProfileReadiness.ts:42,168`), slots bound, provider ready;
- this computer, computed directly.

A target is online when its status was reported within `LIBRARY_COMPUTER_ONLINE_WINDOW` (2
minutes, `apps/server/src/fork/project-library/LibraryLaunchCandidates.ts:23`). LoomOS machines in
the listing (`DirectoryMachine`, `directory.ts:155`) without a reporting environment are shown as
"Needs a Loom server". Mini offload jobs are `argv` commands (`MiniSubmit`,
`packages/contracts/src/fork/mini-offload.ts:63`), not agent sessions, so a Mini hosts bot runs
only through its own Loom server (`nativeServerRunning`, `mini-offload.ts:185-200`).

`best` picks the ready target with the most free slots; this computer wins ties.

## Remote runs

### Requester

`BotsService.run` with a target other than here: check the target is ready for this bot, write
the run row with `target_environment_id` and status `queued`, then submit `{ requestId: runId,
targetEnvironmentId, libraryBotId, revision, inputs, libraryProjectId }`. The request carries
inputs only. Remote runs take no local semaphore or bot permit: they use none of this
computer's provider capacity, and the target enforces the bot's limit.

`BotRemoteResults` (under `forkParked`) long-polls `results/next` with `LIBRARY_REPLY_WAIT_MAX_MS`
(25 seconds, `packages/contracts/src/fork/preview-links.ts:354`) and acknowledges each result.
`started` sets the run `running` with `ranOn`; `terminal` finishes it with status, result
(capped at `BOTS_RESULT_MAX_BYTES`), verdict (L92), usage (L95) and error, and publishes the
normal `run` change. `awaitRun`, the L93 feeder and the L99 driver therefore need no change.

Cancel posts `requests/cancel`. L89 recovery must not fail remote rows:
`BotsStore.listUnfinishedRuns` gains `target_environment_id IS NULL`. Remote rows get a deadline
of creation plus the bot's timeout plus 15 minutes; past it they become `timed_out` with "Mini 2
did not report back."

A batch with a target feeds items as remote runs with window `min(bot limit, target free slots,
20)`. A pipeline step with a target does the same for its run or fan-out.

### Target

`BotRemoteExecutor` runs under `forkParked` while `acceptRemote` is on, and after it is turned off
until the remote-requested runs already started end, so their requesters can still cancel them.
Turned off, it refuses new requests, and a queued remote-requested run fails instead of starting.
It long-polls `requests/next` and handles each leased message:

1. **Dedupe.** `fork_bots_runs.remote_request_id` is unique; a redelivered request returns the
   existing run.
2. **Definition.** Load the linked bot by `libraryBotId`; if its revision is older, sync first;
   a mismatch is refused, including a newer revision, since the requester recorded the one it sent. The request never supplies instructions.
3. **Policy.** The caller is `{ actor: "agent", runtimeMode: ceiling }`, so L89's runtime mode
   rank check refuses bots above the ceiling. L95 budgets apply here.
4. **Start.** `startRunWith(definition, inputs, caller, { remoteRequestId, requestedBy })`, then
   `requests/ack` with `accepted`, or `refused` with the message.
5. **Report.** Subscribe to the run's changes and post `started` and `terminal` to
   `results/post`.

Runs requested by other computers are excluded from the target's inbox (L94); they appear in the
requester's.

## Library side

`apps/server/src/fork/bots/libraryHttp.ts`, routes under `/api/loom/library/bots/`, registered
in `apps/server/src/fork/ForkLayer.ts` beside `LibraryHttpRoutes` and `PageLibraryHttpRoutes`
(`ForkLayer.ts:363-367`). Authentication follows the pages routes
(`apps/server/src/fork/preview-pages/libraryHttp.ts:71-90`): only publisher sessions with
`AuthLibraryPublishScope` and subject `loom-host:<environment>`; the environment comes from the
session, never the body. Bodies are capped (128 KiB for `publish`, 64 KiB otherwise) before they
are read.

| Route                   | Does                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `publish`, `unpublish`  | revisioned upsert and delete of a shared definition                      |
| `list`                  | definitions and deletions after a sequence cursor                        |
| `status`, `targets`     | store one computer's report; list reports                                |
| `requests/submit`       | refuse if the target is offline, not accepting, or not ready for the bot |
| `requests/next`, `/ack` | leased delivery to the target, as pages replies do                       |
| `requests/cancel`       | queue a cancel message for the target                                    |
| `results/post`          | append an update for the requester                                       |
| `results/next`, `/ack`  | leased delivery to the requester                                         |

Leases copy `PageLibraryService`: a waiter taken before the first look, a 2-minute lease
(`REPLY_LEASE_MS`, `PageLibraryService.ts:96`), and `Deferred` wake-ups
(`PageLibraryService.ts:452-466`). An unleased request older than 10 minutes is refused back to
the requester ("Mini 2 did not pick up the run."). Delivered messages are deleted after 7 days.

**Deployment.** This code runs on the Library only after Kyle approves a Library release. The
implementing agent tests it against a local authority (`LOOM_LIBRARY_AUTHORITY`, read in
`LibraryConnection.ts:56`) and never deploys, enrolls computers, or changes the VPS.

## Storage

Migration 12 `Anywhere` (next free id if another bots migration landed first):

- Computer side: `ALTER TABLE fork_bots_definitions ADD COLUMN library_json TEXT`;
  `fork_bots_vault_bindings(bot_id, slot, item_id, PRIMARY KEY (bot_id, slot))`;
  `fork_bots_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`;
  `ALTER TABLE fork_bots_runs ADD COLUMN target_environment_id TEXT`, `remote_request_id TEXT`
  (unique index where not null), `ran_on_json TEXT`, `requested_by_json TEXT`;
  `fork_bots_library_cursor(key TEXT PRIMARY KEY, value TEXT NOT NULL)`.
- Library side (created everywhere, used only on the authority):
  `fork_bots_library_bots(id, revision, seq, definition_json, project_id, updated_by, updated_at,
deleted_at)`, `fork_bots_library_status(environment_id PRIMARY KEY, report_json,
reported_at)`, `fork_bots_library_requests(id PRIMARY KEY, from_env, target_env, message_json,
state, leased_until, created_at)`, `fork_bots_library_results(request_id, seq, to_env,
update_json, leased_until, acked_at, PRIMARY KEY (request_id, seq))`.

## Clients

- `packages/client-runtime/src/fork/bots.ts`: targets, bindings and remote settings atoms;
  commands.
- `apps/web/src/fork/bots/`: Share and Unshare, the badge and conflict message, a target picker
  with readiness reasons on Run, Run on many and pipeline steps, a Vault slots group in the
  editor with the reference picker, a Remote runs section, and "Ran on" and "Requested by" on run
  rows. Opening a remote run thread uses the client's connection to that environment when one
  exists.

## Agent-facing tools

- `loom_bots_targets` (read): readiness for a bot.
- `loom_bots_run`, `loom_bots_run_batch` and `loom_bots_run_pipeline` accept `target`.
- `loom_bots_share` (write). Remote settings are not on MCP: accepting work from other
  computers is Kyle's decision.

## Performance

One status post per minute per computer and two long-polls when the feature is on. Remote runs
move at most 16 KiB of result per run. Nothing streams transcripts across computers.

## Alternatives considered

- **Direct computer-to-computer RPC.** Needs reachable routes and cross-computer auth; the
  Library mailbox works behind NAT with the existing publisher session.
- **Run bots as Mini offload jobs.** Offload runs commands from a committed snapshot, not agent
  sessions with providers and the Vault.
- **Copy secrets with the definition.** Breaks the Vault's per-computer model; slots keep values
  where they live.
