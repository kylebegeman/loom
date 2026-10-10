# L58 technical design

## Overview

Four pieces, all inside L24's directories:

1. A per-project settings store, `projectSettings.ts`, with `autoChecks: { erc, drc }`.
2. A scheduler, `autoChecks.ts`, owned by `PcbPreviewService`. It counts watchers per design,
   debounces saved changes, runs one automatic check at a time and yields to manual runs.
3. A finding delta computed whenever any check result is persisted.
4. An activity stream, `checkEvents`, so every open panel refreshes `latestChecks` when a run
   it did not start lands. This also fixes agent-run checks never refreshing an open panel
   (the only refresh today is the check command's `onSuccess`,
   `packages/client-runtime/src/fork/pcb-preview.ts:165-180`).

The source of "a saved change" is the existing `watch` stream
(`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1170-1227`). It already debounces file
events by 350 ms, hashes the design's sources and emits only when the hash changes. The
scheduler taps it rather than adding a second file watcher.

## Contracts

All in `packages/contracts/src/fork/pcb-preview.ts` unless noted. Every new field on a persisted
or streamed shape is optional or has a decoding default, so check files written before L58 and
clients built before L58 keep decoding.

### Finding identity

The delta needs a stable id per finding. L52 defines it; this packet uses L52's definition
unchanged. If L52 has not landed, build exactly this part of L52 here:

- `PcbViolationItem` gains `uuid: Schema.optional(Schema.String)`. `kicadReports.ts:4-7` drops
  it today.
- `PcbViolation` gains `id: Schema.optional(TrimmedNonEmptyString)`.
- `findingId(kind, violation, sheetPath)` in `apps/server/src/fork/pcb-preview/kicadReports.ts`:
  FNV-1a over `kind`, `group`, `type`, the ERC sheet path, and the item uuids sorted. Items with
  no uuid fall back to the item description plus its position rounded to 0.1 mm. A second
  finding with the same hash gets `-2`, a third `-3`, in report order.

The rest of L52 (unit normalization, the ERC scale fix, markers) is not required here.

### Result additions

```ts
export const PcbCheckTrigger = Schema.Literals(["manual", "auto"]);
export const PcbResolvedFinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  type: Schema.String,
  description: Schema.String, // trimmed to 200 characters
});
export const PcbCheckDelta = Schema.Struct({
  previousRanAt: IsoDateTime,
  previousSourceHash: TrimmedNonEmptyString,
  newCount: NonNegativeInt,
  resolvedCount: NonNegativeInt,
  added: Schema.Array(TrimmedNonEmptyString), // ids, capped at 200
  resolved: Schema.Array(PcbResolvedFinding), // capped at 50
  /** True when either report was truncated at 500 findings, so counts may be off. */
  approximate: Schema.Boolean,
});
```

`PcbCheckResult` gains:

- `trigger: Schema.optional(PcbCheckTrigger)`; absent reads as manual.
- `durationMs: Schema.optional(NonNegativeInt)`.
- `delta: Schema.optional(PcbCheckDelta)`. Absent when there was no previous successful run of
  that check, or when the run failed or timed out.

### Project settings

In a new section of `pcb-preview.ts` (or `pcb-workspace.ts` if L68 put it there first; keep one
definition):

```ts
export const PcbAutoChecks = Schema.Struct({
  erc: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  drc: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export const PcbProjectSettings = Schema.Struct({
  autoChecks: PcbAutoChecks.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  // L68 adds `review` here with its own decoding default.
});
export const PcbProjectSettingsInput = Schema.Struct({ threadId: ThreadId });
export const PcbUpdateProjectSettingsInput = Schema.Struct({
  threadId: ThreadId,
  autoChecks: Schema.optional(
    Schema.Struct({ erc: Schema.optional(Schema.Boolean), drc: Schema.optional(Schema.Boolean) }),
  ),
});
```

