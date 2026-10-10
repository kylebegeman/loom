# L59 technical

## Overview

Every root turn in a Git workspace ends with a checkpoint whose `files` list names the paths the
turn touched (`OrchestrationV2Checkpoint`, `packages/contracts/src/orchestrationV2.ts:1208-1221`,
file entries at `:1200-1205`). L41 turns that list into "models the turn changed"; this packet
turns the same list into "PCB designs the turn changed", through one shared server module.

```
turnFiles.ts (shared with L41)                     PcbPreviewService
  turnCheckpoints(threadId, runId)  --->  turnDesigns(threadId, runId)  <--rpc-- PcbTurnChip
  repoPrefix(root), workspaceFiles  --->    designsForFiles(...)
  turnCheckpointEvents(threadId)    --->  turnDesignEvents(threadId)   <--rpc-- AgentDesignsHost
```

Nothing watches the filesystem and nothing runs per frame. Per finished turn the server does
one projection read and, only when a changed file can be a PCB source, one design discovery
plus a source walk for the designs not already matched by name.

## Contracts

In `packages/contracts/src/fork/pcb-preview.ts`, import `CheckpointId`, `PositiveInt` and
`RunId` from `../baseSchemas.ts` (exported at `baseSchemas.ts:396`, `:30`, `:328`) beside the
existing imports (`:6-13`), then add:

```ts
/** A design a turn wrote, or whose sources it changed. */
export const PcbTurnDesign = Schema.Struct({
  /** The design id from listDesigns: a `.kicad_pro`, standalone sheet/board, or tscircuit entry. */
  designId: TrimmedNonEmptyString,
  kind: Schema.Literals(["kicad", "tscircuit"]),
  name: Schema.String,
  /** "written": the turn changed one of the design's own files. "dependency": another source. */
  reason: Schema.Literals(["written", "dependency"]),
  /** For "dependency", the first changed source, workspace-relative. Null for "written". */
  via: Schema.NullOr(Schema.String),
});
export type PcbTurnDesign = typeof PcbTurnDesign.Type;

export const PcbTurnDesigns = Schema.Struct({
  /** Null when no turn in the thread changed a design. */
  runId: Schema.NullOr(RunId),
  checkpointId: Schema.NullOr(CheckpointId),
  /** The turn number shown in the UI (the checkpoint's appRunOrdinal). */
  turn: Schema.NullOr(PositiveInt),
  designs: Schema.Array(PcbTurnDesign).check(Schema.isMaxLength(20)),
  truncated: Schema.Boolean,
});
export type PcbTurnDesigns = typeof PcbTurnDesigns.Type;

export const PcbTurnDesignsInput = Schema.Struct({
  threadId: ThreadId,
  /** Null: the newest of the 20 latest turns that changed a design. */
  runId: Schema.NullOr(RunId),
});
```

Add to `PCB_PREVIEW_WS_METHODS` (`:15-43`):

```ts
  turnDesigns: "loom.pcb-preview.turnDesigns",
  turnDesignEvents: "loom.pcb-preview.turnDesignEvents",
```

and to `PcbPreviewRpcGroup` (`:225-357`), beside `watch` (`:351`):

```ts
  Rpc.make(PCB_PREVIEW_WS_METHODS.turnDesigns, {
    payload: PcbTurnDesignsInput,
    success: PcbTurnDesigns,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.turnDesignEvents, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: PcbTurnDesigns,
    error: errors,
    stream: true,
  }),
```

Both are reads. Add `[P.turnDesigns]` and `[P.turnDesignEvents]` with
`AuthOrchestrationReadScope` to `apps/server/src/fork/rpcAuthorization.ts` beside
`[P.listDesigns]` (`:41`) and `[P.watch]` (`:46`), and the stream tag to
`ForkSubscriptionRpcTag` (`packages/contracts/src/fork/rpc.ts:56-66`). The client's guarded
list (`packages/contracts/src/fork/clientRpcPermissions.ts:10`) holds writes only, so reads need
no entry there.

No persisted schema changes on the server. The client preference is below, with its decoding
default.

## Server

### Shared module: `apps/server/src/fork/turnFiles.ts`

