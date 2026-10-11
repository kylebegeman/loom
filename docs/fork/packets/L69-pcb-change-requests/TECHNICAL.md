# L69 technical design

## Overview

Change requests are a new `requests` collection in `PcbWorkspace`. They are read through the
existing workspace RPC and stream, so every client and the agent see the same list. They are
written only through one new operation RPC, `changeRequest`, and never through the
whole-document `updateWorkspace`. That one rule gives three properties at once: an older client
that does not know `requests` cannot wipe them, `loom_pcb_save_workspace` cannot change a status,
and the user-only acceptance check lives in one service method.

When a request is created in a Git workspace, the server captures the working tree into a hidden
ref with upstream `CheckpointStore.captureCheckpoint`. Review runs the existing `compare` engine
from that ref to the working tree (or to the ref captured on accept), and a pure client helper
picks out the changes near the anchor.

## Contracts

All additions go in `packages/contracts/src/fork/pcb-workspace.ts` unless noted. `text`, `list`,
`finite` and `PcbBounds` are the file's existing helpers (`pcb-workspace.ts:5-8`, `:34`).

```ts
export const PcbRequestAnchor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("component"), reference: text() }),
  Schema.Struct({ kind: Schema.Literal("net"), name: text() }),
  // Physical millimetres in the view's coordinates, as measurements use.
  Schema.Struct({ kind: Schema.Literal("area"), box: PcbBounds }),
]);
export type PcbRequestAnchor = typeof PcbRequestAnchor.Type;

export const PcbRequestStatus = Schema.Literals(["open", "review", "accepted"]);

const nullable = <S extends Schema.Top>(s: S) =>
  Schema.NullOr(s).pipe(Schema.withDecodingDefault(Effect.succeed(null)));

export const PcbChangeRequest = Schema.Struct({
  id: text(),
  title: text(120),
  request: text(4000),
  anchor: PcbRequestAnchor,
  view: Schema.Literals(["pcb", "schematic"]),
  sheet: Schema.String,
  point: PcbPoint, // where the pin was drawn when the request was made
  sourceHash: text(), // display revision the request was made on
  createdAt: text(40),
  status: PcbRequestStatus.pipe(Schema.withDecodingDefault(Effect.succeed("open" as const))),
  baseRef: nullable(text(200)), // refs/loom/pcb-requests/<id>/base, null without Git
  referenceImage: nullable(Schema.String.check(Schema.isMaxLength(24000))), // data URL
  sentAt: nullable(text(40)),
  response: nullable(text(2000)), // the latest note from whoever set "review"
  reviewRevision: nullable(text()), // display revision when status became "review"
  resolvedRevision: nullable(text()), // display revision on accept
  resolvedRef: nullable(text(200)), // refs/loom/pcb-requests/<id>/resolved
  resolvedAt: nullable(text(40)),
});
export type PcbChangeRequest = typeof PcbChangeRequest.Type;
```

`PcbWorkspace` (`pcb-workspace.ts:120-128`) gains one field:

```ts
requests: list(PcbChangeRequest, 30).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
```

The operation RPC:

```ts
export const PcbChangeRequestOperation = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("create"),
    request: PcbChangeRequest.mapFields(Struct.pick([
      "id", "title", "request", "anchor", "view", "sheet", "point", "sourceHash", "referenceImage",
    ])),
    sent: Schema.Boolean, // true for "Add to draft", false for "Save without adding"
  }),
  Schema.Struct({ op: Schema.Literal("convert-note"), noteId: text(), request: /* same pick */ }),
  Schema.Struct({
    op: Schema.Literal("edit"),
    id: text(),
    title: Schema.optional(text(120)),
    request: Schema.optional(text(4000)),
  }),
  Schema.Struct({
    op: Schema.Literal("status"),
    id: text(),
    status: PcbRequestStatus,
    response: Schema.optional(Schema.NullOr(text(2000))),
  }),
  Schema.Struct({ op: Schema.Literal("sent"), ids: list(text(), 10).check(Schema.isMinLength(1)) }),
  Schema.Struct({ op: Schema.Literal("remove"), id: text() }),
]);
export const PcbChangeRequestInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  expectedVersion: Schema.Int,
  operation: PcbChangeRequestOperation,
});
```

If `mapFields`/`Struct.pick` is awkward in the vendored Effect version, declare
`PcbChangeRequestDraft` as its own struct with those nine fields; keep the field schemas shared.
`createdAt` and the timestamps are ISO strings set by the server; `IsoDateTime` from
`baseSchemas.ts` may be used instead of `text(40)` if it encodes as a string in this file.

