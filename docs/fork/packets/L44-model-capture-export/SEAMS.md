# L44 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. L44 imports nothing new from upstream and changes no upstream file. Desktop needs no IPC.

## Fork-owned shared files edited

| File                                 | Change                                                              | Collides with                                                  |
| ------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `ModelPanel.tsx`                     | `exportCapture`, `captureError` shape, new props, two model actions | Every packet touching the panel; L43 (success and toast roles) |
| `WorkspaceTools.tsx` (`CaptureMenu`) | Two groups after "Attach to the composer"                           | None known                                                     |
| `ViewsSection.tsx`                   | Two items in each row menu                                          | L49 if it adds history rows                                    |
| `useModelEditing.ts`                 | `renderViews` split, `exportViews`                                  | None known                                                     |
| `actions.ts`, `palette.tsx`          | Two actions and entries                                             | Packets adding palette actions                                 |

## Merge check

Run `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>` before
merging. Expect no conflicts: no upstream file changes.

## FORK.md rows

None.
