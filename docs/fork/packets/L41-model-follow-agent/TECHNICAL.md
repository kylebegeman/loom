# L41 technical design

## Overview

Every root turn in a Git workspace ends with a checkpoint whose `files` list names the paths the
turn's own work touched (`apps/server/src/orchestration-v2/CheckpointService.ts:444-481`). The
diff panel and the changed files card already read that list. L41 adds one server method that
turns a checkpoint's file list into the models it affects, one stream that does the same for
each new checkpoint of a thread, and three client consumers: the turn chip on the changed files
card, a host that adds background tabs and changed marks, and a "Changed by the agent" section in
the picker and palette.

```
checkpoint.captured (domain event)
      |
      v
ModelPreviewService.turnModelEvents(threadId) --stream--> AgentModelsHost (web, per open thread)
ModelPreviewService.turnModels(threadId, runId) <--rpc--- ModelTurnChip (changed files card)
      |                                                    ModelPicker section, palette entry
      +-- files -> strip repo prefix -> direct models + SCAD dependents -> stat -> TurnModels
```

Nothing watches the filesystem and nothing runs per frame. The server work per turn is one
projection read and, only when a changed file can be included by SCAD, a bounded scan of the
workspace's `.scad` files whose parse results are cached.

## Contracts

All additions go in `packages/contracts/src/fork/model-preview-3d.ts`. Import `RunId`,
`CheckpointId` and `PositiveInt` from `../baseSchemas.ts` beside `ThreadId` (`:24`).

### Setting

```ts
/** What Loom does when an agent turn writes or changes a model. */
export const AgentModelsMode = Schema.Literals(["offer", "open", "off"]);
export type AgentModelsMode = typeof AgentModelsMode.Type;
```

Append to `ModelPreviewSettings` (`:210-252`), after `agentToolEnabled`:

```ts
  agentModels: AgentModelsMode.pipe(Schema.withDecodingDefault(Effect.succeed("offer" as const))),
```

and to `DEFAULT_MODEL_PREVIEW_SETTINGS` (`:308-333`): `agentModels: "offer"`. The decoding
default means settings saved before L41 load as "offer", the same way `buildPlate.pattern` does
(`packages/contracts/src/fork/model-beds.ts:208`).

`saveSettings` merges an update into the stored record (`ModelPreviewService.ts:1234-1251`), and
`agentModels` is optional in `ModelPreviewSettingsUpdate` (`model-preview-3d.ts:267`). A client
built before L41 sends no `agentModels`, so saving any setting from an old client keeps the
stored mode.

### Turn models

```ts
export const TurnModel = Schema.Struct({
  /** Workspace-relative path, the same form ModelFileRef uses. */
  path: Schema.String,
  format: ModelFormat,
  /** "written": the turn changed this file. "dependency": it changed a file this SCAD reads. */
  reason: Schema.Literals(["written", "dependency"]),
  /** For "dependency": the workspace-relative changed file that made it count. */
  via: Schema.NullOr(Schema.String),
});

export const TurnModels = Schema.Struct({
  threadId: ThreadId,
  /** Null when the thread has no turn that changed a model. */
  runId: Schema.NullOr(RunId),
  checkpointId: Schema.NullOr(CheckpointId),
  /** The turn number shown in the UI (the checkpoint's appRunOrdinal). */
  turn: Schema.NullOr(PositiveInt),
  models: Schema.Array(TurnModel).check(Schema.isMaxLength(50)),
  truncated: Schema.Boolean,
});

export type TurnModel = typeof TurnModel.Type;
export type TurnModels = typeof TurnModels.Type;
```

### Methods

Add to `MODEL_PREVIEW_3D_WS_METHODS` (`:27-69`):

```ts
  turnModels: "loom.model-preview-3d.turnModels",
  turnModelEvents: "loom.model-preview-3d.turnModelEvents",
```

Add to `ModelPreview3dRpcGroup` (`:344-548`):

```ts
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.turnModels,
    /** runId null: the latest turn of the thread that changed a model. */
    Schema.Struct({ threadId: ThreadId, runId: Schema.NullOr(RunId) }),
    TurnModels,
  ),
  Rpc.make(MODEL_PREVIEW_3D_WS_METHODS.turnModelEvents, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: TurnModels,
    error: Schema.Union([ModelPreviewError, EnvironmentAuthorizationError]),
    stream: true,
  }),
```

