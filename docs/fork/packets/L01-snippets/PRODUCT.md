# L01 product

## Problem

Kyle types the same instructions to agents many times a day: review checklists, "fix the
failing test and explain the root cause", release steps, house style reminders. Upstream T3
Code has a temporary prompt stash and ArrowUp recall of the thread's own prompts, but no
durable, searchable library that works across threads, projects and clients. Old Loom had
one (`;alias` + Tab, fill-in fields, history, import and export); this packet rebuilds the
useful part with search-as-you-type as the main way in.

## What the user can do

- Search snippets as you type from anywhere in the app, see live results with a preview,
  and insert the chosen one into the composer, copy it, or send it to the terminal.
- Type `;` and a few letters in the composer to get the same live results inline. Tab or
  Enter inserts the highlighted snippet; an exact alias is always first, so `;review` +
  Tab expands the snippet with alias `review`. A bare `;`, or `;` followed by a space, is
  plain text and never opens the menu.
- Fill in a snippet's fields (`[[ticket]]`, `[[scope|all files]]`) in a small drawer above
  the composer before it is inserted. Built-in values (date, time, project name and path,
  branch) fill themselves; `[[cursor]]` sets where the cursor lands.
- Save the current composer text as a new snippet.
- Manage the library in the Snippets panel: create, edit, pin, give aliases and tags,
  make a snippet global or specific to one project, delete and restore, see revision
  history and restore an older revision.
- Import `.loom-snippet.md` files (including files exported from old Loom) and export one
  snippet or the whole library.
- Send a snippet to the thread's terminal. It is typed at the prompt; Loom never presses
  Enter for you.

## Entry points

| Way in                            | What it does                                                                                | Way out / state                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Panel launcher and "+" menu       | "Snippets" (letter S) opens the Snippets panel for the thread.                              | Close the tab, or `rightPanel.close`. The tab shows the panel is open. |
| Command palette                   | "Search snippets", "Open Snippets panel", "Save prompt as snippet".                         | Dialogs close with Escape; the panel closes like any tab.              |
| Keybinding `loom.snippets.search` | Opens the snippet search dialog. Unbound by default; the user can bind it in Keybindings.   | Escape closes.                                                         |
| Keybinding `loom.snippets.open`   | Toggles the Snippets panel (opens it, or closes it when it is the active surface). Unbound. | Same key again.                                                        |
| Composer `;` menu                 | `;` immediately followed by a non-space character, at the start of a line or after space.   | Escape, moving the cursor away, or deleting the token closes it.       |
| Fill-in drawer                    | Opens above the composer when a chosen snippet has fields.                                  | Escape cancels and leaves the prompt unchanged.                        |
| Settings                          | None. The library is managed in the panel.                                                  |                                                                        |

Reverse states: delete has "Restore" (Deleted filter, 30 days); pin has unpin; restoring a
revision creates a new revision, so the previous one stays restorable; import reports what
it created and skipped, and imported snippets can be deleted.

## States

- Loading: the panel and dialog show a skeleton list until the first library snapshot
  arrives. The `;` menu shows no items until then (it never blocks typing).
- Empty library: the panel shows "No snippets yet" with "New snippet" and "Import"
  buttons; the dialog shows "No snippets yet. Create one in the Snippets panel." with a
  button that opens it.
- No results: "No snippets match `query`." with "Create snippet named `query`".
- Error: a failed save keeps the editor open with the message inline (for example "Alias
  `review` is already used by 'Code review checklist'."). A failed load shows "Couldn't
  load snippets." with Retry.
- Server lacks the feature: the panel entry is disabled with "Snippets need a Loom
  server."; palette items and the `;` menu do not appear; the keybinding does nothing.
- No composer (settings page, pull request page): Insert is disabled with "Open a thread
  to insert snippets."; Copy still works.
- No terminal: "Send to terminal" is disabled with "Open a terminal for this thread first."

## Copy

- Panel title: "Snippets". Launcher description (if L12 adds descriptions): "Reusable
  prompts and fill-in templates."
- Search placeholder: "Search snippets".
- Dialog footer hints: "Enter Insert", "mod+C Copy", "mod+Enter Send to terminal",
  "mod+E Edit".
- Fill-in drawer title: "Fill in snippet", button "Insert", hint "Escape to cancel".
- Editor labels: "Title", "Aliases" (hint: "Type `;alias` in the composer. Letters,
  digits, dot, dash, underscore."), "Tags", "Available in" ("All projects" or a project),
  "Description", "Body" (hint: "Use `[[name]]` for fields, `[[name|default]]` for a
  default, `[[cursor]]` for the cursor.").
- Import result toast: "Imported 12 snippets. 2 skipped." with details on hover.

## Surfaces and connection modes

- Web and desktop: full feature.
- Mobile: not in this packet. The library is still usable from web and desktop against
  the same environment.
- Remote environments: the library is the thread's environment's library. The dialog and
  palette use the active thread's environment; with no active thread they use the primary
  environment.
- Upstream T3 server: hidden or disabled as described above.

## Decisions

- Server-side storage per environment (fork tables in `state.sqlite`): snippets follow the
  machine, and `loom.sh` already backs up that file.
- Global and per-project snippets: a snippet is global unless it names a project. In a
  project, its own snippets rank first and its aliases win over global ones.
- Field syntax is `[[name]]` (confirmed by Kyle), not old Loom's `{{name}}`, because
  `{{ }}` appears in real prompts (GitHub Actions `${{ }}`, Handlebars, Jinja). Import
  converts old `{{name}}` fields and leaves GitHub Actions `${{ }}` untouched.
- The `;` menu opens only when `;` (at the start of a line or after whitespace) is
  immediately followed by a non-space character, and it filters by what follows. A bare
  `;` or `; ` is plain text and never opens the menu, so punctuation in prose stays quiet.
- Search and panel commands have no default keybindings: they are reachable from the
  command palette and the panel launcher, and users bind them in Keybindings if they want
  (EXTENSION-POINTS.md discourages default bindings).
- Search runs on the client over the cached library, so results update on every keystroke
  with no RPC; the server pushes the library when it changes.
- Pins and use counts live on the server (old Loom kept them in localStorage per device,
  a noted lesson).
- A non-matching `;token` never swallows Tab (old Loom did).
- Revisions are recorded only when content changes, capped at 50 per snippet.
- Deleting is a soft delete with a 30-day Deleted filter; history is kept until purge.
