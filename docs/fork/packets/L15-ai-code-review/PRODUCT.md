# L15 product

Status: waiting for the design session. The session's outcome replaces the "Session outcome"
section below; until then this file records only the problem and what is already known.

## Problem

Agents in Loom write a lot of code, and Kyle reviews it in the diff panel line by line. A
second pair of eyes, run on demand, would catch bugs, risky changes and over-engineering
before a commit or pull request, and would let Kyle send precise fixes back to the working
agent without retyping context. Upstream T3 Code has excellent human review tools (the diff
panel with inline comments that attach to the composer, and a full pull request review
panel) but no AI reviewer. Old Loom had one; it worked but was fragile in known ways.

## What the user should be able to do (draft, for the session)

- Start a review of the thread's uncommitted changes, or of the branch against its base, from
  the diff panel, the command palette or the Review panel.
- Choose who reviews (a model), and optionally extra lenses (simplicity, UI design).
- Watch the review run, cancel it, and open the reviewer's transcript.
- Read findings sorted by severity (P0 to P3), each with file, line range, title, explanation,
  and confidence; filter and dismiss them.
- Click a finding to see the code; press "Fix this" to add it to the working thread's
  composer as a review comment (never auto-sent); or "Fix selected" to hand several back in
  one message.
- See past review runs for the thread and whether their findings were fixed or dismissed.

## Entry points (draft)

| Entry                                                                  | Behavior                                                               | Reverse                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| Right panel launcher: "Review"                                         | Opens the Review panel (runs and findings).                            | Close tab.                                   |
| Command palette: "Review uncommitted changes", "Review branch changes" | Starts a run with the default reviewer.                                | Cancel in the panel.                         |
| Diff panel header: "Review" (needs a seam or a shared extension point) | Starts a run for the diff's current scope.                             | Cancel.                                      |
| Settings, Loom, "AI code review"                                       | Default reviewer model, lenses, prompt additions.                      | Same section.                                |
| Keybinding                                                             | `loom.ai-code-review.start` (unbound).                                 | n/a                                          |
| Reviewer thread (if the engine uses threads)                           | Visible in the sidebar as "Review: <thread title>", settled when done. | Unsettle, archive or delete like any thread. |

## States (draft)

Server lacks the feature; no changes to review; reviewer model unavailable; running (with
elapsed time and the reviewer's latest activity); cancelled; failed (reviewer ended without
submitting findings); completed with no findings ("No issues found"); completed with findings.

## Decisions already made

- Discovery first: no design until the brainstorm (Kyle, 2026-09-24).
- Findings are handed back through the composer and never sent automatically (old Loom's
  invariant from ledger 0040; it worked).
- Findings must not be parsed out of every assistant message (old Loom's biggest false
  positive source).
- No new orchestration event types (EXTENSION-POINTS.md).

## Session outcome

To be written after the design session: chosen options per axis in DESIGN-SESSION.md, the
answers to its questions, the final v1 scope, and what moves to later versions. Then set the
README status to "Ready" and revise TECHNICAL, SEAMS, IMPLEMENTATION and TESTING to match.
