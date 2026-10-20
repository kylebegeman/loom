# L99 product

## Problem

Kyle's best work runs as a chain: implement, review with three lenses, fix what the reviews
found, verify, and loop if verification fails. Today that chain is a hand-written workflow script
inside one Claude session. It is hard to reuse, it dies with the session, it always uses the same
provider, and it is invisible from the Bots page. Bots (L89) made each role reusable; nothing
connects them.

## What Kyle gets

- **A pipeline editor.** Name, inputs (the same parameter types bots have), and steps. Each step
  picks a bot and fills the bot's inputs from templates such as `{{input.target}}`,
  `{{steps.review.summary}}` or `{{steps.review.findings}}`. The editor checks every template and
  every required input before saving.
- **Fan-out.** "For each finding of Review, run Fix with `{{item.path}}` and `{{item.detail}}`."
  The fan-out runs as a batch (L93), with its progress grid and retry.
- **Gates.** On a verdict bot step: on fail, stop the pipeline, continue, or go to another step;
  on needs attention, stop or continue.
- **Loops.** "Go back to Fix while Verify fails, at most 3 rounds." Each round is visible, and
  the limit is a hard stop with a clear message.
- **Mixed providers.** Each step uses its bot's model, so a Claude reviewer can feed a Codex
  fixer. A step can override the model for this pipeline only.
- **Pinned behaviour.** Each step follows the bot's stable version (L98), the latest, or a fixed
  number. A run records the exact versions it used.
- **Run view.** One row per step with status, duration, verdict chips, and the run or batch
  behind it. A pipeline run ends with a short report: the path it took, each step's summary, and
  the final verdict.
- **Durable.** Quitting Loom or restarting the server does not lose a pipeline run. Running steps
  are picked up where they are; finished steps are not repeated.
- **Starting.** From the Bots page with an input form, from the palette, from an agent through
  MCP, or from a trigger (L97): "When a pull request opens, run Review, Fix, Verify."
- **Starter pipeline.** "Review, fix, verify" built from the L90 starter bots, editable like any
  pipeline.

## Decisions

- Steps run one at a time except inside a fan-out. Parallel branches would make the run view and
  recovery much harder for little gain over fan-out.
- A step's failure (the bot run failed or timed out) stops the pipeline unless the step allows
  continuing. A stopped pipeline can be resumed from that step after Kyle fixes the cause.
- Every bot run a pipeline starts is an ordinary bot run, with the same caps, budgets and inbox
  behaviour; a stopped pipeline puts one item in the inbox for the step that stopped it.
- Agents can start and watch pipelines; editing pipelines through MCP is allowed within the
  agent's runtime mode, the same rule bots follow.

## Not in this packet

Conditional branches on text results, human approval steps, cross-computer steps (L100), and
pipelines of pipelines.
