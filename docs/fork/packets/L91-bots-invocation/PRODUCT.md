# L91 product

## Problem

Bots live on their own page, but the moment Kyle wants one he is in a thread. Leaving the thread,
finding the bot, copying a path into a form and coming back is enough friction that he writes the
brief inline instead. Agents have the same problem: nothing tells them a pinned bot exists, so
they keep writing new `delegate_task` briefs for jobs a bot already does better.

## What Kyle gets

- **Bots in the `/` menu.** Typing `/rev` shows `/bot:reviewer` after the built-in commands and
  skills, with the bot's description. Archived bots and bots scoped to another project are not
  listed.
- **An inline form.** Picking a bot removes the `/rev` text and opens a small form above the
  composer with the bot's inputs. Choice inputs are a segmented control, booleans a switch, long
  text a textarea. Enter runs; Escape closes. A bot with no inputs runs at once.
- **Runs attached to the thread.** The run uses the current thread's project when the bot lets
  the caller choose. A footer chip ("Reviewer running, 1m") shows runs started from this thread;
  clicking it lists them with Open and Cancel. The thread itself is untouched: no message is added
  unless Kyle asks for one.
- **Send the result here.** A "Post result to this thread" switch in the form (off by default for
  Kyle's own runs). When on, the final reply arrives in the thread as a message from the bot run,
  which also wakes the thread's agent, so "review, then let the agent fix" is one flow.
- **Agents prefer bots.** Every agent gets a short instruction: before writing a `delegate_task`
  brief for a routine job, call `loom_bots_list`, and if a bot matches, run it. `loom_bots_run`
  with `notify: true` returns at once and wakes the caller when the run finishes, like an async
  delegated task.

## Decisions

- Labels use `/bot:<id>`, like `/skill:<name>`, so a bot never shadows a provider command of the
  same name.
- Bot items come after upstream items in the list. They are ranked among themselves only.
- Delivery is opt-in for Kyle and opt-in per call for agents, because a message wakes the agent.

## Not in this packet

A mobile composer entry, per-bot shortcuts and verdict-aware messages (L92 adds the verdict line
to the delivered message).
