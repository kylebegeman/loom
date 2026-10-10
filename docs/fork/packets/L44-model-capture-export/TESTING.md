# L44 testing

Focused tests only, no sleeps, no repo-wide checks.

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
