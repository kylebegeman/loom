# L26: Code graph

Status: Implemented on `feat/loom-code-graph`, built on orchestration V2 with Graphify 0.9.83.
Not merged yet. Kyle deferred the packet for V2 on 2026-09-27 and included it on 2026-10-09.
See the [selected queue](../IMPLEMENT-NOW.md#selected-queue).
User guide: [Code map](../../user/code-graph.md).

Commits:

- `13fa404a42` feat(fork): add the diff panel header extension point (`ext-diff-header`).
- `b188786e4b` feat(fork-code-graph): build code graphs with Graphify on the server.
- `ee70a90584` feat(fork-code-graph): show the code map panel and change impact.

Not in the original selection; added from the repository review
([selections.md](../../selections.md), "From selection to packet") and confirmed by Kyle on
2026-09-24.

Loom builds a code knowledge graph for a project with Graphify (a local, tree-sitter based
Python tool) and uses it three ways: a **Code map** panel to browse the project's hub
symbols, groups and a symbol's neighbors; an **impact** view of what the current changes can
reach, opened from the diff panel header; and one agent-facing MCP tool so agents can ask
"who calls this" or "what does this change touch" without grepping. Loom calls Graphify's
CLI with local-only options and reads its `graph.json`; it never runs Graphify's installers,
hooks or MCP server, which rewrite agent configuration.

## Scope

- In:
  - Detect Graphify on the server (`graphify` on PATH, or a configured command such as
    `uvx --from graphifyy==0.9.83 graphify`), with install commands when missing. Every
    command Loom shows pins 0.9.83; other versions run, labeled untested, and a
    `graph.json` shape check fails with a clear message if their output differs.
  - Build and update a per-project graph with `--code-only` (no LLM, no API key), written
    under the server state directory at `fork/code-graph/<encoded projectId>/`, never in
    the repository. One build at a time per environment, one waiting build per project.
  - Status with staleness (built at another commit than `HEAD`, or uncommitted changes since
    the build), streamed to clients.
  - Code map panel with Overview, Search (with a neighborhood graph) and Impact views.
  - Impact from the diff panel's files, or from the thread checkout's uncommitted changes.
  - MCP tool `loom_code_graph_query` (search, neighbors, impact, path), answering only in
    projects where "Let agents query the code graph" is on (off by default, per project).
  - Automatic updates (off by default) of existing graphs after a project-root turn that
    changed files, and when a client opens a project whose graph is out of date.
  - A Loom settings section (Graphify command, automatic updates, per-project graphs).
- Out:
  - Graphify's LLM features, HTML visualization, MCP server, `install`, `hook install` and
    `watch`. See [TECHNICAL.md](./TECHNICAL.md#what-loom-never-runs).
  - Installing Python, uv or Graphify from the app. The UI shows the command to run.
  - A whole-repository interactive map (needs a graph rendering dependency).
  - Per-file impact badges inside the diff file list (a second, larger seam).
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: nothing new; the RPCs are available through
client-runtime. Remote: works over every connection mode; Graphify runs on the environment's
machine and only small JSON answers cross the wire. Upstream T3 servers: the launcher entry
is disabled with "Needs a Loom server with the code graph", and the diff button, palette
items and settings section are hidden or explained.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group, `ForkLayer` service
  and reactor, persistence, capability `"code-graph"`.
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels): the Code map panel,
  launcher letter `Y`.
- [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp): one tool.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): the "Code graph" section.
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): open, impact, build
  or update.
- [`ext-diff-header`](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header), created
  by this packet in `13fa404a42`: the "Show impact of these changes" button.
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root): `CodeGraphOpenWatcher`,
  which reports the project a client opens.

## Packet seams

None. The diff panel button goes through `ext-diff-header`. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- L15 (AI code review), if present, can read impact server-side through
  `CodeGraphService.impact`. The per-project agent switch gates only the MCP tool.
- L12 (panel picker) lists the Code map panel through the panel registry, with the panel's
  `description`. No work in this packet.

## Prerequisites on the machine

Python 3.10 or newer and uv (or pipx). Graphify installed with
`uv tool install "graphifyy==0.9.83"` (the PyPI name has a double y), or reached through
`uvx` with the "Use uvx" button in settings. Loom works without Graphify; every entry point
explains what is missing.

## Size

About 5,400 lines across the three commits, about 1,100 of them tests, plus a 6,400-line
`graph.json` fixture. The server (service, index, runner) is the bulk.

## Documents

- [PRODUCT.md](./PRODUCT.md), [TECHNICAL.md](./TECHNICAL.md), [SEAMS.md](./SEAMS.md),
  [IMPLEMENTATION.md](./IMPLEMENTATION.md), [TESTING.md](./TESTING.md),
  [REFERENCES.md](./REFERENCES.md).