Both are reads. Add `[M.turnModels]: AuthOrchestrationReadScope` and
`[M.turnModelEvents]: AuthOrchestrationReadScope` to the exhaustive table in
`apps/server/src/fork/rpcAuthorization.ts:78-577` (they landed at `:362-363`). Nothing goes in
`packages/contracts/src/fork/clientRpcPermissions.ts` (it lists guarded writes only). Add
`typeof MODEL_PREVIEW_3D_WS_METHODS.turnModelEvents` to `ForkSubscriptionRpcTag`
(`packages/contracts/src/fork/rpc.ts:158-188`); a stream missing there is typed as unary.

## Server

### Formats in one place

Before L41, `ModelPreviewService.ts` mapped extensions to formats, including STEP, which cannot
be previewed, and the web panel had no shared copy. The extension map is a shared definition
owned by L50 (`L50-model-python-cad/TECHNICAL.md`, "Format"): `MODEL_EXTENSIONS` and
`modelFormatOf(path): ModelFormat | null` in `packages/contracts/src/fork/model-preview-3d.ts`
(`:92-111`), next to `ModelFormat`, called by the server, web, MCP and L41. If L50 has not landed, L41 adds
them there exactly as L50 specifies, minus the `.b3d.py` line and the `build123d` literal:

```ts
export const MODEL_EXTENSIONS = {
  ".stl": "stl",
  ".3mf": "3mf",
  ".obj": "obj",
  ".gltf": "gltf",
  ".glb": "glb",
  ".scad": "scad",
  ".step": "step",
  ".stp": "step",
} as const;
/** The one place a path becomes a format. Server, web, MCP and L41 call this. */
export const modelFormatOf = (path: string): ModelFormat | null => {
  const lower = path.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  return MODEL_EXTENSIONS[ext as keyof typeof MODEL_EXTENSIONS] ?? null;
};
```

The service drops its local `formats` map and imports `modelFormatOf` (`ModelPreviewService.ts:27`)
for every format check. L41 does not create a second map. A new pure module
`apps/server/src/fork/model-preview-3d/formats.ts` keeps only the two server-side sets:

```ts
/** Formats the panel can show. L50 adds STEP and Python sources here. */
export const PREVIEWABLE_FORMATS: ReadonlySet<ModelFormat> = new Set([
  "stl",
  "3mf",
  "obj",
  "glb",
  "gltf",
  "scad",
]);
/** Extensions a SCAD file can read through include, use, import() or surface(). */
export const SCAD_INPUT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".scad",
  ".stl",
  ".off",
  ".obj",
  ".amf",
  ".3mf",
  ".dxf",
  ".svg",
  ".pdf",
  ".png",
  ".json",
  ".dat",
  ".txt",
]);
```

`import()` reads the geometry formats, PDF and (in development snapshots) JSON data, and
`surface()` reads PNG and ASCII heightmaps (`.dat` or `.txt`, REFERENCES.md). CSV is not an `import()` format, so it is not listed.

### SCAD reference parser (shared with L49)

New pure module `apps/server/src/fork/model-preview-3d/scadIncludes.ts`. L49 uses the same file;
whichever packet lands first writes it exactly as below.

```ts
export interface ScadReference {
  readonly kind: "include" | "use" | "import" | "surface";
  /** As written, before resolution. */
  readonly path: string;
}
/** Literal references in a SCAD source. Comments and strings are skipped first. */
export function scadReferences(source: string): ScadReference[];
/**
 * The absolute path a reference names relative to the including file's directory, which
 * OpenSCAD searches first. Library paths (OPENSCADPATH, built-in) are never returned.
 */
export function resolveScadReference(fromFile: string, reference: ScadReference): string;
```

Implementation notes:

- Strip `/* ... */` and `// ...` comments first, keeping string literals intact, so a commented
  `include <old.scad>` does not count.
- `include` and `use`: `/\b(include|use)\s*<([^>\n]+)>/g`.
- `import` and `surface`: `/\b(import|surface)\s*\(\s*(?:file\s*=\s*)?"((?:[^"\\\n]|\\.)*)"/g`.
  Only literal string arguments count; `import(name)` with a variable is skipped.
- Resolution is relative to the including file's directory. OpenSCAD searches that directory
  first, then `OPENSCADPATH` and its library folders (REFERENCES.md). Resolved paths are canonicalized and checked against the workspace; absolute paths inside
  it can count, while external paths and escaping symlinks are excluded.

### Turn models

