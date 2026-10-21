# Loom Bots product and packet index

Status: **Implementation authorized**. Kyle selected all twelve brainstorm items as the Bots V1
on 2026-10-20 and chose the Loom library (fork SQLite tables) for storage. Surfaces are the Bots
page on web and desktop, agents through MCP, and the command palette. Mobile comes later. L100's
Library and VPS side stays local: nothing is deployed without Kyle's approval. The B01 to B12
identifiers remain stable from the brainstorm; L89 to L100 are their repository packet IDs.

A bot is a named, reusable job with a fixed brief, typed inputs and pinned settings. A bot run is
an ordinary thread under those caps. The goal is not deterministic output. The goal is that every
run gets the same focus, settings and constraints, however well or badly the caller phrased the
request.

## Why

About 75 of Kyle's last 100 settled threads were repeated role runs that an orchestrator briefed
from scratch each time (`resolve:<file>`, `review:*:correctness`, `verify:*`, `survey:*`,
`scan:*`, `critic`, `fix:*`). Each brief drifted a little, each run picked whatever model the
caller had, and each one cluttered the Settled list. Bots make those roles named, versioned and
measurable, and keep their runs out of the main thread list.

## Shared design

Every packet builds on L89. The rules below hold across all of them.

- **Slug and names.** The feature slug is `bots`. RPC tags are `loom.bots.<verb>`, MCP tools are
  `loom_bots_<verb>`, tables are `fork_bots_<noun>` tracked in `fork_migrations_bots`, the web
  route is `/loom/bots`, and capability entries are `bots` plus one sub-feature per later packet
  (for example `bots-verdicts`).
- **A definition** has an id (slug), name, description, instructions with `{{param}}`
  placeholders, typed parameters, a pinned model selection, runtime and interaction modes, a
  workspace (scratch folder, project checkout, or new worktree), a wall-clock timeout, a maximum
  number of concurrent runs, and an optional project scope. Every save bumps its version.
- **A run** launches one thread through `ThreadLaunchService` with the bot's settings, never the
  caller's. Its thread id starts with `bot-run-` (`isBotRunThreadId`), which keeps it out of the
  sidebar, navigation and notifications the same way subagent threads are kept out. The Bots page
  lists runs instead.
- **Caps enforced by the server**: pinned model and modes, workspace, wall-clock timeout (the run
  is interrupted), per-bot and environment-wide concurrency. An agent caller can never start a bot
  whose runtime mode is broader than its own. Turn limits and tool allowlists are decided per
  provider adapter in a later packet; today only Claude exposes both.
- **One store, one service.** `BotsService` owns definitions and runs. RPC handlers, MCP tools,
  the palette and later triggers call its methods; nothing launches a bot run another way.
- **Bounded payloads.** Run lists are paged and capped; stored result text is capped at 16 KiB.
  The Bots page subscribes to one change stream that carries the changed run or definition only.

## Packet catalog

Each folder contains README, PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING and REFERENCES.
Complexity and impact are the brainstorm estimates, not delivery dates.

### Minor Features & Improvements

| Idea | Packet                                            | Complexity   | Impact      |
| ---- | ------------------------------------------------- | ------------ | ----------- |
| B01  | [L90 `bots-starters`](./L90-bots-starters/)       | Small        | High        |
| B02  | [L96 `bots-from-thread`](./L96-bots-from-thread/) | Medium       | High        |
| B03  | [L91 `bots-invocation`](./L91-bots-invocation/)   | Small-Medium | High        |
| B04  | [L92 `bots-verdicts`](./L92-bots-verdicts/)       | Medium       | High        |
| B05  | [L94 `bots-inbox`](./L94-bots-inbox/)             | Medium       | High        |
| B06  | [L95 `bots-budgets`](./L95-bots-budgets/)         | Medium       | Medium-High |

### Major Features

| Idea | Packet                                        | Complexity    | Impact                   |
| ---- | --------------------------------------------- | ------------- | ------------------------ |
| B07  | [L89 `bots-core`](./L89-bots-core/)           | Large         | Transformational         |
| B08  | [L93 `bots-batches`](./L93-bots-batches/)     | Large         | High                     |
| B09  | [L97 `bots-triggers`](./L97-bots-triggers/)   | Large         | High to Transformational |
| B10  | [L99 `bots-pipelines`](./L99-bots-pipelines/) | Massive       | Transformational         |
| B11  | [L98 `bots-versions`](./L98-bots-versions/)   | Large         | High                     |
| B12  | [L100 `bots-anywhere`](./L100-bots-anywhere/) | Large-Massive | Transformational         |

## Build order

1. L89, L90, L91, L92: the core, starter bots, invocation from the composer and agents, verdicts.
2. L93, L94, L95, L96: batches, the outcome inbox, usage and budgets, save thread as bot.
3. L97, L98: event triggers, versions and replay.
4. L99, L100: pipelines, Library bots that run anywhere (local side only).

L90 to L100 depend on L89 the way the 3D follow-ups depend on L23. Each later packet lists the
L89 surfaces it extends instead of claiming new extension points.
