# L14 seams

## Extension points created by this packet

Each only if its existence check fails, created exactly as EXTENSION-POINTS.md specifies,
one commit each, before the part that needs it:

- Part C: `ext-composer`, `ext-keybindings`, `ext-palette`.
- Part D: `ext-core`, `ext-mcp`.
- Part E: `ext-core`, `ext-decide` (EXTENSION-POINTS.md section 18; create if missing,
  exactly as specified there), and part C's `ext-composer`, `ext-keybindings`,
  `ext-palette`, plus `ext-settings`.

Record the commits here when done.

## Packet seams

None. The `ChatView.tsx` and `ChatMarkdown.tsx` seams and the `mermaid` dependency served
parts A and B, retired on 2026-10-09 (README, "Retired parts"). Parts C, D and E go through
extension points only.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

With no packet seams, any conflict must be on a `fork: ext-*` line. Record the tag and the
result here.

## FORK.md rows

No "Packet seams" rows.
