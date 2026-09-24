# L21 product

Selections status: "Under consideration" in [selections.md](../../selections.md); scoped by
Kyle in the 2026-09-24 brief, questions answered the same day.

## Problem

Skills now come from many places: each Claude config directory's `skills` folder, project
`.claude/skills`, Codex homes, `~/.agents/skills`, Cursor, Grok and OpenCode locations, and
provider plugins. Kyle runs several accounts per provider and shares one skills folder
between his Claude accounts through symlinks. Upstream T3 Code lists skills only in the
composer's `$` menu, per provider, with no way to see where a skill comes from, which
accounts see it, or to switch it off for one project. Installing a skill pack means running
its installer, which often rewrites `~/.claude` or `~/.codex`. Writing a new skill means
editing files by hand and starting a thread to try it.

## What the user can do

- Open **Skills** and see every skill available on this environment, grouped by name, with
  its description, the providers and accounts that see it, its folder, whether it is shared
  through a symlink, whether it is on or off, and where it came from (folder, provider
  plugin or system, or "Installed by Loom from <repo> at <commit>").
- Filter by provider, scope (user, project, plugin, system), state (on, off), and search by
  name or description.
- See problems: malformed frontmatter, a folder name that differs from the frontmatter name,
  two different skills with the same name where one hides the other, skills containing
  scripts.
- Turn a Claude skill off (or on) for the current project, or for one Claude account, or for
  all Claude accounts. Turn a Codex skill off or on for a Codex home.
- Install skills from a git repository: paste an `https` URL (optionally a branch or tag),
  or pick one of the suggested sources (impeccable, ponytail, TypeSafe), see the skills it
  contains with their descriptions and a "contains scripts" flag, pick skills and a target,
  and install. Nothing from the repository runs. Targets: the shared Claude folder
  `~/.claude/skills` (the default, seen by every Claude account whose `skills` folder links
  to it), one Claude account's own folder, the project's `.claude/skills`, a Codex home,
  `~/.agents/skills` (read by Codex and Cursor), or the project's `.agents/skills`.
