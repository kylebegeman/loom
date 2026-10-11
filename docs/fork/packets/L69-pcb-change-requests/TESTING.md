# L69 testing

## Focused tests

| File                                                                     | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/pcb-preview/changeRequests.test.ts` (new)          | Every transition for `user` and `agent`. Agents may go open to review and review to open with a response, and nothing else: create, edit, remove, convert, accept and reopen all fail with the service message. Accept records `resolvedRevision`, `resolvedRef` and `resolvedAt`; reopen clears them and keeps `response`. The 30-request limit, unique ids, and `convert-note` removing exactly one note. `requestRefs` names two leaf refs under one directory.             |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts` (extend)    | With a fake `CheckpointStore`: create captures `.../base` only in a Git workspace and saves with a null ref otherwise or when capture fails; accept captures `.../resolved`; remove and reopen delete the right refs after the write. Version conflicts fail. `updateWorkspace` with `requests: []` keeps the stored requests. `listRequests` reports `designChanged` from the current source snapshot. A workspace file written before this packet loads with `requests: []`. |
| `apps/server/src/fork/pcb-preview/mcp.test.ts` (extend)                  | `loom_pcb_change_requests` filters by status, omits images and includes `baseRef`. `loom_pcb_update_change_request` reaches the service as `agent` and surfaces the refusal for `accepted`. `loom_pcb_save_workspace` cannot change a status.                                                                                                                                                                                                                                  |
| `apps/web/src/fork/pcb-preview/requests.test.ts` (new)                   | `requestStatus` for each chip. `anchorPoint` for components on both views and sheets, net centroids, areas, and null for a missing reference or net. `changesNearAnchor` for component neighbours through shared nets, net members before and after, area containment with margin, and everything else in `elsewhere`. `requestPrompt` numbering and that it never includes images.                                                                                            |
| `apps/web/src/fork/pcb-preview/SvgViewport.test.tsx` (extend)            | With `onBox`, a drag reports a box in physical millimetres and does not pan; without it, drag pans as before; a click without movement still picks.                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/fork/pcb-preview/workspace.interactions.test.tsx` (extend) | `R` with a selected component opens the form anchored to it; **Add to draft** attaches one image, appends the prepared text and marks the request sent; a full draft shows the composer error and leaves the request unsent; the write controls disable without permission.                                                                                                                                                                                                    |

## Commands

From `apps/server`:

```sh
pnpm exec vp test run src/fork/pcb-preview/changeRequests.test.ts \
  src/fork/pcb-preview/PcbPreviewService.test.ts src/fork/pcb-preview/mcp.test.ts \
  src/fork/rpcAuthorization.test.ts src/fork/cli/callTool.test.ts
```

From `apps/web`:

```sh
pnpm exec vp test run src/fork/pcb-preview/requests.test.ts \
  src/fork/pcb-preview/SvgViewport.test.tsx \
  src/fork/pcb-preview/workspace.interactions.test.tsx \
  src/fork/model-preview-3d/viewer/captureSheet.test.ts
```

From `packages/client-runtime`, the existing permission test covers the new method because it
walks every fork scope:

```sh
pnpm exec vp test run src/state/commandPermissions.test.ts
```

Lint and typecheck from the repository root:

```sh
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/pcb-preview apps/web/src/fork/pcb-preview \
  apps/web/src/fork/model-preview-3d/viewer/captureSheet.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
```

## Manual checks for Kyle

Use a KiCad project in a Git repository and a tscircuit design, in a dev server with copied data.

1. Select a resistor on the board, press `R`, write a request and choose **Add to draft**. The
   draft has one marked capture and the prepared text. Nothing is sent.
2. Select a net, press `R`, **Save without adding**. Press `R` with nothing selected, drag a box,
   save. The Requests tab shows Draft for both. Select both and **Add 2 to draft**: one capture
   per view, numbered pins, one text block.
3. Make a request on a schematic sheet other than the root and confirm the pin and capture land
   on that sheet.
4. Send the draft and let the agent change the board. The requests show **Design changed** and
   pins follow the moved part.
5. Ask the agent to list open change requests and mark one ready for review. The badge appears
   on the Requests rail button with the agent's note in the detail.
6. Ask the agent to accept a request through `loom_pcb_update_change_request`, through
   `loom_pcb_save_workspace` and through `t3 pcb update_change_request`. All three fail.
7. Open the ready request and **Compare**. Changes near the anchor are listed first; overlay,
   before, after and difference all work. **Accept**. Reload the page, reopen the request, and
   confirm **Compare** still shows the frozen before and after. **Reopen**, then **Accept** again.
8. Delete a request and confirm `git for-each-ref refs/loom/pcb-requests/` no longer lists it.
9. In a folder that is not a Git repository, make a request, change the design, and use
   **Capture now** for the image pair.
10. On an untrusted tscircuit design, Compare shows the trust message; statuses still change.
11. Turn a note into a request from Marks; the note is gone and the request keeps its text.
12. Open the same thread on a second client over the tailnet; status changes appear on both.
13. Open the shortcut list and the command palette; both show "Request a change".

## Merge safety

- Contracts: new optional-on-decode fields only. Existing saved workspaces and older clients
  decode; older clients cannot remove requests because the server ignores `requests` in
  `updateWorkspace`.
- Shared files: see [SEAMS.md](./SEAMS.md). The riskiest overlaps are `PcbPreviewPanel.tsx` (other
  keys and overlays) and the `updateWorkspace` unique-id list; keep both edits to single lines.
- Upstream: no upstream files. `CheckpointStore` is imported, not edited. Before an upstream
  integration, confirm with
  `git merge-tree --write-tree --name-only --no-messages HEAD "$tag"` that no L69 file appears,
  and rerun `changeRequests.test.ts` and the service test if `CheckpointStore` changed upstream.

## Local verification

Focused tests cover actor transitions, limits, note conversion, baseline/accept capture and cleanup, version conflicts, workspace preservation, image-free agent listing, status refusal, legacy decoding, semantic anchors, area dragging, single and batch draft captures, full-draft errors and review/accept/reopen comparisons. Contracts, client-runtime, server and web typechecks and scoped strict lint pass.

Real client, KiCad/tscircuit rendering and remote multi-client checks remain pending. Captures wait on drawing readiness events, with a failure timeout; no polling or sleeps are used. Ref directory names use the workspace/design/request hash to prevent collisions. Accepted comparisons with a failed resolved capture show an explicit unavailable state.
