# L69: Change requests on the board

Status: Ready to build.

Approved by Kyle on 2026-10-10.

PCB notes today are text pinned to a point on one revision; they vanish from the drawing once the
design changes and nothing tracks whether the agent dealt with them. With this packet the user
selects a component, a net or a box on the schematic or the board, presses `R`, writes what should
change, and the request goes into the composer draft with a marked capture. Nothing is sent. The
request stays pinned to its part across revisions, shows when the design has changed under it, and
shows "Ready for review" when the agent says it is done. Reviewing compares the board as it was
when the request was made with the board now, listing the changes near the anchor first. Only the
user accepts; accepting records the revision that resolved it, and an accepted request can be
reopened later. Several open requests can go into one draft, and an existing note can be turned
into a request.

## Scope

- In:
  - A `requests` collection in the PCB workspace, with decoding defaults so saved workspaces load.
  - Anchors: a component reference, a net name, or an area (a box in millimetres), on either view
    and any schematic sheet.
  - A Request tool (`R`) in the drawing tool bar and Marks tool list, with a box drag for areas.
  - A Requests inspector tab appended to the rail, with a badge for requests ready for review.
  - Add to draft (marked capture plus prepared text), batch add of up to 10 open requests, and
    "Turn into change request" on an existing note.
  - Statuses open, review and accepted, a separate "sent" timestamp, and the resolving revision.
  - A baseline Git ref captured when a request is made, used by the existing compare engine; a
    second ref captured on accept. Image fallback when the workspace is not a Git repository.
  - `RequestPins.tsx` overlay drawn beside `DrawingOverlays`, on the current revision.
  - MCP tools `loom_pcb_change_requests` and `loom_pcb_update_change_request`, their `t3 pcb`
    actions, and a `requestId` on the editor `focus` and `capture` actions.
- Out:
  - Agents creating, deleting or accepting requests.
  - Threads, replies, assignees or mentions on a request. There is one optional agent response.
  - Requests in the 3D board view. Requests on the 3D model panel stay L23's markup.
  - Changing L23's statuses. See PRODUCT.md, "Decisions needed from Kyle".
  - Turning check findings (L52) into requests. A natural follow-up once both exist.

## Surfaces

- Web and desktop: supported, same panel.
- Mobile: not supported. Mobile has no PCB panel. The contract changes are shared and decode on
  mobile without UI.
- Remote: works on every connection mode. Requests travel in the existing workspace stream; Git
  refs and comparisons run on the environment host. Captures are made in the client.

## Extension points used

None new. Reuses L24's registrations: `ext-panels` (the PCB panel through `ChatView`), `ext-mcp`
(the `loom_pcb_*` toolkit), `ext-cli` (`t3 pcb`), and the `pcb-preview` capability over `ext-core`.
The new RPC method is added to the fork's own guarded scope table.

## Packet seams

None. Every file touched is fork-owned. The server imports upstream `CheckpointStore` without
editing it. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L60 (change highlight): when present, the review view draws the changed components near the
  anchor with `ChangeHighlights.tsx`. Without it the review lists them and the comparison overlay
  shows them.
- L59 (follow agent): independent. A request's "Design changed" chip appears whether or not the
  design was opened through L59.
- L66 (history): baseline refs live under `refs/loom/pcb-requests/`, outside `refs/t3/`, so they
  do not appear in the history timeline or the Compare tab's revision list. L66 can still compare
  against them by name.
- L52 (check markers): independent. A later "Request a fix" on a finding would create a request
  with an area anchor at the finding's point.
- L54 (units): area sizes and the anchor description use L54's formatter when present, otherwise
  millimetres with one decimal.
- L62 (capture export): the marked capture is an ordinary capture; L62's copy and save apply.
- L63 (viewport access): status changes made by an agent are announced through L63's live region
  when present.
- L23 (3D markup): shares the idea and most wording, not code. See PRODUCT.md for the status
  difference.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
