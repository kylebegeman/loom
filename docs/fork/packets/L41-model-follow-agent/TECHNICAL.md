# L41 technical design

## Overview

Every root turn in a Git workspace ends with a checkpoint whose `files` list names the paths the
turn's own work touched (`apps/server/src/orchestration-v2/CheckpointService.ts:443-486`). The
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
`CheckpointId` and `PositiveInt` from `../baseSchemas.ts` beside `ThreadId` (`:7`).

### Setting

```ts
/** What Loom does when an agent turn writes or changes a model. */
export const AgentModelsMode = Schema.Literals(["offer", "open", "off"]);
export type AgentModelsMode = typeof AgentModelsMode.Type;
```

Append to `ModelPreviewSettings` (`:240-262`), after `agentToolEnabled`:

```ts
  agentModels: AgentModelsMode.pipe(Schema.withDecodingDefault(Effect.succeed("offer" as const))),
```

and to `DEFAULT_MODEL_PREVIEW_SETTINGS` (`:297-306`): `agentModels: "offer"`. The decoding
default means settings saved before L41 load as "offer", the same way `buildPlate.pattern` does
(`:237`).

`updateSettings` replaces the whole settings record (`ModelPreviewService.ts:973-983`). A client
built before L41 decodes the stored record without `agentModels` and sends it back, so saving
any setting from an old client resets the mode to "offer". That is acceptable for a default-on
offer, and it is the same caveat every new settings field carries; do not add a merge just for
this packet.

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

Add to `MODEL_PREVIEW_3D_WS_METHODS` (`:10-28`):

```ts
  turnModels: "loom.model-preview-3d.turnModels",
  turnModelEvents: "loom.model-preview-3d.turnModelEvents",
```

Add to `ModelPreview3dRpcGroup` (`:317-392`):

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
`apps/server/src/fork/rpcAuthorization.ts:49-65`. Nothing goes in
`packages/contracts/src/fork/clientRpcPermissions.ts` (it lists guarded writes only). Add
`typeof MODEL_PREVIEW_3D_WS_METHODS.turnModelEvents` to `ForkSubscriptionRpcTag`
(`packages/contracts/src/fork/rpc.ts:55-68`); a stream missing there is typed as unary.

## Server

### Formats in one place

`ModelPreviewService.ts:71-80` maps extensions to formats, including STEP, which cannot be
previewed, and the web panel has no shared copy. The extension map is a shared definition owned
by L50 (`L50-model-python-cad/TECHNICAL.md`, "Format"): `MODEL_EXTENSIONS` and
`modelFormatOf(path): ModelFormat | null` in `packages/contracts/src/fork/model-preview-3d.ts`,
next to `ModelFormat`, called by the server, web, MCP and L41. If L50 has not landed, L41 adds
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

The service drops its local `formats` map and calls `modelFormatOf` at its six uses (`:219`,
`:589`, `:990`, `:998`, `:1014`, `:1122`). L41 does not create a second map. A new pure module
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
]);
```

`import()` reads the geometry formats, PDF and (in development snapshots) JSON data, and
`surface()` reads PNG (REFERENCES.md). CSV is not an `import()` format, so it is not listed.

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
  first, then `OPENSCADPATH` and its library folders (REFERENCES.md). Only the first is inside
  the workspace, which is the only place an agent's checkpoint can change.

### Turn models

Add to `ModelPreviewService` (`make`, `:103`) a `turnModels(threadId, runId)` method and a
`turnModelEvents(threadId)` stream. Both reuse private helpers:

1. **Workspace and prefix.** `resolveWorkspace({ threadId, path: "." })` (`:142-167`) gives
   `root`. Checkpoint file paths are relative to the repository top
   (`apps/server/src/vcs/GitVcsDriver.ts:1214`), while model paths are relative to `root`, which
   can be a subdirectory of the repository. Read the prefix once per root with
   `git -C <root> rev-parse --show-prefix` through the existing `runner` (`ProcessRunner`,
   `timeout: "10 seconds"`), and cache it in a `Map<string, string | null>`; `null` means "not a
   Git repository" and the methods return no models. Use the same `git` invocation style as the
   PCB service (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1860-1880`).
