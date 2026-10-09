# L26 product

## Problem

Agents and Kyle both waste time answering structural questions by grepping: what calls this
function, which modules depend on this file, what else might break if this diff lands. The
diff panel shows what changed but not what the change reaches. Graphify already builds a
deterministic code graph locally with tree-sitter across 25+ languages; Loom puts it to work
without adopting its agent-config installers.

## What the user can do

- See whether Graphify is available on the environment, and if not, the exact command to
  install it (pinned to 0.9.83, the tested version). Another installed version still works
  and is labeled untested.
- Build the graph for the current project with one click, watch progress, cancel, and later
  update it incrementally. See when the graph is out of date (built at an older commit, or
  uncommitted changes since the build).
- Browse the project in the **Code map** panel:
  - Overview: the most connected symbols and the largest groups (Graphify communities) with
    their main files.
  - Search symbols and files by name. Picking one shows its neighborhood as a small static
    graph plus "Uses" and "Used by" lists; any entry can become the new focus.
  - Open a symbol's file at its line in the Files panel.
- See the **impact** of changes: the files and symbols that can be affected, by distance (1
  to 3 hops) and the relation that reaches them. From the diff panel header it traces the
  diff's files; from the panel or palette it traces the thread checkout's uncommitted
  changes.
- Add an impact summary (at most 40 lines) to the composer with "Add to message".
- Let agents query the graph through a Loom MCP tool, per project ("Let agents query the code
  graph for this project", off by default), and turn it off again.
- Turn on automatic graph updates. Only one graph builds at a time per environment; others
  show "Waiting for another build".
- Delete a project's graph.

## Entry points

| Entry                                                                                                           | Behavior                                                                                                                                                            | Reverse / visibility                 |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Right panel launcher, "+" menu and panel picker: "Code map" (letter Y)                                          | Opens the panel on the thread's last view (Overview at first).                                                                                                      | Close the tab.                       |
| Diff panel header: "Show impact of these changes" (network icon)                                                | Switches the same Code map surface to Impact for the files in the diff's current scope and opens it. Hidden without a thread, without files or without the feature. | "Use uncommitted changes" in Impact. |
| Command palette: "Code map: Open", "Code map: Impact of uncommitted changes", "Code map: Build or update graph" | As named. Hidden without the feature or a project.                                                                                                                  | n/a                                  |
| Keybinding                                                                                                      | None.                                                                                                                                                               | n/a                                  |
| Settings, Loom page, "Code graph" section                                                                       | Graphify command with install commands, "Use uvx" and "Reset command"; "Update graphs automatically"; per-project graphs with size, agent switch, "Delete graph".   | Same section.                        |
| Code map panel, Overview, "This project"                                                                        | "Let agents query the code graph for this project" switch and "Delete graph" (with confirmation).                                                                   | Same switch.                         |
| Opening a project                                                                                               | With automatic updates on and an out-of-date graph, an update starts in the background.                                                                             | Turn automatic updates off.          |
| Agents: `loom_code_graph_query`                                                                                 | Search, neighbors, impact, path. Answers only in projects with the agent switch on.                                                                                 | The per-project switch.              |
| Composer                                                                                                        | "Add to message" in Impact appends the summary to the draft.                                                                                                        | Remove the text from the draft.      |

## States

- **Server lacks the feature**: launcher entry disabled with "Needs a Loom server with the
  code graph"; diff button and palette items hidden; settings says the server does not have
  the code graph.
- **No project yet** (a draft thread): "The code map uses this thread's project. Send a
  message to start the thread first."
- **Graphify missing**: "Graphify is not installed", the pinned install command, the command
  Loom looked for, and "Check again", which re-runs detection on the server.
- **Untested Graphify version**: "Graphify X is an untested version. Loom is tested with
  0.9.83, so some graphs may not load." Everything else works as usual.
- **Graph shape mismatch**: the build fails with "This graph was built by Graphify X and does
  not have the shape Loom reads (...). Loom is tested with Graphify 0.9.83: <install
  command>"; the previous graph stays in use.
- **Queued**: "Waiting for another build. One graph builds at a time on this environment."
- **No graph yet**: "No code graph yet" with "Build graph" and "Large repositories can take a
  few minutes."
- **Building / updating / rebuilding**: elapsed time, the last Graphify output line and
  "Cancel". With an earlier graph, its answers keep working until the build finishes.
- **Ready**: "Built <relative time>, at <short sha>", node and link counts, size. **Out of
  date**: "Built at an older commit than the project's current one." or "The project has
  uncommitted changes since the build.", with "Update".
- **Update refused to shrink**: "The update would remove part of the graph. Rebuild to replace
  it." with "Rebuild anyway" and "Try again"; the previous graph stays in use.
- **Failed**: the error summary, Graphify's last output lines under "Details", "Try again".
- **Too large**: "The graph is larger than 100 MB and was not loaded."
- **Agent tool off** (what an agent sees): "The code graph tool is off for this project. Turn
  on 'Let agents query the code graph' in the Code map panel."
- **Empty results**: "No symbols or files match ...", "Nothing in the graph links to this
  symbol.", "Nothing else in the graph depends on these files."
- **Impact with no changes**: "No changes to trace."

## Surfaces and connection modes

Web and desktop supported. Mobile shows nothing. Everything runs on the environment's server,
so local, Tailscale and T3 Connect behave the same. The graph is per environment: two
environments with the same project each build their own.

## Copy

Panel title "Code map". Views "Overview", "Search", "Impact", chosen with a segmented toggle
shown once a graph exists. Buttons "Build graph", "Update", "Rebuild", "Rebuild anyway",
"Try again", "Cancel", "Delete graph", "Open file", "Add to message", "Use uncommitted
changes", "Check again". Settings section "Code graph".

## Decisions

- Graphify runs only with local, deterministic options (`--code-only`), with LLM API keys
  stripped from its environment. No network calls from Loom, no API spend.
- Output lives in Loom's state directory, never as `graphify-out/` in the user's repository.
- The fork reads `graph.json` itself and serves small, bounded answers; the whole graph never
  crosses the WebSocket.
- One MCP tool with a `mode` parameter, per EXTENSION-POINTS.md guidance on tool cost.
- Loom does not install Graphify; it shows the command.
- "Let agents query the code graph" is off by default and enabled per project (Kyle). The
  tool is listed in every session, so its one-sentence description is paid everywhere; the
  switch decides whether calls answer. Server-side readers such as L15 are not gated.
- Graphify 0.9.83 is pinned in every command Loom shows (Kyle). Other versions still run,
  labeled untested; the `graph.json` shape check is the real guard, because the file has no
  schema contract Loom can rely on.
- Automatic updates are off by default and only update existing graphs, never a first one
  (Kyle). They run after a project-root turn that changed files and when a client opens a
  project with an out-of-date graph, one build at a time per environment. Turns in a
  separate worktree never trigger them, because they leave the project root unchanged.
- The diff header button reuses the single Code map surface and switches it to Impact
  rather than opening a second panel.