This is the "files changed in a turn" piece `PCB-FOLLOW-UPS.md` assigns to L41. L41's
TECHNICAL.md specifies the logic but keeps it inside `ModelPreviewService`; it must be shared,
so it lives here, beside `editorBridge.ts` and `sharedJobs.ts`. Whichever of L41 and L59 lands
first creates it exactly as below; the other only calls it.

```ts
export interface TurnCheckpoint {
  readonly runId: RunId;
  readonly checkpointId: CheckpointId;
  readonly turn: number;
  /** Repository-relative paths, as the checkpoint stores them. */
  readonly files: ReadonlyArray<string>;
}

/** Turn checkpoints, the repository prefix and the per-turn stream, shared by fork panels. */
export const makeTurnFiles = Effect.gen(function* () {
  const queries = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagementService;
  const runner = yield* ProcessRunner.ProcessRunner;
  // ...
  return { repoPrefix, turnCheckpoints, workspaceFiles, turnCheckpointEvents };
});
```

- `repoPrefix(root)`: `git rev-parse --show-prefix` with `cwd: root` through `runner.run`
  (`timeout: "10 seconds"`), the same call shape as the PCB service's `git`
  (`PcbPreviewService.ts:1860-1881`). Trim the output; `""` at the top of the repository,
  `"sub/"` below it. Non-zero exit means "not a Git repository" and returns `null`. Cache per
  root in a `Map<string, string | null>`. Checkpoint paths are repository-relative
  (`apps/server/src/vcs/GitVcsDriver.ts:1214`, per L41) while design ids are relative to the
  thread's workspace root, which can be a subdirectory.
- `turnCheckpoints(threadId, runId, limit)`: `queries.getThreadRecords(threadId,
["checkpoints"])` (`apps/server/src/orchestration-v2/ProjectionStore.ts:364-368`). Keep
  checkpoints with `runId !== null`, `appRunOrdinal !== null`, `status === "ready"` and
  non-empty `files` (baselines have both fields null, per L41). With a `runId`, return that
  run's checkpoint; with `null`, the newest `limit` by `appRunOrdinal`.
- `workspaceFiles(prefix, files)`: keep paths starting with `prefix`, strip it, drop the rest.
- `turnCheckpointEvents(threadId)`: `threads.streamDomainEvents`
  (`ThreadManagementService.ts:382`, a `Stream` of every domain event) filtered to
  `type === "checkpoint.captured"` (`orchestrationV2.ts:1765`) with
  `payload.threadId === threadId` and the same turn checkpoint test, mapped to
  `TurnCheckpoint`.

`ProjectLifecycleService` already yields `ThreadManagementService` inside the fork layer
(`apps/server/src/fork/project-lifecycle/ProjectLifecycleService.ts:209`), so
`ForkLayer.ts:24` needs no change; confirm with the server typecheck.

### Sources per design

`sourceSnapshot` (`PcbPreviewService.ts:518-608`) already walks every file whose change makes
the panel reload: KiCad files under the design folder plus referenced sheets and library
tables, tscircuit sources under the package root plus relative imports. It records each path
(`:597-604`) and returns only `{ dirs, sourceHash }` (`:607`). Return the paths too:

```ts
return { dirs, sourceHash: hashKey(...records.sort()), files };
```

where `files` collects `path.relative(resolved.root, canonical)` beside `records.push`. Callers
that destructure `dirs` and `sourceHash` are unaffected. Also export the two "relevant file"
tests at `:557-564` as a module-level `isPcbSource(kind, name)` so `turnDesigns.ts` can
pre-filter with the same rule.

### Turn designs: `apps/server/src/fork/pcb-preview/turnDesigns.ts`

The service file is about 2,600 lines, so the logic goes in a new file with a call site in
`make` (`PcbPreviewService.ts:195`). Its closures (`workspace` `:276`, `discover` `:439-470`,
`sourceSnapshot`, `packageRoot`) are passed in:

```ts
export const makeTurnDesigns = (deps: {
  workspace: (threadId: ThreadId) => Effect<{ root: string }, PcbPreviewError>;
  discover: (root: string) => Effect<{ designs: ReadonlyArray<GroupedDesign> }, PcbPreviewError>;
  snapshotFiles: (root: string, design: GroupedDesign) => Effect<ReadonlyArray<string>, ...>;
  turnFiles: TurnFiles;
}) => ({ turnDesigns, turnDesignEvents });
```

