# L94 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. The "Waiting for you" section reads the thread shells the client already holds; L89's
`fork: bots` filters hide run threads from lists but keep them in `environmentThreadsAtom`.

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
