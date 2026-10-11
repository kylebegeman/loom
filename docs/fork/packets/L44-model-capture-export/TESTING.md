# L44 testing

Focused tests only, no sleeps, no repo-wide checks.

## Results

Implementation branch: `feat/model-units-scale-capture`, 2026-10-10. Milestones:
`11bc13a743` adds the unit and scale-reference settings; `357f419b46` adds the display,
reference geometry and capture-export behavior.

| Focused file set                                                                       | Result                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/captureExport.test.ts`, `useModelEditing.test.tsx` | Passed: 12 tests                                     |
| `viewer/captureSheet.test.ts`, `buildPlate.test.ts`                                    | Passed: 8 existing regression tests across the batch |

The integrated batch passed **70 tests across 10 files**, counted once: 16 foundation tests,
34 viewer tests, 12 export tests and 8 existing capture-sheet/bed-helper regressions.
Changed TS/TSX lint passed. Contracts, web, server and client-runtime typechecks all exited 0;
the existing Effect suggestions remain informational. No repo-wide suite was run.

The commands and manual steps below remain the validation plan; they do not imply additional
completed checks. No browser, desktop, remote-client, real clipboard/download or real OpenSCAD
verification was run in this implementation pass. Those checks remain open; no release or
merge verification is claimed here.

## Automated tests

| File                                                             | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/fork/model-preview-3d/captureExport.test.ts` (new) | `captureFileName`: extension dropped, case kept, local time padded (`20260105-0907`), unsafe characters and spaces become `-`, unicode names fall back cleanly, long names cut at 80, empty parts get `model` and `view`. `canCopyImages`: false without a secure context, without `clipboard.write`, without `ClipboardItem`, or when `supports("image/png")` is false; true otherwise. `copyImage`: calls `clipboard.write` synchronously with a pending promise (assert the stub was called before the promise resolves); throws upstream's message when unavailable. |
| `apps/web/src/fork/model-preview-3d/useModelEditing.test.tsx`    | `exportViews` with `copy` writes once and does not touch the composer store; with `save` creates one download; both respect the single-operation lock; `captureViews` still attaches.                                                                                                                                                                                                                                                                                                                                                                                    |

## Commands

```sh
vp test run apps/web/src/fork/model-preview-3d/captureExport.test.ts \
  apps/web/src/fork/model-preview-3d/useModelEditing.test.tsx \
  apps/web/src/fork/model-preview-3d/viewer/captureSheet.test.ts
vp lint apps/web/src/fork/model-preview-3d
vp run --filter @t3tools/web typecheck
```

## Manual check

With an STL that has saved views and one review sheet:

1. Desktop app: each copy action, then paste into Preview (File, New from Clipboard). Each save
   action: a Save dialog with the suggested name; cancel it once and confirm nothing breaks.
2. Chrome and Safari on `localhost`: same, saves land in Downloads.
3. A browser over plain HTTP on a LAN or tailnet IP (`vp run dev` reached by IP): copy items are
   disabled; save works.
4. A browser over T3 Connect or `vp run dev --share`: copy works.
5. Trigger an error (copy while the clipboard is blocked by the browser) and check the notice
   title. Attach to the composer still works afterwards.
6. Palette: both entries.

## Merge safety

No upstream files. Run the merge preview from CONVENTIONS.md against the newest nightly before
merging, and `scripts/fork/loom.sh check` after.
