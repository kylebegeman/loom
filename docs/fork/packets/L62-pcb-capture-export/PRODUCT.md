# L62 product

## Problem

Every PCB capture goes into the composer draft (`PcbPreviewPanel.tsx:320-361`). To put a
schematic in a design note, a board view in an issue, or a pinout picture in a chat, Kyle has to
take a screen shot and crop it. The drawing is already vector SVG in the client, so a sharp,
scalable file is one click away, but there is no way to get it out.

## What the user can do

- Open the Capture menu and choose "Copy image", "Save PNG" or "Save SVG" for "Visible area" or
  "Whole drawing".
- In 3D, open the Capture menu and choose "Copy image" or "Save PNG" for the 3D view.
- Choose "PNG size" 1x (as on screen) or 2x in the same menu. The choice is remembered on this
  device.
- Paste a copied image anywhere that takes images.
- Open a saved SVG in a browser, Inkscape, Figma or a document editor at true millimetre scale,
  with the layers that were visible, at their opacity, and with pinned measurements and notes.
- Ask an agent for an SVG or a 2x PNG of the drawing; it gets a file path on the host.

## Entry points

| Way in                                                                                     | Way out or undo                                             | How to see it                                                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Capture menu, "Copy image" group                                                           | Nothing to undo; the clipboard is the user's                | "Image copied." notice                                                |
| Capture menu, "Save PNG" and "Save SVG" groups                                             | The file is the user's; delete it as any download           | "Download started." notice, browser downloads, or desktop Save dialog |
| Capture menu, "PNG size"                                                                   | Pick the other size                                         | Checked radio item                                                    |
| Editor command `capture` with `format` or `scale` (MCP `loom_pcb_editor`, `t3 pcb editor`) | Captures are pruned with the existing 50-file, 50 MiB limit | Host path in the tool result                                          |

The main "Capture" button keeps attaching the visible area to the draft. While any capture runs,
every capture action is disabled and the button reads "Capturing", as today.

## States

- Loading: actions are disabled until the current drawing and its visible layers have loaded, as
  the existing capture is (`PcbPreviewPanel.tsx:1078`, `SvgViewport.tsx:252-255`). In 3D, actions
  report "Wait for the 3D board to load." until it has.
- Empty: with no drawing (blocked or never built), the menu is disabled, as today.
- Error: the panel notice shows the reason with an action title: "Image could not be copied",
  "PNG could not be saved" or "SVG could not be saved". Copy failures reuse upstream's message.
  An SVG over 32 MiB fails with "This drawing is too large to save as SVG. Save a PNG instead."
- Disabled: "Copy image" items are disabled when the page is not a secure context or the browser
  lacks image clipboard support. Save is never disabled for that reason. "Save SVG" is not shown
  in 3D.
- Reduced size: a PNG larger than 16,777,216 pixels or 8,192 pixels on a side is scaled down to
  fit, and the success notice says "Saved at W × H pixels, the largest size Loom exports."
- Stale: export uses the drawing on screen. While a newer revision builds, actions are disabled
  (`drawingCurrent`, `PcbPreviewPanel.tsx:181-187`), so a file never mixes revisions.

## Surfaces and connection modes

| Mode                                         | Copy image                              | Save PNG and SVG     |
| -------------------------------------------- | --------------------------------------- | -------------------- |
| Desktop app                                  | Works (app scheme is registered secure) | Electron Save dialog |
| Web on `localhost`                           | Works                                   | Browser download     |
| Web over HTTPS (T3 Connect, Tailscale serve) | Works                                   | Browser download     |
| Web over plain HTTP on a LAN or tailnet IP   | Disabled, not a secure context          | Browser download     |

Safari draws the dark-theme schematic PNG on the light canvas colour instead of inverting it,
because Safari's canvas ignores CSS filters. Mobile has no PCB panel. Against an upstream T3
server the PCB panel does not exist.

## Decisions

- Reuse L44's helper for clipboard, download and file names: one behaviour across panels.
- PNG matches the screen, theme included: it is a picture of what the user is looking at.
- 1x means CSS pixels at the current zoom; 2x doubles them. "Whole drawing" renders the whole
  drawing at the current zoom, so zooming in before saving gives more detail.
- Default PNG size 2x: sharp on high-density screens and in documents.
- SVG layers are nested vector groups, not embedded images, so editors can change them.
- Ids and `<style>` rules are scoped per layer and scripts, `foreignObject` and event attributes
  are removed, so the file stands alone and cannot run code when opened.
- Cap SVG exports at 32 MiB: each sheet is already capped at 4 MiB (`cache.ts:4`), and a bigger
  file is unlikely to open usefully in an editor.
- Multi-sheet schematics add the sheet label to the surface part of the name
  (`power-schematic-usb-20261010-1432.svg`), so sheets saved in the same minute do not collide.
- Attach keeps its current size and compression, which suit the provider; exports are full size.
- No palette entries: the PCB palette has only its toggle, and the Capture menu is one click away.
- Agents get files, not clipboards: the editor command runs outside a user gesture.

## Decisions needed from Kyle

1. SVG colours. Options: (a) KiCad's original colours on the light canvas colour `#f1f3f5`,
   whatever the theme; (b) match the screen, baking the dark-theme schematic inversion into an
   SVG filter and using the dark canvas colour. Recommendation: (a). An SVG is usually going into
   a document or editor, where the tool's own colours print well and stay editable; a baked
   filter changes every colour an editor shows. PNG already covers "exactly what I see". The
   implementation is ready for (b) if Kyle prefers it (TECHNICAL.md, "Theme").
