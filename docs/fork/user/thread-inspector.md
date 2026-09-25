# Thread inspector

The thread inspector answers "what is this thread doing, where, what has it changed, and does
it need me?" in one place: status and elapsed time, model and mode, branch and worktree, ahead
and behind counts, the linked pull request, uncommitted changes, the plan, pending approvals
and questions, subagents, running terminals and context window use.

## Open it

- **Panel:** choose **Inspector** in the right panel's launcher or "+" menu, or run **Show
  thread inspector** from the command palette. Keep it open to watch a long run.
- **Card:** click the eye button in the chat header, or run **Show thread inspector card**.
  The card is for a quick look: it closes as soon as you click elsewhere, press Escape, resize
  the window or the chat, or use one of its buttons.

Both commands can be bound to keys in **Settings > Keybindings** ("Loom: Thread Inspector:
Toggle" and "Loom: Thread Inspector: Card"). Neither has a default binding.

## Jump from it

Row buttons take you to the right place: **Review** opens the diff, **Last turn** opens the
diff for the most recent turn, **Respond** puts you in the composer where the approval or
question waits, and **Open** shows the agents, terminal, pull request or the thread that
implemented a plan.

## The dot on the eye button

A dot on the eye button means the thread is waiting on you: amber for an approval, your
theme's accent color for a question. You do not need to open the card to see it.

## Good to know

- On a window narrower than 900 pixels the card shows Status and Attention first and folds
  the other sections to one line each; click a line to expand it.
- Changes only appear for git repositories.
- A new thread shows its status and workspace until you send the first message.
- The inspector reads what the app already knows, so it also works when connected to a
  standard T3 Code server.
