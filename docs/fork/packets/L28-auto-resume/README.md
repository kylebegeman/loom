# L28: Auto-resume after usage limits

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

When a provider stops a thread's turn because the account ran out of usage, Loom's server
notices, works out when the limit resets, and continues the thread by itself once it has.
When another subscription account of the same provider can pick up the conversation (for
example a second Codex account set up as a shadow home), it moves the thread there right
away instead; this is on by default. A small marker in the thread says what is scheduled,
and the user can resume now, cancel, or turn auto-resume off for that thread.

## Scope

- In:
  - A fork server reactor that detects usage-limit stops for Codex, Claude and Grok from
    orchestration events, with a cursor so no stop is missed across restarts.
  - Reset time from the provider's published usage windows, the Claude rate-limit detail,
    or the stop message, in that order; a bounded retry schedule when nothing says.
  - One scheduled resume per thread in a fork table; resuming dispatches the existing
    `thread.turn.start` command with a continue message (or the original message when the
    stopped turn produced nothing).
  - Automatic cancel when the user sends a message, the thread is archived or deleted, or
    a turn is already running. A per-thread "Don't auto-resume" switch.
  - Account switching, on by default, to another enabled, signed-in instance of the same
    driver in the same continuation group (upstream only lets a thread move between those):
    subscription accounts by default, API-key accounts only when opted in per account;
    most headroom first when every candidate reports usage, otherwise a fixed order from
    settings.
  - "Needs attention" instead of retries for Codex workspace credit and spend-limit stops
    with no window to wait for.
  - Timeline markers (`thread.activity.append`, kinds `loom.auto-resume.*`) that every
    client renders, including upstream web and the App Store mobile app.
  - A composer chip on web and desktop with the countdown, Resume now and Cancel.
  - A Loom settings section and command palette actions.
- Out:
  - Claude turns that the Claude SDK parks until the window reopens (the turn keeps
    running and Claude continues by itself). Moving a parked turn to another account would
    mean interrupting it; not in v1.
  - Cursor, OpenCode and Antigravity: upstream has no usage-limit signal for them today.
  - Redeeming Codex reset credits automatically (upstream already offers "Use reset" in
    Usage; spending a credit stays a human decision).
  - Resuming turns stopped for any other reason (crashes, network errors, auth expiry).
  - Mobile UI for settings or cancel. On mobile, sending any message cancels the schedule.
  - Switching Claude threads between accounts. Kyle's `~/.claude_N` homes share only
    `CLAUDE.md`, `settings.json` and skills, and each home is its own continuation group, so
    Claude waits for the reset on the same account.
  - Follow-up: investigate sharing Claude session folders across homes plus an upstream
    grouping change, which would make Claude accounts switchable. Recorded, not designed.

## Surfaces

- Web and desktop: chip, settings, palette.
- Mobile: timeline markers only (upstream app renders them as generic work log rows);
  sending a message from the phone cancels the pending resume.
- Remote: all server-side; works over every connection mode.
- Upstream T3 server: no chip, settings section says "Needs a Loom server with auto-resume".

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) with Persistence (fork tables, per-packet migrations) and Background work (a
  fork reactor), may create it.
- [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer) (a footer block for the chip), may create it.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings), may create it.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), may create it.

## Packet seams

None.

## Optional integrations

None required. If packet L07 (bottom dock) ships an Activity tab, the `loom.auto-resume.*`
markers appear there like any other activity with no extra work.

## Size

Medium: about 1,800 lines including tests. One agent, 2.5 to 3.5 days. Most of the risk is
in the detection rules, the switch target rules and the reactor's cancel conditions, which
are unit tested.

## How an agent starts

Read `AGENTS.md`, `FORK.md`, the packets `README.md`, `CONVENTIONS.md`,
`EXTENSION-POINTS.md` (sections 1, 2, 4, 7, 8, 11, 12), then this folder in order:
PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING, REFERENCES.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
