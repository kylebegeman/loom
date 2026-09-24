# L22 product

## Problem

Kyle often wants the same standing guidance for a whole conversation: write the least code
that works, be extra careful with a risky migration, explain changes as they happen. Today he
repeats it in messages, edits AGENTS.md or CLAUDE.md (which changes every thread in the
project and gets committed), or installs a tool like ponytail that hooks into each CLI
separately. None of that is per thread, none works the same across Codex, Claude and the
other providers, and none is visible in the app.

## What the user can do

- Turn modes on and off for a thread from the composer; the change applies from the next
  message.
- See which modes are on for a thread at a glance.
- Set default modes for a project; new threads (and threads that never chose) follow them.
  Choose "No modes" for a thread to opt out of the project default.
- Use three built-in modes. Built-ins are fixed; "Duplicate to edit" copies one into a new
  mode the user owns.
- Create, edit, archive and restore their own modes. Each mode is a Markdown file in a modes
  folder the user chooses (default `~/.t3/userdata/fork/instruction-modes/`), so the folder
  can live in a dotfiles repository and be edited with any editor.
- Change the modes folder per environment, and reload it after editing files outside Loom
  (Loom also notices changes on its own).
- See files in the folder that are not valid modes, with the reason.
- Import a pack from a Markdown or `SKILL.md` file (frontmatter `name` and `description`
  become the mode's name and description; the body becomes its rules) and export a mode as
  its Markdown file.
- Preview exactly what the agent receives for the current thread, with its size in
  characters and an estimated token count.

## Built-in modes

Short, written for Loom (not copied from other projects), each under 1,500 characters:

- **Minimal code**: understand the code first; then prefer, in order, not writing it, reusing
  what exists, the standard library, a platform feature, an installed dependency, and only
  then the smallest new code; never cut validation, error handling, security or
  accessibility to get there. (Inspired by ponytail's ladder, MIT.)
- **Extra careful**: state the plan before editing; change one thing at a time; read before
  writing; run the relevant checks after each step; stop and ask before anything
  irreversible (migrations, deletions, force pushes, production data); say what was not
  verified.
- **Explain as you go**: before each change, one or two sentences on what and why; after,
  what changed and how to check it; name trade-offs; keep explanations short.

## Entry points

| Where                               | What                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer footer                     | **Modes** control: shows "Modes" when none are on, the mode's name when one is, "Minimal +1" for more. Opens a menu with a checkbox per mode, "Use project default (Minimal code)", "No modes", "Preview", and "Edit modes...". |
| Settings > Loom > Instruction modes | Modes folder (path, "Reload", "Use default"), the library (list, New mode, edit, Duplicate to edit, archive, restore, import, export, files with problems) and Project defaults (pick a project, check modes).                  |
| Command palette                     | "Instruction mode: <name>" toggles for the active thread (with a check when on); "Edit instruction modes".                                                                                                                      |
| Keybinding                          | `loom.instruction-modes.open` opens the composer's Modes menu; unbound by default (handled by the fork keydown listener, never written into `keybindings.json`).                                                                |

Ways out and ways to see state: every mode unchecks the same way it was checked; "Use project
default" returns a thread to following the project; archived modes can be restored; a
changed folder can be set back with "Use default"; the composer control and the preview
always show the current state, including modes that are selected but missing from the
folder.

On narrow composer layouts the control can be hidden by the composer's overflow rule
(EXTENSION-POINTS.md, section 11); the palette and keybinding still work there.

## Flows

1. In a thread, open **Modes**, check **Extra careful**. The control reads "Extra careful".
   The next message, from any client, reaches the agent with the Extra careful rules ahead of
   the user's text. Every later message carries the rules too, while the mode is on.
2. Uncheck it. The next message carries a one-line notice that earlier modes no longer apply;
   later messages carry nothing.
3. Settings > Loom > Instruction modes > Project defaults > "loom" > check **Minimal code**.
   Every thread in that project without its own choice shows "Minimal code" in the control.
4. New mode: name, one-line description, rules (Markdown, up to 4,000 characters), **Save**.
   Loom writes `<modes folder>/<name-as-slug>.md`. It appears in every thread's menu.
5. Duplicate to edit: on a built-in, opens the editor prefilled with its text and the name
   "<name> (copy)"; saving creates a new file. The built-in stays unchanged.
6. Edit a mode file in another editor and save it. Loom picks up the change (within a few
   seconds, or at once with "Reload"); the next message uses the new rules.
7. Change the folder to `~/dotfiles/loom-modes`. The library now lists that folder's files.
   Threads that had `user:<slug>` selected keep it when the new folder has a file with the
   same name; otherwise the control shows the mode as missing.
8. Preview: a read-only dialog with the exact block, its size in characters and "about N
   tokens", and a note: "Sent before your message on every turn while modes are on. It uses
   context, so keep modes short."

## Copy

- Menu footer: "Modes apply from your next message, for every provider."
- Settings intro: "Standing rules a thread keeps following until you turn them off. Loom sends
  them to the agent with each message."
- Folder row: "Modes folder". Description: "Each mode is a Markdown file in this folder on
  <environment>. Keep it in a dotfiles repository if you like." Buttons: "Reload", "Use
  default".
- Folder missing: "This folder does not exist yet. Loom creates it when you save a mode."
- Problems heading: "Files that are not modes". Row reasons: "No name in the frontmatter",
  "The frontmatter is not valid YAML", "Rules are longer than 4,000 characters", "The file
  name must be lowercase letters, numbers and dashes, ending in .md", "File is larger than
  20 KB", "The name is longer than 60 characters", "The description is longer than 200
  characters", "Too many files (Loom reads the first 200)", "Loom cannot read this file".
- Missing mode in the composer menu: "<id> (file not found)" with "Remove".
- Size warning in the editor above 2,000 characters: "Long modes use context on every turn."
- Conflict on save: "This mode changed on disk since you opened it. Reload or overwrite."
- Archive confirmation: "Archive <name>? Threads using it stop receiving it. You can restore
  it from Archived." (Archiving moves the file into the folder's `archived/` subfolder.)
- Built-in actions: "Duplicate to edit" (no Edit, no Archive).

## States

- Loading: the control shows "Modes" dimmed until state arrives; the settings section shows
  skeleton rows.
- Empty library is impossible (built-ins); no user modes: "No custom modes yet."
- Folder missing: the notice above; built-ins still work.
- Folder unreadable (permission error, or the path is a file): "Loom cannot read <path>:
  <reason>." Built-ins still work; saving is disabled until the folder is fixed.
- Files with problems: listed with their reason; they never reach an agent.
- No project selected in Project defaults: "Choose a project."
- Errors: "Could not save the mode. Try again." with the server message when safe; the
  composer menu shows "Modes are unavailable right now" and hides checkboxes.
- Draft threads: the control works before the first message; the choice is kept for the new
  thread.
- Upstream server: the control is hidden; the settings section reads "Instruction modes need
  a Loom server."

## Surfaces and connection modes

Web and desktop have UI. Mobile has none, but delivery is server-side, so a thread's modes
apply to messages sent from the upstream mobile app too. All connection modes work. The
modes folder is on the environment's machine, never the client's; each environment has its
own folder setting.

## Decisions

- L22 is wanted (Kyle, 2026-09-24). Reason: confirmed in the packet answers.
- Delivery is uniform: a tagged block before the user's text on every turn while modes are
  on, added by the server. Slash commands (`/compact` and friends) are never decorated.
  Reason: robust across compaction and provider restarts, which have no reliable resend
  signal; the preview shows the token cost so it stays visible.
- The transcript shows only what the user typed. The preview shows what the agent gets.
  Reason: the transcript is the user's record.
- Built-in modes are fixed, with "Duplicate to edit". Reason: built-ins can improve with Loom
  releases without overwriting the user's edits.
- Modes are Markdown files in a user-chosen folder (default
  `~/.t3/userdata/fork/instruction-modes/`); the database keeps only per-thread and
  per-project selections, the per-thread delivery marker and the folder setting. Reason: Kyle
  can version modes in dotfiles and edit them with any editor.
- A mode's id is its file name (`user:<slug>` for `<slug>.md`). Reason: selections survive a
  folder change when the new folder has the same files, and renaming a mode's display name
  does not break threads.
- Per-thread choice overrides the project default, including an explicit "No modes".
  Reason: a thread is the unit of work.

## Out of scope

- Follow-up: send the block only when the set changes, plus a short reminder. Reason: Kyle
  chose every turn; revisit only if the token cost matters.
- Follow-up: a live subscription for library changes. Reason: modes change rarely; clients
  refetch on focus and after writes, and saves detect conflicts.
