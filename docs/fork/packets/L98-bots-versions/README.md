# L98: Versions and replay

Status: Implemented on `feat/loom-bots`. See [SEAMS.md](./SEAMS.md) for where the build differs
from this plan.

Improve a bot without worrying that a change made it worse. Every save keeps the full definition
as a numbered version, and every run already records which version it used. Kyle can see a bot's
history, compare any two versions, mark one as the known-good version that triggers and pipelines
use, and replay: run an edited draft against a chosen set of past runs' inputs and see the new
results next to the originals before saving. Runs can carry a rating and a note, and "Suggest an
edit" turns the down-rated runs into a proposed change to the brief.

B11 | Complexity: Large | Impact: High | Depends on: L89 (L92 for verdict comparisons, L95 for
cost, L96 for drafting, L97 and L99 as consumers of the stable version)

## Scope

- In: a versions table written on every save; version numbers that never repeat, including after
  a bot is deleted and recreated; history and diff; restore an old version as a new one; a stable
  version per bot; running a specific version (used by L93, L97, L99); replay of a draft or a
  saved version over 1 to 20 past runs with a side-by-side view; ratings and notes on runs;
  "Suggest an edit" through a hidden drafting thread; MCP tools.
- Out: branching or merging versions; replay against inputs that never ran; automatic scoring
  of text results (verdict bots compare verdicts; text bots are compared by Kyle).

## Surfaces

Web and desktop: History and Replay tabs in the bot editor, rating controls on run rows. Mobile:
nothing new. Remote: RPC only. Gated on `bots-versions`.

## Extension points used

None new (L89's): `ext-core`, persistence, `ext-mcp`. Capability sub-feature `bots-versions`.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
