# L43 testing

Focused tests only, no sleeps, no repo-wide checks.

## Verification evidence (2026-10-10)

Implementation milestones: `6a6645e435` (viewport access).

Milestone `6a6645e435` passed 44 focused tests across four files for keyboard mappings,
announcements, viewer navigation and canvas lifecycle. The later integrated viewer run passed
40 tests, including its keyboard regression; see [L37's evidence](../L37-model-section-caps/TESTING.md).
These overlapping runs are not added together.

Contracts, client-runtime, web and server package typechecks passed.
Targeted lint passed for the checked files, including the ten root integration files. Browser, desktop, GPU, relay and real-model
performance checks were not run. No repository-wide checks were run.

## Automated tests

| File                                                               | Covers                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/viewer/keyboard.test.ts` (new) | Each arrow maps to orbit without Shift and pan with it, with OrbitControls' signs; opposite arrows cancel; non-arrow keys return `null`.                                                                                                                                                                                        |
| `apps/web/src/fork/model-preview-3d/announce.test.ts` (new)        | Load message with fits and with too large; no message when nothing changed; fit flip at the same revision; stale; tool hint and tool off; pan and orbit; standard view; success text; load outranks a simultaneous mode change; a keyboard camera move (no tracked input change) produces nothing; custom `formatSize` is used. |
| `viewer/createViewer.test.ts`                                      | `nudge` before a model loads is a no-op; `owns` is true only for the canvas; repeated nudges coalesce into one render and notify navigation.                                                                                                                                                                                    |

No markup snapshot tests for the region or attributes.

## Commands

```sh
vp test run apps/web/src/fork/model-preview-3d/viewer/keyboard.test.ts \
  apps/web/src/fork/model-preview-3d/announce.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts
vp lint apps/web/src/fork/model-preview-3d
vp run --filter @t3tools/web typecheck
```

## Manual check

Desktop and a browser against the dev server, with an STL that fits and one that does not:

1. Tab from the panel toolbar into the viewport: the ring appears. Click elsewhere and back.
2. Arrows orbit, Shift with arrows pans, in orbit and pan mode. The page never scrolls.
3. Focus the inspector's segmented control and a parameter scrubber: arrows change them, not
   the view.
4. VoiceOver on macOS (Cmd+F5): focus the viewport and hear its name and instructions. Load each
   STL, switch beds in the Bed menu, press `M`, `Escape`, `H`, `O`, `2`, and capture. Each gives
   one message; holding an arrow key gives none.
5. With "Reduce motion" on in macOS settings, nothing animates differently.

## Merge safety

No upstream files. Run the merge preview from CONVENTIONS.md against the newest nightly before
merging, and `scripts/fork/loom.sh check` after.
