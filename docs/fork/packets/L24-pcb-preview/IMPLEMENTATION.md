# L24 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. Work in your own worktree. For the manual check you need a KiCad project and
(optionally) a tscircuit project inside a worktree `.t3` seeded per AGENTS.md "Test data";
KiCad's own demo projects (`/Applications/KiCad/demos/` after installing KiCad 10) are good
fixtures.

## File layout

```
packages/contracts/src/fork/pcb-preview.ts
packages/client-runtime/src/fork/pcb-preview.ts
apps/server/src/fork/pcb-preview/
  PcbPreviewService.ts  tools.ts  discovery.ts  kicadReports.ts  cache.ts  rpc.ts
  tools.test.ts  discovery.test.ts  kicadReports.test.ts  cache.test.ts  PcbPreviewService.test.ts
  fixtures/erc.json  fixtures/drc.json  fixtures/board-header.kicad_pcb
apps/web/src/fork/pcb-preview/
  panel.tsx  PcbPreviewPanel.tsx  SvgViewport.tsx  ChecksView.tsx  usePcbPreview.ts
  state.ts  preferences.ts  palette.tsx  commands.tsx  settings.tsx  summary.ts
  summary.test.ts  usePcbPreview.logic.ts  usePcbPreview.logic.test.ts
docs/fork/user/pcb-preview.md
```

## Steps

1. **Extension points.** Run the existence checks for `ext-core`, `ext-panels`,
   `ext-settings`, `ext-palette`, `ext-web-root`, `ext-keybindings`. Create each missing one
   in its own commit, exactly as specified, with its FORK.md rows.

2. **Contracts.** Write `packages/contracts/src/fork/pcb-preview.ts` from TECHNICAL.md.
   Register it in `fork/index.ts` and `fork/rpc.ts`, add the `watch` tag to
   `ForkSubscriptionRpcTag`, add `"loom.pcb-preview.toggle"` to `FORK_KEYBINDING_COMMANDS`.
   Typecheck `@t3tools/contracts`.

3. **Pure server helpers, test first.**
   - `kicadReports.ts`: parse ERC (`sheets[].violations[]`) and DRC (`violations[]`,
     `unconnected_items[]`, `schematic_parity[]`) JSON. Decode with a lenient Effect Schema
     (unknown keys ignored, `excluded` defaults to false). Sort errors first, cap at 500.

     ```ts
     const Item = Schema.Struct({
       description: Schema.String,
       pos: Schema.optional(Schema.Struct({ x: Schema.Number, y: Schema.Number })),
     });
     const Violation = Schema.Struct({
       type: Schema.String,
       description: Schema.String,
       severity: Schema.String, // "error" | "warning"; anything else maps to "warning"
       excluded: Schema.optional(Schema.Boolean),
       items: Schema.Array(Item),
     });
     const DrcReport = Schema.Struct({
       kicad_version: Schema.String,
       coordinate_units: Schema.optional(Schema.String),
       violations: Schema.Array(Violation),
       unconnected_items: Schema.Array(Violation),
       schematic_parity: Schema.Array(Violation),
     });
     const ErcReport = Schema.Struct({
       kicad_version: Schema.String,
       coordinate_units: Schema.optional(Schema.String),
       sheets: Schema.Array(
         Schema.Struct({ path: Schema.String, violations: Schema.Array(Violation) }),
       ),
     });
     ```

   - `discovery.ts`: `groupDesigns(entries: ReadonlyArray<string>, readConfig)` and
     `innerCopperLayers(header: string)`, which matches `/\(\s*\d+\s+"(In\d+\.Cu)"/g`.
   - `tools.ts`: `parseKicadVersion("10.0.6") -> { major: 10 }`, tolerant of prefixes like
     `KiCad 9.0.1` and trailing text.
   - `cache.ts`: `renderKey(...)`, `isRenderKey`, `isSheetFileName`, and
     `pickPruneVictims(entries, { maxCount: 100, maxBytes: 200 MiB })`.

