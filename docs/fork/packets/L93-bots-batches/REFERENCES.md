# L93 references

- `apps/server/src/fork/bots/BotsService.ts`: semaphores (:105, `permitsFor` :111), `run` (:345),
  `cancel` (:421), `awaitRun` (:443), `recover` (:470) and its `forkParked` registration (:528).
- `apps/server/src/fork/bots/BotsStore.ts:16` `RUNS_KEPT_PER_BOT`.
- `apps/server/src/fork/bots/render.ts:78` `validateInputs`.
- `apps/server/src/vcs/GitVcsDriver.ts:43,295` `ExecuteGitInput`, `execute`.
- `scripts/fork/loom.sh:542`: the conflicted-file listing Loom's merge helper prints.
- `apps/server/src/pullRequest/PullRequestService.ts:166`, `packages/contracts/src/pullRequest.ts:354,316`.
- `apps/server/src/workspace/WorkspaceEntries.ts:99-104`, `packages/contracts/src/project.ts:18-19,240,262`.
- `docs/fork/packets/L90-bots-starters/TECHNICAL.md`: `checkoutThreadId` and the resolver starter.
- `docs/fork/packets/L92-bots-verdicts/TECHNICAL.md`: verdict counts in the report.
- Prior art: GitHub Actions matrix jobs (one definition, many inputs, "re-run failed jobs"),
  `xargs -P` and GNU parallel (bounded fan-out over lines), Buildkite's job grid.
