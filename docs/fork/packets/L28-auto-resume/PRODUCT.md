# L28 product

Selection: F7 in [selections.md](../../selections.md) is listed under "Not selected"; Kyle
confirmed it for this packet in the 2026-09-24 brainstorm.

## Problem

Kyle runs long agent threads, often overnight or while away. When a Codex account runs out
of its 5-hour or weekly window, the turn stops with "Codex usage limit reached. The session
limit resets in 3h 20m. Send the message again once the limit resets." The thread then sits
idle until he notices and types "continue". With several threads, the lost hours add up.
He also has more than one Codex account and would sometimes rather move on to the other
one than wait.

## What the user can do

- Let Loom continue a stopped thread by itself when the limit resets. A marker in the thread
  says "Loom will resume this thread in 3h 20m, after the session limit resets." and later
  "Loom resumed this thread."
- See the pending resume under the composer: "Resumes in 3h 20m" with Resume now and Cancel.
- Resume now (for example after redeeming a reset credit in Usage) or cancel.
- Send any message to take over; the pending resume is cancelled and the marker says so.
- In Settings, Loom, Auto-resume:
  - turn auto-resume on or off per provider (Codex, Claude, Grok);
  - allow switching to another account of the same provider, with a note on which accounts
    qualify;
  - edit the continue message;
  - see every pending resume across threads, with Cancel on each.
- From the command palette on a thread with a pending resume: "Resume now after usage
  limit" and "Cancel auto-resume".

## Entry points

| Entry                        | Way in                                                                                        | Way out                                 | Where the state shows          |
| ---------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------ |
| Automatic                    | A usage-limit stop on a thread whose provider is enabled in settings                          | Cancel, a sent message, archive, delete | Timeline marker; composer chip |
| Composer chip (web, desktop) | Appears while a resume is pending on this thread                                              | Cancel on the chip                      | The chip itself                |
| Command palette              | "Resume now after usage limit", "Cancel auto-resume" (only on a thread with a pending resume) | Same items                              | Chip and marker                |
| Settings                     | Settings, Loom, Auto-resume                                                                   | Toggle off; per-row Cancel              | Pending list in the section    |
| Keybinding                   | None. The action is rare and time-bound; the palette covers keyboard use.                     |                                         |                                |
| Mobile                       | Marker in the timeline (upstream app)                                                         | Send a message                          | Marker                         |

Every schedule has a way out (cancel, take over) and a way to see it (marker, chip, list).

## States

- **Scheduled with a known reset:** chip "Resumes in 3h 20m" (updates once a minute, not a
  running animation), tooltip with the local wall-clock time and the account name.
- **Scheduled without a known reset** (Grok, or Codex without window data): "Loom will check
  again in 30m" and the attempt number ("check 2 of 6").
- **Switching account:** marker "Loom will continue on <account> because <old account> hit its
  session limit." Resume happens after a 10 second grace so a Cancel click can still win.
- **Still limited at resume time:** if the account's windows still show 100% used, the
  resume moves to the new reset time without counting an attempt; marker "The limit has not
  reset yet. Loom will try again in 25m."
- **Resuming:** chip "Resuming" until the new turn starts; then the chip disappears.
- **Resumed:** marker "Loom resumed this thread." (with the account name when it switched).
- **Stopped again by a limit:** a new schedule, attempt count carried over; after 6 attempts
  in a row (configurable 1 to 10) Loom gives up: marker "Loom stopped trying to resume this
  thread after 6 attempts."
- **Cancelled:** marker "Auto-resume cancelled." with the reason: by you, a new message,
  archived, or turn already running.
- **Failed to resume:** the dispatch was rejected (for example, the account was disabled):
  marker "Loom could not resume this thread: <reason>." No retry.
- **Disabled:** stops are not scheduled; nothing shows.
- **Server lacks the feature:** chip absent; settings section "Needs a Loom server with
  auto-resume"; palette items absent.

## Surfaces and connection modes

- Web and desktop: full. Desktop uses the same web bundle.
- Mobile: markers only; take over by sending a message.
- Remote: the worker runs on the environment server, where the provider runs, so it keeps
  working when no client is connected at all. That is the point of the feature.
- Upstream T3 server: nothing happens and nothing is shown.
- Several environments: each Loom server schedules its own threads. The settings list shows
  the selected environment's schedules (the page is scope-gated like General).

## Decisions and open questions

Decisions:

- The server does the work, not a client: clients may be closed when the limit resets.
- Resume by sending a user message with existing commands (no new orchestration events).
  The continue message is visible in the thread, so it is obvious what happened.
- When the stopped turn produced no assistant output and no tool calls, Loom sends the
  original message again instead of the continue message, matching upstream's own advice
  ("Send the message again once the limit resets").
- Account switching is limited to instances upstream already lets a thread move between
  (same driver and same continuation group). For Codex that means shadow-home accounts over
  one shared Codex home; for Claude, instances sharing a Claude home (for example the same
  home with different API keys). Separate Claude homes cannot continue each other's threads.
- Defaults: auto-resume on for Codex, Claude and Grok; account switching off; continue
  message "Continue where you left off. The usage limit that stopped the last turn has
  reset."; grace after reset 2 minutes; max 6 attempts.
- Markers use relative waits ("in 3h 20m"), because the server does not know the viewer's
  timezone; the chip shows the local time in its tooltip.

Open questions for Kyle:

1. Default on or off? On means a stop overnight resumes without any action, and also spends
   the fresh window automatically. The design assumes on.
2. When switching accounts, which order: the account with the most headroom (proposed), or a
   fixed order Kyle sets in settings?
3. Should a Codex stop that names a workspace credit or spend limit
   (`workspace_owner_credits_depleted`, `workspace_*_usage_limit_reached`) be skipped, since
   waiting may not help? Proposed: skip unless a window with a reset time is exhausted.