`PcbEditorAction` (`pcb-workspace.ts:300-345`) gains one optional field, used by the existing
`focus` and `capture` actions:

```ts
requestId: Schema.optional(text()),
```

`packages/contracts/src/fork/pcb-preview.ts`:

- `PCB_PREVIEW_WS_METHODS` (`:15`) gains `changeRequest: "loom.pcb-preview.changeRequest"`.
- `PcbPreviewRpcGroup` (`:225`) gains
  `Rpc.make(M.changeRequest, { payload: W.PcbChangeRequestInput, success: W.PcbWorkspace, error })`.
- `packages/contracts/src/fork/clientRpcPermissions.ts:10` gains
  `[P.changeRequest]: AuthOrchestrationOperateScope`, the same grant as `updateWorkspace`.

No new `PcbPreviewError` reason: conflicts use `conflict`, limits and invalid transitions use
`invalid-parameters`.

## Server

New file `apps/server/src/fork/pcb-preview/changeRequests.ts`:

- `applyRequestOperation(current, operation, context)`: pure. Takes the current workspace, the
  operation, `{ actor: "user" | "agent", now, sourceHash, baseRef, resolvedRef }`, and returns the
  next workspace or a failure message. It enforces:
  - 30 requests; "Delete accepted requests to add more."
  - Unique ids; `convert-note` removes the note and adds the request in one write.
  - Transitions. `actor: "agent"` may only use `status` with `open` or `review`, and only from
    `open` or `review`. Everything else from an agent fails with "Only the user can accept,
    reopen, create or delete change requests." The user may do any transition.
  - `review` stores `response` and `reviewRevision`; `accepted` stores `resolvedRevision`,
    `resolvedRef` and `resolvedAt`; `open` from `accepted` clears the resolved fields and keeps
    `response`.
- `requestRefs(id)`: `{ base: "refs/loom/pcb-requests/<id>/base", resolved: ".../resolved" }`.
  Two leaf names under one directory avoid Git's file-versus-directory ref conflict. The service uses a hash of workspace key, design ID and request ID for the directory, so two designs cannot overwrite each other's baselines.
- `makeChangeRequests(deps)`: the effectful part, built inside `PcbPreviewService.make` with the
  service's own helpers (`resolveDesign`, `sourceSnapshot`, `storageLock`, `readState`,
  `writeState`, `workspaceFile`, `workspaceBus`) plus upstream `CheckpointStore`. It returns
  `changeRequest(input, actor)`:
  1. Resolve the design and take the storage permit, as `updateWorkspace` does
     (`PcbPreviewService.ts:1276-1318`).
  2. Check `expectedVersion`; same conflict message style as `updateWorkspace`.
  3. For `create`, `convert-note` and `status: accepted` by the user, call
     `checkpoints.isGitRepository(root)` and, when true, `captureCheckpoint({ cwd: root,
checkpointRef })`. Capture failure is not fatal: the request saves with a null ref and the
     log records why. Capture runs inside the permit so two accepts cannot race on one ref.
  4. Apply the pure function, decode with `version + 1`, write, publish on `workspaceBus`.
  5. For `remove`, and for `open` from `accepted`, delete the refs with
     `checkpoints.deleteCheckpointRefs` after the write succeeds; ignore failures.
- `listRequests(input, status?)`: reads the workspace and adds `designChanged` per request by
  comparing `sourceHash` with the current `sourceSnapshot` (`PcbPreviewService.ts:518-608`).

`PcbPreviewService.ts` call sites:

- `make` yields `CheckpointStore` (`apps/server/src/checkpointing/CheckpointStore.ts:59`) and
  builds `const requests = makeChangeRequests({...})`. The service is already composed above
  `layerOrchestrationApplication`, which provides `CheckpointStore`
  (`apps/server/src/server.ts:499-502`, `:580-582`), so `ForkLayer.ts` does not change.
- `updateWorkspace` (`:1276`) keeps the stored list: `requests: current.requests` is spread into
  the decoded `next` before writing, whatever the input carried. This is the one behavior change
  to an existing method. Unique-id checking adds `next.requests` to the collection list at
  `:1303-1312`.
- The public object (`:2565-2607`) gains `changeRequest` and `listRequests`.
- `apps/server/src/fork/pcb-preview/rpc.ts` maps `M.changeRequest` to
  `service.changeRequest(input, "user")`.

The compare engine is unchanged. It already accepts any ref that `rev-parse --verify
<ref>^{commit}` resolves (`PcbPreviewService.ts:1938-1945`), and the 68-character ref fits
`PcbCompareInput.from` (`pcb-workspace.ts:153-158`). `revisions()` lists only `refs/t3/`
(`:1907-1932`), so request refs do not crowd the Compare tab.

