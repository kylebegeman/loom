# L44 implementation

Branch from `main`. Commits use `feat(fork-model-capture-export): ...`. Each step compiles and
its tests pass.

1. **Helpers.** Add `captureExport.ts` (`ExportAction`, `captureFileName`, `canCopyImages`,
   `copyImage`, `saveImage`) and `captureExport.test.ts`.
2. **Split rendering.** In `useModelEditing.ts`, extract `renderViews` from `captureViews`
   without changing attach behaviour, then add `exportViews`. Run
   `useModelEditing.test.tsx` to confirm attach is unchanged.
3. **Panel and menu.** In `ModelPanel.tsx` add `exportCapture`, change `captureError` to
   `{ title, message }`, and pass `canCopy`, `onCopy`, `onSave` to `CaptureMenu`. In
   `WorkspaceTools.tsx` add the "Copy image" and "Save PNG" groups.
4. **Views tab.** Add `onExport` and `canCopy` props to `ViewsSection.tsx` and the two items to
   both row menus.
5. **Palette.** Extend `ModelAction` in `actions.ts`, add the two entries in `palette.tsx`, and
   handle them in the `onModelAction` effect.
6. **Docs.** In `docs/fork/user/model-preview-3d.md`, in the "Show the agent your part" section,
   add: "To use a capture elsewhere, choose Copy image or Save PNG in the Capture menu or in a
   view's menu. Copying images needs the desktop app, localhost or an HTTPS connection."

## Done when

- Each of the six actions (copy and save for current view, four-view sheet; saved view; review
  sheet) produces the right image, on web and desktop.
- Saved files are named like `bracket-front-20261010-1432.png`.
- Over plain HTTP on a LAN address, "Copy image" items are disabled and save works.
- Copy works in Safari from the menus (user activation kept).
- Errors show in the capture notice with the right title; success shows "Image copied." or
  "Download started."
- Attaching to the composer behaves exactly as before.
