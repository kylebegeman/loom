# L63 technical

## Overview

Client-only changes in `apps/web/src/fork/pcb-preview/`: a pure message helper and one
persistent live region (L43's pattern), accessible names and roles, a handful of focus moves,
and a reduced-motion rule. No contract, server, storage or agent change.

## Contracts

None.

## Server

None.

## Storage

None.

## Clients

### Announcer: `apps/web/src/fork/pcb-preview/announce.ts` (new, pure)

```ts
import type { PcbCheckKind, PcbCheckResult, PcbComponent } from "@t3tools/contracts/fork";
export type PcbAnnounceInput = {
  place: string; // "Board, Front copper", "Schematic, sheet 2 of 3, Power", "3D board"
  selection: string | null; // from describeSelection
  tool: string | null; // tool hint text, null for select
  checking: PcbCheckKind | null;
  checks: Partial<Record<PcbCheckKind, Pick<PcbCheckResult, "ranAt" | "outcome" | "counts">>>;
  building: boolean; // 2D render running with no current drawing for this surface
  shown: { surface: string; sheet: string; sourceHash: string } | null; // drawing on screen
  three: "loading" | "ready" | null;
  notice: string | null; // info notices only
  step: { id: number; text: string } | null; // finding step or "Go to"
};
export function describeSelection(
  components: readonly PcbComponent[],
  selected: string | null,
  pin: string | null,
  net: string | null,
): string | null;
export function announcement(
  previous: PcbAnnounceInput | null,
  next: PcbAnnounceInput,
): string | null;
```

`describeSelection` returns "U3, ATmega328P" (reference and value), "U3 pin 5, PB2, net SCK"
(reference, pin number, pin name, net; parts left out when empty), "Net GND", or `null`.
A component the inspection does not know yet reads as its reference alone.

`announcement` returns `null` when `previous` is `null` (panel just opened), otherwise the one
message for the most important change:

1. `step` has a new `id`: its text.
2. `selection` changed: the new text, or "Selection cleared" when it became `null`.
3. `place` changed: the new text.
4. `tool` changed: the new hint, or "Select" when it became `null`.
5. `checking` became a kind: "Running ERC" or "Running DRC". `checking` went from a kind to
   `null` and that kind's `ranAt` changed: "DRC clean", "DRC: 3 errors, 5 warnings" (counts
   that are zero are left out), or "DRC could not run" for `failed` and `timed-out`. A changed
   result without a watched run (initial load, an agent's run) is not announced.
6. `three` became `loading`: "Loading 3D board"; became `ready`: "3D board ready".
   `building` became true: "Building board" or "Building schematic". `shown` changed: same
   surface and sheet with a new `sourceHash` is "Board updated"; otherwise, after `building`,
   "Board ready". A surface or sheet change is already covered by `place`.
7. `notice` became a new non-null text: that text.

Messages end without a period except where the text has two sentences, so the screen reader's
own pause is not doubled. Counts use plain numbers; there are no coordinates, so L54's unit
formatter is not involved.

### Live region in `PcbPreviewPanel.tsx`

`DesignWorkspace` (98) builds `PcbAnnounceInput` each render from values it already has:
`place` from `surface`, `sheets`, `sheetIndex`, `layers`, `customLayers` and `PRESET_LABELS`
(91-95; the status bar text at 1333-1343 is the same logic, so extract one `placeText` helper
and use it for both); `selection` from `workbench.inspection?.components`; `tool` from the hint
text at 714-728 (extract it to a `toolHint(mode, points)` helper used by both); `checking` and
`checks` from `preview`; `building` as `!three && preview.rendering && !drawingCurrent`;
`shown` from `preview.display` when `drawingCurrent`; `three` from Board3D (below); `notice`
when `notice?.tone === "info"`; `step` from local state.

An effect keeps the previous input in a ref, calls `announcement`, and on a message sets
`message` state to `{ id: next id, text }`. The region renders once, as the workspace's first
child, so it never unmounts while the panel is open:

```tsx
<div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {message && <span key={message.id}>{message.text}</span>}
</div>
```

The keyed child is replaced for every message, so the same text twice is still announced.
No timers.

Remove `role="status"` from the tool hint (715) and from the info notice (837, keep
`role="alert"` for errors). Add an optional `silent` prop to `OperationStatus`
(`OperationStatus.tsx:22`) that omits `role="status"`, and pass it for "Building schematic" and
"Building board" (764-773) and ChecksView's run status (`ChecksView.tsx:194`), which the
announcer now covers. Other operation cards keep their role.

Pin selection needs its own state: add `pin: string | null` beside `selected` and `net`
(135-136). `selectPin` (220-235) sets it after `selectComponent`; `selectComponent` (205-219)
and the inspector's and editor's net choices (`onNet` at 1266, `case "net"` at 487-491) clear it.

### Finding steps

- With L52: wherever L52's `.` and `,` handler moves to a finding, set
  `step = { id, text: "Finding {i} of {n}. {Severity}, {SOURCE}: {message}" }` with the sheet
  label appended when the finding has one and it differs from the current sheet ("On sheet
  Power."). L63 adds that one line to L52's handler. If L52 landed after L63, L52 adds it.
- Without L52: `ChecksView`'s "Go to" button (`ChecksView.tsx:361-368`) passes its item
  description as a fourth `onLocate` argument; the panel's `onLocate` (1231-1233) sets
  `step = { id, text: "Showing {description}" }` after `focusPoint`.

Both are user steps, so they win over the selection or place change they cause.

### Names and roles

- Workspace root (1035-1040): add `role="region"` and
  `aria-label={`PCB workspace, ${design.name}`}`. A `div` with only `aria-label` and no role
  is not reliably exposed.
- `<main className={styles.canvas} aria-label="Drawing">` (1099) becomes `<section>` with the
  same label. Upstream's `SidebarInset` already renders `main`
  (`apps/web/src/components/ui/sidebar.tsx:566`), so the panel adds a second main landmark.
- `SvgViewport` (328-336): `label` becomes the accessible name. The panel passes
  `` `${design.name}, ${placeText}` `` instead of the sheet label (962), and `LinkedDrawing`
  (1439) passes `` `${design.name}, linked ${…}` ``. Change `role="group"` to
  `role="application"` with `aria-roledescription="drawing"`, move the instructions into an
  `sr-only` span referenced by `aria-describedby` ("Drag or use the arrow keys to pan, Shift for
  larger steps. Scroll or plus and minus to zoom. F fits the drawing."), and give the base image
  (411) and `LayerSheet` images (`LayerSheet.tsx:47`) `alt=""`: today each layer is read as its
  file name, for example `board-F_Cu.svg`.
- Board3D: add a `name` prop (the panel passes `` `${design.name}, 3D board` ``) and call
  `created.describe(name, descriptionId)` after `createViewer` (`Board3D.tsx:89`), with an
  `sr-only` span: "Drag to orbit, right or middle drag to pan, scroll to zoom. The 3D navigation
  toolbar fits the board and chooses a view." Today the canvas says "3D model" with no design
  (`createViewer.ts:71-74`).
- If L43 has not landed, add `describe(name: string, descriptionId: string)` to
  `createViewer.ts` exactly as L43 specifies (sets `aria-label` and `aria-describedby` on the
  canvas). Leave the creation-time label, role and roledescription for L43, so the 3D model
  panel is unchanged until L43 updates its own caller.
- Board3D reports `onStatus("loading" | "ready" | null)` from its existing `loading` and `ready`
  values (`Board3D.tsx:117-119`) in an effect; the panel stores it as `three` in the announcer
  input.
- `InspectorRail` (`Inspector.tsx:151-167`): when a badge shows, the button label becomes
  `` `${title}, ${count} ${count === 1 ? "issue" : "issues"}` ``; the hint stays the title. The
  badge stays `aria-hidden`.
- Status bar check chips (1362-1377): add an `aria-label` such as "DRC: 3 issues, out of date"
  or "ERC clean"; today they read "DRC 3" or "DRC !".

### Focus

DOM order already matches the visual order in both layouts (document bar 1070, canvas 1099,
inspector 1211, rail 1312, status bar 1320; the compact layout moves the rail below without
reordering), so no elements move.

- Opening with `I`: `toggleTools` (700) records `document.activeElement` in a `returnFocus` ref
  and, after the inspector renders, focuses the inspector `section` (`Inspector.tsx:190`, add
  `tabIndex={-1}` and a ref). A rail click does not move focus; the button keeps it, and the
  panel is one Shift+Tab away.
- Closing (`I`, `Escape` at 1056, "Close tools", the rail): if focus is inside the inspector or
  on `document.body`, focus `returnFocus` when it is still connected, else the drawing, else
  the workspace root (`tabIndex={-1}` already, 1039).
- Remounts: `SvgViewport` is re-keyed per view, layers and sheet (960) and 2D unmounts for 3D
  (1176). Track a `drawingFocused` ref from `onFocus` and `onBlur` on the drawing section,
  set when the target carries `data-pcb-drawing` (add it to the viewport container and the 3D
  canvas) and cleared only when `relatedTarget` is a real element (removal blurs with
  `relatedTarget` null). Pass `restoreFocus={drawingFocused.current}` to `SvgViewport` and
  `Board3D`; on mount, if it is true and `document.activeElement` is `document.body` or `null`,
  they focus their element with `preventScroll`. This was found by reading the code and has not
  been reproduced in a browser.
- Visible focus: the drawing already has an inset ring (`workspace.module.css:562-565`). Add the
  same for the 3D canvas, as the model panel does (`model-preview-3d/workspace.module.css:94-97`):

  ```css
  .threeHost canvas:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -3px;
  }
  ```

  It is inset on all four sides, which the fork's no-outset rule allows.

### Reduced motion

Pans and zooms are instant: keyboard steps set the transform directly (`SvgViewport.tsx:
384-396`) and `paint` writes it once in a single frame (116-124). The only PCB transitions are
in `inspector.module.css` (172, 557: chevron rotation, 120 ms; 698: reveal opacity, 100 ms).
Add:

```css
@media (prefers-reduced-motion: reduce) {
  .groupChevron,
  .disclosure > summary::before,
  .revealTool {
    transition: none;
  }
}
```

(Use the real selectors at those lines.) Rule for later packets: an animated pan, for example
easing to a finding, must jump when `matchMedia("(prefers-reduced-motion: reduce)").matches`.

### Help and docs

No `SHORTCUTS` change (`WorkspaceChrome.tsx:252-261`); L52 adds its keys there. Add one
sentence to `docs/fork/user/pcb-preview.md`: the panel works with screen readers, announces
selections, views and check results, and `I` moves focus into the tools.

## Agent-facing tools

None. Agents already read selection, view, layers, checks and loading through the editor
`snapshot` action (`PcbPreviewPanel.tsx:548-568`). Announcements are for people.

## Performance

The announcer is a pure comparison in one effect over values the panel already computes, and
writes one text node only when a message results. Nothing runs per frame, per pointer move or
per zoom step. Focus fixes run on open, close and mount only.

## Alternatives considered

- A shared `apps/web/src/fork/shared/announce` module for both panels: upstream has no live
  region helper (L43, Alternatives), the region is five lines, and the message logic differs.
  Revisit if a third panel needs it.
- Keeping `role="status"` on conditionally mounted cards: screen readers often miss regions
  that are inserted with their content.
- Announcing every rebuild start: noisy while an agent edits; the result is what matters.
- Reordering the DOM so the rail precedes the inspector: the rail sits on the inspector's right
  edge, so the current order already matches what the user sees.
- `role="group"` on the drawing: in NVDA and JAWS browse mode, arrow keys would move the reading
  cursor instead of panning.
