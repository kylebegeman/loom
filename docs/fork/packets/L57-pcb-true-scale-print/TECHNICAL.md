# L57 technical design

## Overview

One new service method, `print`, plots a board with `kicad-cli pcb export pdf` into the PCB
cache and returns a signed URL for the PDF. It runs on a temporary copy of the board so it can
set the paper size without touching the user's files, and it passes a generated drawing sheet
that carries the scale bar and the 100% hint. A `save` flag also copies the PDF into
`fab/print/` in the workspace. The web panel adds a dialog; MCP and CLI reach the same method.

```
PrintDialog / loom_pcb_print / t3 pcb print
  -> loom.pcb-preview.print (AuthTerminalOperateScope)
  -> PcbPreviewService.print -> printPdf.ts
       workspace + sourceSnapshot (PcbPreviewService.ts:276, :518)
       temp dir: board copy (+ .kicad_pro), paper rewrite, scale-bar.kicad_wks
       kicadLock + run("kicad-cli", pcb export pdf ...)    (PcbPreviewService.ts:221, :302)
       cache: <cacheDir>/<hashKey>/print.pdf + manifest.json
       optional save: <root>/fab/print/<design>-<side>-<rev8>.pdf
  <- PcbPrintResult { file: SignedFile, ... }
client fetches /api/loom/pcb-preview/f/<token>/print.pdf (http.ts:7)
```

## Contracts

Add to `packages/contracts/src/fork/pcb-workspace.ts`, beside `PcbReferenceInput`
(`pcb-workspace.ts:287-299`), using the file's `text`, `list` and `finite` helpers
(`pcb-workspace.ts:5-8`).

```ts
export const PcbPrintSide = Schema.Literals(["top", "bottom"]);
export const PcbPrintPaper = Schema.Literals(["board", "A4", "USLetter", "A3", "USLedger"]);

export const PcbPrintInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1_024),
  side: PcbPrintSide.pipe(Schema.withDecodingDefault(() => "top" as const)),
  // KiCad layer names such as "F.Cu". Empty or missing means the side's defaults.
  layers: Schema.optional(list(text(64), 16)),
  // Missing means mirror when side is "bottom".
  mirror: Schema.optional(Schema.Boolean),
  paper: PcbPrintPaper.pipe(Schema.withDecodingDefault(() => "board" as const)),
  blackAndWhite: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  save: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});

export const PcbPrintResult = Schema.Struct({
  file: SignedFile, // model-preview-3d.ts:69-77
  fileName: text(200), // "<design>-<side>-<rev8>.pdf", used for downloads
  workspacePath: Schema.optional(text(4_096)), // workspace-relative, set when saved
  path: Schema.optional(text(4_096)), // absolute host path, set when saved
  sourceHash: text(200),
  side: PcbPrintSide,
  layers: list(text(64), 16),
  mirrored: Schema.Boolean,
  paper: PcbPrintPaper,
  boardMm: Schema.NullOr(Schema.Struct({ width: finite, height: finite })),
  warnings: list(text(400), 8),
  toolVersion: Schema.optional(text(100)),
  log: text(64_000),
});
```

Add `print: "loom.pcb-preview.print"` to `PCB_PREVIEW_WS_METHODS`
(`packages/contracts/src/fork/pcb-preview.ts:15-43`) and an `Rpc.make` entry to
`PcbPreviewRpcGroup` (`pcb-preview.ts:225-357`) with `payload: PcbPrintInput`,
`success: PcbPrintResult`, `error: errors` (`pcb-preview.ts:223`). Errors reuse
`PcbPreviewError` (`pcb-preview.ts:190-213`): `design-not-found`, `unsupported-view`,
`tool-missing`, `tool-too-old`, `path-outside-workspace` and `io-failed`. A failed or timed-out
KiCad run is `io-failed` with the error's existing `exitCode` and `timedOut` fields and the last
2,000 characters of the tool log in `message`. No new reason.

Permission: `print` runs a host tool, so it goes in `FORK_CLIENT_GUARDED_RPC_SCOPES`
(`packages/contracts/src/fork/clientRpcPermissions.ts`) and `FORK_RPC_REQUIRED_SCOPES`
(`apps/server/src/fork/rpcAuthorization.ts:21-46`) as `AuthTerminalOperateScope`, matching
`render` and `check`.

## Server

### New file `apps/server/src/fork/pcb-preview/printPdf.ts`

Pure helpers plus one Effect function that takes its dependencies as arguments, so the service
only gains a call site (PCB-FOLLOW-UPS.md, "Shared touch points").

