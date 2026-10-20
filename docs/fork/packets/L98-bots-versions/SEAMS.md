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

Record the tag and result here when the packet lands.

## FORK.md rows

None.
