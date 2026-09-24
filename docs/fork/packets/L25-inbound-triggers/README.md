# L25: Inbound triggers

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Loom starts work from outside events. A trigger watches GitHub for a project: an issue
assigned to you, an issue given a label, an @mention of you, a review request, or a failed
CI run on a branch a Loom thread is working on. When one arrives, Loom puts it in an Inbox
with a ready-made prompt; you press Start and a new thread (in its own worktree) begins
working on it, or, for a CI failure, the thread that owns the branch gets a follow-up
message. Triggers can also start threads automatically, with guards. The Mac is not
publicly reachable, so the server polls GitHub with `gh`; receiving webhooks through a
home-lab relay is designed here as a later phase.

## Scope

- In (phase 1 and 2, required):
  - Trigger definitions per project: kind, filters, prompt template, model, runtime and
    interaction mode, worktree or project folder, approval (ask or auto, with guards).
  - A server poller (default every 5 minutes) using `gh api`, with cursors, deduplication,
    backoff and "only new events from the moment the trigger is created".
  - Kinds: `issue-assigned`, `issue-labeled`, `mention`, `review-requested`, `ci-failure`.
  - Inbox: pending events with Start, Dismiss (and Restore), started events linked to their
    thread, failed events with Retry. Deterministic ids so a retried start never creates a
    second thread.
  - A toast when new events arrive while Loom is open, and a pending count in the palette.
  - A `/loom/triggers` page (Inbox, Triggers), a Loom settings section (on/off, interval),
    palette actions and one unbound keybinding command.
- In (phase 3, optional, not required for done): GitHub webhook receipt at
  `/api/loom/inbound-triggers/github/<triggerId>` with a per-trigger HMAC secret, feeding the
  same pipeline, for use behind a home-lab relay.
- Out:
  - Slack, Telegram, email, Linear and other sources (later packets can add a source to the
    same pipeline).
  - Schedules (cron-style runs without an external event).
  - Running a project's worktree setup script for triggered threads (phase 1 skips it; see
    PRODUCT.md, open questions).
  - Marking GitHub notifications as read, commenting back on issues, or any write to GitHub.
  - Starting threads while the Loom server is not running (a quit desktop app polls nothing).
  - T3 Connect relay, mobile UI, MCP tools.

## Surfaces

Web and desktop: supported. Mobile: not supported (the phone runs upstream's app); threads a
trigger starts are ordinary threads and appear everywhere, including mobile. Remote: triggers
live on the environment that owns the project, and that server polls GitHub with its own
`gh` login; the page manages any connected environment that supports the feature.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group including one subscription tag, `ForkLayer` service and
  background poller, persistence, capability `inbound-triggers`; phase 3 uses the HTTP
  routes part).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (toast coordinator and shortcut host),
  [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings) (command `loom.inbound-triggers.open`).

## Packet seams

- `apps/web/src/routes/loom.triggers.tsx`: new fork-owned route file.
- `apps/web/src/routeTree.gen.ts`: regenerated.

No edits to upstream source lines. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L06 (source control cockpit) is present, the CI-failure follow-up prompt may include
  the failing job's log tail through L06's server service; otherwise it includes job names
  and links.
- If L19 (project lifecycle) is present, nothing changes; a parked project's triggers are
  skipped because its folder is missing (the event stays pending with a reason).

## Size estimate

Large: about 2.5k to 3k lines with tests. Contracts ~300, server (store, sources, poller,
starter, templates) ~1,200, web (page, editor, inbox, toasts, settings) ~900, tests ~500.
Phase 3 webhooks ~300 more.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder. Build in phases (IMPLEMENTATION.md): store and pure logic, sources with recorded
GitHub responses, the starter against a real orchestration engine in tests, then the web.
Never point a development poller at a real repository with auto-start on.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
