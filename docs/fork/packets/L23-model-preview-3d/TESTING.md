# L23 verification

Local completion and final audit: 2026-10-07, branch `feat/loom-model-preview-3d`, based on
`841d91c11d`. The full original scope, workspace redesign and five selected editing additions
are implemented. This record describes local checks, not a merged or released build.

## Automated evidence

The final closeout ran **46 server tests in 11 files**, including both real OpenSCAD integration
cases against the official macOS **2026.10.05** snapshot. Three new regressions prove coherent
parameter/source snapshots and rejection of outputs when the source, saved sets or known
included files change during rendering. The rejected jobs neither publish cache artifacts nor
replace remembered parameters. These cases failed before the fixes and passed afterward.

The preceding integrated audit passed **189 focused web/integration tests**, with **one Node
DOMParser-dependent 3MF loader skip**. No frontend or contract code changed during closeout;
that coverage remains applicable. The real client loaded the skipped inch-unit fixture at
**25.40 × 25.40 × 25.40 mm**. The earlier audit also passed web, server, contracts and
client-runtime typechecks, feature lint/formatting and the web production build. The viewer
remains lazy-loaded. Existing upstream chunk-size warnings remain.

Closeout reruns the changed server package's typecheck, focused feature lint/format checks,
document links, seam-manifest validation and `git diff --check`. It does not run repository-wide
checks, reinstall dependencies, change schema migrations or perform a merge.

Focused regression coverage includes:

- Signed-token expiry, tampering, traversal, symlink containment and large-file overrides;
  HTTP file delivery and remote origin resolution.
- Customizer literals/ranges/options, sidecar preservation, obsolete overrides/sets and
  worktree isolation with main-checkout-only legacy fallback.
- OpenSCAD argv/capability detection, actual STL/colored 3MF/PNG rendering, summaries, errors,
  cache reuse, dependency reload, interruption and removal of partial output.
- Cache protection under concurrent readers/pruning; bounded per-workspace subscriptions;
  atomic proposal batches and retaining shared review images until their final reference is removed.
- STL/OBJ/glTF/GLB parsing, 3MF units, rejected external glTF resources, abort propagation,
  mesh/line/point/texture/ImageBitmap disposal and unavailable WebGL.
- StrictMode initial fit, saved camera restoration, immediate capture restoration, frame
  coalescing, pointer-tool changes, parameter history/manual Apply and successful-render provenance.
- Literal/sweep validation, stale candidate rebasing, capture exclusion, source refresh ordering
  and settings/panel/palette/keybinding capability integrations.

## Integrated client evidence

The T3 desktop Browser panel exercised the isolated web client with real workspace fixtures.
All five mesh formats and SCAD loaded. Included-file edits refreshed automatically, syntax
errors retained a stale last-good mesh, and parameters/sets persisted without losing other sets.
The initial pass sent a captured image and verified the agent could inspect it; subsequent
audit checks prepared drafts without sending another provider turn.

Current/four/named-view captures, draft persistence, shared MCP render images, build-volume
warnings, file-size overrides, STEP handling, settings, palette and scoped canvas keys worked.
Normal and maximized layouts, dark/light themes and a 480 px expanded inspector were checked;
the narrow inspector had no horizontal overflow.

Selected editing workflows covered undo/redo/manual Apply, a surface measurement and section,
named views/presets, persisted annotations and applied parameters, prepared requests,
reference/current review, reselect, accept and reopen. Variant batches rendered thumbnails,
cancelled immediately, compared linked views with a **30 mm width delta**, promoted candidates,
saved named sets and identified replacements. Invalid drafts stayed editable and valid
multi-field candidate edits persisted together.

Loading checks deliberately delayed encoding and downloads to expose elapsed status, stages,
completed counts, duplicate-action exclusion, comparison loading and progress while switching
inspector tabs. Test delays and prototype overrides were removed, fixtures restored and test
attachments removed.

With page and canvas visibility confirmed, canvas-specific instrumentation recorded **zero
draws over 57.08 idle seconds**. Positive controls produced one zoom draw and two capture draws.
Closing model tabs released their canvases and WebGL context; server tests cover watcher cleanup.
All instrumentation was restored.

## Verification limits and integration status

The final closeout could not repeat browser automation: T3 reported no connected automation
host after reopening the preview. Earlier integrated evidence above remains the UI verification;
closeout changes are confined to server behavior and documentation. The isolated worktree dev
server was restored and retained for inspection.

No physical second-device Tailscale/relay/tunnel session or OS-wide GPU measurement was performed.
Remote URL/HTTP behavior and idle canvas work are tested; these results do not imply those
additional measurements. Linux/Windows OpenSCAD execution was not exercised. Mobile has no 3D UI.

The earlier merge preview is recorded in [SEAMS.md](./SEAMS.md). A clean-main integration
rehearsal is pending a separately authorized merge. No commit, PR, push, merge or release was
performed. Print readiness and slicing remain deferred product exploration, not incomplete L23 work.

## Focused commands

Run tests from their owning package to avoid nested worktree discovery:

```sh
# apps/server; use an existing executable, tests never download one.
LOOM_TEST_OPENSCAD=/path/to/OpenSCAD pnpm exec vp test run src/fork/model-preview-3d src/fork/ForkRuntime.test.ts
pnpm exec tsc --noEmit

# apps/web; run when changing the frontend.
pnpm exec vp test run src/fork/model-preview-3d src/fork/panels/registry.test.ts src/fork/commandPalette/registry.test.ts
pnpm exec tsc --noEmit

# Repository root; keep lint and formatting scoped to the feature.
pnpm exec vp lint apps/server/src/fork/model-preview-3d apps/web/src/fork/model-preview-3d packages/contracts/src/fork/model-preview-3d.ts packages/contracts/src/fork/model-workspace.ts packages/client-runtime/src/fork/model-preview-3d.ts
pnpm exec vp fmt --check apps/server/src/fork/model-preview-3d apps/web/src/fork/model-preview-3d docs/fork/packets/L23-model-preview-3d docs/fork/user/model-preview-3d.md
git diff --check
```

For future user-visible changes, reuse the task's isolated server and `test-t3-app` Browser
workflow. Verify affected loading/error/recovery states and responsive interactions. Do not
redirect a server at live user data or treat a fake process test as CLI compatibility proof.
