# L97: Event triggers

Status: Implemented on `feat/loom-bots`. See [SEAMS.md](./SEAMS.md) for where the build differs
from this plan.

Bots run when something happens, not only when someone asks. Kyle binds a bot to an event and
maps the event's fields to the bot's inputs: "When a check fails on any pull request in Loom, run
Verifier with the failing checks." Events are a pull request check failing, a pull request
opening, a thread settling, a merge conflict during `loom.sh integrate`, a webhook, and a
schedule. Each trigger pins a bot version, respects budgets (L95), and never fires twice for the
same event. Results and skipped firings arrive in the inbox (L94).

B09 | Complexity: Large | Impact: High to Transformational | Depends on: L89 (L94 for the inbox,
L95 for budgets, L98 for running a pinned older version, L93 for fanning out over a list)

## Scope

- In: trigger records in fork SQLite; four event kinds read from the orchestration event store
  with a persisted cursor (pull request checks failing, pull request opened, thread settled) plus
  webhook and schedule; merge conflicts through a webhook that `loom.sh integrate` calls; input
  mapping from event fields; filters (project, repository, branch pattern); version pinning;
  dedupe and a cooldown; budget checks; skipped firings recorded as inbox runs; a Triggers tab on
  the Bots page with a firing log; enable, disable, test fire; MCP tools.
- Out: arbitrary event types or expressions; triggers on other bots' results (that is a pipeline,
  L99); GitHub App webhooks registered automatically (Kyle pastes the URL into GitHub himself).

## Surfaces

Web and desktop: Triggers tab and a trigger editor on the Bots page. Mobile: nothing new.
Remote: RPC only; webhook triggers use the same public URLs as scheduled task webhooks (direct,
tunnel or T3 Connect relay). Gated on `bots-triggers`.

## Extension points used

None new (L89's): `ext-core`, persistence, background work under `forkParked`, `ext-mcp`.
Capability sub-feature `bots-triggers`.

## Packet seams

One: `fork: bots` in `apps/server/src/scheduledTasks/webhookRoute.ts` hands requests whose hook
id starts with `bot-trigger-` to the bot trigger service. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
