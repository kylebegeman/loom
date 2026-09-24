# L20 product

## Problem

Three small frictions, each too small for its own packet:

- Every branch a worktree thread creates is named `t3code/...`. On GitHub, next to a
  maintainer's own branches and other tools' branches, Kyle wants his own namespace (old
  Loom used `loom/` and made it configurable).
- When a project runs in Docker or Podman, reading a container's logs means leaving Loom
  for a terminal and remembering the container name.
- Agents fail when a tool is missing or stale (`jq`, `xcodegen`, `gh`, `uv`), and there is no
  quick view of what an environment has, especially a remote one.

## What the user can do

### Worktree branch prefix

- In Settings, Loom, Small extras, set "Worktree branch prefix" for the selected
  environment, for example `kyle`. Leave it empty for upstream's `t3code`.
- New worktree threads on that environment get branches like `kyle/add-retry-to-uploader`
  after the first message. Existing branches keep their names.
- Invalid values are refused inline with the reason.

### Containers

- Open the Containers panel from the right panel launcher or "+" menu.
- See this project's containers first (matched by Docker Compose working directory), or
  switch to All.
- See each container's name, state, image, compose service and ports.
- Click "Follow logs" to open a terminal tab in the thread's terminal drawer that follows
  the container's logs. Close the tab (or Ctrl+C) to stop.
- Choose the runtime in the panel's menu: Auto, Docker or Podman.

### CLI tools

- In Settings, Loom, Small extras, see the environment's tools grouped by kind, each with
  status, version, path and how it was installed.
- Copy a tool's install hint or update command.
- Click "Check for updates" to ask Homebrew and npm which tools are outdated.
- Add extra executables to check, one per line.

## Entry points

| Part          | Entry                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Branch prefix | Settings, Loom, Small extras (environment-scoped like upstream's General page).                             |
| Containers    | Right panel launcher and "+" menu ("Containers", letter C). Command palette: none (the launcher is enough). |
| CLI tools     | Settings, Loom, Small extras. A "CLI tools" link in the Containers panel's missing-runtime state.           |

Ways out and state: clearing the prefix restores upstream naming; the logs terminal is an
ordinary terminal tab (close it); the panel closes like any tab. No part creates state that
needs undoing beyond the settings values, which have a reset button.

## States

- Branch prefix: saving, saved, invalid (inline error), environment lacks the feature
  ("Needs a Loom server").
- Containers:
  - Loading skeleton.
  - Empty: "No containers on <environment>." / "No containers for this project. Show all."
  - No runtime: "Docker or Podman is not installed on <environment>."
  - Daemon down: "Docker is not running on <environment>." (or "The Podman machine is not
    running."), with Retry.
  - Disabled: launcher entry disabled with "Needs a Loom server".
  - Refresh every 10 seconds while the panel is visible.
- CLI tools:
  - Loading skeleton while probing (a few seconds for twenty tools).
  - Each row: Installed (version), Missing (install hint), Error (probe failed, detail).
  - "Check for updates" in progress, then "Updates checked <time>"; tools not managed by
    Homebrew or npm show "Update manually".

## Copy

- Prefix row: "Worktree branch prefix". Description: "New worktree threads rename their
  branch to <prefix>/<name> after the first message. Leave empty for t3code." Error:
  "Use lowercase letters, numbers, '-', '_' and '/'. Start and end with a letter or number."
- Containers panel title: "Containers". Buttons: "Follow logs", "Refresh", "Show all",
  "This project". Terminal tab title comes from upstream; the command line shows the
  container name.
- CLI tools heading: "CLI tools". Buttons: "Check for updates", "Refresh", "Copy update
  command". Row labels: "Installed with Homebrew", "Installed with npm", "Installed with
  Bun", "Part of macOS", "Part of Xcode", "Unknown install".

No em dashes in product copy.

## Surfaces and connection modes

- Web and desktop: all three parts.
- Mobile: no UI; the branch prefix applies to mobile-started worktree threads on a Loom
  server.
- Remote: all parts act on the chosen environment. Follow logs runs in that environment's
  terminal.
- Upstream T3 server: the settings section shows "Needs a Loom server" for that scope; the
  panel entry is disabled.

## Decisions and open questions

Decisions:

- Only the final generated branch name uses the prefix; temporary branches stay
  `t3code/<hex>`. Reason: upstream recognizes temporary branches by that exact pattern on the
  server, web and mobile; changing it would need seams in shared code and still break
  upstream's mobile app. The temporary name lives only until the first-turn rename.
- The prefix is per environment and stored in a fork table, not in upstream settings.
- Follow logs uses upstream's terminal rather than a fork log streamer. Reason: ANSI,
  scrollback, search and copy come for free, and no new streaming RPC is needed.
- CLI tools never run installers or updaters; they show the command. Reason: package
  managers change the machine; the user decides.

Open questions for Kyle:

1. Prefix default: empty (upstream `t3code`) or `kyle` or `loom`?
2. Should PR checkout branches (`t3code/pr-<n>/...`, created when checking out a PR from a
   fork) use the prefix too? That adds two more packet seams
   (`apps/server/src/git/GitManager.ts:277`, `apps/server/src/sourceControl/BitbucketApi.ts:525`).
3. Which tools belong in the CLI catalog beyond the proposed list in TECHNICAL.md?
