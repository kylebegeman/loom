# L93 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

- `apps/server/src/server.ts`, ext-core: `ForkLayer` is provided `layerPullRequestService`. The
  core runtime builds that service after `ForkLayer`, so the pull request source could not reach
  it otherwise. The `fork:` marker explains the line.

The merge-conflict and glob sources call `GitVcsDriver.execute`, pull requests come from
`PullRequestService.list`, and search uses `WorkspaceEntries`; all are existing services consumed
from fork code.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had. `apps/server/src/server.ts` was among them already; the new
`ForkLayer` line merges cleanly, outside every conflict hunk.

## Where the build differs from the plan

- Persistence is migration 5 (`Batches`): `fork_bots_batches`, `fork_bots_batch_items` and a
  `batch_id` column on runs. The batch row snapshots the bot definition, so a save during a batch
  changes nothing for its waiting items.
- A batch has a `note` saying why it stopped early, such as its bot being archived or deleted.
  Archiving or deleting a bot cancels its running batches.
- `callerThreadId` is part of the batch input for people starting a batch from a thread; agents
  are always their own thread.
- Retry is refused while the batch is still running, and returns `BotBatchRetryResult` with the
  number retried and the labels left out after `BOTS_BATCH_MAX_ATTEMPTS` (5) runs.
- Restart recovery waits on `BotsService.whenRecovered`, then requeues items whose run was
  failed with `RESTARTED_BEFORE_START`, so an item is never lost between being taken and started.
- `loom_bots_batch_status` returns the report markdown with the counts.
- `batchCountsLine` lives in contracts so the server report and the web views share one wording.
- `git ls-files` lists a conflicted path once per merge stage; the glob source dedupes it.
- The pull request source needs a project, so the Run on many form offers the project picker
  for it as well as for file sources.
- Item squares use the shared tooltip instead of a native title, per the repo lint.

## FORK.md rows

- `apps/server/src/server.ts`: the existing ext-core row now mentions the pull request service.
