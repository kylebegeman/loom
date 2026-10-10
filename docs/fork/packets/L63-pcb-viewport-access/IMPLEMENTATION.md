# L63 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Commit with the slug, for
example `feat(fork-pcb-viewport-access): announce PCB selection and check results`.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md, L43's folder,
L52's folder and this folder. Check whether L43 (`describe` in `createViewer.ts`) and L52 (the
`.` and `,` handler) have landed. Have VoiceOver (macOS) ready for the manual pass; NVDA on
Windows if available.

## Steps

1. Pure announcer. Add `apps/web/src/fork/pcb-preview/announce.ts` with `PcbAnnounceInput`,
   `describeSelection` and `announcement`, and `announce.test.ts`.
2. Helpers. In `PcbPreviewPanel.tsx`, extract `placeText` from the status bar (1333-1343) and
   `toolHint` from the tool hint (714-728), and use them where those texts are built today. No
   behaviour change.
3. Live region. Add `pin` state and its set and clear points, build the announcer input, the
   previous-input ref, the effect and the persistent region as the workspace's first child.
   Remove `role="status"` from the tool hint and the info notice. Add `silent` to
   `OperationStatus` and pass it for the build card and ChecksView's run card.
4. 3D status and name. If L43 has not landed, add `describe` to `createViewer.ts` per L43. Add
   `name`, `onStatus` and the description span to `Board3D.tsx`, and call `describe`.
5. Drawing name and role. In `SvgViewport.tsx`, switch to `role="application"` with
   `aria-roledescription="drawing"`, add the description span and `aria-describedby`, set image
   `alt=""` there and in `LayerSheet.tsx`. Pass the new labels from the panel and
   `LinkedDrawing`.
6. Landmarks and labels. Workspace root `role="region"` and label; `main` to `section`; rail
   labels with counts in `Inspector.tsx`; status bar chip labels.
7. Focus. `returnFocus` on open and close of the tools, inspector `tabIndex={-1}` and ref,
   `data-pcb-drawing`, the `drawingFocused` ref and `restoreFocus` in `SvgViewport` and
   `Board3D`. Add the 3D canvas focus ring.
8. Finding steps. Without L52: the `onLocate` label argument and the "Showing …" step. With L52:
   the one line in its step handler. Whichever packet lands second adds the other's line.
9. Reduced motion. Add the `prefers-reduced-motion` block to `inspector.module.css`.
10. Documentation. One sentence in `docs/fork/user/pcb-preview.md`. Set the packet's Status in
    the packet index tables if they carry one.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- With VoiceOver on desktop and in Safari, each announcement in PRODUCT.md is spoken once, and
  nothing is spoken when the panel first opens.
- Tab order follows the visual order; `I` moves focus into the tools and `I` or `Escape`
  returns it; focus stays on the drawing after `1`, `2`, `3`, a sheet change and a layer preset
  change, and the next shortcut works without clicking.
- The page has one `main` landmark with the PCB panel open.
- The 3D board shows a focus ring and is named after the design.
