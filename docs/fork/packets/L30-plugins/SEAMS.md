# L30 seams

Every upstream file this packet touches. The plugin contract itself touches no upstream file:
every registry it replaces is fork-owned, and the existing extension point seams keep pointing
at the same exported names.

## Extension points created by this packet

None. Every extension point the plugin registries derive into (`ext-core`, `ext-web-root`,
`ext-panels`, `ext-palette`, `ext-keybindings`, `ext-settings`, `ext-mcp`, `ext-cli`) already
exists on `main`, and its seam keeps pointing at the same exported name.

## Packet seams

None. If implementation finds an upstream edit is unavoidable, stop and record why here
before making it.

## Merge check

To be run during implementation:
`git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>`. The packet
should add no conflicts beyond those `main` already has.

## FORK.md

No seam rows change. The "Implementation packets" paragraph gains one sentence: features are
built as plugins, with a link to this packet.
