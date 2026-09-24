# L26 product

## Problem

Agents and Kyle both waste time answering structural questions by grepping: what calls this
function, which modules depend on this file, what else might break if this diff lands. The
diff panel shows what changed but not what the change reaches. Graphify already builds a
deterministic code graph locally with tree-sitter across 25+ languages; Loom should put it to
work without adopting its agent-config installers.

## What the user can do

- See whether Graphify is available on the environment, and if not, the exact command to
  install it.
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
- Let agents query the graph through a Loom MCP tool, or turn that tool off.
- Turn on automatic graph updates after turns that changed files.
- Delete a project's graph.

## Entry points

| Entry                                                                                    | Behavior                                                                                                                                                            | Reverse / visibility                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Right panel launcher and "+" menu: "Code map" (letter Y)                                 | Opens the panel on Overview.                                                                                                                                        | Close the tab.                             |
| Diff panel header: "Impact" button (network icon)                                        | Opens the panel on Impact with the files in the diff's current scope (working tree, branch or turn). Hidden when the server lacks the feature or the diff is empty. | Close the tab.                             |
| Command palette: "Open code map", "Show impact of current changes", "Rebuild code graph" | As named. Hidden without the feature.                                                                                                                               | n/a                                        |
| Keybinding                                                                               | None in v1 (panel toggles can be added through `ext-keybindings` later).                                                                                            | n/a                                        |
| Settings, Loom page, "Code graph" section                                                | Graphify command, auto-update after turns, agent tool on or off, per-project graph list with size and "Delete graph".                                               | Same section.                              |
| Agents: `loom_code_graph_query`                                                          | Search, neighbors, impact, path.                                                                                                                                    | Setting "Let agents query the code graph". |
| Composer                                                                                 | "Add to message" in the Impact tab inserts a compact impact summary into the draft.                                                                                 | Remove text from the draft.                |

## States

- **Server lacks the feature** (upstream T3 or old Loom server): launcher entry disabled with
  "Needs a Loom server"; diff button and palette items hidden.
- **Graphify missing**: panel shows "Graphify is not installed on <environment name>." with
  the install command and a "Check again" button. Settings shows the same.
- **Python or Graphify too old**: "Graphify 0.9.67 or newer is needed (found X)."
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

## Decisions and open questions

Decisions:

- Graphify runs only with local, deterministic options (`--code-only`, no labeling), with LLM
  API keys stripped from its environment. No network, no API spend.
- Output lives in Loom's state directory, never as `graphify-out/` in the user's repository.
- The fork reads `graph.json` itself and serves small, bounded answers; the whole graph never
  crosses the WebSocket.
- One MCP tool with a `mode` parameter, per EXTENSION-POINTS.md guidance on tool cost.
- Loom does not install Graphify; it shows the command.

Questions for Kyle:

1. Confirm L26 is in scope (it is not in selections.md).
2. Default for "Let agents query the code graph": on (tool present in every session, costs
   prompt tokens every turn) or off until enabled? Recommendation: off, since most sessions
   will not use it; the settings copy explains the cost.
3. Pin Graphify to an exact version (`0.9.67`, tested) or accept any newer version? The
   `graph.json` schema has no version field; pinning is safer.
4. Should auto-update also run on project open when the graph is stale, or only after turns?
