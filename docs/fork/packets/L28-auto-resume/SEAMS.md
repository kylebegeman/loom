# L28 seams

This packet touches upstream files only through extension points. It reads upstream
events and dispatches upstream commands; it adds no event types and no commands.

## Extension points created by this packet

Whichever of these do not exist yet, each in its own commit, byte for byte as
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md) specifies:

| Extension point                                       | Section | Commit                                                |
| ----------------------------------------------------- | ------- | ----------------------------------------------------- |
| `ext-core` (includes Persistence and Background work) | 1, 2, 4 | `feat(fork): add the server core extension point`     |
| `ext-composer`                                        | 11      | `feat(fork): add the composer extension point`        |
| `ext-settings`                                        | 7       | `feat(fork): add the settings extension point`        |
| `ext-palette`                                         | 8       | `feat(fork): add the command palette extension point` |

Record the ones this packet created, with commit hashes, when it lands.

## Packet seams

None. Registrations in fork-owned files:

| Fork file                                        | Line added                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/index.ts`           | `export * from "./auto-resume.ts";`                                                                                  |
| `packages/contracts/src/fork/rpc.ts`             | `AutoResumeRpcGroup,` in the `.merge(`; `\| typeof AUTO_RESUME_WS_METHODS.subscribeJobs` in `ForkSubscriptionRpcTag` |
| `packages/client-runtime/src/fork/index.ts`      | `export * from "./auto-resume.ts";`                                                                                  |
| `apps/server/src/fork/features.ts`               | `"auto-resume"`                                                                                                      |
| `apps/server/src/fork/ForkRuntime.ts`            | `\| AutoResumeService`                                                                                               |
| `apps/server/src/fork/ForkLayer.ts`              | `AutoResumeLive,` in `ForkServicesLive` (service plus reactor)                                                       |
| `apps/server/src/fork/persistence/migrations.ts` | `AutoResumeMigrations,`                                                                                              |
| `apps/server/src/fork/rpc.ts`                    | `...(yield* makeAutoResumeRpcHandlers(auth)),`                                                                       |
| `apps/server/src/fork/rpcAuthorization.ts`       | seven scope entries                                                                                                  |
| `apps/web/src/fork/composer/registry.tsx`        | `{ id: "auto-resume", Component: AutoResumeComposerChip },` in `FORK_COMPOSER_BLOCKS`                                |
| `apps/web/src/fork/settings/registry.ts`         | `autoResumeSettings,`                                                                                                |
| `apps/web/src/fork/commandPalette/registry.ts`   | `autoResumePaletteSource,`                                                                                           |

## Upstream behavior this packet depends on (not seams)

These are read, not edited. If upstream changes them, the wording-guard tests fail and the
classifier needs updating (TESTING.md):

- Stop messages: `apps/server/src/provider/Layers/codexUsageLimits.ts:218-234`,
  `apps/server/src/provider/Layers/ClaudeAdapter.ts:487,3311`,
  `apps/server/src/provider/acp/XAiAcpExtension.ts:596`.
- `thread.session-set` with `lastError` from ingestion:
  `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1719-1727,2038-2060`.
- Instance switch rules: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:663-686`.
- Account kind from `ServerProvider.auth.type`: `apps/server/src/provider/Layers/CodexProvider.ts:97-103,532-545`
  and `apps/server/src/provider/Layers/ClaudeProvider.ts:139-158`. A new or renamed type
  counts as metered, so a change can only make switching more cautious; `switchTarget.test.ts`
  pins the known values.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here. Then run the wording-guard tests against the merged tree
(TESTING.md) because the merge can change behavior without a textual conflict.

## FORK.md rows

None for packet seams. Extension points created here add their own rows in their own
commits.