4. **Service.** `PcbPreviewService.ts`:

   ```ts
   export class PcbPreviewService extends Context.Service<
     PcbPreviewService,
     {
       readonly status: Effect.Effect<PcbPreviewStatus>;
       readonly listDesigns: (
         i: PcbListDesignsInput,
       ) => Effect.Effect<PcbListDesignsResult, PcbPreviewError>;
       readonly render: (i: PcbRenderInput) => Effect.Effect<PcbRenderResult, PcbPreviewError>;
       readonly readSheet: (
         i: PcbReadSheetInput,
       ) => Effect.Effect<PcbReadSheetResult, PcbPreviewError>;
       readonly check: (i: PcbCheckInput) => Effect.Effect<PcbCheckResult, PcbPreviewError>;
       readonly watch: (i: PcbWatchInput) => Stream.Stream<PcbWatchEvent, PcbPreviewError>;
     }
   >()("loom/PcbPreviewService") {}
   ```

   Build it with `Layer.effect` from `ProcessRunner`, `FileSystem`, `Path`, `ServerConfig`,
   `ProjectionSnapshotQuery`, `WorkspaceEntries`, `WorkspacePaths`. Key internals:

   ```ts
   const resolveDesign = Effect.fn("PcbPreview.resolveDesign")(function* (threadId, designId) {
     const context = yield* snapshots
       .getThreadCheckpointContext(threadId)
       .pipe(Effect.mapError(() => pcbError("thread-not-found", "The thread could not be read.")));
     if (Option.isNone(context))
       return yield* pcbError("thread-not-found", "The thread no longer exists.");
     const cwd = context.value.worktreePath ?? context.value.workspaceRoot;
     const entry = yield* workspacePaths
       .resolveRelativePathWithinRoot({ workspaceRoot: cwd, relativePath: designId })
       .pipe(
         Effect.mapError(() =>
           pcbError("path-outside-workspace", "That design is outside the workspace."),
         ),
       );
     // stat entry.absolutePath; classify kind from the suffix; locate siblings.
     // listDesigns returns entry.absolutePath as PcbDesign.absolutePath (Electronics link).
   });
   ```

   Tool runs:

   ```ts
   const runKicad = (args: ReadonlyArray<string>, cwd: string, timeout: Duration.Input) =>
     kicadLock.withPermits(1)(
       processRunner.run({
         command: kicad.path,
         args,
         cwd,
         timeout,
         maxOutputBytes: 1024 * 1024,
         outputMode: "truncate",
         timeoutBehavior: "timedOutResult",
       }),
     );
   ```

   Treat `code === 0` as clean or ok, `code === 5` (checks only) as violations, anything
   else as failed; `timedOut` as timed-out. A `ProcessSpawnError` (tool vanished) maps to
   `tool-missing`. Write `manifest.json` last. Keep the in-flight render per
   `designId + view + preset` in a `Ref<HashMap<string, Fiber>>` and interrupt the previous
   one when a new request arrives.

   Register the layer and service type in `ForkLayer.ts` and `ForkRuntime.ts`; append
   `"pcb-preview"` to `LOOM_SERVER_FEATURES`.

5. **Handlers.** `rpc.ts`:

   ```ts
   export const makePcbPreviewRpcHandlers = (auth: ForkRpcAuth) =>
     Effect.succeed(
       PcbPreviewRpcGroup.of({
         [PCB_PREVIEW_WS_METHODS.render]: (input) =>
           auth.effect(
             PCB_PREVIEW_WS_METHODS.render,
             withForkRuntime(Effect.flatMap(PcbPreviewService, (s) => s.render(input))),
           ),
         [PCB_PREVIEW_WS_METHODS.watch]: (input) =>
           auth.stream(
             PCB_PREVIEW_WS_METHODS.watch,
             Stream.unwrap(withForkRuntime(Effect.map(PcbPreviewService, (s) => s.watch(input)))),
           ),
         // status, listDesigns, readSheet, check likewise
       }),
     );
   ```

   `withForkRuntime` provides the fork context to an Effect; for the stream, wrap the
   service lookup and `Stream.unwrap` it as above. Add six scopes to
   `FORK_RPC_REQUIRED_SCOPES` (TECHNICAL.md, Contracts). Typecheck `t3`.

