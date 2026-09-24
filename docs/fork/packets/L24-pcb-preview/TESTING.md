# L24 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. The automated tests do not
need KiCad or tscircuit installed; process runs are replaced with a fake `ProcessRunner`
layer.

## Automated tests

| File                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/pcb-preview/kicadReports.test.ts`      | ERC and DRC fixtures (checked in, produced by `kicad-cli` 10 on a demo project) parse into the expected violations; unconnected and parity groups; `excluded` defaulting; errors sorted first; cap at 500 with `truncated`; unknown severity maps to warning; a malformed report fails with a typed error, not a defect.                                                                                                                                                                             |
| `apps/server/src/fork/pcb-preview/discovery.test.ts`         | Grouping: project with sch and pcb; lone `.kicad_pcb`; sub-sheets not listed separately; `*.circuit.tsx` and `tscircuit.config.json` entrypoint; fuzzy-search noise (e.g. `foo.kicad_pro.bak`) dropped; inner layer regex on a 4-layer header fixture.                                                                                                                                                                                                                                               |
| `apps/server/src/fork/pcb-preview/tools.test.ts`             | Version parsing: `10.0.6`, `9.0.1`, `KiCad 8.0.4` (too old), garbage (version-failed).                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/pcb-preview/cache.test.ts`             | `isRenderKey` and `isSheetFileName` reject traversal (`../x.svg`, `a/b.svg`, `x.svg.exe`); render key changes with tool version and preset; prune picks oldest first until under both limits.                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` | With test layers (no database needed): a fake `ProcessRunner`, fake `ProjectionSnapshotQuery` and a temp workspace: `render` writes `manifest.json` and reports sheets; a second call returns `cached: true` without running the process; exit code 5 on `check` is `violations`, 1 is `failed`, `timedOut` is `timed-out`; a design id with `..` fails `path-outside-workspace`; `readSheet` refuses a file over the cap; `tsci` runs get an environment without `T3CODE_*` or `*TOKEN*` variables. |
| `apps/web/src/fork/pcb-preview/usePcbPreview.logic.test.ts`  | No render while hidden; render when visible and the watch hash differs from the last render; no render when equal; view or preset change requests a render; tscircuit untrusted project yields `needs-trust`.                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/pcb-preview/summary.test.ts`              | Plain-text summary: counts line, one line per violation with position and units, excluded omitted, clean message.                                                                                                                                                                                                                                                                                                                                                                                    |

Registry invariants are covered by the extension points' own tests
(`apps/web/src/fork/panels/registry.test.ts`, `packages/contracts/src/fork/keybindings.test.ts`,
`apps/server/src/fork/rpcAuthorization.test.ts`, `apps/server/src/fork/features.test.ts`);
run them because this packet adds entries.

## Commands

```sh
vp test run apps/server/src/fork/pcb-preview apps/web/src/fork/pcb-preview \
  apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts \
  apps/web/src/fork/panels/registry.test.ts packages/contracts/src/fork/keybindings.test.ts
vp lint packages/contracts/src/fork apps/server/src/fork apps/web/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

`packages/contracts` changed, so also typecheck `@t3tools/mobile` (it imports the client
runtime, which imports the fork contracts).

## Manual check

Ask Kyle before starting a dev server or a browser (AGENTS.md). With permission, on web
(and once on desktop):

1. Seed a worktree `.t3` (AGENTS.md "Test data"). Put a KiCad 10 demo project (for example
   a copy of a demo from the KiCad install) and a small tscircuit project in a test project.
2. Open a thread in that project, open the launcher, choose "PCB preview". The design list
   shows both designs.
3. KiCad design: Schematic shows the root sheet; the sheet picker lists every sheet. PCB
   Front, Back and All copper each render. Zoom with the wheel, pan by dragging, double
   click fits.
4. Edit the schematic in KiCad and save. The panel updates within about a second. Collapse
   the right panel, save again, expand: exactly one render runs on expand.
5. Run ERC and DRC. Counts match KiCad's own ERC/DRC dialogs. Copy summary, paste into the
   composer.
6. tscircuit design: the trust prompt appears once; after Render the schematic and PCB show.
   Break the circuit code: the failure state shows the build log and keeps the last render.
7. Rename `kicad-cli` out of reach (or run on a machine without KiCad): the missing-tool
   state appears and the design list still loads.
8. Connect this client to an upstream T3 server: the launcher entry is disabled with
   "Needs a Loom server with PCB preview".
9. Remote: pair a second browser over the tailnet and repeat step 3 from it.
10. Bind `loom.pcb-preview.toggle` in Settings, Keybindings and check it opens and closes the
    panel; the palette item does the same.

## Merge safety

- Before review: the `git merge-tree` preview in SEAMS.md against the newest nightly tag.
  With no packet seams, it should be clean unless an extension point seam conflicts.
- After Kyle merges to main: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
  synced `main`. Record the result here.
