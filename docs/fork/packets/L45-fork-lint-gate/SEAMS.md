# L45 seams

## Extension points created by this packet

None.

## Packet seams

None. Every file L45 edits is fork-owned:

| File                                                          | Change                                                         | Owner            |
| ------------------------------------------------------------- | -------------------------------------------------------------- | ---------------- |
| `scripts/fork/loom.sh`                                        | `fork_lint_paths`, `check_fork_lint`, one call in `run_checks` | Fork maintenance |
| `scripts/fork/loom.test.ts`                                   | Gate tests                                                     | Fork maintenance |
| `FORK.md` (commands table, line 262)                          | "seams, fork lint, fork tests, typechecks"                     | Fork docs        |
| `docs/fork/packets/CONVENTIONS.md` (line 177)                 | Mention the lint step                                          | Fork docs        |
| `apps/web/src/fork/code-graph/CodeGraphPanel.tsx`             | Three `ring-inset` additions                                   | L26              |
| `apps/web/src/fork/device-qa/FlowRunView.tsx`, `PillTabs.tsx` | `ring-inset`                                                   | L09              |
| `apps/web/src/fork/file-outline/FileOutlineList.tsx`          | `ring-inset`                                                   | L05              |
| `apps/web/src/fork/thread-inspector/parts.tsx`                | `ring-inset`                                                   | L04              |
| `apps/web/src/fork/pcb-preview/Plot.tsx`, `SvgViewport.tsx`   | `observeResize`                                                | L24              |
| `apps/web/src/fork/panel-picker/PanelPicker.tsx`              | `scrollbar-gutter-both`                                        | L12              |

No 3D shared files are touched. Anyone with open work in the feature files above should expect a
one-line merge.

## Merge check

Run `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly tag>`. Expect no
conflicts: no upstream file changes. Then run `scripts/fork/loom.sh check` on the result, which
now includes the gate.

## FORK.md rows

No seam rows. Update the `scripts/fork/loom.sh check` row in the commands table.
