# L89 seams

## Extension points created by this packet

None: all existed.

## Packet seams

| File                                                        | Marker       | Lines | Why                                                                  |
| ----------------------------------------------------------- | ------------ | ----- | -------------------------------------------------------------------- |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`         | `fork: bots` | 12    | The Bots footer entry after Sites; the footer has no registry.       |
| `apps/web/src/components/sidebar/mainAppLocation.ts`        | `fork: bots` | 1     | `/loom/bots` is a utility page so the sidebar returns to the thread. |
| `apps/web/src/components/Sidebar.logic.ts`                  | `fork: bots` | 1     | Bot run threads join subagents in the hidden set.                    |
| `packages/client-runtime/src/state/threadShell.ts`          | `fork: bots` | 1     | Hide bot run threads from navigation, which web and mobile share.    |
| `apps/web/src/components/ThreadNotificationCoordinator.tsx` | `fork: bots` | 1     | No completion notification per bot run.                              |

Each hidden-thread seam sits beside the existing subagent check and calls `isBotRunThreadId`, so
an upstream change to that check conflicts on one line at most. A thread id prefix needs no data
over the wire, which a server-side flag on the thread shell would.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here when the packet lands.

## FORK.md rows

One row per file above in the "Packet seams" table, slug `bots`, packet L89.
