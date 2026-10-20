# L98 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Versions, replays and ratings live in fork tables; the instruction diff uses
`@pierre/diffs`, already a dependency of `apps/web`, from fork code. L93, L97 and L99 call
`BotsService.definitionAt`, which is fork code.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had.

## FORK.md rows

None.

## Where the build differs from the plan

- History is a **History** tab on the Bots page, not a tab inside the editor. Replay is a dialog
  opened from a version in History or from **Try on past runs** in the editor, not its own tab.
- The diff compares the definition's input fields only; the brief gets a line diff and every other
  changed field shows before and after.
- A deleted bot's version rows stay, so numbering continues when the bot is made again. Its
  replays are deleted with it, since nothing can show them.
- A batch keeps the definition it started with and always starts from the latest version. A merge
  conflict trigger pinned to an older version skips with `BATCH_NEEDS_LATEST`.
- A trigger's version is a three-way choice, pinned, latest or stable (`followStable`). A pinned
  trigger now runs its pinned version instead of skipping when the bot changes, and one that
  follows the stable version never shows as outdated.
- Replays do not wait out a budget. The whole replay's run count is checked against the daily run
  budget up front; a later refusal, such as the token budget, fails that item with the reason.
- Replay runs count in usage, with a separate `replays` count per bot. They carry no calling
  thread, never notify, and stay out of the inbox. The run list shows them with a Replay badge.
- `fork_bots_replay_items` has a `position` column, so items keep the order they were chosen, and
  `fork_bots_replays` records `started_by`. A draft is stored with `BOT_DRAFT_VERSION` (0), so the
  store's definition schema accepts any integer version.
- There is no list-replays RPC. The dialog holds the replay it started and refetches it when one of
  its runs changes.
- The MCP surface has no suggest-edit tool and `loom_bots_replay` has no wait option; agents poll
  `loom_bots_replay_status`.
- The web rates runs Good or Bad only. There is no note editor; a note set through MCP is kept when
  the rating changes.
