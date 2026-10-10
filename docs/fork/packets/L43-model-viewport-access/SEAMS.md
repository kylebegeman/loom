# L43 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. L43 edits only fork-owned files. Upstream's type-to-focus already treats
`canvas[tabindex]` as interactive (`apps/web/src/components/ChatView.tsx:724`, an existing
`ext-panels` line), so the focused viewport keeps its keys without a new upstream change.

## Fork-owned shared files edited

| File                      | Change                                                                                                      | Collides with                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `viewer/createViewer.ts`  | `nudge`, `owns`, `describe`; role attributes replace the fixed label (lines 71-74)                          | Every packet adding viewer methods            |
| `ModelPanel.tsx`          | Arrow `else if` in the key handler; announcer effect and region; `label` prop; two `role="status"` removals | Every packet adding a key; L44 (success text) |
| `WorkspaceTools.tsx`      | `HELP` rows edited; `ToolHint` role removed                                                                 | L31, L35, L36, L42 (help rows)                |
| `viewer/ViewerCanvas.tsx` | `label` prop and instructions span                                                                          | L31 (display prop)                            |

Merge rule: append, never reorder. The two `HELP` row edits change existing rows; resolve by
keeping both packets' text.

## Merge check

Run `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>` before
merging. Expect no conflicts: no upstream file changes.

## FORK.md rows

None.