Add to `ModelPreviewService` (`make`, `:124`) a `turnModels(threadId, runId)` method and a
`turnModelEvents(threadId)` stream. Both reuse private helpers:

1. **Workspace and prefix.** `resolveWorkspace({ threadId, path: "." })` (`:181-196`) gives
   `root`. Checkpoint file paths are relative to the repository top
   (`apps/server/src/vcs/GitVcsDriver.ts:1476-1478`), while model paths are relative to `root`, which
   can be a subdirectory of the repository. Read the prefix once per root with
   `git -C <root> rev-parse --show-prefix` through the existing `runner` (`ProcessRunner`,
   `timeout: "10 seconds"`), and cache it in a `Map<string, string | null>`; `null` means "not a
   Git repository" and the methods return no models. Use the same `git` invocation style as the
   PCB service (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2533-2554`).
2. **Checkpoint.** `queries.getThreadRecords(threadId, ["checkpoints", "runs"])`
   (`apps/server/src/orchestration-v2/ProjectionStore.ts:486-490`). Runs and the thread's restore
   request ids only feed the shared scan key in `turnFiles.ts`. A turn checkpoint has
   `runId !== null`, `appRunOrdinal !== null` and `status === "ready"`; the production capture path writes
   those for root runs (`CheckpointCaptureService.ts:63-131`), and baselines have both fields
   null (`CheckpointService.ts:329-333`). This uses the capture path's `appRunOrdinal` invariant;
   it does not separately validate a scope-kind field. With a `runId`, pick that run's checkpoint. With `null`,
   walk the 20 newest turn checkpoints by `appRunOrdinal` and return the first with models.
3. **Map files.** `modelsForCheckpoint(threadId, root, prefix, checkpoint)`:
   - Keep paths that start with the prefix and strip it. Drop the rest (outside the workspace).
   - A kept path whose format is in `PREVIEWABLE_FORMATS` is `{ reason: "written", via: null }`.
   - If any kept path has an extension in `SCAD_INPUT_EXTENSIONS`, find its dependents (below)
     and add each as `{ reason: "dependency", via: <first changed path> }`, unless the SCAD
     itself is already "written".
   - Stat each candidate through `fileIn` (`:197-207`), which also rejects symlinks out of
     the workspace. Drop failures: the file was deleted after, or by, the turn.
   - Order "written" first in checkpoint order, then dependencies by path. Cap at 50 and set
     `truncated`.
4. **Dependents.** Reverse edges from two sources, merged:
   - The in-memory `dependencies` map (`:153`), which OpenSCAD's own `-d` output fills for files
     rendered since the server started (`readDeps`, `:622-638`). It is exact, including library
     paths, but only covers rendered files. The on-disk records (`dependencyRecordPath`, `:593`)
     are keyed by a hash of the SCAD path and cannot be reverse-looked-up, so they are not used.
   - A static scan: list the workspace with `entries.list({ cwd: root })` as `listModels` does
     (`:1522-1566`), keep `.scad` files, take at most 500, read each (skip files over 256 KiB),
     parse with `scadReferences` and resolve with `resolveScadReference`. Cache parsed
     references in a `Map<absolute, { revision, refs }>` keyed by `metadata(info).revision`
     (`:109-123`), capped at 2000 entries. Most turns hit the cache for every file.
   - Close transitively: if `b.scad` includes `c.scad` and `a.scad` includes `b.scad`, a change
     to `c.scad` adds both. Stop at 200 dependents.
     The scan only runs when a changed file has a SCAD input extension, so a turn that edited only
     TypeScript costs one projection read. For a unary lookup, refresh workspace entries once
     only when changed SCAD input paths need a dependency scan; do the same per applicable
     stream event. Code-only events do not refresh the index.

`turnModelEvents(threadId)` is
`threads.streamDomainEvents` (`ThreadManagementService.ts:501`) filtered to
`checkpoint.captured` events for this thread whose payload is a ready turn checkpoint with
non-empty `files`, mapped with the same helpers, and filtered to results with models. It begins
with a thread lookup so an unknown thread fails like `watch` does. A checkout folder missing at
subscribe time does not end it: each event resolves the workspace again and skips a checkpoint
whose workspace cannot be resolved. Checkpoint selection, repository-prefix caching and the
filtered event stream live in
`apps/server/src/fork/turnFiles.ts`, shared with L59. `makeTurnFiles` reads the projection store,
thread management service and process runner from the existing fork layer, so `ForkLayer.ts`
needs no new provider. The model service owns format mapping and bounded SCAD dependency
scanning. Conditional workspace-entry refresh keeps newly written dependency parents visible without
forcing an index refresh for code-only turns.

### RPC handlers

In `apps/server/src/fork/model-preview-3d/rpc.ts`, beside `listModels` (`:41-44`):

```ts
[M.turnModels]: (input) =>
  auth.effect(M.turnModels, service.turnModels(input.threadId, input.runId)),
[M.turnModelEvents]: (input) =>
  auth.stream(M.turnModelEvents, service.turnModelEvents(input.threadId)),
```

## Storage

No server storage. The parse cache and prefix cache are in memory. On the client, dismissed
chips are kept in `localStorage` under `loom:model-follow-agent:dismissed:v1` as an array of
`<environmentId>:<runId>` strings, newest last, capped at 200. Changed marks and handled
checkpoint ids are session state in memory.

## Clients

All web code lives in `apps/web/src/fork/model-preview-3d/`. Mobile has no 3D panel and gets
nothing.

### Atoms

In `packages/client-runtime/src/fork/model-preview-3d.ts:23-186` add:

```ts
    turnModels: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:model-turn-models",
      tag: M.turnModels,
    }),
    loadTurnModels: createEnvironmentRpcCommand(runtime, {
      label: "loom:model-turn-models-load",
      tag: M.turnModels,
    }),
    turnModelEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:model-turn-events",
      tag: M.turnModelEvents,
      idleTtlMs: 0,
    }),