`snapshotFiles` is a small wrapper in the service: it builds the resolved design the way
`resolveDesign` does (`:500-516`: KiCad `cwd` is the design's folder, tscircuit `cwd` is
`packageRoot`) without a second `discover`, and returns `sourceSnapshot(...).files`. Extract
that body from `resolveDesign` into `resolveFound(ws, design)` and have `resolveDesign` call it.

`designsForFiles(root, changed)` where `changed` is workspace-relative:

1. Keep the changed paths for which `isPcbSource("kicad", name)` or
   `isPcbSource("tscircuit", name)` holds. None left: return no designs, without discovery.
   A turn that only edited Markdown costs one projection read.
2. `discover(root)` (`:439-470`), which already drops Git-ignored entries (`:449`).
3. **Written.** A design is written when a changed path equals its `id`, `schematicPath` or
   `boardPath`, or, for KiCad, `stem + ".kicad_pro"` where `stem` strips
   `.kicad_(pro|sch|pcb)` from the id, as `groupDesigns` does (`discovery.ts:46`). A KiCad
   project is one design whose id is the `.kicad_pro` (`discovery.ts:59`), so changing all
   three of its files yields one entry.
4. **Dependency.** For each design not yet written, if any remaining changed path matches
   `isPcbSource(design.kind, ...)`, run `snapshotFiles` and intersect. A hit makes it a
   dependency with `via` set to the first changed path in checkpoint order. Run at most 8
   snapshots concurrently and at most 50 in total; designs past that are skipped and set
   `truncated`. A snapshot that fails with `source-limit` skips that design.
5. Order written designs first in checkpoint order, then dependencies by id. Cap at 20 and set
   `truncated`.

This catches a changed sub-sheet (`Sheetfile` references are followed at `:583`), project
libraries (`.kicad_sym`, `.kicad_mod`, `.kicad_dru`, `sym-lib-table`, `fp-lib-table` at
`:562-564`) and tscircuit relative imports (`:581`). A sub-sheet is never its own design: it is
excluded from discovery (`discovery.ts:61`) and reported through the root design.

`turnDesigns(threadId, runId)`:

1. `workspace(threadId)` for `root` (fails like `listDesigns` for unknown threads).
2. `repoPrefix(root)`; `null` returns
   `{ runId: null, checkpointId: null, turn: null, designs: [], truncated: false }`.
3. `turnCheckpoints(threadId, runId, 20)`. With a `runId`, map that checkpoint. With `null`,
   walk newest first and return the first with designs.
4. `designsForFiles(root, workspaceFiles(prefix, checkpoint.files))`.

`turnDesignEvents(threadId)` begins with `workspace(threadId)` so an unknown thread fails like
`watch`, then maps `turnCheckpointEvents(threadId)` through steps 2 and 4 and keeps results
with designs. `discover` runs `entries.search` (`:441-447`); `listDesigns` refreshes the entry
index first (`:473`). Call `entries.refresh(root)` before `discover` in the event path, since
the turn just wrote files the index may not have.

### Service and RPC

Add to the `PcbPreviewService` shape (`PcbPreviewService.ts:83-190`, beside `listDesigns` at
`:135` and `watch` at `:146`):

```ts
    readonly turnDesigns: (
      input: PcbTurnDesignsInput,
    ) => Effect.Effect<PcbTurnDesigns, PcbPreviewError>;
    readonly turnDesignEvents: (input: {
      threadId: ThreadId;
    }) => Stream.Stream<PcbTurnDesigns, PcbPreviewError>;
```

and to the service object (`listDesigns` entry near `:2597`). In
`apps/server/src/fork/pcb-preview/rpc.ts`, beside `listDesigns` (`:32`) and `watch` (`:37`):

```ts
      [M.turnDesigns]: (input) => auth.effect(M.turnDesigns, service.turnDesigns(input)),
      [M.turnDesignEvents]: (input) =>
        auth.stream(M.turnDesignEvents, service.turnDesignEvents(input)),
```

## Storage

No server storage; the prefix cache is in memory. On the client:

- Dismissed chips: `localStorage` key `loom:pcb-follow-agent:dismissed:v1`, an array of
  `<environmentId>:<runId>` strings, newest last, capped at 200. Same shape as L41's key.
