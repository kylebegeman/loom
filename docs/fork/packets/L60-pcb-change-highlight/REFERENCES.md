# L60 references

## Prior art in this repository

- [L42 `model-change-ghost`](../L42-model-change-ghost/): the 3D counterpart. The one previous
  version model, the chip wording, the `D` key and the no-timer rule come from it.
- Compare tab: `apps/web/src/fork/pcb-preview/RevisionCompare.tsx` (change list icons and tones
  at `:37-41`) and the server diff `compareInspections`,
  `apps/server/src/fork/pcb-preview/semantics.ts:443-459`. This packet extends that diff rather
  than adding a second one.
- Overlay markers in millimetres: `apps/web/src/fork/pcb-preview/Overlays.tsx`.
- Blob SVG to canvas: capture in `apps/web/src/fork/pcb-preview/SvgViewport.tsx:251-298` draws
  the drawing's SVG through a blob URL onto a canvas and reads it back with `toBlob`, which is
  the same path `drawingRegions` uses.

## File format facts

- **KiCad board tracks.** In the board file, a track segment is a `segment` token with `start`,
  `end`, `width`, `layer` and `net`; a track arc is `arc` with `start`, `mid`, `end`, `width`,
  `layer` and `net`; a via is `via` with `at`, `size`, `drill`, `layers` and `net`. Zones and
  graphic items (`zone`, `gr_line`, `gr_text`) are separate sections. Verified:
  <https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/>. This is why a geometry diff would
  need several token kinds plus a separate tscircuit parser (TECHNICAL.md, Alternatives).
- **Inspection data has no trace geometry.** `PcbInspection`,
  `packages/contracts/src/fork/pcb-workspace.ts:35-54`, read from source.

## Browser facts

- **Canvas tainting.** Drawing image data "loaded from another origin without CORS approval"
  taints a canvas, and then `getImageData()`, `toBlob()` and `toDataURL()` throw a
  `SecurityError`. Verified: MDN, "Allowing cross-origin use of images and canvas",
  <https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image>.
- **Blob URL origin.** A blob URL's origin is "always the same as that of the environment that
  created the URL, as long as the URL hasn't been revoked yet". Verified: W3C File API,
  "Origin of blob URLs", <https://w3c.github.io/FileAPI/#originOfBlobURL>. So the drawing's
  blob SVGs are same-origin; revoke only after `drawImage` and `getImageData`.
- Not verified: whether every browser engine treats an SVG image containing `foreignObject` as
  tainting even from a same-origin blob. The KiCad and tscircuit SVGs the server returns do not
  use `foreignObject`; `drawingRegions` still catches the `SecurityError` and reports
  `unavailable`.

## Libraries

None new. Licences unchanged.