2. **Checkpoint.** `queries.getThreadRecords(threadId, ["checkpoints"])`
   (`apps/server/src/orchestration-v2/ProjectionStore.ts:364`). A turn checkpoint has
   `runId !== null`, `appRunOrdinal !== null` and `status === "ready"`; capture only ever writes
   those for root runs (`CheckpointCaptureService.ts:63-135`), and baselines have both fields
   null (`CheckpointService.ts:340`). With a `runId`, pick that run's checkpoint. With `null`,
   walk the 20 newest turn checkpoints by `appRunOrdinal` and return the first with models.
3. **Map files.** `modelsForFiles(root, prefix, files)`:
   - Keep paths that start with the prefix and strip it. Drop the rest (outside the workspace).
   - A kept path whose format is in `PREVIEWABLE_FORMATS` is `{ reason: "written", via: null }`.
   - If any kept path has an extension in `SCAD_INPUT_EXTENSIONS`, find its dependents (below)
     and add each as `{ reason: "dependency", via: <first changed path> }`, unless the SCAD
     itself is already "written".
   - Stat each candidate through `resolveFile` (`:168-178`), which also rejects symlinks out of
     the workspace. Drop failures: the file was deleted after, or by, the turn.
   - Order "written" first in checkpoint order, then dependencies by path. Cap at 50 and set
     `truncated`.
4. **Dependents.** Reverse edges from two sources, merged:
   - The in-memory `dependencies` map (`:126`), which OpenSCAD's own `-d` output fills for files
     rendered since the server started (`readDeps`, `:386-402`). It is exact, including library
     paths, but only covers rendered files. The on-disk records (`dependencyRecordPath`, `:357`)
     are keyed by a hash of the SCAD path and cannot be reverse-looked-up, so they are not used.
   - A static scan: list the workspace with `entries.list({ cwd: root })` as `listModels` does
     (`:984-1009`), keep `.scad` files, take at most 500, read each (skip files over 256 KiB),
     parse with `scadReferences` and resolve with `resolveScadReference`. Cache parsed
     references in a `Map<absolute, { revision, refs }>` keyed by `metadata(info).revision`
     (`:88-102`), capped at 2000 entries. Most turns hit the cache for every file.
   - Close transitively: if `b.scad` includes `c.scad` and `a.scad` includes `b.scad`, a change
     to `c.scad` adds both. Stop at 200 dependents.
     The scan only runs when a changed file has a SCAD input extension, so a turn that edited only
     TypeScript costs one projection read.

`turnModelEvents(threadId)` is
`threads.streamDomainEvents` (`ThreadManagementService.ts:382`) filtered to
`checkpoint.captured` events for this thread whose payload is a ready turn checkpoint with
non-empty `files`, mapped with the same helpers, and filtered to results with models. It begins
with `resolveWorkspace` so an unknown thread fails like `watch` does. The service yields
`ThreadManagementService` in `make`; `ProjectLifecycleService` already does the same from the
same fork layer (`apps/server/src/fork/project-lifecycle/ProjectLifecycleService.ts:209`,
`:1282`), so `ForkLayer.ts:25` needs no change.

### RPC handlers

In `apps/server/src/fork/model-preview-3d/rpc.ts`, beside `listModels` (`:29-31`):

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

In `packages/client-runtime/src/fork/model-preview-3d.ts:23-92` add:

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

A query and a command on one tag already exist for `status` and `detect` (`:63-66`, `:91`).

### Opening helpers

New `agentModels.ts`:

- `modelSurface(path)`: `{ ...forkPanelSurface("model-preview-3d", path), title: basename }`.
  The picker (`ModelPicker.tsx:123-126`) and palette (`palette.tsx:44-47`) already set the title
  inline; switch them and `Shortcuts.tsx:38` to this helper. Today `Shortcuts.tsx` opens
  agent-requested tabs without a title, so they read "3D model" (`surface.tsx:19-20`).
- `openModels(threadRef, paths, mode)`: `mode` is `"focus"` (chip click, palette, picker) or
  `"background"`. Focus calls `openSurface` for the first path, which activates it and counts
  as a user choice, then adds the rest in the background. Background adds tabs without
  activating (next section). At most 8 paths are opened; callers pass the rest to the picker.
- `hasModelTab(threadRef)`: the thread's panel `isOpen` and at least one surface with
  `kind === "fork" && panelId === "model-preview-3d"`.

### Background tabs

