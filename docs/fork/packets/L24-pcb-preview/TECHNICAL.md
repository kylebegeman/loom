# L24 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Search for the
quoted code when line numbers drift.

## Overview

```
 web panel (apps/web/src/fork/pcb-preview)            server (apps/server/src/fork/pcb-preview)
 +-------------------------------------+   WS RPC   +-----------------------------------------+
 | design picker   Schematic|PCB|Checks| ---------> | PcbPreviewService                        |
 | <img src=blob:svg>  zoom/pan        |  listDesigns| - resolve thread -> workspace cwd        |
 |                                     |  render     | - discover designs (WorkspaceEntries)    |
 |                                     |  readSheet  | - hash sources, cache by key             |
 |                                     |  check      | - ProcessRunner: kicad-cli / tsci        |
 |                                     | <---------- | - fs.watch design dir (while subscribed) |
 +-------------------------------------+  watch      +-----------------------------------------+
                                                       <stateDir>/fork/pcb-preview/cache/<key>/
```

The client never sees a filesystem path it has to resolve. It sends a `threadId` and a
design id (the design's workspace-relative entry path); the server resolves the thread's
workspace (worktree first, then project root), validates the path stays inside it, runs the
tool into a cache directory keyed by a content hash, and returns a small manifest. The SVG
of one sheet or layer preset is fetched separately, only when shown.

## Tools and exact invocations

Detection runs once per server start and again on `status` requests older than 60 seconds.

| Tool        | Lookup order                                                                   | Version                                    |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| `kicad-cli` | `PATH`; then `/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli` on macOS | `kicad-cli version` (prints e.g. `10.0.6`) |
| `tsci`      | `<cwd>/node_modules/.bin/tsci`; then `PATH`                                    | `tsci --version`                           |

Supported KiCad: 9 and 10 (the `--mode-single`, `--fit-page-to-board` and `pcb render`
behaviors used here exist from 9; confirm against the installed version's `--help` in the
first manual check and note any difference in this file). KiCad 8 and older report
`tool-too-old`.

KiCad (flags from https://docs.kicad.org/10.0/en/cli/cli.html):

```sh
# Schematic: one SVG per sheet, written into the output directory.
kicad-cli sch export svg --output <cacheDir>/sch --exclude-drawing-sheet <design>.kicad_sch

# PCB: one SVG per preset, single file.
kicad-cli pcb export svg --output <cacheDir>/pcb-front.svg --mode-single --fit-page-to-board \
  --exclude-drawing-sheet --drill-shape-opt 2 \
  --layers F.Cu,F.Paste,F.Silkscreen,F.Mask,Edge.Cuts <design>.kicad_pcb
#   back: --layers B.Cu,B.Paste,B.Silkscreen,B.Mask,Edge.Cuts
#   all:  --layers F.Cu,<inner copper layers>,B.Cu,Edge.Cuts, where the inner layers
#         (In1.Cu, In2.Cu, ...) are read from the .kicad_pcb "(layers" block (see Discovery).

# Checks (exit 0 = clean, 5 = violations, anything else = failure).
kicad-cli sch erc --format json --severity-all --units mm --exit-code-violations \
  --output <cacheDir>/erc.json <design>.kicad_sch
kicad-cli pcb drc --format json --severity-all --units mm --exit-code-violations \
  --schematic-parity --output <cacheDir>/drc.json <design>.kicad_pcb
```

`--schematic-parity` is passed only when a sibling `.kicad_sch` with the same base name
exists. `--refill-zones` is not passed: it changes nothing on disk without `--save-board`,
but it can take minutes on large boards; the report header says "Zones as saved".

tscircuit (https://docs.tscircuit.com/command-line/tsci-export):

```sh
tsci export <entry>.circuit.tsx -f schematic-svg -o <cacheDir>/sch/1.svg
tsci export <entry>.circuit.tsx -f pcb-svg       -o <cacheDir>/pcb-top.svg
```

tscircuit exports one schematic SVG and one PCB SVG (top view). The PCB presets "Back" and
"All copper" are hidden for tscircuit designs. `tsci export` runs with `cwd` set to the
directory holding the entry file's nearest `package.json` (or the workspace root).

Every process runs through upstream's `ProcessRunner`
(`apps/server/src/processRunner.ts:140-145`, `run(input: ProcessRunInput)`), with
`timeout` (KiCad render 60 s, KiCad checks 180 s, tsci 120 s), `maxOutputBytes: 1 MiB`,
`outputMode: "truncate"` and `timeoutBehavior: "timedOutResult"`. The environment passed
to `tsci` is the server's environment minus variables matching
`/(TOKEN|SECRET|KEY|PASSWORD|T3CODE_)/i`, because `tsci` executes project code.

Concurrency: one KiCad process and one `tsci` process at a time per server
(`Semaphore.make(1)` each); a newer request for the same design and view replaces a queued
one (the older fiber is interrupted).

## Discovery

`listDesigns` resolves the thread's workspace, then runs upstream's
`WorkspaceEntries.search` (`apps/server/src/workspace/WorkspaceEntries.ts:99`, input
`ProjectSearchEntriesInput` at `packages/contracts/src/project.ts:17-25`, max limit 200) for
the queries `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `.circuit.tsx` and
`tscircuit.config.json`, keeping only entries whose path ends with the suffix exactly
(the search is fuzzy). The workspace index already skips ignored folders.

Grouping rules:

- A KiCad design is one directory with a `.kicad_pro`; its `schematic` is `<base>.kicad_sch`
  and its `board` is `<base>.kicad_pcb` when they exist. A `.kicad_sch` or `.kicad_pcb`
  without a `.kicad_pro` is its own design. Sub-sheets (`.kicad_sch` files referenced by a
  root schematic) are not separate designs: a `.kicad_sch` in a directory with a
  `.kicad_pro` belongs to that project.
- A tscircuit design is each `*.circuit.tsx` file, plus the `mainEntrypoint` of a
  `tscircuit.config.json` (read as JSON; ignored when unreadable).
- Inner copper layers for the "All copper" preset are read from the `.kicad_pcb` header:
  the `(layers` block lists entries like `(4 "In1.Cu" signal)`. A regex over the first
  64 KiB is enough; no S-expression parser.

Design id: the workspace-relative path of the entry file (`hardware/board.kicad_pro`,
`src/blink.circuit.tsx`). Stable across restarts, readable in logs.

## Contracts (`packages/contracts/src/fork/pcb-preview.ts`)

```ts
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const PCB_PREVIEW_WS_METHODS = {
  status: "loom.pcb-preview.status",
  listDesigns: "loom.pcb-preview.listDesigns",
  render: "loom.pcb-preview.render",
  readSheet: "loom.pcb-preview.readSheet",
  check: "loom.pcb-preview.check",
  watch: "loom.pcb-preview.watch",
} as const;

export const PcbToolStatus = Schema.Struct({
  found: Schema.Boolean,
  path: Schema.optional(TrimmedNonEmptyString),
  version: Schema.optional(TrimmedNonEmptyString),
  /** "tool-too-old" when found but below the supported version. */
  problem: Schema.optional(Schema.Literals(["not-found", "tool-too-old", "version-failed"])),
});

export const PcbPreviewStatus = Schema.Struct({
  kicad: PcbToolStatus,
  /** Global tsci only; a project-local tsci is reported per design by listDesigns. */
  tscircuit: PcbToolStatus,
  checkedAt: IsoDateTime,
});

export const PcbDesignKind = Schema.Literals(["kicad", "tscircuit"]);
export const PcbView = Schema.Literals(["schematic", "pcb"]);
export const PcbLayerPreset = Schema.Literals(["front", "back", "all"]);

export const PcbDesign = Schema.Struct({
  id: TrimmedNonEmptyString, // workspace-relative entry path
  kind: PcbDesignKind,
  name: TrimmedNonEmptyString,
  schematicPath: Schema.optional(TrimmedNonEmptyString),
  boardPath: Schema.optional(TrimmedNonEmptyString),
  toolAvailable: Schema.Boolean,
});

export const PcbListDesignsInput = Schema.Struct({ threadId: ThreadId });
export const PcbListDesignsResult = Schema.Struct({
  designs: Schema.Array(PcbDesign),
  truncated: Schema.Boolean,
});

export const PcbRenderInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
  view: PcbView,
  layers: Schema.optional(PcbLayerPreset), // pcb only; default "front"
});

export const PcbSheet = Schema.Struct({
  id: TrimmedNonEmptyString, // file name inside the render, e.g. "board-power.svg"
  label: TrimmedNonEmptyString,
  bytes: NonNegativeInt,
  tooLarge: Schema.Boolean,
});

export const PcbRenderResult = Schema.Struct({
  renderKey: TrimmedNonEmptyString, // sha256 hex, also the cache directory name
  sourceHash: TrimmedNonEmptyString,
  outcome: Schema.Literals(["ok", "failed", "timed-out"]),
  sheets: Schema.Array(PcbSheet),
  log: Schema.String, // last 40 lines of stdout+stderr, capped at 8 KiB
  toolVersion: Schema.optional(TrimmedNonEmptyString),
  renderedAt: IsoDateTime,
  cached: Schema.Boolean,
});

export const PcbReadSheetInput = Schema.Struct({
  threadId: ThreadId,
  renderKey: TrimmedNonEmptyString,
  sheetId: TrimmedNonEmptyString,
});
export const PcbReadSheetResult = Schema.Struct({ svg: Schema.String });

export const PcbCheckKind = Schema.Literals(["erc", "drc"]);
export const PcbViolationItem = Schema.Struct({
  description: Schema.String,
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
});
export const PcbViolation = Schema.Struct({
  type: Schema.String,
  description: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  excluded: Schema.Boolean,
  sheet: Schema.optional(Schema.String), // ERC only
  group: Schema.Literals(["violation", "unconnected", "parity"]),
  items: Schema.Array(PcbViolationItem),
});
export const PcbCheckInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
  kind: PcbCheckKind,
});
export const PcbCheckResult = Schema.Struct({
  kind: PcbCheckKind,
  outcome: Schema.Literals(["clean", "violations", "failed", "timed-out"]),
  sourceHash: TrimmedNonEmptyString,
  violations: Schema.Array(PcbViolation), // capped at 500, sorted errors first
  truncated: Schema.Boolean,
  coordinateUnits: Schema.optional(Schema.String),
  kicadVersion: Schema.optional(Schema.String),
  log: Schema.String,
  ranAt: IsoDateTime,
});

