# L97 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

| File                                             | Marker       | Lines | Why                                                       |
| ------------------------------------------------ | ------------ | ----- | --------------------------------------------------------- |
| `apps/server/src/scheduledTasks/webhookRoute.ts` | `fork: bots` | 3     | Route `bot-trigger-` hook ids to the bot trigger service. |

The three lines:

- an import of `apps/server/src/fork/bots/triggers/BotTriggers.ts` beside the
  `ScheduledTaskService` import (`:15`);
- `const botTriggers = yield* BotTriggers.BotTriggers;` beside `scheduledTasks` (`:30`);
- at `:84`, `const result = yield* (BotTriggers.isBotTriggerHookId(params.hookId) ?
botTriggers.webhook(request) : scheduledTasks.triggerWebhook(request))`, where `request` is the
  object the route already builds (hoisted into a local so both calls take it unchanged).

The route layer is provided inside the server runtime that already merges `ForkLayer`
(`apps/server/src/server.ts:604`), so `BotTriggers` is in context; the implementing agent
confirms this by typecheck. The file already handles four HTTP methods through one handler, so
one seam covers them all.

`scripts/fork/loom.sh` is fork-owned and needs no marker.

Why not an extension point: a webhook hand-off registry would be one more abstraction for one
consumer. If a second fork feature needs inbound webhooks, extract `ext-webhooks` then: a list of
`{ prefix, handle }` consulted at this same line.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here when the packet lands.

## FORK.md rows

- `webhookRoute.ts`, slug `bots`, packet L97.
- `docs/fork/seams.tsv`: `apps/server/src/scheduledTasks/webhookRoute.ts	bots	3`.