`useRightPanelStore` exposes `openSurface` (always activates, `rightPanelStore.ts:624-626`) and
`openProactive`, which only takes diff and pull request surfaces (`:146-150`). `upsertSurface`
can add without activating but is private (`:306-317`). Background tabs only happen when the
panel is already open, so `isOpen` does not change and none of `updateThread`'s visibility
bookkeeping (`:366-394`) applies. Use the store's public `setState` from fork code:

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
changes are not user choices (`:396-398`), so it never blocks upstream's proactive diff. The
store persists `byThreadKey` (`:608`), so background tabs survive a reload like any other tab.
Put this in `agentModels.ts` with a comment naming the invariant (only while open). If upstream
ever adds a public non-activating open, switch to it.

### Proactive diff

When a turn edits at least 3 files or 50 lines, upstream opens and activates the diff
(`ChatView.tsx:5797-5835`, `ChatView.logic.ts:183-205`), even over a 3D tab. L41 does not change
that. In "open" mode with a closed panel, L41 calls `openSurface` for the first model when the
turn's event arrives; whichever of the two lands second wins the active tab, and the other is a
background tab. Both outcomes are fine. Do not try to sequence them.

### Turn chip (packet seam)

`ChangedFilesCard` (`apps/web/src/components/chat/ChangedFilesTree.tsx:24-115`) has `runId` and
`files` and a header action group (`:67`) holding "Expand all folders" and "Open diff". The
packet seam renders the fork component as the group's first child:

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
  `model-preview-3d` feature, with `agentModels === "off"`, or when dismissed.
- Renders null unless some file in `files` has a previewable or SCAD input extension (a pure
  `mayAffectModels(paths)` helper in `agentModels.ts`). Only then does it read
  `models.turnModels({ environmentId, input: { threadId, runId } })`. Turn cards that changed
  only code never call the server.
- While the query is loading or failed, renders null (log the failure once with
  `console.warn`). With zero models, null.
- One model: `Button size="xs" variant="ghost-muted"` with `BoxIcon` and the label
  "Open bracket.scad"; two to 8: "Open 3 models"; more: "Show 12 models", which opens the panel
  on the picker with the turn filter (below). The label span uses the same
  `hidden @[24rem]/changed-files:inline` class as "Open diff" (`:107`), so narrow cards show the
  icon only. Tooltip: the model paths, one per line, or "Models changed by this turn".
- A dismiss `Button size="icon-xs" variant="ghost-muted"` with `XIcon`, tooltip
  "Hide for this turn", writes the dismissal key.
- Click: `openModels(threadRef, paths, "focus")`.

Use existing `components/ui` variants only; no `className` restyling (`shadcn/no-restyle`).

### Agent models host

New `AgentModelsHost.tsx`, rendered from `ModelPreview3dShortcuts` (`Shortcuts.tsx:15-83`),
which `ForkRoot` already mounts, so no new root seam. It subscribes to
`models.turnModelEvents({ environmentId, input: { threadId } })` for the route thread when the
feature is present and the mode is not "off". It keeps a `Set` of handled checkpoint ids for the
session, so a re-render never repeats an event. `streamDomainEvents` starts after the latest
stored event (`apps/server/src/orchestration-v2/Orchestrator.ts:11195-11198`), so only turns
that finish while the thread is open produce background tabs.
For each new `TurnModels`:

1. `written` models not open as tabs: if `hasModelTab`, add them as background tabs (max 8). In
   "open" mode with no model tab, `openModels(..., "focus")`.
2. Models already open as tabs: add their paths to the changed-marks store with the turn number.
3. Remember `{ runId, turn, models }` as the thread's latest agent models for the picker section.

The host renders nothing. The subscription's latest-value semantics can drop an event if two
turns finish within one render; that only loses a background tab, and the chip on the card still
offers it.

### Changed marks

New `agentModelMarks.ts`: a small zustand store
`Record<threadKey, Record<path, { turn: number }>>` with `mark`, `clear(threadKey, path)` and a
selector hook. Add an optional field to `ForkPanelDefinition`
(`apps/web/src/fork/panels/types.ts:26-38`):

```ts
  /** Optional tab icon for one surface; defaults to `icon`. */
  readonly TabIcon?: ComponentType<{ surface: ForkRightPanelSurface; className?: string }>;
```

