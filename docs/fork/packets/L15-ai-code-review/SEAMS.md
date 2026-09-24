# L15 seams

Provisional until the design session. Listed per engine option so the session can weigh merge
cost.

## Extension points

Recommended v1 uses `ext-core` (with persistence and a reactor), `ext-panels`, `ext-mcp`,
`ext-palette`, `ext-settings`, and optionally `ext-keybindings` (with `ext-web-root`). Create
any missing one exactly as specified in [EXTENSION-POINTS.md](../EXTENSION-POINTS.md).

## Packet seams by option

| Option                                           | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Count  | Merge risk                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| A2 reviewer thread plus MCP submit (recommended) | none required                                                                                                                                                                                                                                                                                                                                                                                                                                              | 0      | none                                                     |
| A2 plus diff panel button                        | none; one action registered in `ext-diff-header` (shared with L26)                                                                                                                                                                                                                                                                                                                                                                                         | 0      | none (the extension point carries the risk)              |
| A3 headless structured runner                    | none; fork code reimplements the CLI invocation                                                                                                                                                                                                                                                                                                                                                                                                            | 0      | none, but duplicated CLI plumbing drifts from upstream's |
| A4 headless Codex app-server                     | none                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 0      | none                                                     |
| A1 native provider review                        | `apps/server/src/provider/Services/ProviderAdapter.ts` (optional `review` capability), `apps/server/src/provider/Layers/CodexAdapter.ts`, `apps/server/src/provider/Layers/CodexSessionRuntime.ts` (`review/start`), `apps/server/src/provider/Layers/ProviderService.ts` (expose it), a trigger in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` (like the `/compact` check at 91-94) or a fork RPC calling `ProviderService` directly | 4 to 6 | high: provider code is among upstream's busiest          |

## Diff panel button

If the session keeps the "Review changes" button, it goes through `ext-diff-header`
([EXTENSION-POINTS.md, section 17](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header)), shared with L26: register an action in
`FORK_DIFF_HEADER_ACTIONS` and add no packet seam. Create the extension point if its
existence check fails.

## Merge check

After implementation:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

## FORK.md rows

To be written after the session, one row per upstream file actually touched.
