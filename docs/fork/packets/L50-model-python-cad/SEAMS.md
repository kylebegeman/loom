# L50 seams

## Extension points created by this packet

None: all existed.

## Packet seams

None. Every file this packet touches is fork-owned, so upstream merges cannot conflict with it.
The STEP download reuses the upstream download pattern by copying its few lines into fork code,
not by editing `apps/web/src/components/media/mediaContent.ts`.

## Fork-owned shared files this packet edits

Parallel model packets edit some of the same files. Keep each change additive.

| File                                                                             | Change                                                                                                                                                                                                              | Also edited by                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/contracts/src/fork/model-preview-3d.ts`                                | `"build123d"` format, `modelFormatOf`, `MODEL_EXTENSIONS`, `isSourceFormat`, `pythonPath` setting, `python` status, three RPC tags, `listModels` `include`, `"python-missing"`.                                     | Most model packets                            |
| `packages/contracts/src/fork/clientRpcPermissions.ts`                            | Three terminal entries.                                                                                                                                                                                             | L47, L51                                      |
| `apps/server/src/fork/rpcAuthorization.ts`                                       | Three entries.                                                                                                                                                                                                      | L47, L51                                      |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts`                   | Create `makePythonCad` in `make`; `renderScad` dispatches STEP; `parameters` and `renderImages` accept the new formats; `sidecarPath` handles `.b3d.py`; `listModels` honours `include`; `status` reports `python`. | Most model packets                            |
| `apps/server/src/fork/model-preview-3d/formats.ts`                               | If L41 created it, its map defers to `modelFormatOf`.                                                                                                                                                               | L41, L49                                      |
| `apps/server/src/fork/model-preview-3d/rpc.ts`, `mcp.ts`                         | Three handlers, one tool, format dispatch in `render_mesh`.                                                                                                                                                         | L32, L46, L47, L51                            |
| `packages/client-runtime/src/fork/model-preview-3d.ts`                           | Three atoms.                                                                                                                                                                                                        | L47, L51                                      |
| `apps/web/src/fork/model-preview-3d/ModelPanel.tsx`                              | `modelFormatOf`, `isSourceFormat`, the STEP state.                                                                                                                                                                  | Most model packets                            |
| `apps/web/src/fork/model-preview-3d/ModelInspector.tsx`                          | Labels and "Export STEP".                                                                                                                                                                                           | L32, L36, L40, L46, L47                       |
| `apps/web/src/fork/model-preview-3d/ModelPicker.tsx`                             | Filters and labels.                                                                                                                                                                                                 | L41                                           |
| `apps/web/src/fork/model-preview-3d/ScadCustomizer.tsx`, `VariantsInspector.tsx` | Render command by format.                                                                                                                                                                                           | L32, L47                                      |
| `apps/web/src/fork/model-preview-3d/SettingsSection.tsx`                         | Render `PythonSettings`.                                                                                                                                                                                            | L33, L34, L47, L51                            |
| `docs/fork/user/model-preview-3d.md`                                             | Replace the STEP sentence; add a short Python CAD section.                                                                                                                                                          | Every model packet that changes user guidance |

## Merge check

Run before review:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Expected: exit status 0. Record the tag and result here when the packet is built.

## FORK.md rows

None. No upstream file is touched.
