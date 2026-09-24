# L04 product

## Problem

The state of a thread is spread across the header (branch, git actions), the composer
(approvals, questions, plan progress, context meter), the timeline (work log, subagents)
and the right panel (diff, agents, pull requests). When Kyle comes back to a thread, or
watches a long run, he wants one glance that answers "what is it doing, where, what has it
changed, and does it need me?", with a way to jump straight to whatever needs attention.

## What the user can do

- Open the Inspector tab in the right panel for a full status card of the current thread.
- Show the card from the eye button in the chat header: it docks under the header at the
  chat's top-right corner and closes on the next interaction elsewhere, so a glance costs
  one click and no cleanup.
- Read, at a glance:
  - **Status:** Working (with elapsed time and the current plan step), Needs approval,
    Needs input, Ready, Interrupted, Error (with the message), provider and model, runtime
    mode, plan or default mode.
  - **Workspace:** project, branch, worktree path (copy), ahead and behind counts, linked
    pull request with its state.
  - **Changes:** uncommitted files and lines added and removed, the top five files, and the
    files changed in the last turn.
  - **Plan:** the active plan's steps with their state, and whether a proposed plan is
    ready or was implemented in another thread.
  - **Attention:** pending approvals (kind and detail) and pending questions.
  - **Agents:** running, waiting, idle and finished subagents.
  - **Terminals:** running terminal count.
  - **Context:** context window use as a percentage and tokens, when the provider reports it.
- Jump: "Review changes" opens the diff panel; "Last turn" opens it on the last turn;
  "Open agents", "Open pull request", "Open terminal"; "Respond" focuses the composer where
  the approval or question waits; a proposed plan's implementation thread opens that
  thread.

## Entry points

| Action         | Where                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open the panel | Right panel launcher and "+" menu ("Inspector", letter I); palette "Show thread inspector"; keybinding command `loom.thread-inspector.toggle` (unbound; toggles).                                       |
| Show the card  | Header eye button (left of the project scripts control); palette "Show thread inspector card"; keybinding command `loom.thread-inspector.card` (unbound; toggles).                                      |
| Close          | Close the panel tab. The card closes on the eye button, Escape, a press outside it, a window resize, a chat pane width change (opening a panel, dragging a splitter), or after one of its jump actions. |
| See the state  | The header button shows a small dot when the thread needs attention (approval or question), so the card is not needed to notice it.                                                                     |

No settings.

## Copy

- Header button tooltip: "Thread inspector" (icon: eye).
- Section titles: "Status", "Workspace", "Changes", "Plan", "Attention", "Agents",
  "Terminals", "Context".
- Empty rows: "No changes", "No plan", "Nothing waiting on you", "No subagents", "No
  running terminals", "No context data from this provider".
- Actions: "Review", "Last turn", "Open", "Respond", "Copy path".
- Not a git repository: "Not a git repository" in Workspace; Changes hidden.
- Draft thread: "Send a message to start this thread."

## States

- Loading: rows that depend on the git status query show a muted "Checking..." until the
  first result; everything else is synchronous from thread state.
- Empty: per-row empty copy above.
- Error: a failed git status shows "Git status unavailable" with the error in a tooltip.
- Disabled: draft threads show only Status and Workspace.
- The card never animates continuously; a working status uses upstream's static indicator
  and an elapsed time that updates at most once per second only while visible.

## Surfaces and connection modes

Web and desktop, identical. Mobile: not supported (upstream's tablet inspector is
unrelated). Remote and upstream servers: supported (client-only).

## Decisions and open questions

Decisions:

- Client-only, like old Loom's inspector: no RPCs, no persisted state.
- The card is anchored under its header button and rendered in a portal, so it needs one
  header seam and nothing in the chat layout.
- Light dismissal follows Kyle's last recorded direction for old Loom's card (ledger 1359):
  the eye button is the only way in, and the first interaction elsewhere closes it. Long
  watching belongs to the panel tab, which stays open.
- Compact density (Status and Attention first, other sections collapsed to one line each)
  when the window is narrower than 900 px.

Open questions for Kyle:

- Keep light dismissal, or add a "keep open" pin on the card itself? The packet ships light
  dismissal only.