- The mode, in the existing preferences record (`preferences.ts:12-16`, key
  `loom:pcb-preview:preferences:v1` at `:16`):

```ts
/** What Loom does when an agent turn writes or changes a PCB design. */
export const AgentDesignsMode = Schema.Literals(["offer", "open", "off"]);
const Preferences = Schema.Struct({
  selections: Schema.Record(Schema.String, Selection),
  trusted: Schema.Array(Schema.String),
  electronicsUrl: Schema.String,
  agentDesigns: AgentDesignsMode.pipe(Schema.withDecodingDefault(Effect.succeed("offer" as const))),
});
```

The default is required, not optional polish: `load()` decodes the whole record and falls back
to `defaults` on any failure (`preferences.ts:22-29`), so a new required field would silently
wipe every saved design selection and the tscircuit trust list on first load. Commit
`6ddf84c1aa` (local `fix/preview-defects`) gives the existing fields defaults; if it is not on
your base, add them too. Add
`agentDesigns: "offer"` to `defaults` (`:17-21`) and a `setAgentDesigns` action beside
`setElectronicsUrl` (`:66-70`).

## Clients

All web code lives in `apps/web/src/fork/pcb-preview/` except the extension point files.
Mobile has no PCB panel and gets nothing.

### Atoms

In `packages/client-runtime/src/fork/pcb-preview.ts`, beside `designs` and `watch`
(`:149-158`):

```ts
    turnDesigns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:pcb-turn-designs",
      tag: M.turnDesigns,
    }),
    loadTurnDesigns: createEnvironmentRpcCommand(runtime, {
      label: "loom:pcb-turn-designs-load",
      tag: M.turnDesigns,
    }),
    turnDesignEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:pcb-turn-design-events",
      tag: M.turnDesignEvents,
      idleTtlMs: 0,
    }),
```

### Opening helpers: `agentDesigns.ts`

- `pcbDesignName(designId)`: the basename without `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`,
  `.circuit.tsx` or a final extension, matching `groupDesigns`' `name` (`discovery.ts:54`,
  `:67`, `:82`). Commit `f4941963a6` (local `fix/preview-defects`) adds it to
  `usePcbPreview.logic.ts` and titles the agent-opened and hardware-import tabs with it; import
  it from there rather than adding a copy.
- `pcbSurface(designId)`: `{ ...forkPanelSurface("pcb-preview", designId), title:
pcbDesignName(designId) }`. `forkPanelSurface` sets no title
  (`apps/web/src/fork/panels/registry.ts:20-25`), so every PCB tab reads "PCB preview" today
  (`apps/web/src/fork/panels/surface.tsx:19-20`, `panel.tsx:7`). Use it in
  `commands.tsx:47` (agent `open`) too.
- `mayAffectDesigns(paths)`: true when any path ends in `.kicad_pro`, `.kicad_sch`,
  `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`, `.kicad_dru`, `sym-lib-table`, `fp-lib-table`,
  `.circuit.tsx`, `tscircuit.config.json`, or is a `.ts`, `.tsx`, `.js`, `.jsx` or `.json`
  file. Cheap gate so turns that only touched other files never call the server. It is broader
  than the server's rule on purpose: the server decides.
- `openDesigns(threadRef, designIds, mode)`: as L41's `openModels`. `"focus"` calls
  `openSurface` for the first id (activates it, counts as a user choice), then adds the rest
  in the background; `"background"` only adds. At most 8.
- `hasPcbTab(threadRef)`: the thread's panel `isOpen` and a surface with
  `kind === "fork" && panelId === "pcb-preview"`.

Background tabs use `useRightPanelStore.setState` exactly as L41's "Background tabs" section
specifies (only while the panel is open, no `userActionRevisionByThreadKey` bump). If L41 has
landed, import its helper instead of copying it; if not, write it here as a small exported
function in `apps/web/src/fork/panels/` so L41 can import it.

### Turn chip

`PcbTurnChip.tsx`, registered in the `ext-changed-files` registry (SEAMS.md) with props
`{ threadRef, runId, files }`:

- Renders null without a thread, without the `pcb-preview` feature, with mode `"off"`, when
  dismissed, or when `!mayAffectDesigns(files.map((f) => f.path))`.
