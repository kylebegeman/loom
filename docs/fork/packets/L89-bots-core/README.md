# L89: Bots core and the Bots page

Status: Implemented on `feat/loom-bots`.

A bot is a named, reusable job: a fixed brief with typed inputs, a pinned model, fixed modes,
a workspace rule, a timeout and a concurrency limit. Running a bot fills in its inputs and starts
an ordinary thread with exactly those settings. Runs stay out of the main thread list and appear
on a new Bots page, reached from a bot icon in the sidebar footer, where Kyle defines bots, runs
them from a generated form, and watches what is running, finished or failed. Agents define, list
and run bots through MCP, and the command palette opens the page or runs a bot.

## Scope

- In: bot definitions in fork SQLite with versions bumped on each save; typed parameters
  (`string`, `text`, `number`, `boolean`, `choice`) rendered into `{{param}}` placeholders;
  runs launched through `ThreadLaunchService` with the bot's own model, modes and workspace;
  server-enforced wall-clock timeout and per-bot plus environment-wide concurrency; run history
  with the final reply captured; cancel; restart recovery; the Bots page (library, editor, run
  form, running and recent runs, failures); MCP `loom_bots_list`, `loom_bots_define`,
  `loom_bots_run`, `loom_bots_run_status`, `loom_bots_cancel`; palette "Go to Bots" and
  "Run bot"; user guide.
- Out: starter bots (L90), composer `/` invocation and agent guidance (L91), structured verdicts
  (L92), batches (L93), the outcome inbox and promote to thread (L94), budgets and usage (L95),
  save thread as bot (L96), triggers (L97), version history and replay (L98), pipelines (L99),
  Library sync and remote targets (L100). Turn limits and tool allowlists wait for a per-adapter
  decision. Mobile shows nothing new.

## Surfaces

Web and desktop: the Bots page at `/loom/bots`. Mobile: unsupported in V1; bot run threads are
hidden from mobile navigation by the shared client-runtime filter, so nothing appears there.
Remote: all calls are RPC over the environment WebSocket, so local, Tailscale and T3 Connect
behave the same. The page is gated on `bots` in `capabilities.loomFeatures`; an older server
hides the footer entry and palette items.

## Extension points used

`ext-core` (contracts, service, RPC, capability), persistence, background work (restart recovery
under `forkParked`), `ext-palette`, `ext-mcp`. Route file `apps/web/src/routes/loom.bots.tsx`.

## Packet seams

- `apps/web/src/components/sidebar/SidebarChrome.tsx`: the Bots footer entry after Sites.
- `apps/web/src/components/sidebar/mainAppLocation.ts`: `/loom/bots` counts as a utility page.
- `apps/web/src/components/Sidebar.logic.ts`: hide bot run threads from the sidebar.
- `packages/client-runtime/src/state/threadShell.ts`: hide bot run threads from navigation.
- `apps/web/src/components/ThreadNotificationCoordinator.tsx`: no completion notifications for
  bot runs.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
