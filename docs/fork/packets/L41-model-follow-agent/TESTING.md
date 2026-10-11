# L41 testing

## Results

Implementation branch: `feat/model-follow-ghost-snap`, 2026-10-10. Code milestone:
`b0742acf26` implements follow-agent opening, previous-version retention and snapping/holes,
with the coupled contracts, client integrations and L41 seam.

| Focused set                                                                                                                                                                         | Result                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `ModelPreviewService.test.ts`, `store.test.ts`, `workspace.test.ts`, `scadIncludes.test.ts`, `turnModels.test.ts`, contracts `model-preview-3d.test.ts`, `rpcAuthorization.test.ts` | 55 passed across 7 files. |
| `agentModels.test.ts`, `AgentModelsHost.test.tsx`                                                                                                                                   | 19 passed across 2 files. |

The passing regressions include preserving proactive diff eligibility during automatic
opening, separate explicit user choices, bounded/deduplicated tabs, mode and capability
gating, turn scoping, SCAD dependencies and text heightmaps, symlink handling and conditional
workspace-index refresh. Shared service and schema tests also cover the other two slices.

The integrated L41/L42/L38 batch passed **156 focused tests across 19 files**, counted once:
55 backend/schema/authorization tests, 19 follow-agent client tests, 58 shared snapping/viewer
and editing tests, and 24 ghost/canvas/inspector/loader/metadata regressions. One existing 3MF
loader test was skipped because `DOMParser` is unavailable in the Node test environment.

Strict lint passed on changed files, and contracts, client-runtime, web and server typechecks
passed. The L41 seam-marker/manifest check and `git diff --check` passed.

Browser/desktop and remote-client interaction, actual GPU rendering and image inspection,
large-mesh profiling, the full `loom.sh check` and upstream integration rehearsals remain
unrun. The manual steps below are a validation plan, not completed checks.

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                                | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/model-preview-3d/scadIncludes.test.ts` (new, shared with L49) | `include <a.scad>` and `use <lib/b.scad>` are found; commented-out includes in `//` and `/* */` are ignored; `import("part.stl")`, `import(file="x.3mf")` and `surface("map.png")` are found; `import(name)` with a variable is skipped; a `//` inside a string is not a comment; resolution is relative to the including file's directory; Windows-style backslashes are kept as written.                                                                                                                                                                                                  |
| `apps/server/src/fork/model-preview-3d/turnModels.test.ts` (new)                    | Pure mapping: the repository prefix is stripped and files outside it are dropped; previewable formats are "written", STEP is not; a changed `gear.scad` marks `bracket.scad` that includes it as "dependency" with `via: "gear.scad"`; transitive includes (a includes b includes c, c changed) mark both; a SCAD that is itself written is not repeated as a dependency; ordering is written first, then dependencies by path; the cap of 50 sets `truncated`; include cycles terminate.                                                                                                   |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update)        | `turnModels` with a fake projection store and a temp Git repo whose workspace is a subdirectory: picks the run's ready checkpoint, ignores baselines (`runId` null) and stale checkpoints, returns no models for a non-Git workspace, drops a model deleted after the turn, and with `runId: null` returns the newest turn that changed a model. `turnModelEvents` with a `Stream.make` of domain events (the pattern in `apps/server/src/fork/code-graph/reactor.test.ts:38-41`): emits for this thread's checkpoint with a model, skips other threads, empty `files` and code-only turns. |
| `packages/contracts/src/fork/model-preview-3d.test.ts` (new)                        | A stored settings record without `agentModels` decodes with `"offer"`; an unknown mode fails to decode. If L41 adds `modelFormatOf`: `part.STL` is `"stl"`, `a.stp` is `"step"`, `notes.txt` and `Makefile` are null.                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/rpcAuthorization.test.ts` (updated authorization coverage)    | The exhaustive scope-table check still passes; added assertions allow turn-model unary and stream reads with the read grant and reject both without it before running the query effect.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/src/fork/model-preview-3d/agentModels.test.ts` (new)                      | `mayAffectModels` (true for `.stl`, `.scad`, `.svg`, `.dat` and `.txt`; false for `.ts`); `modelSurface` id and basename title; the background helper adds surfaces without changing `activeSurfaceId`, does nothing when the panel is closed, skips surfaces already present, and leaves `userActionRevisionByThreadKey` unchanged; automatic opening preserves that revision and allows the same turn's proactive diff, while explicit opening records a user choice; dismissal storage caps at 200 and survives a malformed stored value.                                                |

`AgentModelsHost.test.tsx` verifies old-server and draft-thread gating, environment/thread
scoping, checkpoint deduplication, stopping the stream and clearing dots in Do nothing mode,
and rejection of a previous thread's late result. These exercise effects and store behavior;
there are no component markup snapshots.

## Commands

```sh
vp test run apps/server/src/fork/model-preview-3d/scadIncludes.test.ts \
  apps/server/src/fork/model-preview-3d/turnModels.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  packages/contracts/src/fork/model-preview-3d.test.ts \
  apps/web/src/fork/model-preview-3d/agentModels.test.ts \
  apps/web/src/fork/model-preview-3d/AgentModelsHost.test.tsx
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
