# L18 product

## Problem

Kyle works across many repositories, including forks and third-party projects where he cannot
or should not commit agent instructions. Each has its own way to test and build, its own
environment variables, and a cost profile he wants to keep an eye on. T3 Code's project
settings cover model defaults, permissions, worktrees and project actions, but not "what an
agent should know about this project that is not in the repo", "which action is the test
command", "which env vars does this need and are they set", or "how many tokens has this
project burned today". Old Loom's project profiles tried to cover everything (a 486-line
schema and a 1,921-line settings form) and most fields were never read. This packet keeps the
parts that earn their place.

## What the user can do

Profile (Settings, Loom, "Project profile", with a project selected in the scope picker):

- Write private agent notes for the project (Markdown, up to 8,000 characters), for example
  "use `vp` not `pnpm`, never run the e2e suite locally".
- Mark which of the project's actions is its dev, test, typecheck, lint, format and build
  command, choosing from the actions upstream already has (from Project settings or
  `t3.json`). Add a free-form command for an intent that has no action.
- Set advisory budgets: tokens per day for the project, and tokens per thread.
- Choose whether project commands launched from Loom use varlock: Automatic (when
  `.env.schema` exists and varlock is installed), or Never. Set the schema path if it is not
  `.env.schema` at the checkout root.
- Bind snippets or skills to the project when those Loom features are installed.
- See links to upstream's Project settings for model, permissions, worktrees and actions.
- Reset the profile (delete it).

Env panel (right panel "Env", per thread's checkout):

- See every variable in `.env.schema`: name, description, type (with options such as enum
  values), required or optional, sensitive or public, example, docs link, tags.
- See each variable's status: set (and in which file: `.env`, `.env.local`, `.env.<env>`,
  or "server environment"), missing, empty, or invalid for its type (static values only),
  or "resolved by varlock" when the value is a function call. Values are never shown.
- Filter by status (missing and invalid first) and search by name.
- Run "Validate with varlock" to get varlock's own errors (on demand, because it may contact
  secret managers and run code generators the project configured).
- Run any project action, or an intent command, "with varlock" (`varlock run -- <command>`)
  in the thread's terminal.
- See the project's budget use today and the current thread's use.

Agents:

- Call `loom_project_profiles_get` to read the notes, the commands by intent, and the env
  variable names with status (no values).

## Entry points

| Entry                                                                                            | Behavior                                                                                                                            | Reverse / visibility                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Right panel launcher and "+" menu: "Env" (letter E)                                              | Opens the Env panel for the thread's project checkout.                                                                              | Close the tab.                                        |
| Command palette: "Open project env"                                                              | Same.                                                                                                                               | n/a                                                   |
| Command palette: "Run tests with varlock", "Run build with varlock", ... (one per mapped intent) | Runs the mapped command through `varlock run` in the thread's terminal. Listed only when an intent is mapped and varlock is usable. | Stop it in the terminal.                              |
| Command palette: "Edit project profile"                                                          | Opens Settings, Loom, with the thread's project selected.                                                                           | Leave settings.                                       |
| Settings, Loom page, "Project profile" section                                                   | Edit the profile of the selected project scope.                                                                                     | "Reset profile".                                      |
| Env panel header: "Edit profile"                                                                 | Same as the palette item.                                                                                                           | n/a                                                   |
| Timeline marker                                                                                  | "Project token budget 80% used today" / "Thread token budget reached" row in the thread that crossed it.                            | Informational; budgets can be cleared in the profile. |
| Agents: `loom_project_profiles_get`                                                              | Returns the profile summary.                                                                                                        | Setting "Share profile with agents".                  |
| Keybinding                                                                                       | None in v1.                                                                                                                         | n/a                                                   |

## States

- **Server lacks the feature**: launcher entry disabled with "Needs a Loom server"; settings
  section shows "This environment does not run Loom's project profiles."
- **No project scope in settings**: "Choose a project to edit its Loom profile."
- **Several checkouts in scope**: the section edits all of them together and says so; mixed
  values show "Mixed" like upstream's scoped settings.
- **Empty profile**: every field empty; nothing is stored until something is saved.
- **No `.env.schema`**: "No .env.schema in this checkout." with a one-paragraph explanation of
  the format and a link to varlock's docs; the panel still lists keys found in `.env` files
  (names only) under "Variables without a schema".
- **Schema parse error**: the parser's message with line and column, and the path.
- **varlock not installed**: "Run with varlock" and "Validate with varlock" are disabled with
  "Install varlock to use this" and the install command.
- **Validating**: spinner on the button; results replace the status column until refreshed.
- **Budget not reported**: for threads on providers that do not report token usage (Cursor,
  Grok, OpenCode, Antigravity), "Token usage is not reported by <provider>".
- **Loading, error**: standard panel spinner; RPC failures show the error and "Try again".

## Surfaces and connection modes

Web and desktop supported; mobile shows nothing new. All reads happen on the environment's
server; only schema metadata and statuses cross the wire. Profiles are per environment and
project: the same repository on two machines has two profiles (the settings scope can edit
both at once).

## Copy

Section title "Project profile". Fields: "Agent notes", "Commands", "Token budgets", "Env",
"Bindings". Budget labels "Tokens per day for this project", "Tokens per thread". Varlock
choice "Use varlock for commands: Automatic / Never". Env statuses "Set in .env.local",
"Set in server environment", "Missing", "Empty", "Invalid: expected a URL", "Resolved by
varlock". Timeline markers as in the table above.

## Decisions and open questions

Decisions:

- The profile never duplicates an upstream setting; it links to it.
- Command intents reference upstream project actions by id (falling back to a literal command
  only for intents with no action), so editing an action in upstream settings updates the
  profile's command.
- Budgets are advisory. They count tokens from `context-window.updated` activities, which
  only the Claude and Codex adapters emit today.
- Env values are read only on the server and never sent to clients or agents, including
  non-sensitive ones: the panel's job is status, not inspection.
- varlock runs only on explicit user actions.
- The profile lives in Loom's database, not a file in the repository (old Loom made the same
  choice; nothing to commit, nothing to leak).

Questions for Kyle:

1. Approve `@env-spec/parser` as a server dependency (MIT, zero runtime dependencies)?
   Without it the packet ships a smaller hand-written parser for the subset it needs.
2. Should "Share profile with agents" default to on? The tool costs prompt tokens every turn
   in every session, and notes are only useful if agents read them. Recommendation: on.
3. Should the agent notes also be offered as a one-click insert into the composer for
   providers where MCP tools are off? (Not in v1.)
4. Budget day boundary: the server's local midnight (recommended) or UTC?
