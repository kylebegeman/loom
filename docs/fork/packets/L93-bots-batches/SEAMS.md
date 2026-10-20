# L93 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. The merge-conflict source calls `GitVcsDriver.execute`, pull requests come from
`PullRequestService.list`, and search uses `WorkspaceEntries`; all are existing services consumed
from fork code.

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
