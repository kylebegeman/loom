# L25 product

## Problem

Work often starts outside Loom: someone assigns Kyle an issue, labels one `agent`, mentions
him in a PR, or CI goes red on a branch an agent pushed. Today he notices on GitHub, opens
Loom, picks the project, writes a prompt that restates the issue, and starts a thread. For
routine cases that is pure transcription. Loom runs on his Mac with `gh` signed in, so it can
watch for these events and prepare (or start) the thread itself.

## What the user can do

- Create a trigger for a project: choose what to watch, optional filters (labels, include
  pull requests, branches), the prompt template, model and modes, worktree or project
  folder, and whether to ask first or start automatically.
- Test a trigger: see what it would match right now without recording anything.
- See new events in the Inbox, each with its title, repository, author, link, and the
  prompt Loom will send. Start it (optionally changing model or mode first), dismiss it,
  or restore a dismissed one.
- Follow a started event to its thread.
- Retry a failed start; see why it failed.
- Turn a trigger off and on, edit it, delete it.
- Turn all triggers off for an environment in Settings, and set how often Loom checks
  (every 5 minutes by default, as often as every minute), or press "Check now".
- Get a system notification when an event waits for them and Loom is in the background, and
  in-app toasts for everything else; turn either off per device.
- Get the same worktree setup as a manual worktree thread: a triggered worktree thread runs
  the project's setup script before the agent starts.

What each kind watches:

| Kind               | Fires when                                                                                                          | Default action                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `issue-assigned`   | An open issue (optionally PR) in the project's repository is assigned to you                                        | New thread                                              |
| `issue-labeled`    | An open issue in the project's repository carries one of the trigger's labels                                       | New thread                                              |
| `mention`          | You are @mentioned (or your team is) on an issue or PR in the project's repository (mentions elsewhere are ignored) | New thread                                              |
| `review-requested` | Your review is requested on a PR in the project's repository                                                        | New thread, plan mode, prompt asks for a review summary |
| `ci-failure`       | A GitHub Actions run fails on a branch that a Loom thread in the project is on                                      | Follow-up message to that thread                        |

## Entry points

| Entry               | Behavior                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page                | `/loom/triggers`, tabs Inbox and Triggers; `?environmentId=` and `?tab=`.                                                                                                          |
| Command palette     | "Open inbound triggers" (shows the pending count), "Check triggers now", "New trigger for this project".                                                                           |
| Keybinding          | `loom.inbound-triggers.open`, unbound by default.                                                                                                                                  |
| Loom settings       | "Inbound triggers" section: on or off per environment, check interval (1 to 120 minutes, default 5), "Check now", "Open triggers", and the two notification switches (per device). |
| Inbox               | "Check now" in the header and on each trigger row.                                                                                                                                 |
| Toast               | "New from GitHub: <title>" with "Review" when an event waits for you and Loom is focused; "Started from GitHub: <title>" or "Could not start: <title>" for informational events.   |
| System notification | "Waiting for you: <title>" when an event waits for you and Loom is not focused (desktop app; browsers that allow notifications). Clicking opens the Inbox.                         |
| Thread              | A started thread is an ordinary thread; its first message links back to the issue or run.                                                                                          |

Reverse states: Dismiss has Restore; a trigger can be disabled and re-enabled; delete asks
for confirmation and keeps past events (marked "trigger deleted"); auto-start can be switched
back to ask; the whole feature has an off switch per environment.

## States

- Loading: skeletons on both tabs.
- Empty Inbox: "Nothing waiting. Loom checks GitHub every <n> minutes." with "Check now".
- Empty Triggers: "No triggers yet. Create one to start threads from GitHub." with "New
  trigger".
- Trigger health on each row: "Checked 2 minutes ago", "Next check in 3 minutes", or an
  error ("GitHub CLI not installed on <environment>", "Run gh auth login on <environment>",
  "Rate limited until 14:05", "Project removed").
