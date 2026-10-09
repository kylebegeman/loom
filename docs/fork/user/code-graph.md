# Code map

The **Code map** panel shows how a project's files and symbols connect. Look up a function
or file to see what it uses and what uses it, or trace which files a change can reach before
you ask the agent to make it, or after it has. Loom builds the map with
[Graphify](https://github.com/Graphify-Labs/graphify), which reads your code locally.

## Getting started

Open **Code map** from the right-panel launcher (letter Y), the panel picker, or **Code map:
Open** in the command palette. The first time, the panel offers **Build graph**. Large
repositories can take a few minutes; the panel shows the build's progress, and **Cancel**
stops it. One graph builds at a time on each environment, so a second project waits its turn.

The panel needs a Loom server. Connected to a T3 Code server, the launcher entry is disabled.

## Installing Graphify

You install Graphify yourself on the environment host. Loom never runs an installer. Until
Graphify is found, the panel shows the install command, pinned to the release Loom is tested
with:

```sh
uv tool install "graphifyy==0.9.83"
```

`pipx install "graphifyy==0.9.83"` works too. After installing, press **Check again**. To
run Graphify without installing it, choose **Use uvx** in **Settings, Loom, Code graph**. A
different Graphify version still works, but the panel marks it as untested and some graphs
may not load.

Loom runs Graphify's local code extraction only. It removes model API keys from Graphify's
environment, so building a graph never calls a model or spends money.

## Using the map

- **Overview** lists the most connected symbols and the groups of files that work closely
  together. Pick a symbol to look at it in Search.
- **Search** finds symbols and files by name. Picking one shows a small map of its
  neighborhood, with the symbols it uses and the ones that use it listed below. Select any
  of them to move there, or open its file.
- **Impact** traces the thread's uncommitted changes through the graph and lists the files
  they can affect, nearest first. Choose how many hops to follow (1 to 3). **Add to message**
  puts a short summary in the composer so the agent can check those files.

To trace a particular turn, open it in the diff panel and press the code map button in the
diff header (**Show impact of these changes**).

## Keeping the graph current

The panel says when the graph was built at an older commit or when the project has
uncommitted changes since the build. **Update** refreshes it. If Graphify refuses an update
because the new graph would be much smaller, Loom keeps the previous graph and offers
**Rebuild anyway** for when files were removed on purpose.

**Update graphs automatically** in Settings is off by default. When on, Loom updates an
existing graph after a turn changes files in the project's main checkout, and when you open
a project whose graph is out of date. It never builds a first graph on its own, and turns
that run in a separate worktree do not trigger updates.

## Agents

Agents can query the graph with the `loom_code_graph_query` tool once you turn on **Let
agents query the code graph for this project** in the panel's Overview tab. It is off for
every project by default. Each answer the agent reads adds to the conversation, so it uses
tokens.

## Where graphs are stored

Graphs live in the Loom server's data folder, under `fork/code-graph`, never in your
repository. **Delete graph** in the panel or in Settings removes a project's graph, and
deleting a project removes its graph too. Settings lists every project's graph with its
size.
