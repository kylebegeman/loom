# L27 seams

This packet touches upstream files only through extension points.

## Extension points created by this packet

Whichever of these do not exist yet, each in its own commit, byte for byte as
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md) specifies:

| Extension point   | Section                  | Commit                                                |
| ----------------- | ------------------------ | ----------------------------------------------------- |
| `ext-panels`      | 6                        | `feat(fork): add the right panel extension point`     |
| `ext-palette`     | 8                        | `feat(fork): add the command palette extension point` |
| `ext-web-root`    | 5                        | `feat(fork): add the web root extension point`        |
| `ext-keybindings` | 9 (needs `ext-web-root`) | `feat(fork): add the keybindings extension point`     |

`ext-panels`' `useForkPanelActions` and `ext-palette`'s registry import
`@t3tools/client-runtime/fork` (`loomFeaturesOf`), which `ext-core` creates. If `ext-core`
does not exist yet, create it first as well (section 1), even though this packet adds no
server code. Record the ones this packet created, with commit hashes, when it lands.

## Packet seams

None. Registrations in fork-owned files:

| Fork file                                      | Line added                                                    |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `packages/contracts/src/fork/keybindings.ts`   | `"loom.utilities.open",`                                      |
| `apps/web/src/fork/panels/registry.ts`         | `utilitiesPanel,`                                             |
| `apps/web/src/fork/commandPalette/registry.ts` | `utilitiesPaletteSource,`                                     |
| `apps/web/src/fork/ForkRoot.tsx`               | `{ id: "utilities-dialog", Component: UtilitiesDialogHost },` |

No `loomFeatures` entry: the feature is client-only.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Record the tag and result here.

## FORK.md rows

None for packet seams.
