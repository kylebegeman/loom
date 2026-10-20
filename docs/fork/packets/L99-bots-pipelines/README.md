# L99: Pipelines

Status: Selected; queued.

Durable chains of bots, such as review, fix, verify. A pipeline is a saved list of steps; each
step runs a bot, and its structured result fills the next step's inputs. A step can fan out over
a list (one run per finding), stop or continue on a verdict, and loop back with a limit ("fix,
then re-review, at most 3 rounds"). Pipelines run on the server, survive restarts, and can mix
providers because each bot keeps its own model. Kyle starts one with a single input and watches a
step-by-step view on the Bots page.

B10 | Complexity: Massive | Impact: Transformational | Depends on: L89, L92 (gates), L93
(fan-out), L98 (pinned versions); L95 and L97 when present

## Scope

- In: pipeline definitions in fork SQLite (at most 12 steps); pipeline inputs; step input
  templates over pipeline inputs and earlier step outputs; fan-out over findings or a list
  output through L93 batches; verdict gates (stop, continue, or go to a step); bounded loops; a
  per-step version (stable, latest, or a number) and optional model override; a durable state
  machine that survives restarts; cancel and resume; a Pipelines tab with an editor and a run
  view; triggers (L97) and MCP can start pipelines.
- Out: arbitrary code steps, conditions beyond verdicts, parallel branches other than fan-out,
  steps that wait for a person (an approval inside a step's thread already pauses it), and
  running steps on other computers (L100).

## Surfaces

Web and desktop: a Pipelines tab on the Bots page with an editor and a run view. Mobile: nothing
new. Remote: RPC and one new subscription. Gated on `bots-pipelines`.

## Extension points used

None new (L89's): `ext-core`, persistence, background work under `forkParked`, `ext-mcp`,
`ext-palette`. Capability sub-feature `bots-pipelines`.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
