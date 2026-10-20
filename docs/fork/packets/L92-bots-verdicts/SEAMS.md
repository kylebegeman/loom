# L92 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Rendering, decoding and storage live in `apps/server/src/fork/bots/`; chips and findings
in `apps/web/src/fork/bots/`.

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
