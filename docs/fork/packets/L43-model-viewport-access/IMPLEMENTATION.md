# L43 implementation

Branch from `main`. Commits use `feat(fork-model-viewport-access): ...`. Each step compiles and
its tests pass.

1. **Nudge helper.** Add `viewer/keyboard.ts` (`ORBIT_STEP`, `PAN_STEP`, `Nudge`, `nudgeFor`)
   and `viewer/keyboard.test.ts`.
2. **Viewer methods.** In `viewer/createViewer.ts` add `nudge(n)`, `owns(target)` and
   `describe(name, descriptionId)`. Replace the fixed `aria-label` (lines 71-74) with
   `role="application"` and `aria-roledescription="3D viewport"`, keeping `tabIndex = 0`.
3. **Canvas label.** Add the `label` prop and the `sr-only` instructions span to
   `viewer/ViewerCanvas.tsx`; call `describe` once the viewer exists and when `label` changes.
   Pass the file name from `ModelPanel.tsx`.
4. **Arrow keys.** Add the arrow branch to the `ModelPanel.tsx` key handler, gated on `stats` and
   `viewer.current?.owns(event.target)`. Update `HELP` in `WorkspaceTools.tsx`.
5. **Announcer.** Add `announce.ts` (`AnnounceInput`, `announcement`) and `announce.test.ts`.
   In `ModelPanel.tsx`, build the input from existing state (`geometryRevision`, `stats`,
   `oversized`, `buildPlateLabel(settings.buildPlate)`, `displayedError && stats`, `hint`,
   `editing.picking`, `navigationMode`, `activeView`, `success`), keep the previous input in a
   ref, and render the persistent region. Remove `role="status"` from `ToolHint` and the success
   toast.
6. **Docs.** In `docs/fork/user/model-preview-3d.md`, extend the shortcuts paragraph: "With the
   viewport focused, arrow keys orbit and Shift with arrow keys pans." Add one sentence that
   screen readers hear the part's size, triangle count and bed fit after each load.

## Done when

- With the canvas focused, arrows orbit and Shift with arrows pans; `+`, `-`, `F` and `1` to `4`
  still work. With a segmented control, scrubber, menu or input focused, arrows behave as
  before.
- Arrow presses never scroll the page, and an idle viewport draws no frames.
- A screen reader (VoiceOver on macOS) reads "part.stl, 3D viewport" and the instructions on
  focus.
- After load, bed change, tool change, mode change, standard view and capture, VoiceOver speaks
  one short message each, and never during keyboard orbiting.
- The focus ring shows on keyboard focus in light and dark themes.
