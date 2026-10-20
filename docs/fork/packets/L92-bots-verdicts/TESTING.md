# L92 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `verdict.test.ts` (pure): a bare JSON reply decodes; a fenced block with prose around it
  decodes; `line: "12"` becomes 12; unknown keys are ignored; missing `findings` means none;
  60 findings clip to 50 with `findingsTruncated`; an over-long summary is cut with an ellipsis;
  an unknown verdict word, no braces, or broken JSON each return `needs_attention` with
  `source: "invalid"`.
- `render.test.ts`: a verdict bot's prompt ends with `VERDICT_REPLY_REQUEST`; a text bot's does
  not.
- `BotsService.verdicts.test.ts` with fake launch and wait services: a completed verdict run
  stores both columns; a timed-out verdict run stores `verdict: null`; a reply longer than
  `BOTS_RESULT_MAX_BYTES` with the JSON at the end still decodes while `result` is capped; the
  verdict uses the definition version that ran even after the bot is switched back to text;
  `listRuns({ verdict: "fail" })` returns only failing runs.
- `BotsStore.test.ts`: a row with corrupt `verdict_json` returns the run with `verdict: null`.
- Migration test passes with the new id.

## Clients

- Contract tests for `BotVerdict` caps and the optional `output` key.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files.

## Real client

When Kyle asks: restore the reviewer starter, run it on a small change, see a chip and findings;
edit a test bot to reply in prose with verdict output on and confirm Needs attention with the raw
reply.