## Storage

Requests live in the same per-design JSON file as other saved tools,
`<stateDir>/fork/pcb-preview/workspaces/<key>.json`, under the 4 MiB `SAVED_STATE_LIMIT`
(`PcbPreviewService.ts:183`). Worst case is 30 requests with 24,000-character thumbnails and
4,000-character text, about 0.85 MB. Existing files decode with `requests: []`; no migration.

Git refs are the only state outside Loom's directory. A capture is one commit object over a
temporary index, the same as a turn checkpoint (`apps/server/src/vcs/GitVcsDriver.ts:811`). It
never touches the user's index or files.

## Clients

Web and desktop only; all files are in `apps/web/src/fork/pcb-preview/`.

- `requests.ts` (new, pure):
  - `requestStatus(request, currentHash)` returns the chip: draft, requested, changed, review,
    accepted.
  - `anchorPoint(anchor, inspection, view, sheet)` returns the pin position on the current
    revision, or null when the reference or net is gone. Components use `pcb` or `schematic`
    locations (`pcb-workspace.ts:23-31`); nets use the centroid of member pins on that view and
    sheet; areas use the box centre.
  - `describeAnchor(anchor)`: "C12", "net VBUS", "area 12.0 x 8.5 mm at (40.2, 18.0)".
  - `changesNearAnchor(comparison, anchor, view, marginMm = 2)` splits `comparison.changes`
    (`pcb-workspace.ts:160-177`) into `near` and `elsewhere`. Component: the reference plus every
    component sharing a net with it, before or after. Net: every component with a pin on the net,
    before or after. Area: components whose before or after position lies in the box plus margin.
  - `requestPrompt(requests, design, revision)`: the prepared text, below.
- `RequestPins.tsx` (new): numbered pins and dashed area boxes inside the existing overlay
  `<svg data-overlays>`, rendered beside `<DrawingOverlays>` at `PcbPreviewPanel.tsx:984` and in
  `LinkedDrawing` at `:1448`. It takes the requests, the inspection and an optional `only` id list
  for captures. Colour: the existing note token for open, `--warning` for review, muted for
  accepted. No animation.
- `RequestsTab.tsx` (new): grouped list (Ready for review, Open, Accepted), multi-select with a
  selection bar, the request form, and the detail view. Detail shows the chip, anchor, text, the
  agent's response, **Compare** (runs `pcb.compare` from `baseRef` to `""` or `resolvedRef`, then
  renders the existing comparison images and two lists, "Near this request" and "Elsewhere"),
  and footer buttons per chip as listed in PRODUCT.md.