6. **Client-runtime atoms.** `packages/client-runtime/src/fork/pcb-preview.ts` with the
   three atom families (TECHNICAL.md, Clients). Typecheck `@t3tools/client-runtime`.

7. **Web panel.**
   - `usePcbPreview.logic.ts` (pure, tested): given `{ visible, watchHash, lastRender,
view, preset, sheetId }` decide `render | readSheet | idle`.
   - `SvgViewport.tsx`:

     ```tsx
     export function SvgViewport({ svg, label }: { svg: string; label: string }) {
       const url = useMemo(() => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })), [svg]);
       useEffect(() => () => URL.revokeObjectURL(url), [url]);
       const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
       // wheel: requestAnimationFrame-throttled scale around the cursor
       // pointer drag: translate; double click: fit
       return (
         <div className="relative size-full overflow-hidden bg-white" onWheel={...} onPointerDown={...}>
           <img alt={label} src={url} draggable={false}
             style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0" }} />
         </div>
       );
     }
     ```

   - `PcbPreviewPanel.tsx`: toolbar and states from PRODUCT.md, the tscircuit trust prompt,
     the "Open in Electronics" menu item (`electronicsDesignUrl`), and `ChecksView.tsx` with
     "Send summary to chat" (draft store `setPrompt`, append after a blank line, never send)
     and "Copy summary". The tab keeps the registry title "PCB preview"; the design name
     shows in the toolbar.
   - `panel.tsx`: the `ForkPanelDefinition`; append to `FORK_PANELS`, with the
     shortcut letter `Z` assigned in EXTENSION-POINTS.md, "Launcher letters".

8. **Palette, command, settings.** `palette.tsx` (items only when `activeThreadRef` and the
   feature are present; value `action:loom:pcb-preview:toggle`), `commands.tsx`
   (`PcbPreviewCommandHost` subscribes with `onForkCommand` and reads the active thread the
   same way the palette registry does), `settings.tsx` (tool status and the Electronics URL;
   shows "Needs a Loom server with PCB preview" for environments without the feature).

9. **Docs.** `docs/fork/user/pcb-preview.md`: what the panel shows, that it needs KiCad 9+
   or the tscircuit CLI on the environment's machine, that tscircuit renders run project
   code, where the tools are looked for (no custom paths), how "Send summary to chat" works,
   and that "Open in Electronics" needs the Electronics app on the environment's machine.
   Set the packet index Status.

## Pitfalls

- `kicad-cli sch export svg` names files after the sheets (`<project>.svg`,
  `<project>-<sheet>.svg`); list the output directory after the run instead of predicting
  names, and sort the root sheet first.
- KiCad writes relative paths in reports; do not surface absolute server paths in the UI
  when the client is remote, show workspace-relative ones. `PcbDesign.absolutePath` exists
  only to build the Electronics URL; never render it as text.
- `kicad-cli` may print warnings on stderr and still exit 0. Only the exit code decides.
- The effect `FileSystem.watch` recursive option depends on the platform backend; on Linux
  older Node versions lack recursive `fs.watch`. If it fails, fall back to watching the
  design directory non-recursively and say so in a log line.
- Do not render on mount if the panel is not `visible`, and do not keep the watch stream
  subscribed when hidden: unmounting the atom subscription is the off switch.
- Never pass user input as a shell string: `ProcessRunner` takes `command` and `args`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A KiCad 10 demo project renders schematic sheets and all three PCB presets; ERC and DRC
  list violations that match KiCad's own dialog counts.
- Saving the schematic in KiCad updates the panel within about a second while visible.
- A tscircuit `*.circuit.tsx` renders after the trust prompt, with the build log on error.
- Missing tools, no designs, and an upstream server each show their state from PRODUCT.md.
