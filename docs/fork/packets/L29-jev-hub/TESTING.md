# L29 testing

Focused tests only (AGENTS.md). No repo-wide checks, no sleeps, no calls to TypeSafe: every
server test uses `ext-decide` with a scripted `fetch` (or a test `LoomDecide` layer) and
`TestClock` for time.

## Automated tests

`packages/client-runtime/src/fork/jev-hub-lint.test.ts` (pure):

- Each rule in TECHNICAL.md's table fires on a minimal example and stays quiet on a close
  negative: `not` and `n't` fire `negation`, `note` and `knot` do not; two negations in one
  sentence fire `double-negative`; a null and an empty option description fire
  `option-without-criteria`; `how many`, `total`, `more than 3` fire `count-or-math`;
  `2026-09-24`, `yesterday`, `days ago` fire `date-comparison`, while `before merging` alone
  does not; Noul `true: "No, ..."` with `false: "Yes, ..."` and identical criteria fire
  `noul-contradiction`; `write`, `summarize` fire `generation`; 256 options,
  1 option, Score with 1 and 11 levels fire their errors; `empty-instructions`.
- Structured instructions: strings inside objects and arrays are scanned; keys are not.
- Severity: only `empty-instructions`, `too-many-options`, `too-few-options`,
  `score-levels` and `oversized-state` are errors.

`packages/client-runtime/src/fork/jev-hub-cost.test.ts`: 1,000,000 input tokens cost $0.042;
0 tokens is $0; formatting of very small amounts ("under $0.0001").

`apps/server/src/fork/jev-hub/buckets.test.ts`: every boundary of `countBucket`,
`linesBucket`, `durationBucket` (value equal to an edge falls in the upper bucket), and
`ageBucket` with fixed dates.

`apps/server/src/fork/jev-hub/contextShapes.test.ts` (pure, fixture projection rows and
diffs):

- `thread`: last N user and assistant messages oldest first, compaction messages skipped,
  4,000-character cap per message, buckets for turns and age; no raw numbers or ISO dates
  anywhere in the fragment (assert with a regex over the JSON).
- `turn`: user and final assistant message, activity capped at 30, buckets from the diff.
- `diff`: languages from extensions, per-file buckets, `diffExcerpt` output, `.env` file
  marked `redacted`.
- `approval`: pending detection (requested without a resolution), `no-pending-approval`.
- `pasted`: JSON object and array used as is; other text wrapped in `{ text }`.
- `facts`: every bucket has its exact value listed.

`apps/server/src/fork/jev-hub/ContextBuilder.test.ts` (temp workspace, test services):

- File source: workspace-relative path works; absolute path and `..` fail with
  `file-outside-workspace` before any read; `.env.local` and a user-excluded glob fail with
  `file-excluded`; over 256 KB fails with `file-too-large`.
- A planted GitHub token and a `.env` diff section are redacted in the preview, and the
  preview lists them with JSON pointers.
- A state over the budget is trimmed (oldest messages first) and `trimmed` says where; with
  questions alone over the limit, `fits` is false.

`apps/server/src/fork/jev-hub/scoring.test.ts`: `answerLabel` and `isCorrect` for Choice,
Score (most probable level, not the rounded score: a 0.49/0.51 split across levels 1 and 2
labels 2 even when `score` is 1.4) and Noul (0.5 counts as yes); accuracy with errors
excluded; fixed and broke counts.

`apps/server/src/fork/jev-hub/calibration.test.ts`: bins and their accuracies; empty bins are
null; sweep coverage and accuracy at each threshold; filter by answering model; Noul points
use the distance from 0.5; fewer than 30 points is reported through `n`.

`apps/server/src/fork/jev-hub/replay.test.ts` (scripted fetch, `SqlitePersistenceMemory`):

- Baseline uses the feature's current overrides and model; the candidate's overrides and
  model are applied; option keys never change.
- Unlabeled items and items of a Jev-off project are skipped and counted.
- A 429 with `retry-after` is retried and succeeds under `TestClock`; a persistent 529
  becomes an item error without stopping the run.
- Progress events arrive in order and end with `done`; interrupting the stream stops further
  calls (count the scripted fetch invocations).
- Nothing is written to `fork_decide_decisions`; the result is stored and only the newest 20 per
  feature are kept.

`apps/server/src/fork/jev-hub/draftBrief.test.ts`: the brief contains the feature label and
description, the questions JSON, at most three example states, the nine weak spots, the draft
id, the SKILL.md link; it contains no em dash, no key and no unredacted planted token; "None
yet" without examples.

`apps/server/src/fork/jev-hub/JevHubService.test.ts` (on `SqlitePersistenceMemory` with the
fork migrations, a test `ServerSecretStore` holding a fake key, a scripted fetch):

- `run` logs the decision under `jev-hub.playground` with origin `user` and returns it; the
  logged state equals the submitted (already redacted) state; a 10-second timeout applies.
- `run` with no key, "Use Jev" off, or a Jev-off project returns the matching fallback and
  logs nothing.
- Templates: create, rename, unique names ignoring case, invalid questions rejected
  (256 options), delete.
- Ratings through `rateDecision`: per key, clear with null.
- Test items: from a rated decision (labels from "right" and "wrong"), `setKept` set and
  cleared with the last item, `state-purged` and `unlabeled` errors, the 500-item limit,
  playground items with a target feature.
- Drafts: `startDraft` builds the brief and reports `agentsAllowed` from the gate feature
  (the feature itself, or `jev-hub.playground` for an `agentTool: false` feature); expiry
  after 24 hours under `TestClock`; `closeDraft`.
- Feature stats: counts by reason, rated accuracy, models seen, removed features.
- No RPC result or log line contains the fake key (serialize every result and search).

