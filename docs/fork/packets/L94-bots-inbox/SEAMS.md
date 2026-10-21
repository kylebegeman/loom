# L94 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

`apps/web/src/components/sidebar/SidebarChrome.tsx` keeps L89's `fork: bots` seam, now 4 marker
lines: the footer entry's icon and label come from `useBotsFooterEntry()` so the count adds no
upstream line beyond the hook call. The "Waiting for you" section reads the thread shells the client already holds; L89's
`fork: bots` filters hide run threads from lists but keep them in `environmentThreadsAtom`.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had. `SidebarChrome.tsx` merges cleanly.

## Where the build differs from the plan

- The Bots footer entry needed one more `fork: bots` line in
  `apps/web/src/components/sidebar/SidebarChrome.tsx` (4 instead of 3): one import and one
  `useBotsFooterEntry()` call, which supplies the icon with its count and the label.
- The waiting selector reads `hasPendingApprovals` and `hasPendingUserInput` from the client
  shell rather than `pendingRuntimeRequest`, and lists the waiting threads themselves (title,
  what they wait on, **Answer**) instead of joining them to runs. It is one atom over every
  shell, filtered to the bots host, and keeps its last value while nothing it shows changes.
- The footer count and the Inbox tab share one query (the newest 50), which `applyInboxChanges`
  keeps current from run changes. A changed run older than an incomplete page leaves `total`
  alone, since its earlier state is unknown. Both refetch after a reconnect.
- Retries are serialized by a semaphore. `retriedBy`, and a batch item's new `runId` (with the
  old id appended to `previousRunIds`), are written in the new run's insert transaction. Inbox
  retries do not count against the batch's `BOTS_BATCH_MAX_ATTEMPTS`.
- A dismissed run cannot be retried until it is restored, as `isBotInboxRun` says.
- Promoting a run whose thread was deleted forks again under `bot-open-<runId>-<suffix>`.
- Rows show the bot, inputs, time, model, and the error or verdict summary; duration and a batch
  link were left out. The list adds **Dismiss all shown** (at most 50 runs, the dismiss limit).
- The model picker moved out of the editor into `BotModelPicker.tsx`, which both use.
- `loom_bots_inbox` returns 20 runs unless asked for more.

## FORK.md rows

- The L89 paragraph on the Bots footer entry now says 4 marker lines.