- `Inspector.tsx`: append `"Requests"` to `INSPECTOR_TABS` (`:40-50`) and its `TAB_META` entry
  (`icon: MessageSquareDotIcon`, title "Change requests", detail "Asks for the agent, pinned to
  parts"). It is not in `NEEDS_EXECUTION`; only Compare inside it checks `executionAllowed`.
- `PcbPreviewPanel.tsx`:
  - `Tool` gains `"request"`; `TOOLS` (`:84-90`) and `MarksTab.tsx:15` gain
    `{ id: "request", label: "Request", key: "R", icon: MessageSquarePlusIcon }`.
  - Key handler (`:1041-1068`), one line:
    `else if (key === "r" && drawingTools && canMark) startRequest();` where `startRequest`
    opens the form for the selected component, else the selected net, else enters the area tool.
  - `pick` (`:240`) in `request` mode with no box treats a click as a 2 mm box at the point.
  - Badges (`:1316`) become `{ Checks: checkBadge, Requests: reviewBadge }` with the review count
    in the `warning` tone.
  - `addRequestsToDraft(ids)`: groups the requests by view and sheet; for each group switches the
    drawing with the existing surface and sheet setters, waits for `viewport.isReady()`, captures
    the whole drawing (`capture(true)`) with `RequestPins only={groupIds}`, and attaches it with
    `attachModelImage`. Requests made on another revision whose anchor is gone attach their
    stored `referenceImage` instead. Then it appends `requestPrompt` with `appendSummary`
    (`summary.ts:58-59`), restores the original view, and sends `{ op: "sent", ids }`. Order
    matters: attach first, then text, then mark sent, so a full draft leaves requests unsent.
  - The editor switch (`:386-544`): `focus` with `requestId` focuses the anchor and selects the
    component or net; `capture` with `requestId` makes the same marked capture of that one
    request. No editor action changes a status.
- `SvgViewport.tsx`: an optional `onBox?: (box: PcbBounds) => void`. While set, a primary-button
  drag draws a rectangle in physical millimetres instead of panning (`:340-370`); wheel, arrows
  and middle-button drag still pan. The rectangle is painted in the overlay through the existing
  input-driven `paint` (`:116-124`).
- `usePcbWorkbench.ts`: `mutate` sends `requests: []` in `updateWorkspace` because the server
  ignores the field; a new `changeRequest(operation)` runs `pcb.changeRequest` with the current
  version and the same conflict handling.
- `packages/client-runtime/src/fork/pcb-preview.ts`: a `changeRequest` command through
  `createEnvironmentRpcCommand`, next to `applyParameters` (`:105-110`). The UI uses its
  `permissionAtom`.
- Reference images: when a request is saved, the marked capture is reduced with L23's
  `thumbnail(blob)` (`apps/web/src/fork/model-preview-3d/viewer/captureSheet.ts:3-24`), given a
  new optional `limit` argument defaulting to today's 50,000 characters. PCB passes 24,000.
- `MarksTab.tsx`: notes gain **Turn into change request**, which opens the request form prefilled
  with the note text and a 2 mm area anchor at the note point (or the component under it).
- `WorkspaceChrome.tsx:252-261`: add `["Request a change", "R"]` to `SHORTCUTS`.
- `palette.tsx`: "Request a change" runs the same `startRequest`.

Prepared text, appended once per batch:

```text
PCB change requests: <design id>
Design revision: <display source hash>
1. <title> (<describeAnchor>, <view>; sheet <sheet>)
<request text>
2. ...
The attached captures mark each request by number. Change only what each request asks and keep
unrelated parts, nets and placement. When one is done, mark it ready for review with
loom_pcb_update_change_request and say what you changed.
```

## Agent-facing tools

In `apps/server/src/fork/pcb-preview/mcp.ts`, beside `loom_pcb_workspace` (`:130`):

- `loom_pcb_change_requests` (`readsAsCaller`, read-only): `{ designId, status?: "open" |
"review" | "accepted" | "all" }`, default `"open"`. Returns the requests without
  `referenceImage`, each with `designChanged`, `describeAnchor` text and `baseRef`, so an agent can
  call `loom_pcb_compare` with `from: baseRef`. Description: "List change requests the user
  pinned to this design. Use baseRef with loom_pcb_compare to see what changed since."
- `loom_pcb_update_change_request` (`actsAsCaller`): `{ designId, requestId, status: "open" |
"review", response?: string <= 2000 }`. Calls `service.changeRequest(..., "agent")` with the
  current version read inside the call, so agents do not juggle versions. Description: "Mark a
  change request ready for review (or back to open) with a short note. Only the user can accept."
- `loom_pcb_save_workspace` (`:141-155`): description gains "Change requests are kept as they are;
  use loom_pcb_update_change_request."
- `loom_pcb_editor`: `focus` and `capture` accept `requestId`.

`t3 pcb change_requests` and `t3 pcb update_change_request` follow automatically from
`apps/server/src/fork/pcb-preview/cli.ts`, which maps an action to `loom_pcb_<action>`. The CLI
has the agent's rights.

## Performance

- No animation loops. Pins are static SVG in the existing overlay, repainted only when the
  workspace, selection or camera changes, as notes are.
- `anchorPoint` runs per request per render over at most 30 requests; component lookups use a
  `Map` built once per inspection with `useMemo`.
- Workspace payload grows by at most about 0.85 MB at the 30-request limit; typical requests
  without large images are a few kilobytes. The whole-document `updateWorkspace` no longer carries
  them, so ordinary saves stay small.
- Compare runs only on **Compare**, never on open. Its cost is the existing engine's: for
  tscircuit, two builds of up to 120 s each; for KiCad, SVG exports.
- Captures happen in the client on user action. Batch switching waits for readiness rather than
  sleeping.
- Remote: the operation RPC is a few kilobytes. Images in the draft are the composer's normal
  upload path.

## Alternatives considered

- Extending `PcbAnnotation` with optional request fields. Rejected: notes and requests have
  different lifetimes, and status writes would still go through the whole-document update.
- Writing requests through `updateWorkspace` with a server-side diff guard. Rejected: an older
  client that drops the field would delete every request, and the guard is a diff over arbitrary
  edits instead of a check on one named operation.
- Using the latest turn checkpoint as the baseline. Rejected: it misses edits made since the last
  turn, which is often exactly what the user is looking at.
- Storing reference images as files served over signed HTTP. Worth it if thumbnails grow; at
  24,000 characters and 30 requests the existing workspace stream is simpler and bounded.
- Letting agents accept with a user setting. Rejected for now; see PRODUCT.md.
