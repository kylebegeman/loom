# L95: Usage and budgets

Status: Selected; queued.

Show what each bot costs and how well it works, and let Kyle cap it. Every run records the
tokens it used. The Bots page shows, per bot, runs, success rate, median duration and tokens for a
window ("Reviewer: 140 runs this week, 94% pass, 2m median, 3% of tokens"), and the Usage page
gains a short Bots section with the same numbers. A bot can carry a budget (runs per 24 hours,
tokens per 24 hours); a run that would exceed it is refused with a clear message, a batch waits,
and a trigger records a skipped run.

B06 | Complexity: Medium | Impact: Medium-High | Depends on: L89 (L92 for pass rates, L93 for
batches)

## Scope

- In: token columns on runs filled at the terminal step; `loom.bots.usage` for a time window;
  budgets on the definition; enforcement at run start for every caller; batch waiting; the Usage
  tab on the Bots page; budget fields and a static meter in the editor; a Bots section on the
  Usage page; MCP `loom_bots_usage`.
- Out: dollar budgets (provider pricing is a Usage page concern and not available per turn);
  per-project or global bot budgets; monthly windows.

## Surfaces

Web and desktop: Bots page Usage tab, editor budget fields, Usage page section. Mobile: nothing
new. Remote: RPC only; the Usage page section queries each selected environment that supports
`bots-budgets`. Gated on `bots-budgets`.

## Extension points used

None new (L89's): `ext-core`, persistence, `ext-mcp`. Capability sub-feature `bots-budgets`.

## Packet seams

One: `fork: bots` in `apps/web/src/components/usage/UsagePage.tsx` renders the Bots section
after the Totals section. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
