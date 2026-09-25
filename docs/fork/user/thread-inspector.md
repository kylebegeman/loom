# Thread inspector

The thread inspector answers "what is this thread doing, where, what has it changed, and does
it need me?" in one place: status and elapsed time, model and mode, branch and worktree, ahead
and behind counts, the pull request, uncommitted changes, the plan, pending approvals and
questions, subagents, running terminals and context window use.

It comes in two sizes that always agree with each other:

- **The card** is a quick look. It opens under the eye button in the chat header and shows
  the status, anything waiting on you, and one line per area. Click a line to jump to the
  place that handles it.
- **The panel** is the working view. It lives in the right panel and shows every area in
  full, with tools: copy the branch or worktree path, open the diff, show the last turn's
  changes, open the agents panel, a terminal, the pull request, or the thread that
  implemented a plan.

## Open it

- **Card:** click the eye button in the chat header, or run **Show thread inspector card**
  from the command palette. It closes when you click elsewhere, press Escape, or use one of
  its lines. Its last line, **Open inspector panel**, switches to the panel.
- **Panel:** choose **Inspector** in the right panel's launcher or "+" menu, or run **Show
  thread inspector** from the command palette. Keep it open to watch a long run.

Both commands can be bound to keys in **Settings > Keybindings** ("Loom: Thread Inspector:
Toggle" and "Loom: Thread Inspector: Card"). Neither has a default binding.

## Respond from it

When the thread waits on an approval or a question, both sizes lead with it and offer
**Respond**, which puts you in the composer where the approval or question waits.

## The dot on the eye button

A dot on the eye button means the thread is waiting on you: amber for an approval, your
theme's accent color for a question. You do not need to open the card to see it.

## Good to know

- Changes only appear for git repositories. The panel lists the largest changes first and
  points to the diff panel for the rest.
- A new thread shows its status and workspace until you send the first message.
- The inspector reads what the app already knows, so it also works when connected to a
  standard T3 Code server.
