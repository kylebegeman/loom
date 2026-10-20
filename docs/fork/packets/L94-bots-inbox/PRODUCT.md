# L94 product

## Problem

Bot runs are hidden from the sidebar on purpose (L89), which keeps it clean. The cost is that a
run that fails, times out, or ends unsure leaves no trace Kyle will see unless he opens the Bots
page and scans the run list. Worse, a run that stops to ask for an approval just sits there until
its timeout, because nobody can see the question.

## What Kyle gets

- **A count.** The Bots footer entry reads "2 need attention" when the inbox is not empty, and
  nothing extra when it is.
- **Waiting for you.** Runs blocked on an approval or a question are listed first, with the
  kind of request and how long it has waited, and "Open thread" to answer it in place.
- **Needs attention.** Failed and timed-out runs, and completed runs whose verdict is
  "needs attention", newest first. Each shows the bot, inputs, how long it ran, the error or
  verdict summary, and its batch when it came from one.
- **Retry.** Reruns the same inputs with the bot's current definition. The new run replaces the
  old item in the inbox; the old run stays in history, linked as "retried by".
- **Retry on another model.** The same, with a model picked for this one run, for when a provider
  is down or a model gave up. The bot definition does not change.
- **Dismiss.** Removes an item from the inbox without rerunning it. A "Dismissed" filter shows
  them again and "Restore" puts one back.
- **Open as thread.** Forks the run into a normal thread named after the bot and its inputs. The
  thread appears in the sidebar with the full transcript, and Kyle continues the conversation
  from there. The run records the thread, so a second click opens the same thread.

## Decisions

- A "fail" verdict is not an inbox item. It is a completed answer ("this change has a bug"), shown
  with a red chip on the Bots page. "Needs attention" means the bot could not decide, which is
  Kyle's job.
- Cancelled runs are not inbox items: Kyle or an agent chose to stop them.
- A retried run leaves the inbox at once, even before the retry finishes; if the retry fails, the
  retry is the new item.
- Runs started by an agent appear too. An agent that wants its own failures handled should read
  them through `loom_bots_inbox`.

## Not in this packet

Push notifications, email, mobile inbox screens, and automatic retries.
