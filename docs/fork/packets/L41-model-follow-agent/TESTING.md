# L41 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                                | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/model-preview-3d/scadIncludes.test.ts` (new, shared with L49) | `include <a.scad>` and `use <lib/b.scad>` are found; commented-out includes in `//` and `/* */` are ignored; `import("part.stl")`, `import(file="x.3mf")` and `surface("map.png")` are found; `import(name)` with a variable is skipped; a `//` inside a string is not a comment; resolution is relative to the including file's directory; Windows-style backslashes are kept as written.                                                                                                                                                                                                  |
| `apps/server/src/fork/model-preview-3d/turnModels.test.ts` (new)                    | Pure mapping: the repository prefix is stripped and files outside it are dropped; previewable formats are "written", STEP is not; a changed `gear.scad` marks `bracket.scad` that includes it as "dependency" with `via: "gear.scad"`; transitive includes (a includes b includes c, c changed) mark both; a SCAD that is itself written is not repeated as a dependency; ordering is written first, then dependencies by path; the cap of 50 sets `truncated`; include cycles terminate.                                                                                                   |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update)        | `turnModels` with a fake projection store and a temp Git repo whose workspace is a subdirectory: picks the run's ready checkpoint, ignores baselines (`runId` null) and stale checkpoints, returns no models for a non-Git workspace, drops a model deleted after the turn, and with `runId: null` returns the newest turn that changed a model. `turnModelEvents` with a `Stream.make` of domain events (the pattern in `apps/server/src/fork/code-graph/reactor.test.ts:38-41`): emits for this thread's checkpoint with a model, skips other threads, empty `files` and code-only turns. |
| `packages/contracts/src/fork/model-preview-3d.test.ts` (new)                        | A stored settings record without `agentModels` decodes with `"offer"`; an unknown mode fails to decode. If L41 adds `modelFormatOf`: `part.STL` is `"stl"`, `a.stp` is `"step"`, `notes.txt` and `Makefile` are null.                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/rpcAuthorization.test.ts` (existing exhaustive check)         | Fails if a method lacks a scope row; no new test, it must keep passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/src/fork/model-preview-3d/agentModels.test.ts` (new)                      | `mayAffectModels` (true for `.stl`, `.scad`, `.svg`; false for `.ts`); `modelSurface` id and basename title; the background helper adds surfaces without changing `activeSurfaceId`, does nothing when the panel is closed, skips surfaces already present, and leaves `userActionRevisionByThreadKey` unchanged; dismissal storage caps at 200 and survives a malformed stored value.                                                                                                                                                                                                      |

No component markup tests. The chip and host are thin over tested helpers.

## Commands

```sh
vp test run apps/server/src/fork/model-preview-3d/scadIncludes.test.ts \
  apps/server/src/fork/model-preview-3d/turnModels.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  packages/contracts/src/fork/model-preview-3d.test.ts \
  apps/web/src/fork/model-preview-3d/agentModels.test.ts
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/model-preview-3d apps/web/src/fork/model-preview-3d \
  apps/web/src/fork/panels apps/web/src/components/chat/ChangedFilesTree.tsx
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`, in a Git workspace:

1. Ask the agent to write `bracket.scad`. The turn's changed files card shows
   "Open bracket.scad"; click it and the panel opens on the file with its name as the tab title.
2. Ask for three STL exports. The card shows "Open 3 models" and opens three tabs, the first
   active.
3. With `bracket.scad` open, ask the agent to edit only `gear.scad`, which `bracket.scad`
   includes. The tab shows a dot with "Changed by the agent in turn N"; switching to it clears
   the dot. The card offers "Open bracket.scad".
4. Keep the panel on a model and ask for a new model. A background tab appears; the active tab
   does not change.
5. Dismiss a chip, reload, and confirm it stays hidden while other turns keep theirs.
6. Set "Open automatically", close the panel and ask for a model: the panel opens on it. Set
   "Do nothing": no chip, tab or dot.
7. Palette "3D model: Open models from the last turn" and the picker section both open the last
   turn's models; in a thread with no model turns the palette shows the empty message.
8. Ask the agent to open a model with `loom_model_preview_3d_editor`; the tab shows the file
   name.
9. Narrow the chat column: the chip shows only its icon, like "Open diff".
10. Repeat 1 over a Tailscale or T3 Connect connection; light and dark themes.

Upstream server: no chip, no setting, no errors in the console.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge preview in SEAMS.md. Expect a clean merge or a
conflict only on the two marked lines in `ChangedFilesTree.tsx`. After merge to `main`, Kyle
runs `scripts/fork/loom.sh integrate nightly --dry-run`.