- Feature off: page banner "Inbound triggers are off on <environment>." with "Turn on".
- Disabled (server lacks `inbound-triggers`): "Inbound triggers need a Loom server."
- Starting: the row shows a spinner until the thread exists, then "Started" with a link.
  For a worktree thread with a setup script, the thread itself shows the script starting
  and its terminal; a failed script shows "Setup script failed (exit N); started anyway" on
  the event.
- Notifications blocked: the settings switch shows "Allow notifications" (or, when denied,
  "Allow notifications in your browser or system settings").
- Failed: the reason and Retry.
- Event waiting for a thread: CI follow-ups wait while the target thread is working and say
  "Waiting for <thread> to finish".

## Copy

- Trigger editor sections: "Watch", "Filters", "Prompt", "Thread", "When an event arrives".
- Approval options: "Ask me first" (default) and "Start automatically". Help under
  automatic: "Issue and comment text comes from other people and reaches the agent. Loom
  starts automatically only for private repositories or authors you trust; everything else
  waits in the Inbox."
- Prompt help: "Available fields: {{title}}, {{url}}, {{repository}}, {{number}},
  {{author}}, {{labels}}, {{body}}, {{branch}}, {{workflow}}, {{failedJobs}}, {{runUrl}}."
- Inbox buttons: "Start", "Dismiss", "Restore", "Retry", "Open thread", "Open on GitHub".
- Toasts: "New from GitHub: <title>", "Started from GitHub: <title>", "Could not start:
  <title>".
- System notification: title "Waiting for you: <title>", body "<repository> #<number>".
- Settings switches: "System notification when an event waits for me", "In-app toasts for
  trigger activity".

No em dashes in product copy.

## Surfaces and connection modes

- Web and desktop: full feature.
- Mobile: no UI. Threads started by triggers show on mobile like any thread.
- Remote: supported; each environment polls with its own `gh` credentials; the page lets you
  pick the environment.
- Upstream T3 server: feature hidden or explained; no fork RPC is sent.
- Upstream client talking to a Loom server: unaffected; threads created by triggers are
  ordinary threads with ordinary events.

## Decisions

- Polling first, no public webhook. The Mac is not reachable; `gh` is already signed in.
- Default is "Ask me first". Issue bodies and comments are untrusted text written by other
  people; putting them in front of an agent without review is a prompt-injection risk.
  Automatic starts are limited to private repositories or trusted authors, and the prompt
  frames external text as data.
- Triggered threads default to plan interaction mode and the project's runtime mode, in a
  new worktree, so they never touch the checkout Kyle is working in.
- A new trigger only fires on events after it was created, so enabling one never floods
  the Inbox with a backlog.
- CI failures go to the thread that owns the branch; branches without a Loom thread are
  ignored ("my branch" means a branch Loom is working on).
- One thread per external object: a second event for the same issue does not start another
  thread.
- No new orchestration events or commands; threads are created with upstream's
  `thread.create` and `thread.turn.start`.
- The packet is confirmed (Kyle, 2026-09-24), although it is not in `selections.md`.
- Polling through `gh` only. Webhooks are a recorded follow-up and stay undesigned: the Mac
  has no public endpoint and `gh` already covers the five kinds.
- Triggered worktree threads run the project's setup script, the same as manual worktree
  threads, so a triggered agent starts in a worktree prepared the same way. A failed script is best effort, as upstream treats it: the agent starts anyway and
  the event says so.
- Check interval defaults to 5 minutes, adjustable down to 1 minute, with "Check now": fast
  enough for Kyle's use while staying far under GitHub's rate limit.
- Mentions count only in the project's own repository: a mention elsewhere has no project to
  start in.
- System notification for events that wait on the user ("Ask me first", or held by the
  auto-start guards), because those need a decision; in-app toasts only for informational
  events, which need none. Both have a per-device off switch.
