# L90 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Seeding, restore and the starter marker live in `apps/server/src/fork/bots/` and
`apps/web/src/fork/bots/`.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Against `v0.1.1-nightly.20261020.3411` on 2026-10-20, L90 added no conflicting file; the 68
conflicts are the branch base's, as recorded in L89.

## FORK.md rows

None.
