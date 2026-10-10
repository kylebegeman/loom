# L43 references

## Prior art in the repo

- Upstream live regions: an always-mounted `sr-only` `role="status"` element
  (`apps/web/src/components/settings/ThemeSearchSection.tsx:337`), and
  `aria-live="polite" aria-atomic="true"` on changing text
  (`apps/web/src/components/chat/ExpandedImageDialog.tsx:245`). No shared helper exists.
- Upstream instructions for a keyboard-driven custom control: an `sr-only` span referenced by
  `aria-describedby` (`apps/web/src/components/ui/color-picker.tsx:128-131`).
- Upstream reduced motion: `useMediaQuery("(prefers-reduced-motion: reduce)")`
  (`apps/web/src/panelAnimations.ts:39`). Not needed here because nothing animates.
- Fork panel: `OperationStatus` is already `role="status" aria-live="polite"`
  (`apps/web/src/fork/model-preview-3d/OperationStatus.tsx:20`).

## Libraries and facts

- three 0.186.0 (MIT), already a dependency. OrbitControls exposes `rotateLeft(angle)`,
  `rotateUp(angle)` and `pan(deltaX, deltaY)` in pixels, each calling `update()`
  (`apps/web/node_modules/three/examples/jsm/controls/OrbitControls.js:636-695`). Its own
  keyboard handler pans on plain arrows and orbits on Ctrl, Cmd or Shift with arrows
  (`OrbitControls.js:1188-1271`). Verified in source.
- WAI-ARIA `application` role: "a structure containing one or more focusable elements requiring
  user input, such as keyboard or gesture events" that do not follow a standard widget pattern.
  [WAI-ARIA 1.2, application](https://www.w3.org/TR/wai-aria-1.2/#application). Verified.
- `aria-roledescription` gives a human-readable role name
  ([WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/#aria-roledescription)). Link not checked in
  this pass; the attribute is standard ARIA 1.1 and later.
- Live regions announce changes to content inside an element that already exists; regions
  inserted with their text are announced inconsistently. Source:
  [MDN, ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions).
  Verified: MDN says to "establish the live region before updating its content" and that
  `role="alert"` content is announced even when inserted with its text, which is why the panel's
  alerts stay as they are. Per-screen-reader behaviour is not verified.
- Slicers and CAD viewers (PrusaSlicer, Bambu Studio) offer keyboard view presets but, as far as
  we know, no arrow-key orbit or screen reader support (not verified).
