# L97 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

| File                                             | Marker       | Lines | Why                                                       |
| ------------------------------------------------ | ------------ | ----- | --------------------------------------------------------- |
| `apps/server/src/scheduledTasks/webhookRoute.ts` | `fork: bots` | 2     | Route `bot-trigger-` hook ids to the bot trigger service. |

The two lines:

- an import of `apps/server/src/fork/bots/triggers/BotTriggers.ts` beside the `Metrics` import
  (`:13`);
- `const scheduledTasks = yield* BotTriggers.webhookTarget;` in place of reading
  `ScheduledTaskService` (`:31`). `webhookTarget` returns the scheduled task service with
  `triggerWebhook` sending `bot-trigger-` hook ids to `BotTriggers.webhook`, or the service
  unchanged when `BotTriggers` is not provided. The handler body is untouched.

The existing `fork: ext-core` comment in `apps/server/src/server.ts` (`:604`) now also provides
`layerScheduledTaskWebhookOrigin` to `ForkLayer`, so trigger addresses use the relay origin the way
scheduled tasks do. It stays one marker line; the file keeps its 3 `ext-core` lines.

`scripts/fork/loom.sh` is fork-owned and needs no marker. The route test,
`apps/server/src/fork/bots/triggers/webhookRoute.test.ts`, is fork-owned too, so the upstream
`webhookRoute.test.ts` is untouched.

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

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had. `webhookRoute.ts` merges cleanly.

## FORK.md rows

- `webhookRoute.ts`, slug `bots`, packet L97.
- `docs/fork/seams.tsv`: `apps/server/src/scheduledTasks/webhookRoute.ts	bots	4`.

## Where the build differs from the plan

- The route seam takes 2 marker lines, not 3, and stays outside the request handler. The planned
  edit at the `triggerWebhook` call conflicted with upstream, which reindented the whole handler
  in `v0.1.1-nightly.20261020.3411`; swapping the service the handler reads avoids that region.
- Substituted event values are wrapped in `<event-data-ID>` tags, not `<webhook-data-ID>`, because
  every trigger kind uses them, not only webhooks.
- A trigger's `webhook` field is `{ path, url, hasSecret }`: `url` is null until the server knows
  its public origin, so the page builds the address from `path` and the environment's base URL.
  Callers without `orchestration:operate` never receive the field.
- A merge conflict report runs as one batch per delivery, keyed by the tag and a hash of the file
  list. Its batch records the trigger, so each item run frames the tag, branch and file as
  untrusted, also after a restart resumes the batch.
- A trigger ignores events from before it was saved (`occurredAt`), and a pull request first seen
  before then (`firstSeenSince`), so turning one on does not fire for every pull request already
  linked.
- The event reactor follows `ThreadManagementService.streamStoredEventsFrom` with a durable
  cursor per event type, rather than `EventSinkV2`, which the fork layer cannot reach. The first
  start replays history once to learn pull request state; the `occurredAt` rule keeps that replay
  from firing.
- A bot change shows "Runs version N; Bot is now version M." with **Use version M**, rather than
  "Bot changed since this trigger was set" with Review and Use latest. Until L98 adds versions,
  repinning accepts only the current version, and firings of an outdated trigger are skipped.
- Skipped firings become failed runs through `BotsService.recordUnstarted`, so they reach the
  inbox like any refused run. Only the final firing is published to the page, never the
  placeholder written before the run starts.
- The firing list shows 20 at a time, not 50; 500 firings are kept per trigger.
- The 60-per-minute webhook rate limit is kept in memory, so a restart resets it.
- The schedule loop sleeps at most 60 seconds between looks, so a changed clock or a new trigger is
  picked up within a minute even if no change event arrives.
- The mapping rule is `checkTriggerMapping` in contracts, shared by the server's save and the web
  editor, rather than mirrored.
- The web page gets a **Triggers** tab and the palette a **New bot trigger...** submenu.
- L96 left `refineDraft` and `dismissSuggestion` out of the client guard list in
  `packages/contracts/src/fork/clientRpcPermissions.ts`, so a read-only client offered them and the
  server refused. They are added here beside the trigger writes. `makeForkRpcAuth` gains
  `has(scope)` so the trigger list can leave out the webhook address for readers.
