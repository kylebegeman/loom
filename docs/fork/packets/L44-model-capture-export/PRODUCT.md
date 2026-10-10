# L44 product

## Problem

Every capture goes into the composer (`capture.ts:7-50`). To share a view anywhere else, Kyle
attaches it, then fishes the image back out of the draft, or takes a screenshot of the panel
with its toolbars. The panel already renders clean PNGs; it just cannot hand them over.

## What the user can do

- Open the Capture menu and choose Copy image or Save PNG for "Current view" or
  "Four-view sheet".
- In the Views tab, open a saved view's menu or a review sheet's menu and choose "Copy image" or
  "Save PNG".
- Run "3D model: Copy view image" or "3D model: Save view as PNG" from the palette.
- Paste the image elsewhere, or find `bracket-front-20261010-1432.png` in Downloads (web) or
  wherever the Save dialog put it (desktop).

## Entry points

| Way in                           | Way out                                      | Where the state shows       |
| -------------------------------- | -------------------------------------------- | --------------------------- |
| Capture menu, "Copy image" group | Nothing to undo; the clipboard is the user's | "Image copied." message     |
| Capture menu, "Save PNG" group   | Cancel the desktop Save dialog               | "Download started." message |
| Saved view row menu              | Same                                         | Same                        |
| Review sheet row menu            | Same                                         | Same                        |
| Palette, two entries             | Same                                         | Same                        |

While any capture runs, every capture action is disabled, as today ("Capturing" on the button,
`WorkspaceTools.tsx:315`, `ModelPanel.tsx:538`).

## States

- Loading: actions disabled until the model has loaded, as the existing capture is
  (`ModelPanel.tsx:630-633`).
- Empty: no saved views means no row menus; the Capture menu items still work.
- Error: the existing capture notice (`ModelPanel.tsx:961-971`) shows with an action-specific
  title: "Image could not be copied" or "PNG could not be saved". Copy failures reuse upstream's
  wording where it applies: "Image copying is unavailable. Use a secure browser connection or
  save the image." (`apps/web/src/components/media/MediaActions.tsx:103-105`).
- Disabled: "Copy image" items are disabled when the page is not a secure context or the browser
  lacks image clipboard support. Save is never disabled for that reason.
- Stale: a saved view from an earlier revision refits before capture, as review sheets already do
  (`captureSheet.ts:40`).

## Surfaces and connection modes

| Mode                                         | Copy image                              | Save PNG             |
| -------------------------------------------- | --------------------------------------- | -------------------- |
| Desktop app                                  | Works (app scheme is registered secure) | Electron Save dialog |
| Web on `localhost`                           | Works                                   | Browser download     |
| Web over HTTPS (T3 Connect, Tailscale serve) | Works                                   | Browser download     |
| Web over plain HTTP on a LAN or tailnet IP   | Disabled, not a secure context          | Browser download     |

Mobile has no 3D panel.

## Decisions

- Same render code as attach: one capture path, so exports match what agents see.
- Exports are not compressed. Attach compresses to the provider limit; a saved file should be the
  full image.
- File names use local time to the minute and the model's base name without extension, so files
  sort by model and then time.
- No IPC for desktop: upstream already copies images with `navigator.clipboard.write` on desktop
  (`MediaActions.tsx:100-111`), and the main window keeps Electron's default download behaviour.
- Saving into the project is out: it would be a server write with its own conflicts, and the
  agent-facing path already returns PNGs.

## Decisions needed from Kyle

1. Palette entries. Recommendation: add "3D model: Copy view image" and "3D model: Save view as
   PNG" for the current view only; they cost two lines each and match the existing capture
   entries (`palette.tsx:54-62`). Skip four-view and sheet variants to keep the palette short.
   Building to the recommendation is safe.
