# L99 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Pipelines, their runs and attempts live in fork tables and fork services. The engine calls
fork code only: `startRunWith` (L93), the L93 batch start, `definitionAt` (L98),
`BotBudgets.check` (L95) and `isBotInboxRun` (L94). The new subscription is added to the fork's
own `ForkSubscriptionRpcTag` union (`packages/contracts/src/fork/rpc.ts:108`), which the client
stream union already includes through the existing `ext-core` seam. The Pipelines tab is part of
the fork's Bots route.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here when the packet lands.

## FORK.md rows

None.