`apps/server/src/fork/jev-hub/mcp.test.ts`:

- Tool names start with `loom_` and are unique across fork toolkits.
- `loom_jev_hub_ask`: with `jev-hub.ask` in `manual`, the result is `agent-not-allowed` with the
  one-line explanation and nothing is sent; in `manual-agents`, a template by name and an
  inline question both run with origin `agent` and the caller's `threadId`; exactly one of
  `template` and `question` is required.
- `loom_jev_hub_submit`: unknown, closed, expired and foreign-thread drafts fail; the gate switch
  off fails with the feature's label; per-call and per-draft limits; a question with changed
  option keys is rejected by index; accepted drafts become `source: "agent"` templates with
  unique names; edge cases become items with empty `labels` and the agent's `suggested`
  values; submitted states are redacted.

`apps/web/src/fork/jev-hub/exportRequest.test.ts`: the JSON body round-trips; the curl uses
`$TYPESAFE_API_KEY`, a quoted heredoc and `--data-binary @-`; JSON containing `'`, `$` and
backticks survives unchanged inside the heredoc.

Registry invariants come from the extension points' own tests: panel id `jev-hub` and letter
`J` unique (`apps/web/src/fork/panels/registry.test.ts`), palette values start with
`action:loom:`, keybinding command `loom.jev-hub.open`
(`packages/contracts/src/fork/keybindings.test.ts`), scope table and tag prefixes
(`apps/server/src/fork/rpcAuthorization.test.ts`), decide feature ids
(`apps/server/src/fork/decide/registry.test.ts`), fork tables prefixed `fork_`
(`apps/server/src/fork/persistence/migrations.test.ts`), capability slugs
(`apps/server/src/fork/features.test.ts`).

## Commands

```sh
vp test run \
  packages/client-runtime/src/fork/jev-hub-lint.test.ts \
  packages/client-runtime/src/fork/jev-hub-cost.test.ts \
  apps/server/src/fork/jev-hub/*.test.ts \
  apps/server/src/fork/decide/*.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/features.test.ts \
  apps/server/src/fork/persistence/migrations.test.ts \
  apps/web/src/fork/jev-hub/exportRequest.test.ts \
  apps/web/src/fork/panels/registry.test.ts \
  apps/web/src/fork/settings/registry.test.ts \
  packages/contracts/src/fork/keybindings.test.ts
vp lint packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/server/src/fork/jev-hub apps/server/src/fork/decide apps/web/src/fork/jev-hub
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck   # contracts changed; mobile imports them
```

(Include the palette and MCP registry tests if their extension points ship them. Drop the
`decide` tests from the list when this packet did not create `ext-decide`.)

## Manual check

With Kyle's permission, one integrated pass with `test-t3-app` on web against a seeded
worktree `.t3`, then the desktop dev app. Kyle pastes his key; the agent never sees or
stores it.

1. Settings, Loom, Jev: save the key, "Test key" lists the models; the key field shows only
   "Key saved on <date>"; WebSocket frames never contain the key.
2. Decisions panel (letter J) on a thread: empty log state; Playground with the last turn
   and its diff: the preview shows buckets, redactions (plant a fake `ghp_` token and a
   `.env` change in a scratch project first) and the token meter; Run shows answers, latency,
   tokens and cost; the Log shows the same decision with the same state.
3. Rate it "Wrong, should have been X", add it to the feature's test set, clear and redo the
   rating, remove it from the test set.
4. Question builder: type "How many files are not tests?" and see `count-or-math` and
   `negation`; add 11 Score levels and see the error block Save; save a valid template;
   "Use for this feature" on a registered feature (if one is installed) and revert; export
   curl and run it in a terminal with `TYPESAFE_API_KEY` set by Kyle.
5. Tuning: replay a small test set with a reworded template, cancel one replay midway, run
   another to the end; read the calibration chart; set a threshold and see the next decision
   of that feature fall back as low confidence when below it; clear it; pin and unpin
   `jev-1.13.0`.
6. "Draft with an agent": the composer fills and nothing is sent; with the gate switch off
   the card warns; turn it on, send the brief to a Claude or Codex thread, and see drafts and
   unlabeled edge cases arrive; label one; close the draft and see a further submit fail.
7. Agents: with "Ask Jev from agents" off, an agent's `loom_jev_hub_ask` reports it is not
   allowed; turn it on and the call answers and appears in the log as "Agent".
8. Turn "Jev off for this project" on: the playground banner shows and Run is disabled.
9. Upstream-server case: connect to an upstream T3 server (or remove `"jev-hub"` and
   `"decide"` from `LOOM_SERVER_FEATURES` in the dev server): the launcher entry is disabled
   with "Needs a Loom server with the Jev hub.", palette items are absent, the Jev settings
   section explains it is unavailable.
10. Remote: repeat step 2 over Tailscale.

## Merge safety

On the packet branch: the `git merge-tree` preview from SEAMS.md, result recorded there.
After Kyle merges to `main`: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
synced `main`. Until the `loom.sh` follow-up lands (CONVENTIONS.md, "Known gap"), typecheck
`apps/server`, `packages/contracts` and `packages/client-runtime` by hand on the rehearsal
branch.

## Acceptance criteria

- Every PRODUCT.md behavior works on web and desktop, with loading, empty, error, setup and
  unsupported states, and the reverse of every action.
- The key never appears in an RPC payload, log, export or file outside the secret store.
- What the preview shows is exactly what the log records as sent.
- No exact numbers or dates reach Jev from a context builder.
- Replays do not touch the decision log and honor the project switch.
- No default keybinding is added; no RPC is issued per keystroke in the question builder.
