# Lxx seams

Every upstream file this packet touches. Extension point seams are listed only if this packet
creates the extension point.

## Extension points created by this packet

Extension point names and the commit that created each, or "None: all existed".

## Packet seams

| File                       | Marker         | Lines | Why              |
| -------------------------- | -------------- | ----- | ---------------- |
| `path/to/upstream/file.ts` | `fork: <slug>` | 1     | One-line reason. |

Include JSON seams with "(no marker)". Explain why each seam could not be avoided with an
extension point.

## Merge check

The command run (`git merge-tree --write-tree --name-only --no-messages HEAD <tag>`), the tag,
and the result. Conflicts must only be on the lines above.

## FORK.md rows

The rows added to FORK.md's "Packet seams" (and, if created here, "Extension point seams")
tables.
