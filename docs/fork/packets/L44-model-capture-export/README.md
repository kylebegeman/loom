# L44: Copy and save captures

Status: Implemented locally; client verification pending (`feat/model-units-scale-capture`).

Approved by Kyle on 2026-10-10.

Implemented in the L40/L39/L44 batch on the branch above. All 70 focused tests, changed-source
lint and contracts/web/server/client-runtime typechecks passed. Real-client interaction,
clipboard/download behavior and real OpenSCAD checks were not run; see
[TESTING.md](./TESTING.md#results) for the evidence and remaining checks.

Captures can leave Loom. Next to "Attach to the composer", the Capture menu offers "Copy image"
and "Save PNG" for the current view and the four-view sheet, and saved views and review sheets
offer the same two actions in their row menus. Copy puts a PNG on the clipboard for pasting into
a chat, issue or slicer forum; save downloads a PNG named after the model, the view and the time,
such as `bracket-front-20261010-1432.png`. On a connection where the browser blocks clipboard
images, copy is disabled and save still works.

## Scope

- In:
  - "Copy image" and "Save PNG" for: current view, four-view sheet (Capture menu), each saved
    view and each review sheet (Views tab row menus).
  - File names `<model>-<view>-<yyyymmdd-hhmm>.png`, local time.
  - Insecure-context fallback: copy disabled, save available.
  - Desktop: same web code; save opens Electron's Save dialog.
  - Success and error feedback in the panel's existing notice and toast.
  - Palette entries for the current view, per the recommendation in PRODUCT.md.
- Out:
  - New image sizes, formats (JPEG, SVG) or resolution options.
  - Saving into the project folder (that is a server write; a later idea if wanted).
  - Mobile (no 3D panel).
  - Any agent tool change: the editor `capture` action already returns the PNG.

## Surfaces

Web and desktop. Mobile has no 3D panel. Remote: images are rendered in the client from the
mesh it already downloaded through the signed file route, so nothing new crosses the network.
Clipboard availability depends on a secure context; see PRODUCT.md.

## Extension points used

Reuses L23's `ext-panels`, `ext-palette` (two entries) and the model action bus
(`actions.ts`). Creates none.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L31 (orthographic): exported images follow the projection automatically, because export calls
  the same `viewer.capture` and `captureNamedViews`. The four-view sheet is orthographic once
  L31 lands.
- L43 (announcer): "Image copied." and "Download started." go through the panel's `success`
  state, which L43 announces. Without L43 the visible message is the same.
- L36, L37, L42 (overlays): whatever the viewer draws is in the PNG; no extra work.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