```

A query and a command on one tag already exist for `status` and `detect` (`:149-152`, `:185`).

### Opening helpers

New `agentModels.ts`:

- `modelSurface(path)`: `{ ...forkPanelSurface("model-preview-3d", path), title: basename }`.
  The picker (`ModelPicker.tsx:271`, `:358`), palette (`palette.tsx:45`) and `Shortcuts.tsx:41`
  use this helper. Before it, `Shortcuts.tsx` opened agent-requested tabs without a title, so
  they read "3D model" (`surface.tsx:19-20`).
- `openModels(threadRef, paths, mode)`: focus is for a chip click, palette or picker and calls
  `openSurface` for the first path as a user choice, then adds the rest in the background.
  Automatic opening and background additions use the store's public `setState`, preserving
  `userActionRevisionByThreadKey`. At most 8 paths are opened; larger explicit requests open
  the picker filtered to that turn.
- `hasModelTab(threadRef)`: the thread's panel `isOpen` and at least one surface with
  `kind === "fork" && panelId === "model-preview-3d"`.

### Background tabs

`useRightPanelStore` exposes `openSurface` (always activates, `rightPanelStore.ts:665-668`) and
`openProactive`, which only takes diff and pull request surfaces (`:121-127`). `upsertSurface`
can add without activating but is private (`:307-318`). Background tabs only happen when the
panel is already open, so `isOpen` does not change and none of `updateThread`'s visibility
bookkeeping (`:363-391`) applies. Use the store's public `setState` from fork code:

```ts
useRightPanelStore.setState((state) => {
  const key = scopedThreadKey(threadRef);
  const current = state.byThreadKey[key];
  if (!current?.isOpen) return state;
  const added = surfaces.filter((s) => !current.surfaces.some((e) => e.id === s.id));
  if (added.length === 0) return state;
  const next = { ...current, surfaces: [...current.surfaces, ...added] };
  return { byThreadKey: { ...state.byThreadKey, [key]: next } };
});
```

This does not advance `userActionRevisionByThreadKey`, matching the store's rule that automatic
changes are not user choices (`automaticUpdate`, `:393-399`), so it never blocks upstream's
proactive diff. The store persists `byThreadKey` (`partialize`, `:1184-1189`), so background tabs
survive a reload like any other tab.
Put this in `agentModels.ts` with a comment naming the invariant (only while open). If upstream
ever adds a public non-activating open, switch to it.

### Proactive diff

When a turn edits at least 3 files or 50 lines, upstream opens and activates the diff
(`apps/web/src/hooks/useProactivePanels.ts:147-189`, called from `ChatView.tsx:2052`, and
`ChatView.logic.ts:208-241`), even over a 3D tab. L41 does not change
that. Automatic model opening must preserve `userActionRevisionByThreadKey`; `openSurface`
increments it and would incorrectly suppress the turn's proactive diff. The fork's automatic
path uses public `setState` to open and activate the first model without recording a user
choice. Whichever automatic update lands second can activate its surface, leaving the other
as a background tab. Explicit chip, picker and palette actions still use `openSurface`.

### Turn chip (packet seam)

`ChangedFilesCard` (`apps/web/src/components/chat/ChangedFilesTree.tsx:30-152`) has `runId` and
`files` and a header action group (`:77`) holding "Expand all folders" and "Open diff". Its first
child is now the `ext-changed-files` seam, `ForkChangedFilesActions` (`:78-79`), and
`ModelTurnChip` registers in `apps/web/src/fork/changedFiles/registry.ts:17`. Before that seam,
the packet rendered the chip directly:

```diff
 import { MorphIcon } from "~/components/MorphIcon";
