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
- Use three built-in modes, and create, edit, archive and restore their own.
- Import a pack from a Markdown or `SKILL.md` file (frontmatter `name` and `description`
  become the pack's name and description; the body becomes its rules) and export a pack as
  Markdown.
- Preview exactly what the agent receives for the current thread.

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
| Settings > Loom > Instruction modes | The library (list, New mode, edit, archive, restore, import, export) and Project defaults (pick a project, check modes).                                                                                                        |
| Command palette                     | "Instruction mode: <name>" toggles for the active thread (with a check when on); "Edit instruction modes".                                                                                                                      |
| Keybinding                          | `loom.instruction-modes.open` opens the composer's Modes menu; unbound by default.                                                                                                                                              |

Ways out and ways to see state: every mode unchecks the same way it was checked; "Use project
default" returns a thread to following the project; archived packs can be restored; the
composer control and the preview always show the current state.

On narrow composer layouts the control can be hidden by the composer's overflow rule
(EXTENSION-POINTS.md, section 11); the palette and keybinding still work there.

## Flows

1. In a thread, open **Modes**, check **Extra careful**. The control reads "Extra careful".
   The next message, from any client, reaches the agent with the Extra careful rules ahead of
   the user's text.
2. Uncheck it. The next message carries a one-line notice that earlier modes no longer apply;
   later messages carry nothing.
3. Settings > Loom > Instruction modes > Project defaults > "loom" > check **Minimal code**.
   Every thread in that project without its own choice shows "Minimal code" in the control.
4. New mode: name, one-line description, rules (Markdown, up to 4,000 characters), **Save**.
   It appears in every thread's menu.
5. Preview: a read-only dialog with the exact block and its size in characters, and a note:
   "Sent before your message on every turn while modes are on. It uses context, so keep modes
   short."

## Copy

- Menu footer: "Modes apply from your next message, for every provider."
- Settings intro: "Standing rules a thread keeps following until you turn them off. Loom sends
  them to the agent with each message."
- Size warning in the editor above 2,000 characters: "Long modes use context on every turn."
- Archive confirmation: "Archive <name>? Threads using it stop receiving it. You can restore
  it from Archived."

## States

- Loading: the control shows "Modes" dimmed until state arrives; the settings section shows
  skeleton rows.
- Empty library is impossible (built-ins); no user packs: "No custom modes yet."
- No project selected in Project defaults: "Choose a project."
- Errors: "Could not save the mode. Try again." with the server message when safe; the
  composer menu shows "Modes are unavailable right now" and hides checkboxes.
- Draft threads: the control works before the first message; the choice is kept for the new
  thread.
- Upstream server: the control is hidden; the settings section reads "Instruction modes need
  a Loom server."

## Surfaces and connection modes

Web and desktop have UI. Mobile has none, but delivery is server-side, so a thread's modes
apply to messages sent from the upstream mobile app too. All connection modes work.

## Decisions and open questions

Decisions:

- Delivery is uniform: a tagged block before the user's text on every turn while modes are
  on, added by the server. Slash commands (`/compact` and friends) are never decorated.
- The transcript shows only what the user typed. The preview shows what the agent gets.
- Packs are per environment, stored in fork tables; built-ins live in code.
- Per-thread choice overrides the project default, including an explicit "No modes".

Open questions for Kyle:

1. Every turn, or only when the set changes? This packet sends the block every turn while
   modes are on (robust across compaction and provider restarts, at a token cost). A "send on
   change, then a one-line reminder" policy is a small follow-up if the cost matters.
2. Should built-in texts be editable (copy-on-edit into a user pack) or fixed? Default:
   "Duplicate to edit".
3. Is a per-environment library right, given several environments, or do you want packs kept
   in a file you sync yourself (for example `~/.t3/userdata/fork/instruction-modes/*.md`)?