- See updates for installed sources, review what changed, update, or remove an installed
  skill (it moves to Loom's trash folder).
- Create a skill in the Lab: name, description, target (the same list, default the shared
  Claude folder; `~/.agents/skills` for skills meant for several providers), "only I can
  start it"
  (`disable-model-invocation`), "hide from the slash menu" (`user-invocable: false`), and a
  body template. Edit `SKILL.md` with live validation and save.
- Test a skill: choose a project and a provider account, and Loom opens a new thread with
  `$skill-name` and a sample prompt ready to send. Come back to the Lab to iterate.

## Entry points

| Where                             | What                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Right panel launcher and "+" menu | **Skills** (letter K). Opens on the Skills tab for the thread's project.                                           |
| Command palette                   | "Open skills", "Install skills from git" (opens Sources with the URL field focused), "Create a skill" (opens Lab). |
| Keybinding                        | `loom.skill-registry.toggle` in Settings > Keybindings, unbound by default.                                        |
| Composer `$` menu                 | Unchanged (upstream). The registry's changes show there after the provider refresh it triggers.                    |

Ways out and ways to see state: every toggle can be flipped back; every install can be
removed (and restored from Loom's trash folder by hand); every scaffolded skill can be
removed from the Lab ("Move to trash"). The inventory is the place to see state; a refresh
button re-reads it.

## Layout

- **Skills tab**: search field and filter chips; a list of rows. A row shows the name, a
  one-line description, provider icons for the accounts that see it (dimmed when off), badges
  (Project, Plugin, System, Shared, Loom, Scripts, Problem). Expanding a row shows its folder
  and real path, the accounts list with a switch per account or per project (Claude), the
  source, the problems, and actions: **Open in Lab**, **Reveal folder** (desktop only),
  **Remove** (Loom installs only).
- **Sources tab**: URL field with optional ref and **Fetch**; under it, **Suggested**
  sources, each with its license and a **Fetch** button (nothing is fetched until clicked); a
  fetched source lists its skills with checkboxes (the suggested ones preselected), a target
  picker defaulting to the shared Claude folder, and **Install**; below, installed sources
  with commit, date, **Check for updates**, **Update**, and their installed skills.
- **Lab tab**: **New skill** form; a list of editable skills (user and project folders only,
  not plugin or system skills); an editor (plain textarea with monospace font) with a
  validation list under it, **Save**, **Test in new thread**, **Move to trash**.

## Copy

- Empty inventory: "No skills found on this environment. Install some from git, or create
  one in the Lab."
- Shared folder note: "This folder is shared by Claude, Claude 1 and Claude 2. Changes here
  apply to all of them."
- Codex scope note: "Codex turns skills on or off for every project that uses this Codex
  home."
- Read-only providers: "Managed by Cursor. Change it in Cursor's own settings."
- Install warning when scripts are present: "This skill includes scripts the agent may run.
  Loom copies them but never runs them itself. Review them before using the skill."
- Remove confirmation: "Move <name> to Loom's trash? Threads that use it will no longer find
  it. You can restore it from <trash path>."
- Test hint: "Agents read skills when a session starts. Test in a new thread after every
  change."
- Target picker: "Shared Claude folder (~~/.claude/skills): Claude, Claude 1, Claude 2" (the
  accounts that see it); "Only Claude 2 (~~/.claude_2/skills)" for an account with its own
  folder; "All agents (~/.agents/skills): Codex, Cursor". When no Claude account reads the
  shared folder: "No Claude account reads this folder."
- Suggested sources: "impeccable (Apache-2.0): design skill for frontend work.",
  "ponytail (MIT): least-code review and audit skills.", "TypeSafe (MIT): the skill for
  building with TypeSafe's Jev API." Note under the list: "Loom copies only the skill
  folders. It never runs a project's installer."

## States

- Loading: skeleton rows while the inventory arrives; per-project probes show "Checking
  Codex skills for this project" per account and fill in when done.
- Empty, as above.
- Partial: an account whose probe failed shows "Could not read skills from Codex 2" with
  **Retry**; the rest of the list still shows.
- Fetching a source: phases "Cloning", "Scanning", with **Cancel**. Errors: "The repository
  could not be cloned: <git message without credentials>", "No skills found in this
  repository."
- Installing, updating, removing: row-level progress, then a toast.
- Write conflicts: "SKILL.md changed on disk since you opened it. Reload or overwrite."
- Upstream server: launcher entry disabled with "Needs a Loom server".

## Surfaces and connection modes

Web and desktop. **Reveal folder** exists only in the desktop app and only for the local
environment. No mobile UI. Remote environments work in every connection mode: the inventory,
files and git all live on the environment.

## Decisions

- Provider reports are the truth for "what the agent sees" and "is it on"; the file scan adds
  where it lives, sharing and provenance. The two are merged by real path. Reason: upstream
  already encodes each CLI's discovery rules.
- Per-project enable and disable exists only where the provider supports it (Claude, through
  its settings files). Loom does not fake it with its own filter. Reason: a filter would not
  stop the agent from using a skill it still sees.
- Installs copy files; they do not symlink into a Loom cache, so an installed skill keeps
  working if Loom is removed.
- Loom never runs code from a skill source: no install scripts, no package managers, no git
  hooks, no submodules. Reason: vendor installers rewrite provider homes and add hooks.
- Nothing is deleted: removal moves to `<state dir>/fork/skill-registry/trash/`.
- The default Claude target is the shared `~/.claude/skills` folder; a single account's own
  folder is selectable. Reason: Kyle's `~/.claude_N/skills` folders are symlinks to it, so
  one copy reaches every account (Kyle, 2026-09-24).
- `~/.agents/skills` is offered as a cross-provider target for installs and the Lab. Reason:
  Codex and Cursor read it (Kyle, 2026-09-24). Loom creates the folder on first use.
- Suggested sources are impeccable (Apache-2.0), ponytail (MIT) and typesafe-ai/skills (MIT,
  https://github.com/typesafe-ai/skills); only their skill folders are copied. Reason: Kyle's
  picks; the TypeSafe skill is the explicit install path agreed for L29, which never installs
  it automatically.

## Out of scope

- Follow-up: a Jev skill suggestion (kept in L29's idea catalog). Reason: not selected for now.
- Follow-up: agent-facing tools such as `loom_skill_registry_scaffold`. Reason: every MCP
  tool costs prompt tokens in every session; wait for a need.
