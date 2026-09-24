# L28 product

Selection: F7 in [selections.md](../../selections.md), first listed as not selected; confirmed
for this packet on 2026-09-24.

## Problem

Kyle runs long agent threads, often overnight or while away. When a Codex account runs out
of its 5-hour or weekly window, the turn stops with "Codex usage limit reached. The session
limit resets in 3h 20m. Send the message again once the limit resets." The thread then sits
idle until he notices and types "continue". With several threads, the lost hours add up.
He also has more than one Codex subscription account and would rather move on to the other
one than wait.

## What the user can do

- Let Loom continue a stopped thread by itself when the limit resets. A marker in the thread
  says "Loom will resume this thread in 3h 20m, after the session limit resets." and later
  "Loom resumed this thread."
- Let Loom move a stopped Codex thread to another Codex subscription account right away, when
  one in the same group has room (on by default). Claude threads wait for the reset.
- See the pending resume under the composer: "Resumes in 3h 20m" with Resume now and Cancel.
- Turn auto-resume off for one thread ("Don't auto-resume this thread") from the chip, the
  palette or Settings, and back on.
- Resume now (for example after redeeming a reset credit in Usage) or cancel.
- Send any message to take over; the pending resume is cancelled and the marker says so.
- In Settings, Loom, Auto-resume:
  - turn auto-resume on or off per provider (Codex, Claude, Grok);
  - switch accounts on a limit (on by default), with a note on which accounts qualify;
  - see the accounts per group with their kind (subscription or API key) and usage, include
    or exclude each one ("Include in automatic switching", off for API-key accounts by
    default), and set the fixed order used when usage is unknown;
  - edit the continue message;
  - see every pending resume and every "Needs attention" stop across threads, with Cancel or
    Dismiss on each, and the threads with auto-resume off, with "Allow" on each.
- From the command palette on a thread with a pending resume: "Resume now after usage
  limit" and "Cancel auto-resume". On any thread: "Don't auto-resume this thread" or "Allow
  auto-resume for this thread".

## Entry points

| Entry                        | Way in                                                                                        | Way out                                                                    | Where the state shows          |
| ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------ |
| Automatic                    | A usage-limit stop on a thread whose provider is enabled in settings                          | Cancel, a sent message, archive, delete                                    | Timeline marker; composer chip |
| Composer chip (web, desktop) | Appears while a resume is pending or a stop needs attention on this thread                    | Cancel or Dismiss on the chip; "Don't auto-resume this thread" in its menu | The chip itself                |
| Per-thread switch            | Chip menu, palette, or Settings list                                                          | "Allow auto-resume for this thread"                                        | Palette label; Settings list   |
| Command palette              | "Resume now after usage limit", "Cancel auto-resume" (only on a thread with a pending resume) | Same items                                                                 | Chip and marker                |
| Settings                     | Settings, Loom, Auto-resume                                                                   | Toggle off; per-row Cancel                                                 | Pending list in the section    |
| Keybinding                   | None. The action is rare and time-bound; the palette covers keyboard use.                     |                                                                            |                                |
| Mobile                       | Marker in the timeline (upstream app)                                                         | Send a message                                                             | Marker                         |

Every schedule has a way out (cancel, take over) and a way to see it (marker, chip, list).

## States

- **Scheduled with a known reset:** chip "Resumes in 3h 20m" (updates once a minute, not a
  running animation), tooltip with the local wall-clock time and the account name.
- **Scheduled without a known reset** (Grok, or Codex without window data): "Loom will check
  again in 30m" and the attempt number ("check 2 of 6").
- **Switching account:** marker "Loom will continue on <account> because <old account> hit its
  session limit." Chip "Continuing on <account> in a few seconds" with Cancel. Resume
  happens after a 10 second grace so a Cancel click can still win.
- **No account to switch to:** the thread waits for the reset on the same account (the
  scheduled state above). This is always the case for Claude today.
- **Needs attention:** a Codex workspace credit or spend limit with no usage window to wait
  for. Marker "Needs attention: <account> hit a workspace credit or spend limit. Loom will not
  retry. Add credits or raise the limit, then send a message." Chip "Needs attention" with
  Dismiss. No retries and no switch.
- **Off for this thread:** a stop adds the marker "Auto-resume is off for this thread." and
  nothing is scheduled.
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

## Decisions

- The server does the work, not a client: clients may be closed when the limit resets.
- Resume by sending a user message with existing commands (no new orchestration events).
  The continue message is visible in the thread, so it is obvious what happened.
- When the stopped turn produced no assistant output and no tool calls, Loom sends the
  original message again instead of the continue message, matching upstream's own advice
  ("Send the message again once the limit resets").
- Account switching is limited to instances upstream already lets a thread move between
  (same driver and same continuation group). For Codex that means shadow-home accounts over
  one shared Codex home; for Claude, instances sharing a Claude home. Separate Claude homes
  cannot continue each other's threads.
- Defaults: auto-resume on for Codex, Claude and Grok (Kyle), with the "Resumes in 3h 20m"
  chip, Cancel, and a per-thread "Don't auto-resume" switch; account switching on; continue
  message "Continue where you left off. The usage limit that stopped the last turn has
  reset."; grace after reset 2 minutes; max 6 attempts.
- Account switching defaults to on for Codex subscription accounts (Kyle, a change from the
  first draft's "off"): on a limit, the thread moves to another account in the same group
  right away instead of waiting, because idle hours are the cost this packet exists to cut.
- Switching order: the most headroom when every candidate reports usage (Codex reports an
  account's usage once it has been used); otherwise the fixed order set in settings (Kyle).
- API-key accounts (`~/.codex_api`, `~/.claude_api`) are never picked automatically; each can
  opt in with "Include in automatic switching" (Kyle). They bill per token, so moving a
  thread there is a spending decision.
- Codex workspace credit and spend-limit stops (`workspace_owner_credits_depleted`,
  `workspace_*_usage_limit_reached`) are skipped unless a window with a reset time is also
  exhausted; they get "Needs attention" instead of retries (Kyle), since waiting cannot fix
  them.
- Claude waits for the reset on the same account: Kyle's `~/.claude_N` homes share only
  `CLAUDE.md`, `settings.json` and skills (not session history), and upstream treats separate
  Claude homes as separate continuation groups. Follow-up (recorded, not designed):
  investigate sharing Claude session folders plus an upstream grouping change to make Claude
  accounts switchable.
- Markers use relative waits ("in 3h 20m"), because the server does not know the viewer's
  timezone; the chip shows the local time in its tooltip.
