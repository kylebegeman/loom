# L66 implementation

Each step compiles and keeps existing tests green. Commit per step with
`feat(fork-pcb-history): ...` (or `refactor(fork-pcb-history): ...` for steps 1 and 3).

1. **Shared history service.** If L49 has landed, move its inline backup, stage, rename and
   undo code from `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts` into
   `apps/server/src/fork/model-preview-3d/historyRestore.ts` as TECHNICAL.md describes, and
   call it with a one-entry list. L49's tests pass unchanged. If L49 has not landed, create
   `history.ts` and `historyGit.ts` exactly as L49's TECHNICAL.md defines them (Limits, Git
   plumbing, Tracked set and candidates) with their tests, then `historyRestore.ts`. Either
   way, widen `UndoManifest.entries[].restoredOid` to nullable and add `lsTree`'s `recursive`
   option. Add `historyRestore.test.ts`.
2. **Contracts.** In `packages/contracts/src/fork/pcb-workspace.ts`: the history schemas,
   `checkpointId` on `PcbAssetInput`, `turn-history` and `turn-compare`, optional
   `turnHistory` state. In `pcb-preview.ts`: `checkpointId` on `PcbRenderInput`,
   `"version-not-found"`, three methods and RPCs. Add the authorization rows
   (`apps/server/src/fork/rpcAuthorization.ts`), client permission rows
   (`packages/contracts/src/fork/clientRpcPermissions.ts`) and three commands in
   `packages/client-runtime/src/fork/pcb-preview.ts`. Add stub handlers in `rpc.ts` that fail
   `version-not-found` until step 6, so the exhaustive table and RPC group typecheck.
3. **Design file rules.** Create `apps/server/src/fork/pcb-preview/designFiles.ts` with
   `isDesignSource`, `isReferenceSource`, `designReferences` and `isDesignFile` moved from
   `sourceSnapshot` (`PcbPreviewService.ts:557-596`), and make `sourceSnapshot` use them with
   no behavior change (existing `PcbPreviewService.test.ts` passes). Add `designSet` and
   `designFiles.test.ts`.
4. **Render seams.** In `PcbPreviewService.ts`: split `asset` into `asset` and
   `assetFor(input, resolved, snapshot, options)`; give `runRender` and `runAsset` a
   `{ frozen }` option that skips the re-snapshot checks (`:892-897`, `:1735-1739`); make
   `runRender`'s tscircuit path (`:835-846`) call `assetFor` with its own `resolved`. Live
   behavior and job keys stay the same.
5. **Listing.** Create `apps/server/src/fork/pcb-preview/history.ts` with the limits,
   `makePcbHistory(deps)`, `liveDesignSet` and `history`. In `make`, create `historyDir` (real
   path), the `ls-tree` LRU and the tree protection set, and wire the `history` handler and
   service method. Replace `revisions` (`:1907-1932`) with `scopedRevisions` plus the widened
   commit list.
6. **Versions.** Add `versionDesign` (materialize, reference rounds, limits, LFS,
   `node_modules` link, frozen snapshot). `render` and `asset` use it when `checkpointId` is
   set. Extend `prune` to cover trees and stale pending trees.
7. **Restore and undo.** Add `historyRestore` (plan, dry run, conflict check, KiCad lock
   detection, `historyRestore.ts`) and `historyUndo` under `storageLock`. Wire the handlers.
8. **Agent tools.** In `mcp.ts`: `loom_pcb_history`, `loom_pcb_restore_version`,
   `checkpointId` on `loom_pcb_render` and `loom_pcb_asset`, and the description updates for
   `loom_pcb_revisions` and `loom_pcb_editor`. Extend `mcp.test.ts`.
9. **Web helpers and hook.** Create `apps/web/src/fork/pcb-preview/history.ts` with
   `history.test.ts`, and `usePcbHistory.ts`. Add the optional `checkpointId` to
   `usePcbPreview` and `Board3D`.
10. **Strip and viewing.** Create `HistoryStrip.tsx`. In `PcbPreviewPanel.tsx`: state, strip,
    status label and "Back to current", read-only gating (`canMark`, capture, export, Views
    save, Inspector notice in `Inspector.tsx`), toolbar button.
11. **Compare.** `RevisionCompare` `initial` prop; the strip's "Compare" opens the tab with the
    version's ref.
12. **Restore dialog.** Create `RestoreDesignDialog.tsx` with the dry-run plan, the two
    checkboxes, the KiCad and running-agent warnings, the notice with Undo, and conflict
    handling.
13. **Keys, palette, editor.** `t`, `[` and `]` in the key handler (brackets before the
    modifier early return), `SHORTCUTS` rows in `WorkspaceChrome.tsx`, palette entries and
    `actions.ts`, and `turn-history` / `turn-compare` plus `turnHistory` state in
    `handleEditorRequest`.
14. **User guide.** Add a "History" section to `docs/fork/user/pcb-preview.md`: how to open
    it, that versions come from the thread's turns in Git workspaces, that restore writes the
    whole design with one Undo and what the two options do, and the agent tool names. Update
    the Compare paragraph: its list shows this thread's turns and the design's commits.

## Done when

- `T` opens a strip listing only this thread's turns that changed the design's files, with
  Start and Now, and turns that touched only another design in the same folder are absent.
- `[` and `]` show the schematic, board and 3D board as they were, with sheets and project
  libraries from that turn, the camera kept, and stale renders interrupted.
- A version where the design or a view did not exist yet says so, and restore is disabled.
- Compare from the strip diffs the version against today; Compare's lists show "Turn N" and
  no other thread's refs.
- Restore writes every differing design file together, offers supporting files and removals
  off by default, warns about KiCad lock files and a running agent, refuses on a conflict,
  rolls back a failed write completely, and Undo returns all files at once.
- Agents can list, render, export, compare, plan, restore and undo through `loom_pcb_*`, and
  `t3 pcb history` / `t3 pcb restore_version` work.
- L49's model history behaves the same before and after step 1.
- The focused tests, lint and typechecks in TESTING.md pass, and the merge check is clean.
