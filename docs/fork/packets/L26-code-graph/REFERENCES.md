# L26 references

## Old Loom

No direct predecessor. Old Loom's P7 "branch graph" is a git graph (L06), not a code graph.
The L26 brief (2026-09-24) introduces Graphify as a new capability.

## Graphify (primary dependency, called as an external tool)

Repository: <https://github.com/Graphify-Labs/graphify>, PyPI package `graphifyy`, tested
release 0.9.83, Python 3.10+. License Apache-2.0 (code contributed before the relicense
remains MIT; see its `LICENSE-MIT` and `NOTICE`). Loom does not vendor or copy its code; it
runs the installed CLI, reads its output, and ports the traversal idea (not code) to
TypeScript. The packet was first reviewed at 0.9.67 (commit `4c73561`); the implementation
targets 0.9.83, and the test fixture's `graph.json` was written by 0.9.83. Look these up by
name in the pinned release; line numbers move between releases.

| Path                                                                       | Use                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pyproject.toml`                                                           | Package name, `graphify` entry point, version pin.                      |
| `graphify/cli.py` (`extract`: `--code-only`, `--out`, `--force`; `update`) | Build argv.                                                             |
| `graphify/watch.py` (`_rebuild_code`)                                      | What `update` re-extracts.                                              |
| `graphify/paths.py` (`GRAPHIFY_OUT`, read at import)                       | Output directory override.                                              |
| `graphify/export.py` (`to_json` and its shrink guard)                      | `graph.json` shape, atomic writes, the "Refusing to overwrite" refusal. |
| `graphify/validate.py`                                                     | Required node and edge fields.                                          |
| `graphify/affected.py` (`DEFAULT_AFFECTED_RELATIONS`, `affected_nodes`)    | The impact walk Loom ports; `IMPACT_RELATIONS` copies the list.         |
| `graphify/prs.py` (`compute_pr_impact`)                                    | Community count for impact.                                             |
| `graphify/serve.py`                                                        | Graphify's MCP server, rejected as the agent path.                      |
| `graphify/llm.py`                                                          | LLM backends and their environment variables, scrubbed from the child.  |
| `graphify/install.py`, `graphify/hooks.py`                                 | What Loom must never run (agent config and git hook writers).           |
| `graphify/security.py`                                                     | Graphify's own graph size cap (512 MiB); Loom refuses above 100 MB.     |
| `BENCHMARKS.md`                                                            | Scale reference (about 22.6k nodes and 48.7k edges for ERPNext).        |

## Upstream T3 Code (orchestration V2)

- `apps/server/src/orchestration-v2/ThreadManagementService.ts`: `streamDomainEvents`, the
  source of `checkpoint.captured` (`packages/contracts/src/orchestrationV2.ts`), whose
  `payload.files` lists a turn's changed files.
- `apps/server/src/persistence/OrchestrationEventStore.ts`: `latestApplicationSequence` and
  `streamApplicationEvents`, the source of `project.deleted`
  (`packages/contracts/src/applicationEvent.ts`).
- `apps/server/src/orchestration-v2/ProjectStore.ts` (`ProjectStoreV2.get`: title and
  `workspaceRoot`) and `ProjectionStore.ts` (`ProjectionStoreV2.getThread`: `projectId` and
  `worktreePath`).
- `apps/server/src/serverActivation.ts`: `forkParked` for the reactor streams.
- `apps/server/src/processRunner.ts`: `ProcessRunner` for short git calls.
- `apps/server/src/mcp/McpToolAccess.ts` (`readsAsCaller`) and `McpInvocationContext.ts`:
  thread-scoped access for the agent tool.
- `apps/server/src/config.ts`: `stateDir`.
- `apps/web/src/components/DiffPanel.tsx`: `routeThreadRef`, `codeViewFiles`,
  `selectedScopeLabel` and `diffSelection`, passed to the `ext-diff-header` seam.
- `apps/web/src/rightPanelStore.ts`: `openSurface` and `openFile(ref, path, line)`.
- `apps/web/src/composerDraftStore.ts`: `getComposerDraft` and `setPrompt`, used by "Add to
  message".

## External

- NetworkX node-link format (what `graph.json` is):
  <https://networkx.org/documentation/stable/reference/readwrite/generated/networkx.readwrite.json_graph.node_link_data.html>.
- uv tools: <https://docs.astral.sh/uv/guides/tools/>.
