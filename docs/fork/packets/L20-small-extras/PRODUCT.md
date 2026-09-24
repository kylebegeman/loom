# L20 product

## Problem

Four small frictions, each too small for its own packet:

- Every branch a worktree thread creates is named `t3code/...`. On GitHub, next to a
  maintainer's own branches and other tools' branches, Kyle wants his own namespace (old
  Loom used `loom/` and made it configurable).
- Some of Kyle's projects (work repositories) must not show that AI helped: no
  `Co-Authored-By: Claude` trailer, no "Generated with" line, no `loom/` or `t3code/` branch
  prefix, no agent named in a commit, a pull request or a code comment. Today each agent
  decides this on its own, and Claude adds attribution by default.
- When a project runs in Docker or Podman, reading a container's logs means leaving Loom
  for a terminal and remembering the container name.
- Agents fail when a tool is missing or stale (`jq`, `xcodegen`, `gh`, `uv`), and there is no
  quick view of what an environment has, especially a remote one.

## What the user can do

### Worktree branch prefix

- In Settings, Loom, Small extras, set "Worktree branch prefix" for the selected
  environment. It starts as `loom`. Clear it for upstream's `t3code`.
- New worktree threads on that environment get branches like `loom/add-retry-to-uploader`
  after the first message. Existing branches keep their names.
- Invalid values are refused inline with the reason.
- Projects with "No AI identification" on ignore the prefix (below).

### No AI identification (private projects)

