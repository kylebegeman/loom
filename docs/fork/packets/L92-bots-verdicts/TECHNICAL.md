# L92 technical design

## Overview

```text
loom.bots.run (verdict bot)
   render.ts: instructions + inputs + VERDICT_REPLY_REQUEST ─▶ ThreadLaunchService.launch (L89)
   waitForThread ─▶ final assistant reply (full text, before the 16 KiB cap)
   verdict.ts: extractJsonObject ─▶ lenient decode ─▶ clip to caps
        ok   ─▶ verdict { pass | fail | needs_attention, summary, findings }
        fail ─▶ verdict { needs_attention, "not a valid verdict" }, verdictSource "invalid"
   terminal run row: result (capped) + verdict_json + verdict column ─▶ watch / MCP
```

The run lifecycle is L89's. This packet changes what is appended to the prompt and what is
recorded at the terminal step for completed runs.

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BotOutput = Schema.Literals(["text", "verdict"])`.
- `BotDefinitionInput` gains `output: Schema.optionalKey(BotOutput)`; absent means `text`, so
  every L89 definition and older client save stays valid.
- `BotVerdictValue = Schema.Literals(["pass", "fail", "needs_attention"])`.
- `BotFinding = Schema.Struct({ title, detail, path: optionalKey, line: optionalKey(Int >= 1) })`
  with `title` at most 200 characters, `detail` at most 4,000, `path` at most 1,000.
- `BotVerdict = Schema.Struct({ verdict: BotVerdictValue, summary (at most 2,000), findings:
Array(BotFinding) (at most 50), findingsTruncated: Boolean, source: Literals(["decoded",
"invalid"]) })`.
- `BotRun` gains `verdict: Schema.optionalKey(Schema.NullOr(BotVerdict))`. Null for text bots and
  for runs that did not complete.
- `BotsListRunsInput` gains `verdict: Schema.optionalKey(BotVerdictValue)`.
- `BOTS_VERDICTS_FEATURE = "bots-verdicts"`.

Constants: `BOTS_VERDICT_MAX_FINDINGS = 50`, `BOTS_VERDICT_SUMMARY_MAX = 2000`.

## Reply request

`apps/server/src/fork/bots/verdict.ts` exports `VERDICT_REPLY_REQUEST`, appended by
`render.ts` after the rendered instructions for `output: "verdict"` bots:

```text
## Reply format

End your work with a final reply that contains only this JSON object, with no prose before or
after it:

{"verdict":"pass"|"fail"|"needs_attention","summary":"<one paragraph>","findings":[{"title":"...","detail":"...","path":"optional/relative/path","line":123}]}

