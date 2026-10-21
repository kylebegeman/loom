# L97 product

## Problem

The routine work around Kyle's repositories is event shaped. A check fails and someone has to read
the log; a pull request opens and someone has to review it; an upstream merge stops on conflicts
and each file needs the resolver. Today Kyle notices, opens a thread and briefs an agent. The
pull request watch already wakes a thread when a check fails, but it wakes the thread that opened
the pull request, with whatever brief that thread happens to have.

## What Kyle gets

- **Triggers on a bot.** Each bot has a Triggers section, and the Bots page has a Triggers tab
  listing all of them: the event, the filter, the bot version, and when it last fired.
- **Six events.**
  - _Pull request checks failing_: a linked pull request's checks turn to failing. Inputs can use
    the repository, number, title, branch, URL and the failing check names.
  - _Pull request opened_: a pull request is linked to a thread for the first time while open.
  - _Thread settled_: a thread in a chosen project settles. Inputs can use its title, id and
    branch.
  - _Merge conflict during integrate_: `scripts/fork/loom.sh integrate` stops on conflicts. The
    trigger gets the tag and the conflicted files, and runs the bot once per file.
  - _Webhook_: a URL to paste into GitHub or any service, with the same optional signature check
    as scheduled task webhooks. Inputs map to fields of the request body, for example
    `body.pull_request.number`.
  - _Schedule_: every N minutes or at a time of day on chosen weekdays, with fixed inputs.
- **Mapping.** For each bot parameter, Kyle picks an event field or types a fixed value. Required
  parameters must be mapped before the trigger can be enabled.
- **Filters.** Project, repository, and a branch pattern (`main`, `release/*`), where the event
  has them.
- **Pinned version.** A trigger runs the bot version it was saved with. When the bot changes, the
  trigger shows "Bot changed since this trigger was set" with Review and Use latest. Until Kyle
  chooses, firings use the pinned version (with L98) or are skipped into the inbox (before L98).
  A trigger can instead be set to always follow the latest version.
- **Never twice.** One pull request check failure on one commit fires once, however often the
  sync sees it. Each trigger also has a cooldown (default 10 minutes) and a daily limit (default
  20 firings).
- **Budgets apply.** A firing over the bot's budget (L95) is not run; it becomes a skipped run in
  the inbox with the reason.
- **Firing log.** Each trigger shows its last 50 firings: event, time, the run it started or why
  it was skipped. "Test fire" runs the trigger with a sample event Kyle can edit.
- **Agents.** An orchestrator can list, create and enable triggers through MCP, within its own
  runtime mode.

## Decisions

- Pull request events cover pull requests linked to a Loom thread, because those are the ones
  the server syncs. Repository-wide coverage comes from a GitHub webhook trigger.
- Checks failing fires on the change to failing, not on every sync while failing, and again only
  after the head commit changes.
- Events that happen while the server is stopped are still seen after it starts: the trigger
  service reads from where it stopped. Schedules follow the scheduled task rules: an interval
  that came due while stopped runs once at startup, and a time of day missed by more than 10
  minutes moves to its next time instead of running late.
- Triggered runs appear as started by Kyle (or by the agent that created the trigger), with the
  trigger named on the run.

## Not in this packet

Triggers on other bots' outcomes, conditions beyond the filters above, and registering webhooks
in GitHub on Kyle's behalf.
