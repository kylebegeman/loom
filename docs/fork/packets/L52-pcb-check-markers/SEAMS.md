# L52 seams

## Extension points created by this packet

None: all existed (L24's `ext-core`, `ext-panels`, `ext-mcp`).

## Packet seams

None. No upstream file changes. No FORK.md or `docs/fork/seams.tsv` row.

## Fork-owned shared files edited

Other PCB follow-up packets edit these too. Keep each change additive and in its own spot.

| File                                                    | Change                                                                                                              | Also edited by                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/contracts/src/fork/pcb-preview.ts`            | Optional `uuid`, `id`, `sheetId`, `pointsInMm`.                                                                     | L54, L58, L64, L68                                    |
| `packages/contracts/src/fork/pcb-workspace.ts`          | `PcbFinding` (shared definition), two editor actions, `findings` snapshot state.                                    | Most packets with editor actions (L60, L61, L66, L69) |
| `apps/server/src/fork/pcb-preview/kicadReports.ts`      | Unit and ERC scale normalization, `findingId`, `ercSheetId`, `normalizeCheckResult`.                                | L54 (if it converts units), L58                       |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts` | Two call sites in `check` and `latestChecks`.                                                                       | Most server packets                                   |
| `apps/server/src/fork/pcb-preview/mcp.ts`               | Three description strings.                                                                                          | Every packet adding tools                             |
| `apps/web/src/fork/pcb-preview/PcbPreviewPanel.tsx`     | Key lines (`.`, `,`, `C`, Escape), overlay slot, pick hit test, two editor cases, snapshot field, ChecksView props. | Every UI packet                                       |
| `apps/web/src/fork/pcb-preview/SvgViewport.tsx`         | `OverlayScaleContext` provider, `unitsPerPixel` on the handle.                                                      | L60, L62, L63, L69                                    |
| `apps/web/src/fork/pcb-preview/ChecksView.tsx`          | Lifted excluded state, active finding, switch, Locate gate.                                                         | L54, L58, L64, L68                                    |
| `apps/web/src/fork/pcb-preview/WorkspaceChrome.tsx`     | Two `SHORTCUTS` rows.                                                                                               | L60, L61, L66, L69                                    |
| `apps/web/src/fork/pcb-preview/preferences.ts`          | `checkMarkers` with a decoding default.                                                                             | Any packet with a device preference                   |
| `docs/fork/user/pcb-preview.md`                         | Two sentences in the Checks paragraph.                                                                              | Every packet                                          |

New files: `apps/web/src/fork/pcb-preview/findings.ts`, `findings.test.ts`, `CheckMarkers.tsx`,
`apps/server/src/fork/pcb-preview/kicadReports.test.ts`.

## Merge check

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. Nothing here touches upstream files.

## FORK.md rows

None.