- Turn "No AI identification" on for a project in Settings, Loom, Small extras (the "No AI
  identification" block), from the command palette in one of the project's threads, or in
  the project's Loom profile when project profiles (L18) are installed.
- In that project:
  - New worktree branches are named by change type instead of `loom/`: `feature/`, `fix/`,
    `hotfix/`, `chore/`, `docs/` or `refactor/`, followed by the generated name, for example
    `fix/login-redirect`. The type is picked from the generated name and the first message
    by fixed keyword rules (default `feature/`). When Jev is turned on for the project, Jev
    may pick the type instead; Jev starts turned off for private projects.
  - Every message the agent receives (every provider) starts with a short instruction: no
    mention of AI, agents, models or tools, and no co-author trailers, in commit messages,
    pull request titles and bodies, code comments or authorship.
  - Claude sessions start with Claude Code's own commit and pull request attribution turned
    off, so Claude adds no trailer or "Generated with" line even if it ignores the
    instruction.
  - After each turn, Loom checks the new commits on the thread's branch for AI markers
    (a `Co-Authored-By` naming an agent, an AI vendor's address, "Generated with ...", an
    agent as author or committer, an agent's name in the message). When it finds any, the
    thread gets a warning row, and web and desktop show a warning with "Copy fix command".
    Loom never rewrites history on its own.
  - A branch that still has its temporary `t3code/<hex>` name after the first turn gets the
    same kind of warning, with "Rename branch".
- Run "Check this thread's commits for AI markers" from the palette at any time.
- Turn it off the same ways. Nothing already committed changes.

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

| Part                  | Entry                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch prefix         | Settings, Loom, Small extras (environment-scoped like upstream's General page).                                                                                                                                                                                       |
| No AI identification  | Settings, Loom, Small extras, "No AI identification" (a switch per project on the environment). Command palette: "Turn on No AI identification for this project" / "Turn off ...", "Check this thread's commits for AI markers". L18's project profile, when present. |
| Private mode warnings | Timeline row in the thread (every client). Web and desktop toast with "Copy fix command" or "Rename branch", and "Open thread".                                                                                                                                       |
| Containers            | Right panel launcher and "+" menu ("Containers", letter C). Command palette: none (the launcher is enough).                                                                                                                                                           |
| CLI tools             | Settings, Loom, Small extras. A "CLI tools" link in the Containers panel's missing-runtime state.                                                                                                                                                                     |

Ways out and state: clearing the prefix restores upstream naming; "No AI identification" has
its off switch in every place that has the on switch, and the settings list shows which
projects have it; the palette toggle toast offers "Undo"; the logs terminal is an ordinary
terminal tab (close it); the panel closes like any tab; warnings are dismissed like any toast
and stay visible in the timeline. Settings values have a reset button.

## States

- Branch prefix: saving, saved, invalid (inline error), environment lacks the feature
  ("Needs a Loom server").
- No AI identification:
  - With a project selected in the settings scope, the block lists only that project; with
    all projects in scope, it lists every project of the environment.
  - List loading skeleton; empty project list: "No projects on <environment>."
  - Toggling: the switch shows progress; failure reverts it with the error.
  - A project with it on shows "On since <date>".
  - Claude sessions already running keep their attribution setting until they restart; the
    row says "Claude threads already running pick this up when their session restarts. The
    instruction applies from the next message."
  - Check from the palette: "No AI markers in this thread's new commits." or the warning.
  - Not a git repository, or the thread has no branch: the check says so and does nothing.
  - Server lacks the part: palette items hidden, the block shows "Needs a newer Loom server".
- Containers:
  - Loading skeleton.
  - Empty: "No containers on <environment>." / "No containers for this project. Show all."
  - No runtime: "Docker or Podman is not installed on <environment>."
  - Daemon down: "Docker is not running on <environment>." (or "The Podman machine is not
    running."), with Retry.
  - Disabled: launcher entry disabled with "Needs a Loom server".
  - Refresh every 10 seconds while the panel is visible.
- CLI tools:
  - Loading skeleton while probing (a few seconds for about forty tools).
  - Each row: Installed (version), Missing (install hint), Error (probe failed, detail).
  - "Check for updates" in progress, then "Updates checked <time>"; tools not managed by
    Homebrew or npm show "Update manually".

## Copy

- Prefix row: "Worktree branch prefix". Description: "New worktree threads rename their
  branch to <prefix>/<name> after the first message. Leave empty for t3code. Private
  projects use feature/, fix/ and the like instead." Error: "Use lowercase letters,
  numbers, '-', '_' and '/'. Start and end with a letter or number." Preview line: "New
  branches look like <prefix>/fix-login-redirect"
- Private projects block title: "No AI identification". Description: "In these projects
  Loom asks agents to leave AI out of commits, pull requests and comments, turns off
  Claude's attribution, names branches by change type, and checks new commits after each
  turn." Row switch label: the project name. Limits note: "Loom still creates a temporary
  t3code/<id> branch until the first message renames it, and keeps hidden checkpoint refs
  that a normal git push does not send."
- Palette: "Turn on No AI identification for this project", "Turn off No AI identification
  for this project", "Check this thread's commits for AI markers". Toggle toast: "No AI
  identification is on for <project>." / "... is off for <project>." with "Undo". Check
  results besides the warning: "No AI markers in this thread's new commits.", "This thread is
  not on a branch, so Loom did not check its commits." and "This thread's folder is not a git
  repository."
- Warning toast title: "Commits in <branch> mention AI". Description: "<n> new commits:
  <short ids>." plus "Already pushed. After fixing, push with --force-with-lease." when
  pushed. Actions: "Copy fix command", "Open thread". Expandable "Show details": each
  commit's subject and what was found, and the command. When only names in messages were
  found: title "Commit messages name an agent", action "Copy reword command".
- Temporary branch toast: "<branch> still has a temporary name". Actions: "Rename branch",
  "Copy command", "Open thread".
- Timeline row: "No AI identification: <n> new commits mention AI (<short ids>). Fix command
  in the Loom warning or the palette check." / "No AI identification: the branch still has
  its temporary name <branch>."
- Containers panel title: "Containers". Buttons: "Follow logs", "Refresh", "Show all",
  "This project". Terminal tab title comes from upstream; the command line shows the
  container id.
- CLI tools heading: "CLI tools". Buttons: "Check for updates", "Refresh", "Copy update
  command". Row labels: "Installed with Homebrew", "Installed with npm", "Installed with
  Bun", "Part of macOS", "Part of Xcode", "Unknown install". Xcode row with only the Command
  Line Tools: "Xcode is not installed (Command Line Tools only)". After "Check for updates":
  "Homebrew results are as fresh as its last brew update."

No em dashes in product copy. Nothing in these strings attributes work to AI; the words
"AI" and "agent" appear only in Loom's own UI, never in text Loom writes into a repository.

## Surfaces and connection modes

- Web and desktop: all four parts.
- Mobile: no UI. The branch prefix, private branch names, the instruction, Claude's
  attribution setting and the commit check all run on the server, so they apply to threads
  started or messaged from the mobile app too; mobile sees the warning rows in the timeline.
- Remote: all parts act on the chosen environment. Follow logs runs in that environment's
  terminal. The commit check runs git on the environment.
- Upstream T3 server: the settings section shows "Needs a Loom server" for that scope; the
  panel entry is disabled; palette items are hidden.

## Decisions

- Only the final generated branch name uses the prefix; temporary branches stay
  `t3code/<hex>`. Reason: upstream recognizes temporary branches by that exact pattern on the
  server, web and mobile; changing it would need seams in shared code and still break
  upstream's mobile app. The temporary name lives only until the first-turn rename.
- The prefix is per environment, stored in a fork table, and defaults to `loom`. Reason:
  Kyle's answer; `loom/` was old Loom's namespace.
- PR checkout branches (`t3code/pr-<n>/...`) keep upstream naming. Reason: Kyle's answer; no
  extra seams in `GitManager.ts` and `BitbucketApi.ts`.
- No AI identification is a per-project switch stored in a fork table. Reason: it is a
  property of the repository (work versus personal), not of a thread or an environment.
- Private branch names use a change-type prefix chosen by fixed keyword rules; Jev may choose
  only when Jev is on for that project, and Jev defaults to off for private projects when
  both exist. Reason: Kyle's answer; a work repository should not send its first message to
  a third party unless he opts in.
- The work is on the agent side: upstream's own commit and pull request text generation adds
  no attribution (checked in `TextGenerationPrompts.ts` and `GitManager.ts`). Every provider
  gets the instruction; Claude additionally gets its documented `attribution` setting
  emptied for the session; Codex relies on the instruction. Reason: Claude Code has a
  deterministic switch and the Codex app-server has none; one uniform instruction covers the
  rest.
- The commit check warns and suggests a command; it never rewrites history. Reason: history
  rewriting is the user's call, especially after a push.
- Nothing is written into the work repository to make this happen (no settings file, no
  hook). Reason: such files could be committed or change Kyle's manual sessions.
- Follow logs uses upstream's terminal rather than a fork log streamer. Reason: ANSI,
  scrollback, search and copy come for free, and no new streaming RPC is needed.
- CLI tools never run installers or updaters; they show the command. Reason: package
  managers change the machine; the user decides.
- The CLI catalog adds argent, xcbeautify, impeccable, blender, openscad, kicad-cli, ollama
  and lms (tools other packets use) and swiftlint, cloudflared, wrangler, rustc, cargo, go
  and mas (installed on Kyle's Mac). Provider CLIs stay out. Reason: Kyle's answer.

## Known limits (documented in the user guide)

- A new worktree thread's branch is `t3code/<hex>` until the first message's rename. Loom
  never pushes it; it exists only locally. If the rename fails (text generation failed), the
  commit check warns and offers "Rename branch".
- Checkpoint refs are hidden local refs (`refs/t3/checkpoints/...`), as is upstream's
  `refs/t3code/pre-refresh`; a normal `git push` sends only branches and tags you name, so
  they stay local unless someone pushes with `--mirror` or an explicit refspec.
- The instruction is a request, not a guarantee, for every provider except Claude's own
  attribution lines. The commit check is the backstop for commits; code comments and pull
  request text are not scanned.
- Codex 0.156.1 contains its own commit attribution instruction behind a flag whose default
  is unverified; IMPLEMENTATION.md has the verification step.
- Messages that start with `/` (slash commands) and messages near the input size limit are
  sent without the instruction.
- Checking out a pull request still creates a local `t3code/pr-<n>/...` branch.

## Out of scope

- Follow-up: prefixing temporary branches, per-project prefixes, renaming existing branches.
- Follow-up: a Codex-side switch (for example a `config` override at thread start) if the
  verification shows Codex adds its trailer despite the instruction. Reason: decided by the
  verification result, not designed here.
- Follow-up: scanning pull request bodies and code comments for AI markers. Reason: commits
  are the durable, pushed record; PR text is visible before it is posted.
- Starting, stopping, restarting or removing containers; exec into containers; compose
  up/down; Kubernetes; Apple's `container` CLI.
- Installing or updating tools from Loom; provider CLIs (Codex, Claude, Cursor, Grok,
  OpenCode, Antigravity), which upstream's Providers settings already cover.
- Mobile UI.
