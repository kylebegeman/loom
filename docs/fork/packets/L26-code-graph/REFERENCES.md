# L26 references

## Old Loom

No direct predecessor. Old Loom's P7 "branch graph" is a git graph (L06), not a code graph.
The L26 brief (2026-09-24) introduces Graphify as a new capability.

## Graphify (primary dependency, called as an external tool)

Repository: <https://github.com/Graphify-Labs/graphify>, reviewed at commit
`4c735618f3d56fd622c2049771584621c31ba9ff`, PyPI package `graphifyy` 0.9.67, Python 3.10+.
License Apache-2.0 (code contributed before the relicense remains MIT; see its `LICENSE-MIT`
and `NOTICE`). Loom does not vendor or copy its code; it runs the installed CLI and reads its
output, and ports the traversal idea (not code) to TypeScript.

| Path                                                                                             | Use                                                                   |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `pyproject.toml` (name, entry points `graphify`, `graphify-mcp`, extras)                         | Install command and version pin.                                      |
| `graphify/cli.py:3218-3345` (`extract` flags: `--code-only`, `--out`, `--force`, `--no-cluster`) | Build argv.                                                           |
| `graphify/cli.py:2403-2461`, `graphify/watch.py:1379` (`update`, `_rebuild_code`)                | Incremental update.                                                   |
| `graphify/paths.py` (`GRAPHIFY_OUT`, read at import)                                             | Output directory override.                                            |
| `graphify/export.py:272-417` (`to_json`, shrink guard at 273-327)                                | `graph.json` shape and atomic writes.                                 |
| `graphify/validate.py:4-7`                                                                       | Required node and edge fields.                                        |
| `graphify/affected.py` (`DEFAULT_AFFECTED_RELATIONS` 10-32, `affected_nodes` 189)                | Blast-radius algorithm to port.                                       |
| `graphify/prs.py:260` (`compute_pr_impact`)                                                      | Community count for impact.                                           |
| `graphify/serve.py` (MCP server, tools at 1881-2012)                                             | Reviewed and rejected as the agent path (TECHNICAL, Alternatives).    |
| `graphify/llm.py:102-215`                                                                        | LLM backends and their env vars, scrubbed from the child environment. |
| `graphify/install.py`, `graphify/hooks.py`                                                       | What Loom must never run (agent config and git hook writers).         |
| `graphify/security.py:32`                                                                        | Graphify's own graph size cap (512 MiB).                              |
| `BENCHMARKS.md`                                                                                  | Scale reference (about 22.6k nodes, 48.7k edges for ERPNext).         |

## Upstream T3 Code

- `apps/web/src/components/DiffPanel.tsx`: `routeThreadRef` (133), `selectedScopeLabel`
  (216), `codeViewFiles` (435), header action group (756). Seams at 87 and 756.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx:1071-1095`: writing text
  into a thread's composer draft (`getComposerDraft`, `setPrompt`).
- `apps/web/src/rightPanelStore.ts:137,577-600`: `openFile(ref, path, line)`.
- `apps/server/src/processRunner.ts`: child process spawning pattern
  (`ChildProcessSpawner`, `resolveSpawnCommand`), `ProcessRunner` for short git calls.
- `apps/server/src/mcp/toolkits/pullRequests/handlers.ts:146-181`: resolving a thread and
  project from `McpInvocationContext` with `ProjectionSnapshotQuery`.
- `apps/server/src/provider/Layers/ProviderService.ts:906-913`: MCP capabilities per session
  (`pull-requests` always granted).
- `apps/server/src/serverActivation.ts:11-26`: `forkParked` for the reactor.
- `packages/contracts/src/orchestration.ts:1944,2084`: `project.deleted`,
  `thread.turn-diff-completed` events.
- `apps/server/src/config.ts:117-131`: `stateDir`.

## External

- NetworkX node-link format (what `graph.json` is):
  <https://networkx.org/documentation/stable/reference/readwrite/generated/networkx.readwrite.json_graph.node_link_data.html>.
- uv tool install: <https://docs.astral.sh/uv/guides/tools/>.