The decoding default pattern matches `packages/contracts/src/fork/model-preview-3d.ts:237`. An
update merges only the fields given and returns the full `PcbProjectSettings`.

### Activity

```ts
export const PcbCheckEventsInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
});
export const PcbCheckActivity = Schema.Struct({
  running: Schema.NullOr(
    Schema.Struct({
      kind: PcbCheckKind,
      trigger: PcbCheckTrigger,
      sourceHash: TrimmedNonEmptyString,
    }),
  ),
  paused: Schema.Array(
    Schema.Struct({
      kind: PcbCheckKind,
      reason: Schema.Literals(["slow", "failed"]),
      durationMs: Schema.optional(NonNegativeInt),
    }),
  ),
  /** Latest persisted ranAt per kind; a client refreshes latestChecks when one advances. */
  ranAt: Schema.Struct({ erc: Schema.optional(IsoDateTime), drc: Schema.optional(IsoDateTime) }),
});
```

Each event is a full snapshot, so a dropped or repeated event is harmless.

### Methods

Added to `PCB_PREVIEW_WS_METHODS` (`pcb-preview.ts:15-43`) and the RPC group (`:335-357`):

| Method                                   | Payload                         | Success              | Scope             |
| ---------------------------------------- | ------------------------------- | -------------------- | ----------------- |
| `loom.pcb-preview.projectSettings`       | `PcbProjectSettingsInput`       | `PcbProjectSettings` | OrchestrationRead |
| `loom.pcb-preview.updateProjectSettings` | `PcbUpdateProjectSettingsInput` | `PcbProjectSettings` | TerminalOperate   |
| `loom.pcb-preview.checkEvents` (stream)  | `PcbCheckEventsInput`           | `PcbCheckActivity`   | OrchestrationRead |

`PcbLatestChecksInput` gains `ensureFresh: Schema.optional(Schema.Boolean)`, default false over
RPC. Updating the setting needs TerminalOperate because it schedules tool runs, the same scope
as `check` (`apps/server/src/fork/rpcAuthorization.ts:43`). Add all three to
`FORK_RPC_REQUIRED_SCOPES` (`rpcAuthorization.ts:21-46`; exhaustive, typecheck fails without
them), `updateProjectSettings` to `FORK_CLIENT_GUARDED_RPC_SCOPES`
(`packages/contracts/src/fork/clientRpcPermissions.ts:10-23`), and `checkEvents` to
`ForkSubscriptionRpcTag` (`packages/contracts/src/fork/rpc.ts:56-69`).

## Server

### Settings store

`apps/server/src/fork/pcb-preview/projectSettings.ts`, created by whichever of L58 or L68 lands
first:

- File: `<stateDir>/fork/pcb-preview/project-settings.json`, shape
  `{ projects: Record<projectId, PcbProjectSettings> }`, decoded with the defaults above.
- `get(projectId)` returns defaults for unknown projects and for an unreadable file (logged once).
- `update(projectId, patch)` runs under its own `Semaphore(1)`, rereads, merges, writes with
  `writeFileStringAtomically` like the check files (`PcbPreviewService.ts:1146-1147`), then
  publishes the new value on a `PubSub.sliding(16)` so the scheduler re-evaluates.
- Projects that no longer exist are kept; the file is a few hundred bytes per project.

The service resolves `projectId` through the existing `workspace(threadId)`
(`PcbPreviewService.ts:285-300`).

### Splitting `check`

`check` (`PcbPreviewService.ts:1058-1155`) becomes an inner
`runCheck(resolved, kind, trigger, timeout)` plus the public wrapper. The inner function keeps
everything it does today and adds:

- `durationMs` measured with `Clock.currentTimeMillis` around `run`.
- Inside the existing `cacheLock` block (`:1139-1150`), after reading `previous`: when the new
  outcome is `clean` or `violations` and the previous one was too, compute the delta. Write the
  file under the same `previous.ranAt <= value.ranAt` rule.