- Otherwise reads `pcb.turnDesigns({ environmentId, input: { threadId, runId } })`. Null while
  loading, on failure (one `console.warn`) or with zero designs.
- One design: `Button size="xs" variant="ghost-muted"` with `CircuitBoardIcon` and "Open
  board" (the design name); two or more: "Open 3 designs". The label span uses the "Open diff"
  responsive class (`ChangedFilesTree.tsx:107`). Tooltip: one line per design, `name` for
  written and `name (changed power.kicad_sch)` for dependencies.
- Dismiss: `Button size="icon-xs" variant="ghost-muted"` with `XIcon`, tooltip "Hide for this
  turn".
- Click: `openDesigns(threadRef, ids, "focus")`.

Existing `components/ui` variants only, no `className` restyling.

### Agent designs host

`AgentDesignsHost.tsx`, rendered by `PcbPreviewCommandHost` (`commands.tsx:24`), which is
already mounted as a fork host, so no new root seam. For the route thread, with the feature and
mode not `"off"`, it subscribes to `pcb.turnDesignEvents`. A session `Set` of handled
`checkpointId`s prevents repeats. For each event:

1. Designs not already open as tabs: if `hasPcbTab`, add them in the background (max 8). In
   `"open"` mode with no PCB tab, `openDesigns(..., "focus")`.
2. Designs already open: nothing. The open panel reloads through `watch` on its own, and L60
   shows what changed.

`streamDomainEvents` starts after the latest stored event, so only turns finishing while the
thread is open act (per L41's citation of `Orchestrator.ts:11195-11198`).

### Palette and settings

- `palette.tsx` (`:5-25`): a second item "Open designs from the last turn", description
  "Designs the agent wrote or changed", searchTerms `["agent", "turn", "changed"]`. It calls
  `loadTurnDesigns` with `runId: null` and opens up to 8 with `"focus"`. With none,
  `toastManager.add` (as `apps/web/src/fork/device-qa/state.ts:131`) with "The agent has not
  changed a design in this thread."
- `settings.tsx` (`PcbPreviewSettingsSection`, `:136`): a `SettingsRow` "When an agent changes
  a design" with a native `select`: "Offer to open" (`offer`), "Open automatically" (`open`),
  "Do nothing" (`off`). Description: "Offer designs a turn wrote or changed, or open them in
  the PCB panel."

## Agent-facing tools

No new tool. Agents already open a design with `loom_pcb_editor` `{ action: "open" }`
(`apps/server/src/fork/pcb-preview/mcp.ts:25-35`), reachable as `t3 pcb editor` because the CLI
maps actions to `loom_pcb_<action>` (`cli.ts:6-16`). This packet gives that tab its title. A
`turn_designs` tool would tell the agent what it just wrote.

## Performance

- Server: one projection read per lookup. Discovery only when a changed file can be a PCB
  source. Source walks only for designs not matched by name, at most 50 per turn, 8 at a time,
  each bounded by `sourceSnapshot`'s own limits (`:533`, `:552`, `:566`). The
  stream works once per turn.
- Wire: at most 20 short entries per lookup or event.
- Client: no polling, no animation. Cards that changed no candidate file never query. Query
  atoms dedupe repeated renders. Background tabs mount nothing until shown, because
  `PcbPreviewPanel` renders null when not visible (`PcbPreviewPanel.tsx:1597-1604`).
- Remote: unchanged; drawings still load through L24's paths when a tab is shown.

## Alternatives considered

- **Mapping files on the client.** The card has `files`, but repository prefixes, sub-sheet
  references and tscircuit imports need workspace reads. Same reasoning as L41.
- **A separate "PCB changed files" stream.** `PCB-FOLLOW-UPS.md` forbids a second turn-files
  service, and it would duplicate L41's checkpoint logic.
- **Extension-only matching (any `.kicad_*` file).** Misses tscircuit imports, offers the
  wrong project when two share a folder, and disagrees with when the panel reloads.
- **One offer per changed file.** Three offers for one KiCad project, none for sub-sheets.
- **A packet seam per chip on `ChangedFilesTree.tsx`.** Two packets on one line conflict on
  every merge; EXTENSION-POINTS.md says to promote the spot when a second packet needs it.
- **A server setting.** PCB has no server settings record; L58's per-project settings would
  add a dependency for a client behavior.
