# L69 implementation

Commits use `feat(fork-pcb-change-requests): ...`. Each step leaves the tree compiling and its
tests passing.

1. **Contracts.** In `packages/contracts/src/fork/pcb-workspace.ts` add `PcbRequestAnchor`,
   `PcbRequestStatus`, `PcbChangeRequest`, the draft fields, `PcbChangeRequestOperation` and
   `PcbChangeRequestInput` exactly as in TECHNICAL.md. Add `requests` to `PcbWorkspace` with its
   decoding default and `requestId` to `PcbEditorAction`. In `pcb-preview.ts` add the method name
   and the RPC; in `clientRpcPermissions.ts` add the scope row. Fix `freshWorkspace`
   (`PcbPreviewService.ts:1232`) and the client `EMPTY` workspace in `usePcbWorkbench.ts` to
   include `requests: []`. Add a contract test that a saved workspace without `requests`, and a
   request without the defaulted fields, both decode.
2. **Pure request rules.** Create `apps/server/src/fork/pcb-preview/changeRequests.ts` with
   `applyRequestOperation` and `requestRefs`. Cover every transition for both actors, the limit,
   unique ids and `convert-note` in `changeRequests.test.ts`.
3. **Service.** In `PcbPreviewService.make` yield `CheckpointStore`, add `makeChangeRequests`
   in `changeRequests.ts` and call it with the service helpers. Expose `changeRequest(input,
actor)` and `listRequests(input, status)`. In `updateWorkspace` keep `current.requests` and add
   `next.requests` to the unique-id check. Wire `rpc.ts`. Update the `create` helper in
   `PcbPreviewService.test.ts` to provide a fake `CheckpointStore` that records refs, and add
   service tests (see TESTING.md).
4. **Client runtime.** Add the `changeRequest` command in
   `packages/client-runtime/src/fork/pcb-preview.ts`. In `usePcbWorkbench.ts` add
   `changeRequest(operation)` using the current version, and send `requests: []` from `mutate`.
5. **Client helpers.** Create `apps/web/src/fork/pcb-preview/requests.ts` with
   `requestStatus`, `anchorPoint`, `describeAnchor`, `changesNearAnchor` and `requestPrompt`, and
   `requests.test.ts`.
6. **Area drag.** Add `onBox` to `SvgViewport.tsx`. Extend `SvgViewport.test.tsx` for a drag that
   reports a box in physical millimetres and for panning still working when `onBox` is unset.
7. **Pins.** Create `RequestPins.tsx` and render it beside both `DrawingOverlays` uses in
   `PcbPreviewPanel.tsx` (`:984`, `:1448`) with an `only` prop for captures.
8. **Request form and tool.** Add the `request` tool to `TOOLS` in `PcbPreviewPanel.tsx` and
   `MarksTab.tsx`, the `R` key line, `startRequest`, the form (title, request text, **Add to
   draft** with Cmd/Ctrl+Enter, **Save without adding**, **Cancel**), and the palette action.
   Saving takes the marked capture, makes the 24,000-character thumbnail with
   `thumbnail(blob, 24000)` (add the optional `limit` argument in
   `apps/web/src/fork/model-preview-3d/viewer/captureSheet.ts`), sends `create`, then for **Add to
   draft** attaches the capture and appends `requestPrompt`. Add the `SHORTCUTS` row.
9. **Requests tab.** Create `RequestsTab.tsx`; append `"Requests"` in `Inspector.tsx` with its
   meta and switch case; add the review badge at `PcbPreviewPanel.tsx:1316`. Detail view with
   chips, response, footer actions and **Compare**. Export `ComparisonImages` from
   `RevisionCompare.tsx` so the detail reuses its overlay, before, after and difference modes.
   Without Git, show the "When requested" and **Capture now** pair.
10. **Batch and notes.** Add multi-select and `addRequestsToDraft` (group by view and sheet,
    switch, wait for readiness, capture, restore, mark sent). Add **Turn into change request** to
    notes in `MarksTab.tsx`.
11. **Agent tools.** Add `loom_pcb_change_requests` and `loom_pcb_update_change_request` to
    `mcp.ts` with handlers that call the service with `"agent"`; update the
    `loom_pcb_save_workspace` description; handle `requestId` in the editor `focus` and `capture`
    cases. Extend `mcp.test.ts`.
12. **Docs.** In `docs/fork/user/pcb-preview.md`, "Optional editor tools", add a short paragraph:
    how to request a change, that only the user accepts, and that Compare uses the revision the
    request was made on. Add the two tools to the agent paragraph only if it lists tools (today it
    does not).

## Done when

- The CONVENTIONS definition of done holds: focused tests, lint and typecheck pass, no upstream
  file changed, commits use the packet slug.
- A request can be made on a component, a net and an area on both views, added to the draft
  alone and in a batch, compared, accepted, reopened after a reload, and deleted with its refs.
- An agent can list requests and mark one ready for review; its attempts to accept, reopen,
  create or delete fail with the service message, including through
  `loom_pcb_save_workspace`.
- A workspace saved before this packet loads unchanged with an empty request list.
- Every manual check in TESTING.md passes on desktop and in a browser connected remotely.
