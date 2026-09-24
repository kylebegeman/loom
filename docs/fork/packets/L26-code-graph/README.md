# L26: Code graph

Status: Not started. Confirm scope with Kyle before implementation (the packets index notes
L26 is not in selections.md; the brief of 2026-09-24 asks for it).

Loom builds a code knowledge graph for a project with Graphify (a local, tree-sitter based
Python tool) and uses it three ways: a **Code map** panel to browse the project's modules,
hub symbols and a symbol's neighbors; a **blast-radius** view of what the current changes can
affect, opened from the diff panel; and one agent-facing MCP tool so agents can ask "who calls
this" or "what does this change touch" without grepping. Loom calls Graphify's CLI with
local-only options and reads its `graph.json`; it never runs Graphify's installers or hooks,
which rewrite agent configuration.

## Scope

- In:
  - Detect Graphify on the server (`graphify` on PATH, or a configured command such as
    `uvx --from graphifyy@0.9.67 graphify`), with setup instructions when missing.
  - Build and update a per-project graph with `--code-only` (no LLM, no API key), output
    stored under `<stateDir>/fork/code-graph/<projectId>/`, never in the repository.
  - Status with staleness (graph commit vs `HEAD`, dirty tree), streamed to clients.
  - Code map panel: overview (stats, communities, hub symbols), symbol search, a symbol's
    neighborhood (list plus a small SVG graph), and an Impact tab.
  - Blast radius: from the diff panel's changed files, or the working tree when opened
    elsewhere, list affected symbols and files by distance and relation.
  - MCP tool `loom_code_graph_query` (search, neighbors, impact, path).
  - Optional auto-update after each turn that changed files (off by default).
  - A settings section (Graphify command, auto-update, agent tool on or off).
- Out:
  - Graphify's LLM features (semantic extraction of docs, community labeling, PR triage), its
    HTML visualization, its own MCP server, `graphify install`, `graphify hook install`,
    `graphify watch`. See [TECHNICAL.md](./TECHNICAL.md#what-loom-never-runs).
  - Installing Python, uv or Graphify from the app. The UI shows the command to run.
  - A full interactive force-directed map of the whole repository (needs a graph rendering
    dependency; revisit if the list views prove insufficient).
  - Per-file impact badges inside the diff file list (a second, larger seam).
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: not supported (the mobile app shows nothing new; the RPCs
are available through client-runtime if a later packet wants them). Remote: works over every
connection mode; Graphify runs on the environment's machine. Upstream T3 servers: the panel
shows "Needs a Loom server" and the diff button is hidden.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC, ForkLayer, persistence, capability `"code-graph"`), including a background
  reactor for auto-update and cleanup.
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (the Code map panel, launcher letter `Y`).
- [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp) (one tool).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (one section on the Loom settings page).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (open the panel, show impact of current changes, rebuild graph).
- `ext-diff-header` ([EXTENSION-POINTS.md, section 17](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header)): the "Impact" button in the
  diff panel header.

Create any that are missing, exactly as specified in EXTENSION-POINTS.md.

## Packet seams

None. The diff panel button goes through `ext-diff-header`. See [SEAMS.md](./SEAMS.md).

## Prerequisites on the machine

Python 3.10 or newer and uv (or pipx). Graphify installed with
`uv tool install "graphifyy==0.9.67"` (the PyPI name has a double y), or reached through
`uvx` via the Graphify command setting. Loom works without it; the feature explains what is
missing.

## Size

Medium to large: about 2,500 to 3,200 lines including tests. The server (runner, index,
traversal) is the bulk.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then this
folder. Install Graphify locally first (see Prerequisites) and run it by hand once on a small
repository to confirm the flags in TECHNICAL.md against the installed version. Build the
graph index and traversal against a checked-in fixture `graph.json` before touching the
runner or UI.

## Documents

- [PRODUCT.md](./PRODUCT.md), [TECHNICAL.md](./TECHNICAL.md), [SEAMS.md](./SEAMS.md),
  [IMPLEMENTATION.md](./IMPLEMENTATION.md), [TESTING.md](./TESTING.md),
  [REFERENCES.md](./REFERENCES.md).
