# L97 references

- `apps/server/src/orchestration-v2/EventSink.ts:177-185` `stream` (`afterSequence`,
  `eventType`, `bounded`) and `latestSequence`.
- `apps/server/src/orchestration-v2/Orchestrator.ts:11735-11751` the bounded stored stream and
  the live tail.
- `packages/contracts/src/orchestrationV2.ts:1606,1624,1628` lifecycle events and the pull
  request link event.
- `packages/contracts/src/threadPullRequest.ts:54,86-87,101` checks state, watch head and failed
  checks, the link.
- `packages/contracts/src/pullRequest.ts:53` `PullRequestChecksState`.
- `apps/server/src/orchestration-v2/PullRequestSyncReactor.ts:39` the slow sync interval.
- `apps/server/src/scheduledTasks/webhookRoute.ts:15,30,84,111` the seam lines and result mapping.
- `apps/server/src/scheduledTasks/ScheduledTaskService.ts:58,64,72,84,1361` route prefix, rate
  limit, relay URL, webhook origin, token check.
- `apps/server/src/scheduledTasks/webhookVerification.ts:7,13` and
  `apps/server/src/scheduledTasks/webhookTemplate.ts:147-165` token, signature and data framing.
- `apps/server/src/scheduledTasks/Schedule.ts:12,70` schedule helpers.
- `packages/contracts/src/environmentHttp.ts:745` and `infra/relay/src/hooks/upstream.ts:90` the
  only forwarded hook path.
- `scripts/fork/loom.sh:541-549` the integrate conflict branch.
- `apps/server/src/serverActivation.ts:27` `forkParked`.
- `apps/server/src/fork/bots/BotsService.ts` `BotCaller` (:54), `run`.
- `docs/fork/packets/L93-bots-batches/TECHNICAL.md` `startRunWith`;
  `docs/fork/packets/L94-bots-inbox/TECHNICAL.md` the inbox predicate;
  `docs/fork/packets/L95-bots-budgets/TECHNICAL.md` `BotBudgets.check`.
- Prior art: GitHub Actions `on:` events and `concurrency`, Zapier triggers with field mapping,
  Renovate's schedule and rate limits, Dependabot's per-day pull request limit.
