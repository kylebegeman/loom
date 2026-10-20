# L92: Structured verdicts

Status: Selected; queued.

A bot can promise a structured answer instead of free text: pass, fail or needs attention, a
one-paragraph summary and a list of findings with optional file and line. Loom asks for that
shape in the run's instructions, decodes it from the final reply, and stores it next to the run.
The Bots page shows a verdict chip on every run and the findings underneath; agents get the same
verdict as JSON through MCP. A reply that cannot be decoded is never silently dropped: the run is
marked "needs attention" and keeps the raw reply.

B04 | Complexity: Medium | Impact: High | Depends on: L89

## Scope

- In: an `output` setting on bot definitions (`text` default, or `verdict`); the appended reply
  request; decoding with caps; `needs_attention` with the raw reply on decode failure; verdict
  columns on runs; a verdict filter on `listRuns`; chips and findings on the Bots page; verdict JSON
  in `loom_bots_run`, `loom_bots_run_status` and the L91 delivery message; a new starter revision
  that turns verdicts on for the reviewer and verifier.
- Out: custom output schemas per bot (one fixed verdict shape keeps batch reports and pipeline
  gates simple); provider-native structured output (each adapter differs, and a bot run is a normal
  agent turn, not a text-generation call).

## Surfaces

Web and desktop: chips and findings on the Bots page and in the composer runs popover (L91).
Mobile: nothing new. Remote: verdicts travel inside `BotRun`, so every connection mode gets them.
Gated on `bots-verdicts`.

## Extension points used

None new (L89's): `ext-core`, persistence, `ext-mcp`. Capability sub-feature `bots-verdicts`.

## Packet seams

None.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