+import { ModelTurnChip } from "~/fork/model-preview-3d/ModelTurnChip"; // fork: model-follow-agent
```

```diff
         <div className="flex shrink-0 items-center gap-1">
+          <ModelTurnChip runId={runId} files={files} /> {/* fork: model-follow-agent */}
           {hasDirectories && (
```

`ModelTurnChip.tsx` (fork-owned):

- Reads `useRouteThread()` (`apps/web/src/fork/routeThread.ts`), the environment's
  `loomFeatures` and the settings query. Renders null without a thread, without the
  `model-preview-3d` and `model-follow-agent` features, with `agentModels === "off"`, or when dismissed.
- Renders null unless some file in `files` has a previewable or SCAD input extension (a pure
  `mayAffectModels(paths)` helper in `agentModels.ts`). Only then does it read
  `models.turnModels({ environmentId, input: { threadId, runId } })`. Turn cards that changed
  only code never call the server.
- While the query is loading or failed, renders null (log the failure once with
  `console.warn`). With zero models, null.
- One model: `Button size="xs" variant="ghost-muted"` with `BoxIcon` and the label
  "Open bracket.scad"; two to 8: "Open 3 models"; more: "Show 12 models", which opens the panel
  on the picker with the turn filter (below). The label span uses the same
  `hidden @[24rem]/changed-files:inline` class as "Open diff" (`:122`), so narrow cards show the
  icon only. Tooltip: the model paths, one per line. `truncated` can mean incomplete dependency
  discovery, not merely more than 50 models, so the chip never invents an extra count; the
  tooltip and filtered picker say that some models may be omitted.
- A dismiss `Button size="icon-xs" variant="ghost-muted"` with `XIcon`, tooltip
  "Hide for this turn", writes the dismissal key.
- Click: `openModels(threadRef, paths, "focus")`.

Use existing `components/ui` variants only; no `className` restyling (`shadcn/no-restyle`).

### Agent models host

New `AgentModelsHost.tsx`, rendered from `ModelPreview3dShortcuts` (`Shortcuts.tsx:17-87`),
which `ForkRoot` already mounts, so no new root seam. It subscribes to
`models.turnModelEvents({ environmentId, input: { threadId } })` for the route thread when the
feature is present and the mode is not "off". It keeps a `Set` of handled checkpoint ids for the
session, so a re-render never repeats an event. `streamDomainEvents` starts after the latest
stored event (`apps/server/src/orchestration-v2/Orchestrator.ts:14600-14604`), so only turns
that finish while the thread is open produce background tabs.
For each new `TurnModels`:

1. `written` models not open as tabs: if `hasModelTab`, add them as background tabs (max 8). In
   "open" mode with no model tab, use the automatic opening path that preserves user choice history.
2. Models already open as tabs: add their paths to the changed-marks store with the turn number.
   New background tabs are marked too; viewing one clears its dot.
3. Remember `{ runId, turn, models }` as the thread's latest agent models for the picker section.

The host renders nothing. The subscription's latest-value semantics can drop an event if two
turns finish within one render; that only loses a background tab, and the chip on the card still
offers it.

### Changed marks

New `agentModelMarks.ts`: a small zustand store
`Record<threadKey, Record<path, { turn: number }>>` with `mark`, `clear(threadKey, path)` and a
selector hook. Add an optional field to `ForkPanelDefinition`
(`apps/web/src/fork/panels/types.ts:26-40`):

```ts
  /** Optional tab icon for one surface; defaults to `icon`. */
  readonly TabIcon?: ComponentType<{ surface: ForkRightPanelSurface; threadRef: ScopedThreadRef; className?: string }>;
```

and use it in `ForkSurfaceIcon` (`apps/web/src/fork/panels/surface.tsx:22-27`) when present.
Both files are fork-owned (`ext-panels`). The 3D panel's `TabIcon` renders `BoxIcon` and, when
the surface's path is marked, a small dot in the theme's primary colour inside the icon box with
an `aria-label` "Changed by the agent in turn 6". `ModelFile` clears the mark when it becomes
visible (`ModelPanel.tsx`, the `visible` prop at `:186-201`).

### Picker section and palette

- `ModelPicker.tsx`: above the file grid, a section "Changed by the agent" headed "Turn 6",
  listing that turn's models as rows that open with `modelSurface`. Its data is the host's
  latest record for the thread while one fresh `loadTurnModels` call with `runId: null` runs
  on each opening and refresh. This remains current when Do nothing has stopped the stream;
  a late older lookup cannot replace a newer remembered turn. A picker surface has no resource
  id (`ModelPanel.tsx:2677`), so "Show 12 models" passes the run through a session-only `pickerTurn` entry in `agentModelMarks.ts`
  (`Record<threadKey, RunId>`), set before `openSurface` and cleared when the picker unmounts.
  The section and file grid then show that run instead of the latest; Show all model files
  clears the filter. The explicit picker section remains available in Do nothing mode.
- `palette.tsx`: an action "3D model: Open models from the last turn" that calls
  `loadTurnModels` with `runId: null` and opens up to 8. With no models it shows a toast
  "The agent has not changed a model in this thread."

### Settings row

In `SettingsSection.tsx`, after the agent tools row (`:443-453`), a `SettingsRow` titled
"When an agent writes a model" with a `Select`:
"Offer to open" (`offer`), "Open automatically" (`open`), "Do nothing" (`off`). Description:
"Offer models a turn wrote or changed, or open them in the 3D panel." Uses `set` (`:135`), so
the existing save flow and `permissionAtom` apply.

## Agent-facing tools

No new tool. The setting is part of `ModelPreviewSettings`, so `loom_model_preview_3d_settings`
and `loom_model_preview_3d_save_settings` read and write it, and `t3 model settings` follows.
An agent that wants a model on screen already calls `loom_model_preview_3d_editor` with
`action: "open"`; this packet fixes that tab's title. Opening tabs is client state, so a
`turnModels` tool would only duplicate what the agent knows about its own writes.

## Performance

- Server: one projection read per lookup; a cached `git rev-parse` per workspace; the SCAD scan
  only for turns that changed a SCAD input, at most 500 files of 256 KiB, cached by revision.
  The stream does work only on `checkpoint.captured`, once per turn.
- Wire: `TurnModels` is at most 50 short paths. The chip queries only cards whose files include
  a candidate extension. Query atoms dedupe repeated renders of the same card.
- Client: no animation, no polling. The dot is static. At most 8 background tabs per turn, and
  a hidden model tab releases its mesh 60 s after it is hidden (`ModelPanel.tsx:1145-1156`).
  The right panel mounts only the active surface, so newly added background tabs download
  nothing until selected.
- Remote: mesh bytes still go through signed URLs; nothing new crosses the WebSocket besides the
  path lists.

## Alternatives considered

- **Filesystem watching.** Rejected by the brief and by cost: it would need a recursive watcher
  per workspace and would also fire for the user's own edits.
- **Parse the turn diff patch on the client.** `orchestration.getTurnDiff` returns a raw patch
  (`apps/server/src/checkpointing/CheckpointDiffQuery.ts:89-265`); the client already has the file
  list without it. SCAD dependents need workspace reads, which belong on the server.
- **Client-only mapping without an RPC.** Direct matches could be computed in the browser from
  `files`, but repository prefixes, deleted files and SCAD dependents cannot. One RPC keeps a
  single rule for chip, picker and palette.
- **A new right panel store action.** Cleaner, but it is an upstream seam in a busy file for a
  three-line state update that only applies while the panel is open.
- **A shared `ext-turn-files` extension point.** Declined for now: EXTENSION-POINTS.md promotes
  a spot only when a second packet needs it. If one does, move the line into a registry like
  `apps/web/src/fork/diffHeader/registry.ts`.
- **Putting the chip in the assistant message meta row** (`AssistantMessageMeta`,
  `apps/web/src/components/chat/TimelineAssistantRows.tsx:152-204`).
  That row exists on every message, not only turns with changes, and the changed files card is
  where "Open diff" already lives.