and use it in `ForkSurfaceIcon` (`apps/web/src/fork/panels/surface.tsx:22-25`) when present.
Both files are fork-owned (`ext-panels`). The 3D panel's `TabIcon` renders `BoxIcon` and, when
the surface's path is marked, a small dot in the theme's primary colour inside the icon box with
an `aria-label` "Changed by the agent in turn 6". `ModelFile` clears the mark when it becomes
visible (`ModelPanel.tsx`, the `visible` prop at `:90-100`).

### Picker section and palette

- `ModelPicker.tsx`: above the file grid, a section "Changed by the agent" headed "Turn 6",
  listing that turn's models as rows that open with `modelSurface`. Its data is the host's
  latest record for the thread, or one `loadTurnModels` call with `runId: null` on mount when
  there is none. A picker surface has no resource id (`ModelPanel.tsx:1170`), so "Show 12
  models" passes the run through a session-only `pickerTurn` entry in `agentModelMarks.ts`
  (`Record<threadKey, RunId>`), set before `openSurface` and cleared when the picker unmounts.
  The section then shows that run instead of the latest.
- `palette.tsx`: an action "3D model: Open models from the last turn" that calls
  `loadTurnModels` with `runId: null` and opens up to 8. With no models it shows a toast
  "The agent has not changed a model in this thread."

### Settings row

In `SettingsSection.tsx`, after the agent tools row (`:281-291`), a `SettingsRow` titled
"When an agent writes a model" with a native `select` (matching the section's other controls):
"Offer to open" (`offer`), "Open automatically" (`open`), "Do nothing" (`off`). Description:
"Offer models a turn wrote or changed, or open them in the 3D panel." Uses `set` (`:56`), so
the existing save flow and `permissionAtom` apply.

## Agent-facing tools

No new tool. The setting is part of `ModelPreviewSettings`, so `loom_model_preview_3d_settings`
and `loom_model_preview_3d_save_settings` read and write it, and `t3 model settings` follows.
An agent that wants a model on screen already calls `loom_model_preview_3d_editor` with
`action: "open"`; this packet fixes that tab's title. Opening tabs is client state, so a
`turnModels` tool would only duplicate what the agent knows about its own writes.

## Performance

- Server: one projection read per lookup; a `git rev-parse` once per workspace; the SCAD scan
  only for turns that changed a SCAD input, at most 500 files of 256 KiB, cached by revision.
  The stream does work only on `checkpoint.captured`, once per turn.
- Wire: `TurnModels` is at most 50 short paths. The chip queries only cards whose files include
  a candidate extension. Query atoms dedupe repeated renders of the same card.
- Client: no animation, no polling. The dot is static. At most 8 background tabs per turn, and
  a hidden model tab releases its mesh 60 s after it is hidden (`ModelPanel.tsx:470-478`).
  Check during implementation whether hidden right panel surfaces mount at all; if they do and
  load their mesh, defer `ModelFile`'s first load until the tab is first visible.
- Remote: mesh bytes still go through signed URLs; nothing new crosses the WebSocket besides the
  path lists.

## Alternatives considered

- **Filesystem watching.** Rejected by the brief and by cost: it would need a recursive watcher
  per workspace and would also fire for the user's own edits.
- **Parse the turn diff patch on the client.** `orchestration.getTurnDiff` returns a raw patch
  (`apps/server/src/orchestration-v2/checkpointDiff.ts:7-48`); the client already has the file
  list without it. SCAD dependents need workspace reads, which belong on the server.
- **Client-only mapping without an RPC.** Direct matches could be computed in the browser from
  `files`, but repository prefixes, deleted files and SCAD dependents cannot. One RPC keeps a
  single rule for chip, picker and palette.
- **A new right panel store action.** Cleaner, but it is an upstream seam in a busy file for a
  three-line state update that only applies while the panel is open.
- **A shared `ext-turn-files` extension point.** Declined for now: EXTENSION-POINTS.md promotes
  a spot only when a second packet needs it. If one does, move the line into a registry like
  `apps/web/src/fork/diffHeader/registry.ts`.
- **Putting the chip in the assistant message meta row** (`MessagesTimeline.tsx:2868-2917`).
  That row exists on every message, not only turns with changes, and the changed files card is
  where "Open diff" already lives.
