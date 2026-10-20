# L98 technical design

## Overview

```text
BotsService.save ─▶ fork_bots_definitions (current)  +  fork_bots_versions (every version, same tx)
                                   │
loom.bots.versions / version ──────┤ history, two definitions for a diff (diffed in the browser)
loom.bots.setStable ───────────────┤ stable_version on the definition row (no new version)
loom.bots.definitionAt(version) ───┘ used by L93 batches, L97 triggers, L99 pipeline steps

loom.bots.replay { botId, source: draft | version, runIds }
   ─▶ fork_bots_replays + items ─▶ startRunWith(definition, run.inputs, caller, { replayId })
   ─▶ side-by-side rows (original run vs replay run)

loom.bots.rateRun ─▶ rating, note on the run
loom.bots.suggestEdit ─▶ hidden drafting thread (L96 BotDrafts) ─▶ proposed draft
```

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_VERSIONS_FEATURE = "bots-versions"`.
- `BotVersion = { botId, version, definition: BotDefinitionInput, savedBy: Literals(["user",
"agent", "starter", "restore"]), savedAt, changed: Array(String), restoredFrom: NullOr(Int) }`.
  `changed` lists top-level field names that differ from the previous version, computed at save.
  It is a new struct, so its literals do not affect older clients.
- `BotVersionSummary = BotVersion` without `definition`, plus `runs`, `passRate`,
  `medianTotalTokens` (null without L92 and L95 data).
- `BotDefinition` gains `stableVersion: Schema.optionalKey(Schema.NullOr(Schema.Int))`.
- `BotRun` gains `replayId: optionalKey(NullOr(String))`, `rating: optionalKey(NullOr(Literals(["up",
"down"])))`, `note: optionalKey(NullOr(String))` (at most 500 characters).
- `BotReplay = { id, botId, source: { kind: "draft" } | { kind: "version", version }, baseVersion,
createdAt, status: Literals(["running", "done", "cancelled"]), items: Array({ originalRunId,
replayRunId: NullOr(BotRunId), comparison: Literals(["fixed", "broke", "same", "changed",
"pending", "failed"]) }), summary: { fixed, broke, same, changed, failed } }`.

| Tag                        | Payload                                                             | Success                 | Scope                   |
| -------------------------- | ------------------------------------------------------------------- | ----------------------- | ----------------------- |
| `loom.bots.versions`       | `{ botId, before?, limit (1 to 50) }`                               | `{ versions, hasMore }` | `orchestration:read`    |
| `loom.bots.version`        | `{ botId, version }`                                                | `BotVersion`            | `orchestration:read`    |
| `loom.bots.setStable`      | `{ botId, version: NullOr(Int) }`                                   | `BotDefinition`         | `orchestration:operate` |
| `loom.bots.restoreVersion` | `{ botId, version, expectedVersion }`                               | `BotDefinition`         | `orchestration:operate` |
| `loom.bots.replay`         | `{ botId, draft?: BotDefinitionInput, version?, runIds (1 to 20) }` | `BotReplay`             | `orchestration:operate` |
| `loom.bots.getReplay`      | `{ replayId }`                                                      | `BotReplay`             | `orchestration:read`    |
| `loom.bots.cancelReplay`   | `{ replayId }`                                                      | `BotReplay`             | `orchestration:operate` |
| `loom.bots.rateRun`        | `{ runId, rating: NullOr(up/down), note: NullOr(String) }`          | `BotRun`                | `orchestration:operate` |
| `loom.bots.suggestEdit`    | `{ botId, runIds? }`                                                | `BotDraftResult` (L96)  | `orchestration:operate` |

Exactly one of `draft` and `version` is set on `replay`. Replay progress reaches the client
through the existing `run` change (replay runs are runs) plus `getReplay` on each change of a run
with that `replayId`; no `BotsChange` member is added.

## Writing versions

`BotsService.save` (`apps/server/src/fork/bots/BotsService.ts`) computes the next version from
the existing definition, or, for a recreated id, from `BotsStore.maxRunVersion` (added with
L90). With a versions table, a version can exist with no runs, so the next number becomes
`1 + max(existing version, maxRunVersion, MAX(version) in fork_bots_versions)`. The definition
upsert (`BotsStore.putDefinition`) and the version insert run in one transaction, so a crash can
never leave a current definition without its version row.

`changed` compares the new definition input with the previous version's, field by field (deep
equality for `workspace`, `parameters`, `modelSelection`), so history shows "Instructions,
timeout" without loading two definitions.

`savedBy` is `restore` for `restoreVersion`, `starter` when the save came from L90's seeding or
restore (the definition's `origin` is set and the text equals the shipped text), otherwise the
caller's actor.

Deleting a bot keeps its version rows, so its runs stay readable and numbering continues if the
id is reused. Version rows of a deleted bot are removed when its last run is pruned.

Retention: at most 200 versions per bot. Beyond that, the oldest versions that no kept run
references and that are not stable or pinned by a trigger (L97) or pipeline (L99) are deleted.

### Migrating existing bots

Migration 10 inserts one version row per existing definition from `fork_bots_definitions`
(`savedBy` from `created_by`, `changed` empty). Older versions were never stored; history starts
at the current one and the UI says "Earlier versions were saved before history was kept".

## Running a specific version

`BotsService.definitionAt(botId, version | "stable" | "latest")` returns the stored definition
merged with the current row's `archivedAt` (an archived bot refuses every version). L93, L97 and
L99 call it and pass the result to `startRunWith`, which already accepts a definition and records
`botVersion` from it. With L98, L93 batches store `bot_version` instead of a `definition_json`
snapshot for new batches; existing batch rows keep their snapshot.

## Replay

`BotReplays.start(input, caller)`:

1. Load the bot and the runs; every run must belong to the bot and be terminal. Runs of a
   deleted parameter set still replay: inputs are validated against the replayed definition with
   `validateInputs` (`apps/server/src/fork/bots/render.ts:78`), and a run whose inputs no longer
   validate becomes an item with comparison `failed` and the reason, without a launch.
2. A draft is validated like a save (`checkParameters`, runtime mode rank against the caller) and
   stored in the replay row as JSON, with `bot_version` 0 on its runs. Version 0 is never a saved
   version (`BotDefinition.version` requires at least 1 in `packages/contracts/src/fork/bots.ts`).
3. Budget (L95): the whole replay is checked up front (`runsInWindow + items <= runsPerDay`); a
   replay never half-starts on a budget.
4. Items start through `startRunWith(definition, run.inputs, caller, { replayId })` with
   concurrency `min(bot limit, 5)`, the L93 feeder shape. Replay runs keep the original run's
   project and, for L90 `caller` checkouts, its recorded `checkoutThreadId` (L94).
5. Each finished replay run updates its item's comparison:
   - with verdicts (L92): original `fail` or `needs_attention` and replay `pass` is `fixed`;
     original `pass` and replay not `pass` is `broke`; equal verdicts are `same`;
   - without verdicts: equal status and identical result text is `same`, otherwise `changed`;
   - a replay run that failed or timed out is `failed`.

Recovery follows L93: pending items have no run rows and are started again after a restart;
items whose run failed with `started_at` null are requeued.

Replay runs are excluded from the inbox: `isBotInboxRun` gains `replayId == null`, and the inbox
SQL adds `replay_id IS NULL`. An older client that still shows a replay failure in its inbox
count is a cosmetic mismatch, not an error. Usage (L95) counts replay runs under the bot and
reports them separately as "replays".

Replays are kept for 30 days or the newest 20 per bot. Their runs follow normal run pruning; an
item whose run was pruned shows "Run no longer kept".

## Ratings and suggested edits

`rateRun` sets `rating`, `note`, and `rated_at` on any terminal run.

`suggestEdit` reuses L96's `BotDrafts` drafting thread (scratch project, `approval-required`,
`plan`, 180 seconds, archived afterwards) with `SUGGEST_EDIT_REQUEST`: the current definition, up
to 10 down-rated runs (or the given `runIds`) with inputs, results capped at 4 KiB each, verdicts
and notes, and up to 5 up-rated runs as examples to keep. The reply's `instructions` and
`parameters` are merged into the current definition and returned as a `BotDraftResult`; nothing
is saved.

## Storage

Migration 10 `Versions` (next free id if another bots migration landed first):

- `fork_bots_versions(bot_id TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT
NULL, saved_by TEXT NOT NULL, saved_at TEXT NOT NULL, changed_json TEXT NOT NULL,
restored_from INTEGER, PRIMARY KEY (bot_id, version))`.
- `ALTER TABLE fork_bots_definitions ADD COLUMN stable_version INTEGER`.
- `fork_bots_replays(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, source_json TEXT NOT NULL,
draft_json TEXT, base_version INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
finished_at TEXT)` and `fork_bots_replay_items(replay_id TEXT NOT NULL, original_run_id TEXT NOT
NULL, replay_run_id TEXT, comparison TEXT NOT NULL, reason TEXT, PRIMARY KEY (replay_id,
original_run_id))`.
- `ALTER TABLE fork_bots_runs ADD COLUMN replay_id TEXT`, `rating TEXT`, `note TEXT`,
  `rated_at TEXT`.

## Clients

- `packages/client-runtime/src/fork/bots.ts`: versions pages, a replay atom refreshed from run
  changes with its `replayId`, commands.
- `apps/web/src/fork/bots/BotHistory.tsx`: the version list and compare view. The instructions
  diff uses `parseDiffFromFile` from `@pierre/diffs`, the library the web app already uses for
  file diffs (`apps/web/src/lib/diffRendering.ts:2,99`), with the two instruction texts as old
  and new files. Other fields render as Before and After rows.
- `apps/web/src/fork/bots/BotReplay.tsx`: run picker with filters, the side-by-side table, the
  summary line, and "Save as new version" (a normal save with `expectedVersion`).
- Run rows gain the rating buttons and note field; the editor gains Suggest an edit.

## Agent-facing tools

- `loom_bots_versions` (read): history summaries.
- `loom_bots_replay` (write): `{ botId, draft? | version?, runIds }`; `loom_bots_replay_status`
  (read). An orchestrator tuning a bot can measure its edit before saving it.
- `loom_bots_rate_run` (write): an agent that checked a bot's result can record a rating and note.

## Performance

A save adds one row. History reads summaries without definitions. Replay is bounded at 20 runs.

## Alternatives considered

- **Diff on the server.** Ships a diff format over the wire and duplicates what the web diff
  library already does for two strings.
- **Replay in a temporary bot.** Would need a fake id, permits and cleanup; a draft definition
  passed to `startRunWith` reuses everything.
- **Version rows only for pinned versions.** Smaller, but loses exactly the history that explains
  a regression.
