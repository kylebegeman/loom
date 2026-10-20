# L93: Batches

Status: Selected; queued.

Run one bot over many inputs as a single action. Kyle picks a bot and a source (pasted lines, a
file glob, the current merge conflicts, open pull requests, or search results), sees how many
items it found, and starts the batch. Loom runs the items through the bot's normal concurrency
limits, shows a progress grid, lets Kyle retry only the failures, and produces one report with the
combined verdicts. Agents start batches with a list of inputs through MCP.

B08 | Complexity: Large | Impact: High | Depends on: L89 (L92 for verdict counts, L90 for the
resolver starter)

## Scope

- In: batch records and items in fork SQLite; six sources (lines, glob, merge conflicts, pull
  requests, search, explicit `inputs[]`); a preview that resolves a source without starting
  anything; at most 200 items per batch; feeding items through the existing per-bot and
  environment semaphores; restart recovery that never loses an unstarted item; cancel; retry
  failed (and optionally needs-attention) items; a report with counts by status and verdict;
  the batch view on the Bots page; MCP `loom_bots_run_batch`, `loom_bots_batch_status`,
  `loom_bots_batch_retry`, `loom_bots_batch_cancel`; palette "Run bot on many".
- Out: cross-bot batches (that is a pipeline, L99); sources that need an external service beyond
  the existing pull request provider; editing items after start.

## Surfaces

Web and desktop: a "Run on many" flow on each bot and a Batches tab on the Bots page. Mobile:
nothing new. Remote: all RPC plus one new subscription, so every connection mode works. Gated on
`bots-batches`.

## Extension points used

None new (L89's): `ext-core`, persistence, background work under `forkParked`, `ext-palette`,
`ext-mcp`. Capability sub-feature `bots-batches`.

## Packet seams

None.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
