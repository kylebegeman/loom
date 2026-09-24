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
- Bind a per-project default reviewer when Loom's AI code review (L15) is installed.
- Turn "No AI identification" on or off for the project when Loom's small extras (L20) are
  installed; the row is L20's switch, shown here too.
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
- See the project's budget use today (the day ends at the server's local midnight) and the
  current thread's use.

Composer (every provider):

- Type `%` at the start of a word to open Loom's project menu and choose "Insert project
  notes". The notes are inserted into the message as plain text, so every provider gets
  them, including threads where MCP tools are off. With no notes yet, the item reads "Add
  project notes" and opens the profile.

Agents:

- Call `loom_project_profiles_get` to read the notes, the commands by intent, and the env
  variable names with status (no values). On by default ("Share profile with agents").

## Entry points

| Entry                                                                                            | Behavior                                                                                                                            | Reverse / visibility                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Right panel launcher and "+" menu: "Env" (letter E)                                              | Opens the Env panel for the thread's project checkout.                                                                              | Close the tab.                                        |
| Command palette: "Open project env"                                                              | Same.                                                                                                                               | n/a                                                   |
| Command palette: "Run tests with varlock", "Run build with varlock", ... (one per mapped intent) | Runs the mapped command through `varlock run` in the thread's terminal. Listed only when an intent is mapped and varlock is usable. | Stop it in the terminal.                              |
| Command palette: "Edit project profile"                                                          | Opens Settings, Loom, with the thread's project selected.                                                                           | Leave settings.                                       |
| Composer: `%` menu, "Insert project notes"                                                       | Replaces the `%` token with "Project notes:" and the notes. "Add project notes" when empty (opens the profile).                     | Edit or delete the inserted text before sending.      |
| Settings, Loom page, "Project profile" section                                                   | Edit the profile of the selected project scope.                                                                                     | "Reset profile".                                      |
| Env panel header: "Edit profile"                                                                 | Same as the palette item.                                                                                                           | n/a                                                   |
| Timeline marker                                                                                  | "Project token budget 80% used today" / "Thread token budget reached" row in the thread that crossed it.                            | Informational; budgets can be cleared in the profile. |
| Agents: `loom_project_profiles_get`                                                              | Returns the profile summary.                                                                                                        | Setting "Share profile with agents" (on by default).  |
| Keybinding                                                                                       | None in v1.                                                                                                                         | n/a                                                   |

## States

- **Server lacks the feature**: launcher entry disabled with "Needs a Loom server"; settings
  section shows "This environment does not run Loom's project profiles."
- **No project scope in settings**: "Choose a project to edit its Loom profile." The "Share
  profile with agents" switch still shows, once per environment in the scope (it is an
  environment setting).
- **Several checkouts in scope**: the section edits all of them together and says so; mixed
  values show "Mixed" like upstream's scoped settings.
- **Empty profile**: every field empty; nothing is stored until something is saved.
- **No `.env.schema`**: "No .env.schema in this checkout." with a one-paragraph explanation of
  the format and a link to varlock's docs; the panel still lists keys found in `.env` files
  (names only) under "Variables without a schema".
- **Schema parse error**: the parser's message with line and column, and the path.
- **varlock not installed**: "Run with varlock" and "Validate with varlock" are disabled with
  "Install varlock to use this" and the install command.
- **First validation on an environment**: a one-time confirmation before varlock runs (see
  Copy); "Cancel" runs nothing and asks again next time.
- **Validating**: spinner on the button; results replace the status column until refreshed.
- **Budget not reported**: for threads on providers that do not report token usage (Cursor,
  Grok, OpenCode, Antigravity), "Token usage is not reported by <provider>".
- **Loading, error**: standard panel spinner; RPC failures show the error and "Try again".
- **Composer menu**: "Loading project notes..." (disabled) while the profile loads; "Add
  project notes" when empty; the `%` menu does not open at all on a server without project
  profiles, so `%` stays plain text there.

## Surfaces and connection modes

Web and desktop supported; mobile shows nothing new. All reads happen on the environment's
server; only schema metadata and statuses cross the wire. Profiles are per environment and
project: the same repository on two machines has two profiles (the settings scope can edit
both at once).

## Copy

Section title "Project profile". Fields: "Agent notes", "Commands", "Token budgets", "Env",
"Bindings". Agents setting: "Share profile with agents" (on), description "Agents can read
your notes, commands and env variable status (never values) with one tool." Composer items
"Insert project notes" (description: the first line of the notes) and "Add project notes".
Inserted text starts with "Project notes:" on its own line. Budget labels "Tokens per day for this project", "Tokens per thread". Varlock
choice "Use varlock for commands: Automatic / Never". First "Validate with varlock" on an
environment: title "Validate with varlock?", body "varlock loads this project's configuration
on <environment>. That can contact the secret managers and run the code generators the
project configured. Values stay on the server.", buttons "Validate" and "Cancel". Env statuses "Set in .env.local",
"Set in server environment", "Missing", "Empty", "Invalid: expected a URL", "Resolved by
varlock". Timeline markers as in the table above.

## Decisions

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
- `@env-spec/parser` is approved as a server dependency, pinned to an exact version (0.6.0,
  MIT, no runtime dependencies, current on npm on 2026-09-24). There is no hand-written
  fallback parser. Reason: varlock's own parser is the format's reference; Kyle approved it.
- "Share profile with agents" defaults to on, and the tool description stays at one or two
  lines. Reason: notes only help if agents read them; a short description keeps the per-turn
  prompt cost small.
- "Insert project notes" ships in v1 as a composer menu item (the `%` menu, through
  `ext-composer-menu`), for every provider. Reason: it covers providers and threads where MCP
  tools are off, with plain text the user can see and edit.
- The budget day ends at the server's local midnight. Reason: Kyle's answer; "today" then
  matches the clock of the machine doing the work, which is easier to read than UTC.