- `defaultPrintLayers(side)`: top is `["F.Cu", "F.Silkscreen", "F.Courtyard", "Edge.Cuts"]`;
  bottom is `["B.Cu", "B.Silkscreen", "B.Courtyard", "Edge.Cuts"]`. KiCad 9 and 10 use these
  names (`PcbPreviewService.ts:797-806` already passes `F.Silkscreen` and `Edge.Cuts`).
- `validatePrintLayers(requested, boardLayers)`: keeps names present in the board's layer table
  (from `inspectBoard`, `semantics.ts:66-197`) and `Edge.Cuts`; drops the rest with a warning.
  Rejects an empty result with `unsupported-view` "None of the chosen layers exist on this
  board", the reason `runRender` uses for bad layers (`PcbPreviewService.ts:787`).
- `rewritePaper(boardText, paper)`: replaces the board's top-level `(paper "...")` form with the
  chosen size (`"A4"`, `"USLetter"`, `"A3"`, `"USLedger"`), or inserts it after `(general ...)`
  when missing. Uses `parseSexp` (`semantics.ts`) to find the node and splices by offset so the
  rest of the file is byte-identical. `"board"` leaves the text untouched.
- `scaleSheet({ boardMm, sideLabel })`: returns `.kicad_wks` text. Content, in page coordinates
  from the left-bottom corner (`lbcorner`), all in millimetres:
  - `(setup (textsize 1.5 1.5) (linewidth 0.15) (left_margin 10) (right_margin 10)
(top_margin 10) (bottom_margin 10))`
  - a `rect` 50 by 10 from `(10 10 lbcorner)` to `(60 20 lbcorner)`;
  - `line` ticks at x = 10, 20, ... 60, 3 mm high, labelled `0`, `10`, ... `50 mm` with `tbtext`;
  - `tbtext` "Print at 100%, not Fit to page. This bar must measure 50 mm." at `(10 24 lbcorner)`;
  - `tbtext` "Board outline 48.26 x 33.02 mm, top, viewed from the top" (or "bottom, mirrored")
    at `(10 28 lbcorner)`; omitted when `boardMm` is null;
  - `tbtext` `${KICAD_VERSION}` style variables are not used; the text is literal.
    The drawing sheet is plotted at 1:1 regardless of `--scale` (KiCad docs: "The border and title
    block are not scaled"), so the bar measures the printer, and the outline label lets the user
    measure the board itself. The exact `.kicad_wks` S-expression grammar must be checked against
    a sheet saved by KiCad's drawing sheet editor before shipping (see REFERENCES.md).
- `printFileName(design, side, sourceHash, revision?)`: `<stem>-<side>-<rev>.pdf`, where `rev` is
  the title block revision when present (from the board's `(title_block (rev "..."))`), else the
  first 8 hex characters of the source hash. Stem sanitised to `[A-Za-z0-9._-]`.
- `pageWarnings(boardBounds, paper, pageSizeMm)`: when the Edge.Cuts bounds from `inspectBoard`
  do not fit inside the page minus margins, warn "Part of the board is outside the page. Choose
  a larger paper, or move the board inside the page frame in KiCad." KiCad plots at the board's
  editor coordinates on the page; whether `pcb export pdf` recentres at scale 1 is unverified,
  so the warning uses editor coordinates and the manual checks confirm it.
- `runPrint(deps, input)`: the procedure below. `deps` is `{ run, kicadLock, requiredTool,
workspace, sourceSnapshot, cacheDir, signCacheFile, ensureWorkspaceDirectory, refreshEntries,
temporaryCircuitCwd }`, all existing members of the service closure.

### Procedure

1. Resolve the design with `workspace` and `sourceSnapshot` (`PcbPreviewService.ts:276-301`,
   `:518-608`). A design without a board fails with `unsupported-view` "This design has no board".
2. `requiredTool("kicad")` (`PcbPreviewService.ts:669-703`) enforces KiCad 9 or newer. Read the
   major version from `parseKicadVersion` (`tools.ts`).
3. Compute the key: `hashKey(workspaceKey, designId, sourceHash, "print", side, layers.join(),
mirrored, paper, blackAndWhite, kicadVersion)` (`cache.ts`). If
   `<cacheDir>/<key>/print.pdf` and its `manifest.json` exist, skip to step 7.
4. Make a temporary directory inside `cacheDir` (`.print-<random>`), removed in an `ensuring`
   finaliser:
   - KiCad design: copy `<stem>.kicad_pcb` and, when present, `<stem>.kicad_pro` (the project
     carries plot settings and text variables). Apply `rewritePaper`.
   - tscircuit design: runs the project's circuit code, so the client keeps the action disabled
     until the design is trusted, as rendering does (`usePcbPreview.logic.ts:15`). The server
     has no trust check of its own, matching `runRender`; agents act as the caller.
     Run `tsci export <entry> -f kicad_pcb -o <tmp>/board.kicad_pcb` with the same arguments
     shape as `runAsset` (`PcbPreviewService.ts:1680-1700`) inside `temporaryCircuitCwd`
     (`:1486-1515`). Missing KiCad fails with `tool-missing` naming KiCad.
   - Write `scale.kicad_wks` from `scaleSheet`.
5. Under `kicadLock` (`PcbPreviewService.ts:221-226`), run with a 120 s timeout:

   ```
   kicad-cli pcb export pdf
     --output <tmp>/print.pdf
     --layers <comma list>
     --mode-single
     --drawing-sheet <tmp>/scale.kicad_wks
     --include-border-title
     --drill-shape-opt 2
     [--mirror]                 when mirrored
     [--black-and-white]        when blackAndWhite
     [--scale 1]                KiCad 10 and newer only
     [--check-zones]            KiCad 10 and newer only
     <tmp>/<stem>.kicad_pcb
   ```

   KiCad 9 has neither `--scale` nor `--check-zones`; its PDF plot uses the board's plot scale
   from the project, which defaults to 1:1. On KiCad 9 add the warning "Zones are printed as
   last filled in KiCad". `--check-zones` refills only in memory and never saves the board. On
   a nonzero exit or timeout, fail with `io-failed` as above, using `processLog` (`tools.ts`).

6. Move `print.pdf` into `<cacheDir>/<key>/print.pdf` and write `manifest.json`
   (`{ kind: "print", fileName, sourceHash, side, layers, mirrored, paper, boardMm, warnings,
toolVersion, log, createdAt }`). `prune` (`PcbPreviewService.ts:621-667`) already evicts
   64-hex directories with a manifest, so prints share the render cache limits (`cache.ts`
   `CACHE_LIMITS`, 100 entries, 200 MiB).
7. Mint the signed file with `signCacheFile(<cacheDir>/<key>/print.pdf)`, the generalised
   `signBoard` described below. The token's `base` is the entry directory, so the URL is
   `/api/loom/pcb-preview/f/<token>/print.pdf` and `revision` is the cache key.
8. If `save`, `ensureWorkspaceDirectory(root, "fab/print")` (`PcbPreviewService.ts:258-275`),
   copy to a temporary name in that folder and rename to `fileName` (atomic replace), then
   `entries.refresh` as `exportReference` does (`PcbPreviewService.ts:2461`).
9. Return `PcbPrintResult`.

Cancellation: the RPC fibre is interrupted when the client job's result atom loses its last
subscriber; `run` already kills the child on interruption (`PcbPreviewService.ts:302-353`) and
the finaliser removes the temporary directory.

### Signed file route (shared with L65)

`resolveSignedRequest` (`PcbPreviewService.ts:1533-1556`) only accepts `board.glb`, and
`http.ts:25-29` sends `Content-Type: model/gltf-binary` for every file. Replace both with one
table in `cache.ts`:

```ts
export const SIGNED_FILE_TYPES = {
  "board.glb": { contentType: "model/gltf-binary", maxBytes: 128 * 1024 * 1024 },
  "print.pdf": { contentType: "application/pdf", maxBytes: 64 * 1024 * 1024 },
} as const;
```

`resolveSignedRequest` replaces its `path.basename(real) !== "board.glb"` and `MAX_MODEL_BYTES`
test (`PcbPreviewService.ts:1544-1550`) with a lookup in the table, and its error copy drops the
word "model" ("That file is unavailable. Create it again."). `http.ts` looks up the content type
by basename instead of the fixed `model/gltf-binary`. No `Content-Disposition`: the client sets
the download name with `<a download>`, and a direct link opens in the browser's PDF viewer.
`signBoard` (`PcbPreviewService.ts:1518-1532`) becomes `signCacheFile(file)`, building the URL
from the file's basename, so prints and L65 packages reuse it. L65 adds `"package.zip"` to the
same table. Whichever packet lands first creates it.

### Source scan

`sourceSnapshot` excludes `<root>/.loom/pcb-references` (`PcbPreviewService.ts:529-531`). Add
`<root>/fab` beside it. Saved PDFs would not change a KiCad hash (only `kicad_*` files count),
but tscircuit designs hash `.json .csv .svg .png` files, and L65's outputs under `fab/` would.
Shared with L65; first to land adds it.

## Storage

- Cache: `<cacheDir>/<key>/print.pdf` and `manifest.json`, pruned with renders. Not synced.
- Workspace: `fab/print/<stem>-<side>-<rev>.pdf` only when the user or agent saves. Overwrites
  the same name for the same revision.
- No settings, no new database state, no client storage.

## Clients

### Client runtime

Add to `packages/client-runtime/src/fork/pcb-preview.ts` a command
`print = createEnvironmentRpcCommand(PCB_PREVIEW_WS_METHODS.print, ...)` beside `check`, with its
`permissionAtom` used for availability. A job (`print.resultAtom`) cancels when unsubscribed.

### Web

- `WorkspaceMenu` (`apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx:199-245`): add "Print at
  1:1…" after "Export board reference…", disabled without a board or without the permission,
  with the tooltip copy from PRODUCT.md.
- New `apps/web/src/fork/pcb-preview/PrintDialog.tsx`, following `ExportDialog`
  (`WorkspaceChrome.tsx:312-369`) and its `OperationStatus`:
  - Form: Side (Top, Bottom) as a segmented control; Layers as a checkbox list built from the
    inspection's board layers with the side's defaults checked and "Reset to defaults"; Mirror
    checkbox, default on for Bottom; Paper select ("Board page", A4, US Letter, A3, US Ledger);
    "Black and white" checkbox; the note "Nothing is written to your design files."
  - Running: `OperationStatus` "Creating PDF" with Cancel.
  - Result: the file name, board size, warnings, and actions:
    - "Download PDF": fetch `modelUrl(environmentId, file.relativeUrl)`
      (`apps/web/src/fork/model-preview-3d/state.ts:17-21`) into a Blob and click an
      `<a download={fileName}>`, the pattern in
      `apps/web/src/fork/apple-build-tooling/state.ts:124-134`.
      On desktop the main window uses Electron's default download handling, which shows a save
      dialog; confirm in the manual checks.
    - "Save to workspace": calls `print` again with `save: true`; the cache makes it instant.
    - After saving, "Open" and "Show in folder" call `shellEnvironment.openInEditor` with
      `editor: "file-manager"` and `reveal` as in `apps/web/src/fileContextMenu.ts:115-160`,
      shown only when `serverConfig.availableEditors.includes("file-manager")`. "Open" uses the
      host's default app through the same capability check; when unavailable, only Download.
    - "Change options" returns to the form.
  - Stale: compare `result.sourceHash` with the design's current hash from `usePcbPreview`; on
    mismatch show the stale line and keep Download enabled.
- `PcbPreviewPanel.tsx`: open the dialog from the menu, as `exportBoard` (`:602-636`) does for the
  reference export. No key binding.

### Desktop

No desktop code. The signed URL is same-origin for the web bundle, and `openInEditor` already
works through the desktop shell.

### Mobile

None. Mobile has no PCB panel.

## Agent-facing tools

- MCP: `loom_pcb_print` in `apps/server/src/fork/pcb-preview/mcp.ts`, built like
  `loom_pcb_check` (`mcp.ts:110-119`, handler `:349-356`): `Tool.make("loom_pcb_print", {
parameters: Schema.Struct({ ...design, side, layers, mirror, paper, blackAndWhite, save })`
  with `save` optional, `success: W.PcbPrintResult`, `failure`, `dependencies:
[McpInvocationContext, ThreadManagementService] })`, titled "PCB: print", `Readonly` false,
  `Destructive` false. Handler uses `McpToolAccess.actsAsCaller`, the `thread` helper
  (`mcp.ts:259-267`) and
  `withForkRuntime(PcbPreviewService.print({ ...input, save: input.save ?? true, threadId }))`.
  Agents default to saving because a signed URL is of little use to them; the description says
  "Returns the saved path under fab/print/. Ask the user to print at 100%."
- CLI: `t3 pcb print '{"designId":"board/main.kicad_pcb","side":"bottom"}'` works with no CLI
  change because `cli.ts` maps actions to `loom_pcb_<action>`.
- Editor command: none. Printing does not change the visible editor.

## Performance

A PDF plot of four layers takes about a second on small boards. It holds `kicadLock`, so a
render or DRC waits; the UI says so. The cache key makes repeat downloads and "Save to
workspace" free. PDF bytes never cross the WebSocket. No polling: the dialog waits on the job.

## Alternatives considered

- Draw the scale bar on `User.Drawings` in the temporary board: plotted at board scale, so it
  checks the board as well, but needs a free layer and S-expression edits to graphics. The
  drawing sheet avoids both, and the outline size label covers the board check.
- Print the panel's SVG from the browser: the browser's print dialog scales by default and SVG
  physical units depend on the renderer. This is the failure the feature exists to avoid.
- `--mode-multipage` for both sides in one PDF: mirror applies to the whole run, so the bottom
  would come out unmirrored or the top mirrored. Two runs plus a merge needs a PDF library.
- `pcb export svg` plus a server-side SVG to PDF converter: a new dependency for no gain.
- Setting `--scale 1` on KiCad 9 by editing the project's plot settings: the default is already
  1:1, and editing `pcbnew.plot` settings in JSON is fragile. Manual checks cover it.