- For `trigger: "auto"`, skip the write when the outcome is `failed` or `timed-out`; return
  the result to the scheduler only. Manual runs persist failures as they do today.
- After writing, publish `{ key, kind, ranAt }` on a new `checkBus = PubSub.sliding(64)`
  (pattern from `workspaceBus`, `:1229`, and `workspaceUpdates`, `:2552-2567`).

The public `check` calls `scheduler.manual(key, kind, runCheck(..., "manual", "180 seconds"))`,
so the scheduler knows a manual run is active.

### Delta

`checkDelta(previous, next)` in `kicadReports.ts`, pure:

- Compare only findings with `excluded: false`. Excluding a finding in KiCad then reads as
  resolved, which is what the user did.
- Findings without an `id` (results written before L52 or this packet) get one computed on read
  with `findingId`, so the first run after upgrading still has a delta.
- `added`: ids in next not in previous, in report order, capped at 200. `resolved`: findings in
  previous not in next, capped at 50, descriptions trimmed to 200 characters. Counts are exact
  over the stored lists.
- `approximate` is true if either result has `truncated: true`.

Report size is capped at 500 findings (`contracts pcb-preview.ts:169`), so this is two small set
operations per run.

### Scheduler

`apps/server/src/fork/pcb-preview/autoChecks.ts` exports `makeAutoChecks(deps)` returning
`{ watching, notify, manual, ensureFresh, activity }`. It is built once in the service layer and
holds, per design key (`hashKey(workspaceKey, designId)`, `cache.ts:7`):

```ts
type DesignState = {
  watchers: number;
  resolved: ResolvedDesign; // latest, for running
  savedHash: string | null; // last hash seen from watch
  pending: Fiber | null; // debounce, then the run
  running: { kind; trigger; sourceHash } | null;
  manualActive: Set<PcbCheckKind>;
  paused: Map<PcbCheckKind, { reason: "slow" | "failed"; sourceHash: string; durationMs?: number }>;
};
```

State lives in a `Ref` (or `SynchronizedRef` for the fiber swaps); all transitions are short
and never wait on a tool.

Constants, named in the module:

