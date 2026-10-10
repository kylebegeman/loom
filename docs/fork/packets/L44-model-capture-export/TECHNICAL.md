# L44 technical

## Overview

Export reuses the two existing renderers, `viewer.capture(four)` (`createViewer.ts:572-627`) and
`captureNamedViews` (`viewer/captureSheet.ts:25-79`), and adds two sinks next to
`attachModelImage` (`capture.ts:19-50`): the clipboard and a download. Everything is client
side.

## Contracts

None.

## Server

None.

## Storage

None.

## Clients

### `apps/web/src/fork/model-preview-3d/captureExport.ts` (new)

```ts
export type ExportAction = "copy" | "save";
export function captureFileName(path: string, label: string, date: Date): string;
export function canCopyImages(): boolean;
export function copyImage(image: Promise<Blob>): Promise<void>;
export function saveImage(image: Blob, name: string): void;
```

- `captureFileName`: base name of `path` without its extension, then `label`, then
  `yyyymmdd-hhmm` in local time, joined by `-`, plus `.png`. In each part, runs of characters
  outside `[A-Za-z0-9._]` become `-` and leading and trailing `-` are trimmed; the stem is cut
  to 80 characters. Case is kept. An empty part becomes `model` or `view`.
- `canCopyImages`: `window.isSecureContext && !!navigator.clipboard?.write &&
typeof ClipboardItem !== "undefined"`, and `ClipboardItem.supports?.("image/png") !== false`.
  This extends upstream's check (`MediaActions.tsx:139-142`) with the secure-context test, so
  the item is disabled up front instead of failing after a click.
- `copyImage`: throws upstream's message ("Image copying is unavailable. Use a secure browser
  connection or save the image.", `MediaActions.tsx:103-105`) when `canCopyImages()` is false;
  otherwise `return navigator.clipboard.write([new ClipboardItem({ "image/png": image })])`.
  It takes a promise and must be called before any `await`, so Safari and Firefox still see the
  click's user activation. This is upstream's pattern (`MediaActions.tsx:107-110`).
- `saveImage`: object URL, an `<a download>` click, and revoke after 30 seconds, as
  `downloadMedia` does for URLs (`apps/web/src/components/media/mediaContent.ts:29-39`). We do
  not call `downloadMedia` itself because it fetches a URL and we already hold the blob.

Labels: current view uses the active standard view (`iso`, `front`, `top`, `right`), else the
active saved view's name, else `view`. The four-view sheet uses `four-views`. A saved view uses
its name; a review sheet uses its name.

### Rendering for export

`useModelEditing.ts:186-209` `captureViews` renders and attaches in one task. Split the render
half into `renderViews(ids, includeMeasurements): Promise<Blob>`, which sets overlays, starts
`captureNamedViews` synchronously and restores overlays exactly as now, and keep `captureViews`
as `renderViews` plus `attachModelImage`. Add
`exportViews(ids, includeMeasurements, name, action)`:

```ts
perform(action === "copy" ? "Copying model image" : "Saving model image", async () => {
  const image = renderViews(ids, includeMeasurements); // no await before this line
  if (action === "copy") await copyImage(image);
  else saveImage(await image, captureFileName(path, name, new Date()));
});
```

`perform` (`useModelEditing.ts:34-47`) calls the task synchronously, so the clipboard write still
runs inside the click. It also gives export the same single-operation lock as attach.

### Panel

`ModelPanel.tsx`:

- Add `exportCapture(four: boolean, action: ExportAction)` beside `capture` (628-650), using the
  same readiness check and `perform`. It calls `viewer.current.capture(four)` without awaiting,
  then `copyImage` or `saveImage`.
- On success set `success` to "Image copied." or "Download started." The 5-second auto-dismiss
  (174-177) already applies.
- Change `captureError` from a string to `{ title, message }` so the notice (961-971) can say
  "Capture could not be attached", "Image could not be copied" or "PNG could not be saved".
- Pass `canCopy={canCopyImages()}`, `onCopy` and `onSave` to `CaptureMenu` (788-796) and
  `onExport={editing.exportViews}` and `canCopy` to `ViewsSection` (1112).
- Listen for the new model actions in the existing `onModelAction` effect (651-657).

`WorkspaceTools.tsx` `CaptureMenu` (293-357): after the "Attach to the composer" group, add a
"Copy image" group and a "Save PNG" group, each with "Current view" and "Four-view sheet", using
the same icons. Copy items take `disabled={!canCopy}`. Do not reorder existing groups.

`ViewsSection.tsx`: in the saved view `RowMenu` (240-254) and the review sheet `RowMenu`
(307-331), add "Copy image" (`CopyIcon`) and "Save PNG" (`DownloadIcon`) before the separator.
A saved view exports as a one-view sheet through `exportViews([view.id], false, view.name, ...)`,
which titles the image with the view's name.

### Palette

`actions.ts:2` `ModelAction` gains `"copy-view"` and `"save-view"`. `palette.tsx:54-62` adds the
two entries "3D model: Copy view image" and "3D model: Save view as PNG". Palette selection is a
user gesture in Chromium, which covers desktop and Chrome. In Safari the clipboard write may lose
activation after the palette closes; the copy then fails with the error notice and Save still
works (not verified).

### Desktop

No new IPC. The app's schemes are registered `secure: true`
(`apps/desktop/src/electron/ElectronProtocol.ts:118-142`), so `isSecureContext` holds, and
upstream's image copy already runs there. The main window sets no permission handler and no
`will-download` handler (the only one is for preview sessions,
`apps/desktop/src/preview/Manager.ts:3723`), so Electron uses its default download routine,
which shows a Save dialog.

## Agent-facing tools

None. Agents cannot use the user's clipboard or Downloads folder, and
`loom_model_preview_3d_editor` with `capture` already returns the PNG as base64
(`ModelPanel.tsx:347-375`, `model-editor.ts:99`). Export is a user capability layered on the
same render path agents use.

## Performance

One render per export, the same as attach. No compression pass, so export is cheaper than
attach. A four-view PNG is 1600 by 1200 pixels, typically 1 to 3 MB; it stays in memory only
until the clipboard or download takes it. The object URL is revoked after 30 seconds. Nothing is
sent over the network.

## Alternatives considered

- An Electron IPC for clipboard images (`clipboard.writeImage`): unnecessary, since the web API
  works on desktop, and it would be a new seam.
- `showSaveFilePicker` on web: Chromium only, and a download matches upstream's "Save image".
- Writing exports into the workspace through the server: different feature, needs a service
  method and conflict handling. Left out.
- Reusing `attachModelImage`'s compressed file for export: lowers quality for no gain.
