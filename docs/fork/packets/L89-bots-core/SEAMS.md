# L89 seams

## Extension points created by this packet

None: all existed.

## Packet seams

| File                                                        | Marker       | Lines | Why                                                                  |
| ----------------------------------------------------------- | ------------ | ----- | -------------------------------------------------------------------- |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`         | `fork: bots` | 3     | The Bots footer entry after Sites; the footer has no registry.       |
| `apps/web/src/components/sidebar/mainAppLocation.ts`        | `fork: bots` | 1     | `/loom/bots` is a utility page so the sidebar returns to the thread. |
| `apps/web/src/components/Sidebar.logic.ts`                  | `fork: bots` | 2     | Bot run threads join subagents in the hidden set.                    |
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

Against `v0.1.1-nightly.20261020.3411` on 2026-10-20, L89 added no conflicting file. The branch
base already conflicted in 68 files, `ThreadNotificationCoordinator.tsx` among them, before L89's
seam line.

## Registry

One row per file above in `docs/fork/seams.tsv` with marker `bots`, and one paragraph in FORK.md
under "Packet seams".
