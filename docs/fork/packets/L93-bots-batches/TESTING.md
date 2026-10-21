# L93 testing

## Server (`vp test run apps/server/src/fork/bots`)

- `batchSources.test.ts`:
  - lines: blank lines and duplicates dropped, order kept.
  - glob in a temporary git repository: tracked files match, untracked and ignored files do not,
    `:(top)` style patterns are refused, 201 matches refuse with the count.
  - conflicts: a repository left mid-merge with two conflicted files returns both; a clean tree
    returns "No conflicted files".
  - pullRequests with a fake `PullRequestService`: open entries become numbers with labels; a
    project error lands in `note`.
  - search with a fake `WorkspaceEntries`: content matches deduplicate by path; `truncated` is
    reported.
- `batchReport.test.ts` (pure): verdict and text headings, failing sections with findings,
  passing items as single lines, the 64 KiB cap.
- `BotBatches.test.ts` with the fake launch and wait services L89's tests use:
  - with a bot limit of 2, at most 2 run rows exist at any moment, and all 10 items finish;
  - saving the bot mid-batch does not change the instructions later items use; lowering the
    limit does take effect;
  - cancel skips pending items and cancels in-flight runs; the batch ends `cancelled`;
  - retry `failed` requeues only failed and timed-out items and records `previousRunIds`;
    `failed_and_attention` adds needs-attention verdicts; a sixth attempt is refused;
  - an invalid item refuses `runBatch` and writes nothing;
  - the conflicts source refuses a worktree bot;
  - restart: stop the service with 3 started and 5 pending items, run L89 recovery then batch
    recovery, and assert the never-launched items return to pending, running ones keep their
    waiter, and all 8 finish. Drive the milestones by awaiting persisted rows and the change
    PubSub, never sleeps.
- `BotsStore.test.ts`: run pruning skips runs of a running batch.
- Migration test passes with the new id.

## Clients

- Contract tests: `BotBatchSource` bounds, `BotRun` with and without `batchId`, and an L89-era
  client schema decoding a `BotRun` that carries `batchId`.
- Client runtime: `watchBatches` folding replaces one item without refetching the batch.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`; lint changed
  files.

## Real client

When Kyle asks: run the resolver starter over a real merge with several conflicts and watch the
grid fill; kill and restart the dev server mid-batch and confirm the batch completes; run the
reviewer over open pull requests and copy the report.
