# L63 references

## Old Loom

No matching selection in [selections.md](../../selections.md); this is a 2026-10-10 follow-up
to L24.

## Prior art in the repo

- L43's announcer and canvas naming for the 3D panel:
  [L43 TECHNICAL.md](../L43-model-viewport-access/TECHNICAL.md). L63 copies the pure
  `announcement(previous, next)` shape and the persistent region markup.
- Upstream renders its own `sr-only` status elements per feature and has no shared live-region
  helper (`apps/web/src/components/settings/ThemeSearchSection.tsx:337`, cited by L43), and an
  instructions span for a keyboard widget (`apps/web/src/components/ui/color-picker.tsx:128`).
- Upstream's `SidebarInset` renders `main` (`apps/web/src/components/ui/sidebar.tsx:566`); the
  PCB panel adds another (`apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx:1099`).
- PCB code read for this packet: `PcbPreviewPanel.tsx` (selection 205-235, capture 320-361,
  status cards 705-849, key handler 1041-1068, inspector and rail 1211-1318, status bar
  1320-1386), `SvgViewport.tsx` (keyboard 378-401, role and name 328-336), `Board3D.tsx`,
  `Inspector.tsx` (rail 130-173, frame 175-215), `ChecksView.tsx` (run status 194, locate
  361-368), `OperationStatus.tsx`, `LayerSheet.tsx`, `workspace.module.css` and
  `inspector.module.css`.
- The 3D model panel's inset focus ring: `apps/web/src/fork/model-preview-3d/workspace.module.css:
94-97`.

## Facts

- Live regions: content changes inside an existing `aria-live` region are announced; a region
  inserted together with its content often is not. `role="status"` implies `aria-live="polite"`
  and `aria-atomic="true"`. Verified (via L43):
  [MDN, ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions),
  [WAI-ARIA 1.2, status](https://www.w3.org/TR/wai-aria-1.2/#status).
- `role="application"` tells assistive technology to pass keys to the widget, and
  `aria-roledescription` gives it a human name. Verified:
  [WAI-ARIA 1.2, application](https://www.w3.org/TR/wai-aria-1.2/#application),
  [WAI-ARIA 1.2, aria-roledescription](https://www.w3.org/TR/wai-aria-1.2/#aria-roledescription).
- A page should have one `main` landmark unless others are hidden. Verified:
  [WAI-ARIA 1.2, main](https://www.w3.org/TR/wai-aria-1.2/#main).
- Screen readers announce an inserted `role="alert"` element reliably, which is why failures
  keep their alerts. This matches common practice and MDN's alert guidance
  ([MDN, alert role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role));
  behaviour per screen reader was not tested in this pass.
- `prefers-reduced-motion`: [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).
- Not verified in a browser: that focus falls to `document.body` when the focused viewport is
  re-keyed or the inspector closes, and that a removed element blurs with a `null`
  `relatedTarget`. The design works whether or not the blur fires.

## Licences

No third-party code or assets. No dependency added.