| Name                     | Value | Why                                                                                                                               |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AUTO_CHECK_DEBOUNCE`    | 2 s   | Editors write several files per save; KiCad writes the schematic and backups in a burst. Added after watch's own 350 ms debounce. |
| `AUTO_CHECK_TIMEOUT`     | 120 s | Lower than the manual 180 s (`PcbPreviewService.ts:1092`); a run this long is already paused next time.                           |
| `AUTO_CHECK_MAX_MS`      | 60 s  | A run that took longer pauses that check for the design until a manual run is faster.                                             |
| `AUTO_CHECK_CONCURRENCY` | 1     | One automatic run on the environment at a time, through a scheduler `Semaphore(1)`.                                               |

Flow:

1. `watching(resolved)` is a scoped acquire. `watch` calls it inside its scope (`:1176`), so it
   increments `watchers` on subscribe and decrements on finalize. When `watchers` reaches 0,
   interrupt `pending` (which interrupts a running auto check and its KiCad process, since
   `run` spawns in a scope, `apps/server/src/processRunner.ts:239-241`).
2. `watch` taps each emitted `{ sourceHash }` (including the first) with
   `Stream.tap(e => scheduler.notify(key, resolved, e.sourceHash))`. The client stream is
   unchanged.
3. `notify` stores `savedHash`, reads the project setting and, if any enabled kind needs a run,
   interrupts `pending` and forks a new fiber: `Effect.sleep(AUTO_CHECK_DEBOUNCE)` then the
   run. A save during a running auto check therefore interrupts it.
4. A kind needs a run when it is enabled, the design has the needed file (schematic for ERC,
   board for DRC), the stored result's `sourceHash` differs from `savedHash`, it is not in
   `manualActive`, and it is not paused for this hash (failed) or at all (slow).
5. The run takes the scheduler permit, re-reads the setting, then runs ERC then DRC
   sequentially through `runCheck(..., "auto", AUTO_CHECK_TIMEOUT)`. Each run goes through the
   existing `kicadLock` (`PcbPreviewService.ts:223`), so it also queues behind a render.
6. After each run: if `durationMs > AUTO_CHECK_MAX_MS`, mark paused slow. If the outcome is
   `failed` or `timed-out`, mark paused failed for this hash. Publish activity.
7. `manual(key, kind, effect)` adds `kind` to `manualActive`, interrupts `pending` if its run is
   for the same design, runs `effect`, then removes `kind`, clears a slow pause when the manual
   run took at most `AUTO_CHECK_MAX_MS`, clears a failed pause, and calls `notify` again with
   the last `savedHash` so the other kind still runs. Manual runs never take the scheduler
   permit, so they never wait behind automatic work beyond the existing `kicadLock`.
8. A settings change re-runs `notify` for every design with watchers in that project.

The interrupted auto run never writes: the write happens after `run` returns, and interruption
stops the fiber before it.

### `ensureFresh`

`latestChecks({ ensureFresh: true })` calls `scheduler.ensureFresh(resolved)`, which:

- Takes a fresh `sourceSnapshot` (the agent may have saved a moment ago, before the watch fired).
- For each enabled kind whose stored hash differs and that is not paused: join the running or
  pending auto run for that design if it targets this hash, otherwise start one immediately
  (no debounce) through the same permit.
- Waits for those runs, bounded by `AUTO_CHECK_TIMEOUT` per kind, then reads results as today.

With the setting off, `ensureFresh` does nothing and the agent gets the stored results; the
tool description says to call `loom_pcb_check` then. `ensureFresh` does not count as a watcher;
work it starts runs to completion even with no client open.

### Activity stream

`checkEvents(input)` resolves the design, emits the current snapshot (running, paused, and
`ranAt` read from the stored files), then one snapshot per scheduler change or `checkBus`
message for that key. `Stream.changesWith` on a structural compare drops repeats. Manual runs
from any client or agent publish to `checkBus`, so all panels see them.

## Storage

- New: `<stateDir>/fork/pcb-preview/project-settings.json` (above).
- Changed: check files gain `trigger`, `durationMs` and `delta`. Old files decode unchanged.
- In memory only: scheduler state and pauses. A server restart clears pauses, which is fine:
  the next save tries once more.
- Client: none new. The Checks switches read the server setting, not `preferences.ts`.

## Clients

Web and desktop only.

- `packages/client-runtime/src/fork/pcb-preview.ts`:
  - `projectSettings` query family keyed by `{ threadId }`.
  - `updateProjectSettings` command whose `onSuccess` refreshes that query.
  - `checkEvents` subscription family with `idleTtlMs: 0`, like `watch` (`:154-158`).
- `apps/web/src/fork/pcb-preview/usePcbPreview.ts`:
  - Subscribe to `checkEvents` for the selected KiCad design while the panel is open.
  - When `ranAt.erc` or `ranAt.drc` is newer than the loaded result, refresh `latestChecks`
    (`:140-144`). The existing merge by `ranAt` (`:159-166`) keeps a local manual result
    if it is newer.
  - Expose `activity` alongside `checks`.
- `PcbPreviewPanel.tsx` status chips (`:1356-1379`): when `activity.running?.kind` matches,
  show "ERC: checking". When the latest result has a delta with new or resolved findings and
  matches the saved hash, show "DRC: 2 new, 5 resolved" (omit a zero part). A paused kind
  shows "DRC: paused". Otherwise keep the existing text. Tone: error when the result has
  errors, warning for new findings with no errors, ok when only resolved, stale unchanged. The
  title gives the full sentence, for example "DRC after a save: 7 findings, 2 new, 5 resolved.
  Ran 12:41.".
- `ChecksView.tsx`:
  - A row at the top, "Check after each save", with "ERC" and "DRC" checkboxes
    (`components/ui/checkbox.tsx`). Helper text: "For this project. Runs while this design is
    open or when an agent reads checks.". Disabled without TerminalOperate through the command's
    `permissionAtom`, with the existing message at `ChecksView.tsx:191`.
  - A summary line per kind when a delta exists: "2 new, 5 resolved since the last run". With
    `approximate`, append "(approximate)".
  - A "New" badge (`components/ui/badge.tsx`, existing variant) on rows whose id is in
    `delta.added`.
  - "Resolved" disclosure under the list showing `delta.resolved` descriptions, collapsed by
    default.
  - The paused notices from PRODUCT.md, with a "Run DRC" button that is the existing run action.
- With L52 present, `CheckMarkers.tsx` draws its active-style ring on findings in `delta.added`
  until the next run. Without L52 there are no markers; nothing to do.

No animation. The "checking" label is static text.

## Agent-facing tools

`apps/server/src/fork/pcb-preview/mcp.ts`:

- `loom_pcb_check` (`:110-119`): description becomes "Run KiCad ERC or DRC on saved source.
  The result's delta lists findings added and resolved since the previous run.". It calls the
  public `check`, so it counts as a manual run.
- `loom_pcb_latest_checks` (`:120-129`): parameters gain `ensureFresh` (MCP default true,
  applied in the handler at `:357-365`). Description: "Read the latest ERC and DRC results. When
  checks after each save are on for the project, waits for results that match the saved files.
  Each result's delta lists added and resolved findings.".
- New `loom_pcb_check_settings`: parameters `{ autoChecks?: { erc?, drc? } }`; with no
  `autoChecks` it reads, otherwise it updates and returns the settings. `actsAsCaller`, since it
  can schedule tool runs; read-only annotation false. Title "PCB: check settings". The handler
  calls `projectSettings` or `updateProjectSettings` on the service.
- The CLI maps `t3 pcb check_settings '<json>'` through the existing rule (`cli.ts:13-15`).
- Update `mcp.test.ts` expectations for the new tool list.

## Performance

- CPU, estimated and unverified: ERC on a small or medium schematic takes a few seconds; DRC
  takes a few seconds on a small board and can take minutes on a large dense one. Each
  automatic run is one `kicad-cli` process at a time on the environment.
- Caps: debounce 2 s, one automatic run on the environment at a time, interruption on a newer
  save, nothing runs without a watcher or an agent request, slow checks pause after 60 s,
  failures never retry on the same files, and stored results that already match skip the run.
  Worst case while someone saves continuously on a slow board: one run per save burst until the
  first slow run pauses it.
- Memory: one small state record per watched design.
- Wire: one activity snapshot (well under 1 KB) per state change per subscribed client, plus the
  existing `latestChecks` refresh when a run lands. Results already capped at 500 findings.
- Client: the chip and Checks re-render on activity changes only. No timers in the client.

## Alternatives considered

- Run checks in the client after each `watch` event. Two open clients would run twice, agents
  would get nothing, and closing the tab mid-run would waste the work. The scheduler belongs on
  the server, next to `kicadLock`.
- A global file watcher per project with the setting on. It would check designs nobody is
  looking at and keep KiCad busy in the background; rejected for CPU.
- Per-design setting. More precise but needs a setting per file and is easy to forget; the
  project scope matches how board rules are shared.
- Environment-wide setting in Settings. Simpler UI, but turning it on for one small board would
  start checks on every large board in other projects.
- Delta by description and position instead of uuid. Moving a part would read as one resolved
  and one new finding. Uuids survive moves; position is only the fallback.
- Reuse the `watch` stream to carry activity. It would change a contract every client decodes
  and mix two concerns; a separate small stream is cheaper to reason about.
- Persist automatic failures. That would replace a useful old report with an empty failed one
  after a half-written save.
