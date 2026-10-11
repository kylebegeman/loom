# L69 product

## Problem

Asking an agent to change a board means describing where the change goes in words, attaching a
capture, and then remembering to check the result. L24's notes help with the first part only. A
note is a point on one revision: once the design reloads it disappears from the drawing, and
nothing records whether it was handled. The user has no list of open asks, no way to see what
changed near the part they marked, and no record of when they were satisfied.

## What the user can do

- Select a component or net and press `R`, or press `R` with nothing selected and drag a box, then
  write a short title and the change they want.
- Choose **Add to draft**. The request is saved, a marked capture of the drawing is attached to
  the composer, and a prepared description is appended to the draft. Nothing is sent.
- Choose **Save without adding** to collect several requests, then select them in the Requests tab
  and choose **Add 3 to draft**. One capture per view and sheet shows all their pins, numbered.
- See every request in the Requests tab, grouped by status, with its pin on the drawing. Pins
  follow their component or net to the current revision.
- See **Design changed** when the design is different from the revision the request was made on,
  and **Ready for review** when the agent (or the user) marks it addressed, with the agent's note.
- Open a request and choose **Compare** to see the board as it was when the request was made
  against the board now, with the changed parts near the anchor listed first.
- Choose **Accept** to record that the change is done, or **Not yet** to send a ready request back
  to open. Accepted requests keep the before and after for later.
- **Reopen** an accepted request, including after a reload or on another client.
- Turn an existing note into a request from Marks, keeping its text and position.
- Ask an agent "what change requests are open?" and have it mark one ready for review with a
  short explanation.

## Entry points with reverse states

| Way in                                                     | Way out or back                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `R`, the Request tool in the tool bar, or Request in Marks | `Escape` or **Cancel** in the form                                 |
| Box drag for an area                                       | `Escape`, or drag again to replace the box                         |
| **Add to draft** / **Save without adding**                 | **Delete** in the request detail                                   |
| **Add N to draft** with a selection                        | **Clear selection**                                                |
| Agent or user marks ready for review                       | **Not yet** returns it to open                                     |
| **Accept**                                                 | **Reopen**                                                         |
| **Turn into change request** on a note                     | Delete the request; the note is not restored (said in the confirm) |
| Requests tab                                               | Click the tab again or `Escape`                                    |
| Command palette "Request a change"                         | Same as `R`                                                        |

## States

- Loading: the tab shows "Reading change requests" while the workspace loads. The Request tool is
  disabled until the drawing and its inspection are ready, matching Note.
- Empty: "Select a part, a net or an area and press R to ask for a change. The request goes to the
  composer with a marked capture of the drawing."
- Error: saving or status changes show the service message inline. A version conflict says
  "These requests changed on another client. Reload them before saving." Compare failures show the
  compare log as the Compare tab does.
- Disabled: without workspace write permission, the tool and status buttons are disabled with
  "Saving requests needs permission on this environment." For an untrusted tscircuit design,
  **Compare** is disabled with the existing "Allow circuit code from the drawing" message; status
  changes still work. When a draft has no room, the capture error from the composer is shown.
- Stale: a request made on another revision shows **Design changed**. A component or net that no
  longer exists shows "C12 is no longer in the design" and the pin is drawn at its last position
  only in the request's own capture. Area pins are drawn as a dashed box on any revision.
- No Git: requests work, but Compare is replaced by the image pair "When requested" and
  **Capture now**, as in L23.

## Status chips

The stored status is open, review or accepted. The chip is derived:

| Chip             | When                                             |
| ---------------- | ------------------------------------------------ |
| Draft            | open, never added to a draft                     |
| Requested        | open, added to a draft, design unchanged         |
| Design changed   | open, design revision differs from the request's |
| Ready for review | review                                           |
| Accepted         | accepted                                         |

## Surfaces and connection modes

Web and desktop share the panel. Mobile has no PCB panel. Over remote, relay and tunnel the
requests arrive in the existing workspace stream; captures are taken by the client; comparisons
and Git refs are host operations, so they behave the same everywhere.

## Decisions

- Anchors are semantic (component, net) or a box. A part's reference survives revisions, so the
  pin can follow it.
- Requests are a separate collection, not extended notes. Notes keep working with no migration.
- Creating a request attaches to the draft by default. That is the request's purpose; saving
  without adding is the secondary path for batching.
- Baseline Git refs at creation, not the last turn checkpoint. The user marks what they see,
  which can include edits made after the last turn.
- Refs live under `refs/loom/pcb-requests/`. They stay out of the Compare list and L66's history.
- "Review" means "believed addressed, waiting for the user". "Sent" is a separate timestamp.
  Agents need a way to say "done, please look" that is not acceptance.
- Agents may set open or review and add a response; only the user accepts or reopens. Acceptance
  is the user's sign-off on hardware that will be manufactured. An agent's view that it is done is
  the input to that review, not the decision. The service enforces this, not only the UI.
- At most 30 requests per design, matching L23's annotation limit and keeping the workspace small.
- Batch add is capped at 10 so the prepared text and captures stay readable.

## Implementation decisions

1. The end-to-end implementation uses hidden Git refs in the repository, under
   `refs/loom/pcb-requests/<request-key>/base` and `.../resolved`, deleted with the request. T3 already
   writes `refs/t3/` checkpoints each turn. The request key includes the workspace and design,
   preventing collisions between boards. These refs are never pushed by default, and without them
   "compare with when I asked" is not possible.
2. L23 keeps `review` meaning "added to the composer". PCB uses "waiting for user review". If agents later get a 3D update tool, align L23 to the PCB meaning in
   that packet.