export const PcbWatchInput = Schema.Struct({
  threadId: ThreadId,
  designId: TrimmedNonEmptyString,
});
/** First element is the current hash; then one element per debounced change. */
export const PcbWatchEvent = Schema.Struct({ sourceHash: TrimmedNonEmptyString });

export class PcbPreviewError extends Schema.TaggedError<PcbPreviewError>()("PcbPreviewError", {
  reason: Schema.Literals([
    "thread-not-found",
    "workspace-missing",
    "design-not-found",
    "path-outside-workspace",
    "tool-missing",
    "tool-too-old",
    "render-not-found",
    "sheet-too-large",
  ]),
  message: Schema.String,
}) {}

const errors = Schema.Union([PcbPreviewError, EnvironmentAuthorizationError]);

export const PcbPreviewRpcGroup = RpcGroup.make(
  Rpc.make(PCB_PREVIEW_WS_METHODS.status, {
    payload: Schema.Struct({}),
    success: PcbPreviewStatus,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.listDesigns, {
    payload: PcbListDesignsInput,
    success: PcbListDesignsResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.render, {
    payload: PcbRenderInput,
    success: PcbRenderResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.readSheet, {
    payload: PcbReadSheetInput,
    success: PcbReadSheetResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.check, {
    payload: PcbCheckInput,
    success: PcbCheckResult,
    error: errors,
  }),
  Rpc.make(PCB_PREVIEW_WS_METHODS.watch, {
    payload: PcbWatchInput,
    success: PcbWatchEvent,
    error: errors,
    stream: true,
  }),
);
```

`ThreadId`, `IsoDateTime`, `NonNegativeInt` and `TrimmedNonEmptyString` come from
`packages/contracts/src/baseSchemas.ts` (lines 108, 35, 17, 15). The formatter will wrap the
`Rpc.make` lines.

Streaming: `loom.pcb-preview.watch` is added to `ForkSubscriptionRpcTag` (it is a durable
subscription that should come back after a reconnect).

Scopes (`FORK_RPC_REQUIRED_SCOPES`):

| Tag                                           | Scope                | Why                                                                                             |
| --------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `status`, `listDesigns`, `readSheet`, `watch` | `orchestration:read` | Read-only.                                                                                      |
| `render`, `check`                             | `terminal:operate`   | They spawn processes on the server, and `tsci` executes project code. Same power as a terminal. |

## Server (`apps/server/src/fork/pcb-preview/`)

| File                   | Contents                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PcbPreviewService.ts` | `Context.Service` `loom/PcbPreviewService` with `status`, `listDesigns`, `render`, `readSheet`, `check`, `watch`; `layer`. |
| `tools.ts`             | Tool detection and version parsing (pure parsing is tested).                                                               |
| `discovery.ts`         | Grouping of search results into designs; inner-layer regex. Pure, tested.                                                  |
| `kicadReports.ts`      | ERC/DRC JSON to `PcbViolation[]`. Pure, tested against fixture reports.                                                    |
| `cache.ts`             | Cache directory layout, key computation, pruning.                                                                          |
| `rpc.ts`               | `makePcbPreviewRpcHandlers(auth)`, thin.                                                                                   |

Dependencies, all available to `ForkLayer` (EXTENSION-POINTS.md, "What ForkLayer can use"):
`ProcessRunner`, `FileSystem`, `Path`, `ServerConfig` (for `stateDir`),
`ProjectionSnapshotQuery` (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:279`),
`WorkspaceEntries`, `WorkspacePaths`.

Workspace resolution: `ProjectionSnapshotQuery.getThreadCheckpointContext(threadId)`
(`ProjectionSnapshotQuery.ts:201-203`) returns `workspaceRoot` and `worktreePath`
(`ProjectionThreadCheckpointContext`, lines 50-56). Use `worktreePath ?? workspaceRoot`, the
same rule as upstream's `resolveThreadWorkspaceCwd`
(`apps/server/src/checkpointing/Utils.ts:12-24`). Every design path is then resolved with
`WorkspacePaths.resolveRelativePathWithinRoot` (`apps/server/src/workspace/WorkspacePaths.ts:111-117`),
which rejects absolute paths and traversal.

Source hash: sha256 over the sorted list of `(relative path, size, mtimeMs)` for the files
that affect the view (KiCad: the design directory's `.kicad_sch`, `.kicad_pcb`,
`.kicad_pro`, `.kicad_dru`, `sym-lib-table`, `fp-lib-table`; tscircuit: every `.ts`, `.tsx`
and `.json` file under the entry's package directory, excluding `node_modules` and `dist`,
capped at 2,000 files). Metadata only, no file reads, so hashing is cheap enough to run on
every watch event.

Render key: sha256 of `sourceHash + kind + view + layers + toolVersion`. A render with an
existing complete cache directory (it has a `manifest.json`) returns `cached: true` without
running the tool.

Watch: `FileSystem.watch(designDir, { recursive: true })` (effect `FileSystem.watch`
accepts a `recursive` option), debounced 500 ms with `Stream.debounce` the way upstream
debounces its own config watches (`apps/server/src/keybindings.ts:568-569`), mapped to a
fresh source hash, deduplicated with `Stream.changes`. The stream starts with the current
hash. It lives only as long as the client subscription, so a hidden panel costs nothing.
For tscircuit the watched directory is the entry's package directory, filtered to ignore
events under `node_modules`, `dist` and `.tscircuit`.

Errors: tool failures are results (`outcome: "failed"` with the log), not RPC errors, so
the client can show the log. `PcbPreviewError` is for requests that cannot run at all.

## Storage

No tables. Files under `path.join(config.stateDir, "fork", "pcb-preview", "cache")`:

```
cache/<renderKey>/manifest.json   PcbRenderResult without `cached`
cache/<renderKey>/sch/*.svg       schematic sheets
cache/<renderKey>/pcb-<preset>.svg
cache/checks/<sha256(designId+kind)>.json   last PcbCheckResult per design and kind
```

`manifest.json` is written last with `writeFileStringAtomically`
(`apps/server/src/atomicWrite.ts:5`), so a crashed render is never mistaken for a complete
one. Pruning runs after each render: keep at most 100 render directories and 200 MiB,
removing the least recently modified first. The last check result per design is kept so the
Checks tab can show the previous run after a reload.

`readSheet` validates `renderKey` as 64 hex characters and `sheetId` as a plain file name
(`^[A-Za-z0-9._-]+\.svg$`) before joining paths, and refuses files over 4 MiB with
`sheet-too-large`.

## Clients

Shared atoms (`packages/client-runtime/src/fork/pcb-preview.ts`):

- `pcbPreviewStatusAtomFamily`: `createEnvironmentRpcQueryAtomFamily` over `status`.
- `pcbDesignsAtomFamily`: query over `listDesigns`, keyed by `threadId`.
- `pcbWatchAtomFamily`: `createEnvironmentRpcSubscriptionAtomFamily` over `watch`, keyed by
  `threadId + designId`.
- `render`, `readSheet` and `check` are imperative `request(...)` calls from the panel hook,
  because they depend on the current view and are cancelled on change.

Web (`apps/web/src/fork/pcb-preview/`):

| File                  | Contents                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel.tsx`           | `ForkPanelDefinition` (`id: "pcb-preview"`, title "PCB preview", icon `CircuitBoardIcon` from lucide, shortcut `"Z"`, `isAvailable: threadRef !== null && loomFeatures.includes("pcb-preview")`). |
| `PcbPreviewPanel.tsx` | Toolbar (design select, view tabs, preset or sheet select, zoom, refresh, "Rendering" state), body.                                                                                               |
| `SvgViewport.tsx`     | `<img>` from a Blob URL; CSS `transform: translate() scale()` pan and zoom; fit on first load.                                                                                                    |
| `ChecksView.tsx`      | Run ERC / Run DRC, grouped list, copy summary.                                                                                                                                                    |
| `usePcbPreview.ts`    | View state machine: current design, view, preset, sheet; render on (visible and hash changed); cancel on change.                                                                                  |
| `state.ts`            | Web atom instances with `connectionAtomRuntime`.                                                                                                                                                  |
| `preferences.ts`      | `loom:pcb-preview:last-design:v1` (per project), `loom:pcb-preview:trusted-projects:v1`, `loom:pcb-preview:electronics-url:v1`, all via `resolveStorage` in try/catch.                            |
| `palette.tsx`         | Palette source: "Open PCB preview" / "Close PCB preview".                                                                                                                                         |
| `commands.ts`         | `onForkCommand("loom.pcb-preview.toggle", ...)` registration, mounted from a tiny `ForkRoot` component.                                                                                           |
| `settings.tsx`        | Loom settings section: tool status from `status`, Electronics URL field.                                                                                                                          |
| `summary.ts`          | Pure: `PcbCheckResult` to the copyable text summary.                                                                                                                                              |

Rendering the SVG safely: `new Blob([svg], { type: "image/svg+xml" })`, `URL.createObjectURL`,
shown in `<img>`; revoked on change and unmount. Scripts and external references inside an
SVG loaded as an image do not run or load, so the panel never uses `dangerouslySetInnerHTML`.
KiCad SVGs use a white or transparent background; the viewport sets a neutral checker-free
background token so both light and dark themes read (`bg-white` in both themes, matching
how KiCad plots look, with a 1px border token).

Panel lifecycle: the panel is mounted only while it is the active surface (EXTENSION-POINTS.md,
Right panels), and `visible` is false while the right panel is collapsed. The watch
subscription and all renders run only while `visible`. On becoming visible, the panel
compares the watch hash with the last rendered `sourceHash` and renders only if different.

Palette and keybinding: the palette item and the `loom.pcb-preview.toggle` command both call
`useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("pcb-preview"))`, or
`closeSurface(threadRef, "fork:pcb-preview")` when that surface is already the active one
(`closeSurface` is declared at `apps/web/src/rightPanelStore.ts:160`).

Electronics link: when `loom:pcb-preview:electronics-url:v1` is set, the toolbar menu shows
"Open in Electronics", which opens that URL with `window.open` (desktop: upstream's external
link handling applies). The URL is client-local because the Electronics app runs on a
machine the client can reach, which may differ from the Loom server.

## Agent-facing tools

None. Agents run `kicad-cli` themselves or use the Electronics app's MCP server.

## Performance

- Nothing runs while the panel is hidden: no watch, no renders.
- The manifest is under 2 KiB. SVG text crosses the WebSocket only for the one sheet on
  screen, once per render key (the client keeps the last 6 sheets in memory, keyed by
  `renderKey + sheetId`). KiCad SVGs for small boards are typically 100 KiB to 2 MiB; the
  4 MiB cap bounds the worst case.
- Pan and zoom are CSS transforms on one `<img>`: no re-render, no layout work, no repaint
  loop. Wheel zoom is throttled to one update per animation frame, applied only during input.
- Tool processes are serialized per tool; a burst of saves produces one render (debounce
  plus interruption of the queued request).
- `listDesigns` is one workspace search per suffix (5 searches, limit 200 each), run when
  the panel opens and on the Refresh button, not on every watch event.

## Alternatives considered

- **Embedding `@tscircuit/runframe` or `@tscircuit/pcb-viewer` in the web bundle.** Old
  Loom did this (`@tscircuit/runframe`, `@tscircuit/eval`) and needed large
  `packageExtensions` blocks in `pnpm-workspace.yaml` to install at all; it would add large
  new production dependencies, would evaluate project code in the browser, and would not
  cover KiCad. Rejected.
- **An HTTP route serving SVG files** (`/api/loom/pcb-preview/files/...`). It would let the
  browser cache by URL, but browser `<img>` requests to a remote environment do not carry the
  bearer credential the WebSocket uses, so it would not work over every connection mode
  without new auth work. RPC text with a cap is simpler and remote-safe.
- **PNG rasterization on the server.** Needs `@resvg/resvg-js` or KiCad's `pcb render`,
  larger payloads, and blurry zoom. Rejected for v1.
- **Running ERC/DRC on every change.** DRC can take tens of seconds on real boards and would
  compete with renders. On demand, with a stale marker, is enough.
- **Depending on the Electronics app's `/api/previews`.** It would make the panel useless
  without that app running, which the brief rules out.