Use "pass" when the job succeeded or nothing is wrong, "fail" when you found a problem, and
"needs_attention" when you could not decide or need a person. Keep at most 50 findings.
```

The text lives in fork code, not in the bot's stored instructions, so improving it improves
every verdict bot at once and a saved definition never carries a stale copy. L98's version diff
shows the stored instructions only, which is what Kyle edits.

## Decoding

`decodeVerdictReply(reply: string): BotVerdict`, pure and total:

1. `extractJsonObject(reply)` (`packages/shared/src/schemaJson.ts:192`) takes the outermost
   object, which tolerates a fenced code block or a stray sentence.
2. Decode with a lenient wire schema: the same fields without length caps, `findings` optional
   (absent means none), `line` accepting a numeric string. Unknown keys are ignored. This mirrors
   `decodeJsonReply` (`packages/provider-core/src/server/textGenerationOperations.ts:58`) but
   cannot reuse it: that helper maps failures to `TextGenerationError` for a fixed operation set.
3. Clip: titles, details, summary and paths are cut to their caps with a trailing ellipsis;
   findings beyond 50 are dropped and `findingsTruncated` is set. Clipping keeps a good-faith
   reply useful instead of failing it on length.
4. Any failure in steps 1 to 2 returns `{ verdict: "needs_attention", summary: "The bot's reply was
not a valid verdict. The raw reply is below.", findings: [], findingsTruncated: false, source:
"invalid" }`.

Decoding runs on the full final assistant reply, before L89 caps `result` at
`BOTS_RESULT_MAX_BYTES`. A long reply whose JSON sits past 16 KiB still decodes; the stored
`result` is the capped raw text either way, so the "raw reply" Kyle sees is the same text the
transcript holds, cut at the cap with `resultTruncated` set.

Only `completed` runs are decoded. `failed`, `cancelled` and `timed_out` runs keep `verdict: null`:
there is no final answer to judge, and L94's inbox already lists them by status.

## Storage

Migration 4 `RunVerdicts` (next free id if another bots migration landed first):

```sql
ALTER TABLE fork_bots_runs ADD COLUMN verdict TEXT;          -- pass | fail | needs_attention
ALTER TABLE fork_bots_runs ADD COLUMN verdict_json TEXT;     -- BotVerdict
CREATE INDEX IF NOT EXISTS fork_bots_runs_verdict ON fork_bots_runs (bot_id, verdict, created_at DESC);
```

`verdict` duplicates `verdict_json.verdict` so filters and counts (L93 reports, L95 success rate)
use the index without decoding JSON. `BotsStore` writes both in the terminal update and decodes
`verdict_json` with `BotVerdict`; a row whose JSON no longer decodes is returned with
`verdict: null` rather than skipped, because the run itself is still valid.

## Server

- `render.ts`: `renderPrompt(definition, inputs)` returns the rendered instructions plus the
  reply request for verdict bots. L89's `renderInstructions` stays as the instruction-only step
  the L98 replay compares.
- `BotsService` terminal step: when the definition's `output` (taken from the `bot_version` that
  ran, not the current one) is `verdict` and the status is `completed`, compute the verdict and
  store it with the row.
- `listRuns` honors `verdict` (`WHERE verdict = ?`).
- L91 delivery message: for verdict runs the header becomes `Bot run finished: Reviewer, fail (3
findings)` followed by the summary and findings as a short list, then the raw reply only when
  `source` is `invalid`.
- `bots-verdicts` appended to `LOOM_SERVER_FEATURES` (`apps/server/src/fork/features.ts:10`).

## Agent-facing tools

- `loom_bots_define` accepts `output`.
- `loom_bots_run` (with `wait`) and `loom_bots_run_status` return `verdict` as an object beside
  `result`. When `source` is `decoded` the tool text leads with the verdict JSON so the agent does
  not have to read the raw reply.
- `loom_bots_list` reports each bot's `output`, so an orchestrator knows which bots it can branch
  on.

## Clients

- `apps/web/src/fork/bots/VerdictChip.tsx`: Pass, Fail, Needs attention as `Badge` variants
  `success`, `error` and `warning` (`apps/web/src/components/ui/badge.tsx:27-38`), no restyling.
- `apps/web/src/fork/bots/BotFindings.tsx`: title, detail and `path:line` with copy, then the raw
  reply. For `source: "invalid"` it shows the summary and the raw reply expanded.
- `BotRuns.tsx`: the chip beside the status badge and a filter row (All, Pass, Fail, Needs
  attention) that refetches `listRuns` with `verdict`.
- `BotEditor.tsx`: a "Reply" segmented control (Text, Verdict) with a one-line explanation.
- Gating on `bots-verdicts`; an older server never sends `verdict`.

## Performance

Decoding is one object extraction and one schema decode per finished verdict run. Verdicts ride inside
the existing `run` change events; findings are capped at 50 so an event stays small.

## Alternatives considered

- **Count a malformed reply as a failed run** (the original brainstorm). It hides a working run
  behind a red status and loses the distinction between "the bot broke" and "the bot's format
  slipped". Needs attention with the raw reply keeps both visible.
- **Per-bot JSON schemas.** Flexible, but every consumer (batch counts, inbox, pipeline gates)
  would need to understand arbitrary shapes.
- **A follow-up text-generation call to extract the verdict.** Adds a second model call per run
  and needs an upstream `ProviderTextGeneration` seam (only five fixed operations exist,
  `packages/provider-core/src/server/textGeneration.ts:96`).
