# L90 technical design

## Overview

```text
startup ─forkParked─▶ BotsService.seedStarters
                        │ for each shipped starter not in fork_bots_starters
                        ▼
          one transaction: insert definition (if id free) + fork_bots_starters row
                        │
                        ▼
                change PubSub ─▶ loom.bots.watch
Bots page "Restore starter" ─RPC loom.bots.restoreStarter─▶ BotsService.restoreStarter
```

Starters are ordinary bot definitions with an `origin` marker. Nothing in the run path changes.

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BotStarterId = Schema.Literals(["merge-conflict-resolver", "reviewer", "verifier"])`.
- `BotOrigin = Schema.Struct({ kind: Schema.Literal("starter"), starterId: BotStarterId,
revision: Schema.Int })`.
- `BotDefinition` gains `origin: Schema.optionalKey(BotOrigin)`. It is not part of
  `BotDefinitionInput`, so a client save cannot forge it; the service carries it forward on every
  save of that id.
- `BotStarterStatus`: `{ starterId, revision, name, description, state }` where `state` is
  `present | edited | outdated | removed`. `edited` means the stored instructions, parameters,
  modes, timeout or concurrency differ from the shipped revision it came from. `outdated` means
  the shipped revision is newer than `origin.revision`. `removed` means the starter row exists and
  no definition with that id carries the starter `origin` (deleted, or the id belongs to a bot
  Kyle wrote himself).

| Tag                        | Payload         | Success         | Scope                   |
| -------------------------- | --------------- | --------------- | ----------------------- |
| `loom.bots.listStarters`   | `{}`            | `{ starters }`  | `orchestration:read`    |
| `loom.bots.restoreStarter` | `{ starterId }` | `BotDefinition` | `orchestration:operate` |

- `BotWorkspace`'s project variant gains `checkout: Schema.optionalKey(Schema.Literals(["root",
"caller"]))`; absent means `root`, L89's behavior. `caller` means "run in the checkout the work
  is in": the run uses that thread's `worktreePath` (or the project root when it has none) through
  `ThreadLaunchService`'s `existing_worktree` strategy
  (`apps/server/src/orchestration-v2/ThreadLaunchService.ts:56-62`).
- `BotsRunInput` gains `checkoutThreadId: Schema.optionalKey(ThreadId)`: the thread whose
  checkout a `caller` bot uses. The service resolves it in this order: `checkoutThreadId`, then the
  run's caller thread (the authenticated MCP caller in L89, or the composer thread in L91), then
  refuses with `invalid` ("This bot runs in the checkout that holds the work; start it from that
  thread or pick a checkout."). The thread must belong to the run's project. Accepting a thread id
  instead of a raw path means the server only ever launches into a checkout Loom already manages.

`createdBy` stays `user | agent`. A seeded starter records `createdBy: "user"` because Kyle owns
it once it exists; the `origin` field, not `createdBy`, says where it came from. This avoids
adding a third `BotCreator` value that `startedBy` (which shares the schema) would then accept.

## Shipped definitions

`apps/server/src/fork/bots/starters.ts` exports `BOT_STARTERS`, a readonly array of
`{ starterId, revision, definition: Omit<BotDefinitionInput, "modelSelection"> }` and
`BOT_STARTERS_REVISION`. Each instruction text is a template literal kept in that file, so a
change to the shipped text is a reviewed code change that bumps `revision`.

| Id                        | Parameters                                                                                                 | Workspace                                                                   | Runtime / interaction           | Timeout | Concurrency |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- | ------- | ----------- |
| `merge-conflict-resolver` | `file` (string, required)                                                                                  | `{ type: "project", projectId: null, worktree: false, checkout: "caller" }` | `auto-accept-edits` / `default` | 20 min  | 4           |
| `reviewer`                | `target` (string, required), `lens` (choice: `correctness`, `surfaces`, `fidelity`, default `correctness`) | `{ type: "project", projectId: null, worktree: false }`                     | `approval-required` / `plan`    | 15 min  | 4           |
| `verifier`                | `target` (string, required), `claim` (text, required)                                                      | `{ type: "project", projectId: null, worktree: false }`                     | `auto-accept-edits` / `default` | 10 min  | 4           |

`projectId: null` means the caller chooses the project at run time (L89 `BotWorkspace`). The
resolver must run in the checkout that holds the conflict, usually an integration worktree, never
a fresh worktree, because the conflict state lives in that checkout's index. L89's workspace can
only target the project root or a new worktree, which is why this packet adds `checkout:
"caller"`.

Instruction outlines (the implementing agent writes the full text):

- Resolver: inspect `git diff -- {{file}}`, `git show :1:{{file}}` (base), `:2:` (ours) and `:3:`
  (theirs); keep every `fork:` marker line and the fork side of seams listed in
  `docs/fork/seams.tsv`; resolve, `git add {{file}}`, run the narrowest check for the file, never
  commit; reply with a short account of each hunk.
- Reviewer: do not edit files; read `{{target}}`; apply the `{{lens}}` checklist; reply with
  findings ordered by severity, each with a path and line where possible.
- Verifier: restate `{{claim}}` as a check; run the smallest command or test that decides it; stop
  at the time limit with "undetermined" rather than widening scope; reply with what ran and the
  answer.

The reply format is plain text until L92 adds the verdict contract; L92 switches the reviewer and
verifier starters to `output: "verdict"` in a new starter revision.

## Model at seed time

`BotDefinitionInput.modelSelection` is required, but the right model depends on the environment.
At seed time the service reads `ServerSettingsService.getSettings`
(`apps/server/src/serverSettings.ts:179`) and uses `defaultModelSelection`, falling back to
`fallbackTextGenerationModelSelection` (`packages/shared/src/serverSettings.ts:96`) over the
enabled provider instances. If neither yields a model, seeding writes nothing and runs again on
the next start. `restoreStarter` keeps the bot's current `modelSelection` when the bot exists, so
a restore never undoes Kyle's model choice.

## Storage

Migration 2 `Starters` appended to `BotsMigrations` in `apps/server/src/fork/bots/migrations.ts`
(L89 uses id 1 for both of its tables). If another bots migration landed first, take the next free
id.

- `fork_bots_starters(starter_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, seeded_at TEXT NOT
NULL)`.

A row means "this environment has offered this starter". Deleting the bot leaves the row, which
is how a deleted starter stays deleted across restarts.

## Server

- `BotsStore`: `listStarterRows`, `recordStarter(starterId, revision)` and an
  `insertDefinitionIfAbsent` that returns whether it wrote.
- `BotsService.seedStarters`: for each `BOT_STARTERS` entry without a row, in one SQL
  transaction: insert the definition at version 1 with `origin` if no bot has that id, then
  insert the row. A user bot that already owns the id is left alone; the row is still written, and
  the starter shows `removed` so Kyle can restore it under that id if he wants to replace his own.
  Publishes a `bot` change per insert.
- `BotsService.restoreStarter(starterId)`: builds the shipped definition, keeps the existing
  `modelSelection` and `scopeProjectId` if the bot exists, and saves through the normal `save`
  path so the version bumps and the change is published. Restoring also clears `archivedAt`. A
  deleted starter is recreated with a version one above the highest `bot_version` among its runs,
  so a version number never names two different texts (L98 relies on this).
- `BotsService.listStarters`: compares stored definitions with the shipped entries field by field
  (instructions, parameters, modes, workspace, timeout, concurrency; not model) to compute
  `state`.
- Seeding layer: `Layer.effectDiscard(forkParked(BotsService.use((s) => s.seedStarters)))`, next
  to L89's restart recovery. `forkParked` is at `apps/server/src/serverActivation.ts:28`.
- `bots-starters` appended to `LOOM_SERVER_FEATURES` (`apps/server/src/fork/features.ts:10`).

## Agent-facing tools

- `loom_bots_list` returns `origin` with each bot, so an agent can tell a starter from a custom bot.
- `loom_bots_restore_starter` (write): `{ starterId }`.

Agents need restore so an orchestrator that edited a starter badly can put it back without Kyle.

## Clients

- `BotRunForm.tsx`: for a `caller` bot, a "Checkout" picker listing the project root and the
  worktrees of the project's non-archived threads (from thread shells with a `worktreePath`),
  which fills `checkoutThreadId`.
- `apps/web/src/fork/bots/`: a `StarterChip` on the card (`Starter`, `Starter, edited`, or
  `Newer starter available`), "Restore starter" in `BotEditor.tsx` behind a confirm, and a
  "Starters you removed" list on the library pane fed by `listStarters`.
- `packages/client-runtime/src/fork/bots.ts`: `listStarters` query atom refreshed on any `bot` or
  `bot-deleted` change, and a `restoreStarter` command.
- Gating: everything above requires `bots-starters`; an older server shows bots without chips.

## Performance

Seeding is three inserts once per environment. `listStarters` reads three rows. No change to the
run path.

## Alternatives considered

- **Seed on every start unless present.** Deleted starters would come back, which reads as a bug.
- **A separate `starter` value in `BotCreator`.** `BotCreator` also types `BotRun.startedBy`, so a
  run could claim to be started by a starter.
- **Shipping starters as read-only built-ins.** Kyle wants to tune them; read-only copies would
  need a fork-and-edit flow for no gain.
