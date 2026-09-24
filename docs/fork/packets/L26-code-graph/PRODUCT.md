# L26 product

## Problem

Agents and Kyle both waste time answering structural questions by grepping: what calls this
function, which modules depend on this file, what else might break if this diff lands. The
diff panel shows what changed but not what the change reaches. Graphify already builds a
deterministic code graph locally with tree-sitter across 25+ languages; Loom should put it to
work without adopting its agent-config installers.

## What the user can do

- See whether Graphify is available on the environment, and if not, the exact command to
  install it (pinned to 0.9.67, the tested version). Another installed version still works
  and shows "Untested version".
- Build the graph for the current project with one click, see progress, and later update it
  incrementally. See when the graph is stale (built at an older commit, or the tree has
  uncommitted changes).
- Browse the project in the **Code map** panel:
  - Overview: files, symbols and relations counted; the largest communities (clusters of
    related code) with their main files; the most connected ("hub") symbols.
  - Search symbols and files by name.
  - Select a symbol to see its neighbors grouped by relation (calls, called by, imports,
    imported by, contains, inherits), with a small graph of the neighborhood.
  - Open any symbol's file at its line in the Files panel.
- See the **blast radius** of changes: from the diff panel's "Impact" button, the panel opens
  on the Impact tab with the diff's files; it lists affected symbols and files by distance
  (1 to 3 hops) and by the relation that reaches them. Opened from the palette or launcher,
  Impact uses the thread's working tree changes.
- Add an impact summary to the composer as context ("Add to message"), so the agent gets the
  same list.
- Let agents query the graph through a Loom MCP tool, per project ("Let agents query the code
  graph", off by default), and turn it off again.
- Turn on automatic graph updates: after turns that changed files, and in the background
  when opening a project whose graph is stale. Only one graph builds at a time per
  environment; others wait with "Waiting for another build".
- Delete a project's graph.

## Entry points

| Entry                                                                                    | Behavior                                                                                                                                                               | Reverse / visibility                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Right panel launcher and "+" menu: "Code map" (letter Y)                                 | Opens the panel on Overview.                                                                                                                                           | Close the tab.                                 |
| Diff panel header: "Impact" button (network icon)                                        | Opens the panel on Impact with the files in the diff's current scope (working tree, branch or turn). Hidden when the server lacks the feature or the diff is empty.    | Close the tab.                                 |
| Command palette: "Open code map", "Show impact of current changes", "Rebuild code graph" | As named. Hidden without the feature.                                                                                                                                  | n/a                                            |
| Keybinding                                                                               | None in v1 (panel toggles can be added through `ext-keybindings` later).                                                                                               | n/a                                            |
| Settings, Loom page, "Code graph" section                                                | Graphify command (with the pinned install command), "Update graphs automatically", per-project graph list with size, the per-project agent switch, and "Delete graph". | Same section.                                  |
| Code map panel, Overview header                                                          | "Let agents query the code graph for this project" switch and the Graphify version label.                                                                              | Same switch.                                   |
| Opening a project                                                                        | With auto-update on and a stale graph, an update starts in the background.                                                                                             | Turn auto-update off.                          |
| Agents: `loom_code_graph_query`                                                          | Search, neighbors, impact, path. Answers only in projects with the agent switch on.                                                                                    | Per-project "Let agents query the code graph". |
| Composer                                                                                 | "Add to message" in the Impact tab inserts a compact impact summary into the draft.                                                                                    | Remove text from the draft.                    |

## States

- **Server lacks the feature** (upstream T3 or old Loom server): launcher entry disabled with
  "Needs a Loom server"; diff button and palette items hidden.
- **Graphify missing**: panel shows "Graphify is not installed on <environment name>." with
  the install command and a "Check again" button. Settings shows the same.
- **Untested Graphify version**: a warning label "Graphify X, untested version (Loom is
  tested with 0.9.67)" next to the version; everything else works as usual.
- **Graph shape mismatch**: when a build's `graph.json` does not have the shape Loom reads,
  "This graph was built by Graphify X and does not have the shape Loom reads. Loom is tested
  with Graphify 0.9.67." with the pinned install command; the previous graph stays in use.
- **Queued**: "Waiting for another build" while a different project's graph builds.
- **Agent tool off** (what an agent sees): "The code graph tool is off for this project."
- **No graph yet**: "No code graph for <project>." with "Build graph" and an estimate note
  ("Large repositories can take a few minutes").
- **Building / updating**: progress line with elapsed time and the last Graphify output line;
  "Cancel". Panels stay usable on the previous graph during an update.
- **Ready**: "Built <relative time> at <short sha>". **Stale**: "Built at <sha>, HEAD is
  <sha>" or "Uncommitted changes since the last build", with "Update".
- **Failed**: the error summary and the last lines of Graphify's stderr, "Try again".
- **Too large**: "The graph is larger than 100 MB and was not loaded." (limit in TECHNICAL).
- **Empty results**: "No symbols match." / "No affected symbols found within 3 hops." /
  "This symbol has no recorded relations."
- **Impact with no changes**: "No changed files in this thread."

## Surfaces and connection modes

Web and desktop supported. Mobile shows nothing. Everything runs on the environment's server,
so local, Tailscale and T3 Connect behave the same; only small JSON results cross the wire.
The graph is per environment: two environments with the same project each build their own.

## Copy

Panel title "Code map". Tabs "Overview", "Search", "Impact". Buttons "Build graph", "Update",
"Cancel", "Delete graph", "Add to message", "Open file". Settings section "Code graph".

## Decisions

- Graphify runs only with local, deterministic options (`--code-only`, no labeling), with LLM
  API keys stripped from its environment. No network, no API spend.
- Output lives in Loom's state directory, never as `graphify-out/` in the user's repository.
- The fork reads `graph.json` itself and serves small, bounded answers; the whole graph never
  crosses the WebSocket.
- One MCP tool with a `mode` parameter, per EXTENSION-POINTS.md guidance on tool cost.
- Loom does not install Graphify; it shows the command.
- Not in the original selection; added from the repository review
  ([selections.md](../../selections.md), "From selection to packet") and confirmed by Kyle on
  2026-09-24.
- "Let agents query the code graph" is off by default and enabled per project (Kyle): most
  sessions will not use it, and a project where agents benefit can opt in. Upstream lists
  every MCP tool to every session, so the one-sentence description is still paid everywhere;
  the switch decides whether calls answer. L15 reads the graph server-side regardless of
  this switch, because no agent is querying in that path.
- Graphify 0.9.67 is pinned in every install command Loom shows (Kyle). Other versions still
  run, labeled "untested version", and a `graph.json` shape check fails with a clear message
  instead of showing wrong results. `graph.json` has no schema version, so the shape check is
  the real guard.
- Auto-update also runs when a project with a stale graph is opened, in the background, with
  one build at a time per environment (Kyle). It never builds a first graph on its own.
