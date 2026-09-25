# L04 product

## Problem

The state of a thread is spread across the header (branch, git actions), the composer
(approvals, questions, plan progress, context meter), the timeline (work log, subagents)
and the right panel (diff, agents, pull requests). When Kyle comes back to a thread, or
watches a long run, he wants one glance that answers "what is it doing, where, what has it
changed, and does it need me?", with a way to jump straight to whatever needs attention.

## What the user can do

Two surfaces read one model, so a value can never differ between them:

- **The card** is the glance. It opens from the eye button in the chat header, anchored
  under the button with its right edge on the button's right edge, and closes on the next
  interaction elsewhere. It shows the hero, what needs you, then one line per area; a line
  with somewhere to go is a button. Its footer opens the panel.
- **The panel** is the workbench: the Inspector tab in the right panel. It shows the hero,
  then every area as a section with its tools.
- The **hero** on both: the status (Working with elapsed time, the current plan step and
  step progress; Needs approval or Needs input with a **Respond** button; Plan ready; Ready;
  Interrupted; Error with the message; Draft) and fact chips: the model with its provider
  glyph, the runtime mode, plan mode.
- Read, at a glance:
  - **Needs you:** each pending approval (kind and command or path) and question.
  - **Workspace:** project, branch, ahead and behind, worktree path, pull request with its
    state and title. The panel adds copy buttons for the branch and the path.
  - **Changes:** file count and lines added and removed; the panel lists the largest files
    with per-file stats and points to the diff panel for the rest, plus the last turn's
    files.
  - **Plan:** progress and the current step; the panel lists every step with its state. A
    proposed plan shows as ready to review or implemented in another thread.
  - **Agents:** working, idle and finished counts; the panel lists the agents, working ones
    first, with what each is doing and for how long.
  - **Terminals:** each running terminal by its label.
  - **Context:** percentage and tokens with a bar, when the provider reports it; the panel
    adds the total processed and the automatic compaction note.
- Jump: a card line or a panel tool opens the diff panel (all changes, or the last turn's),
  the agents panel, the pull request, a terminal, or the thread that implemented a plan.
  **Respond** focuses the composer where the approval or question waits.

## Entry points

| Action         | Where                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open the panel | Right panel launcher and "+" menu ("Inspector", letter I); palette "Show thread inspector" (opens); keybinding command `loom.thread-inspector.toggle` (unbound; toggles); the card's footer "Open inspector panel". |
| Show the card  | Header eye button (first header action); palette "Show thread inspector card" (opens); keybinding command `loom.thread-inspector.card` (unbound; toggles).                                                          |
| Close          | Close the panel tab. The card closes on the eye button, Escape, a press outside it, or after one of its lines or its footer; it stays open while a reply streams and follows the button when the header reflows.    |
| See the state  | The header button shows a small dot when the thread needs attention (approval or question), so the card is not needed to notice it.                                                                                 |

No settings.

## Copy

- Header button tooltip: "Thread inspector" (icon: eye).
- Hero statuses: "Draft", "Needs approval", "Needs input", "Error", "Connecting", "Working",
  "Plan ready", "Monitoring", "Interrupted", "Ready". Fact chips: the model name, the runtime
  mode label, "Plan mode".
- Panel section titles: "Needs you", "Workspace", "Changes", "Plan", "Agents", "Terminals",
  "Context". Card lines: "Changes", "Last turn", "Plan", "Agents", "Context", plus the branch,
  worktree, pull request and terminal lines named by their values.
- Actions: "Respond", "Open diff", "Show" (last turn), "Open" (pull request, terminal),
  "Open thread", "Agents panel", "Copy branch", "Copy worktree", "Open inspector panel".
- Empty and overflow copy: "No uncommitted changes", "N more in the diff panel", "N more in
  the agents panel", "N more in the chat".
- Not a git repository: "Not a git repository" in Workspace; Changes hidden.
- Draft thread: "Send a message to start this thread."

## States

- Loading: Workspace shows a muted "Checking..." and Changes shows placeholder lines until
  the first git status; everything else is synchronous from thread state.
- Empty: sections with nothing to show are omitted; Changes says "No uncommitted changes".
- Error: a failed git status shows "Git status unavailable"; a session error shows the
  message under the status.
- Disabled: draft threads show only the hero and Workspace.
- Nothing animates continuously: static dots, an elapsed time that updates once per second
  only while visible, and bars that move only when their value changes.

## Surfaces and connection modes

Web and desktop, identical. Mobile: not supported (upstream's tablet inspector is
unrelated). Remote and upstream servers: supported (client-only).

## Decisions

- Client-only, like old Loom's inspector: no RPCs, no persisted state.
- The card is the app's popover (base-ui) anchored to the eye button, so it uses the same
  glass surface, placement, viewport collision handling and dismissal as every other menu,
  and needs one header seam and nothing in the chat layout.
- Light dismissal only, confirmed by Kyle (and his last recorded direction for old Loom's
  card, ledger 1359): the card opens from the eye button, the palette or its keybinding,
  and the first interaction elsewhere closes it. There is no pin on the card; the panel tab
  is the keep-open view for long watching.
- One typed model for both surfaces. The card is already the compact form, so there is no
  separate compact density.
- Lists are capped where the owning panel does the real work: eight files in the panel's
  Changes, five agents, three approvals and terminals on the card.
