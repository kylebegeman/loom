# L21 implementation plan

Ordered steps; each leaves the tree compiling. Commits `feat(fork-skill-registry): ...`;
extension points in their own `feat(fork): ...` commits.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Build fixtures under a temp directory in tests, and for manual runs under the worktree's
  `.t3/scratch/` (a Claude config dir with a `skills` folder, a second one whose `skills` is a
  symlink to the first, a Codex home, a project with `.claude/skills` and `.agents/skills`).
  Point scratch provider instances at them. Do not toggle, install into, or scaffold into
  Kyle's real `~/.claude*`, `~/.codex*` or `~/.agents` during development.
- Git fetch tests use a local bare repository created in the test's temp directory through a
  `file://` URL allowed only in tests (inject the URL policy), never the network.

## File layout

```
packages/contracts/src/fork/skill-registry.ts        skill-registry.test.ts
packages/client-runtime/src/fork/skill-registry.ts
apps/server/src/fork/skill-registry/
  knownRoots.ts        knownRoots.test.ts
  SkillScanner.ts      SkillScanner.test.ts
  ProviderReports.ts
  mergeInventory.ts    mergeInventory.test.ts
  toggles.ts           toggles.test.ts
  targets.ts           targets.test.ts
  suggestedSources.ts
  sources.ts           sources.test.ts
  installs.ts          installs.test.ts
  lab.ts               lab.test.ts
  validate.ts          validate.test.ts
  SkillRegistryService.ts
  migrations.ts  rpc.ts
apps/web/src/fork/skill-registry/
  panel.tsx  SkillsPanel.tsx  SkillsTab.tsx  SourcesTab.tsx  LabTab.tsx
  inventory.logic.ts  inventory.logic.test.ts
  palette.ts  SkillRegistryShortcuts.tsx  state.ts
docs/fork/user/skill-registry.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-panels`, `ext-palette`,
   `ext-web-root`, `ext-keybindings`; create missing ones as specified, one commit each.
2. **Contracts.** Schemas and RPC group from TECHNICAL.md; register the group, the stream tag
   and the keybinding command. Tests: tag prefixes, `ScaffoldInput` name pattern,
   `InstallTarget` round-trip.
3. **Pure helpers, test first.** `validate.ts` (copy `parseFrontmatterBoolean` semantics from
   upstream's `ClaudeSkills.ts:50-70` rather than importing a private function),
   `knownRoots.ts`, `mergeInventory.ts` (symlinked shared folder merges into one entry with
   several visibilities; shadowing; install attachment; `modifiedSinceInstall`),
   `inventory.logic.ts` on the web side, and `targets.ts` (`resolveTargets` over injected
   instances and realpaths: shared folder detection, default choice, no duplicate account
   rows).
4. **Scanner and provider reports.** `SkillScanner.ts` with the budget and `realpath`;
   `ProviderReports.ts` with the concurrency, timeout and per-project cache.
5. **Service, storage, handlers (read path).** `SkillRegistryService.inventory`, migrations,
   `inventory` and `sources` handlers, service and feature registration. At this point the
   panel can be built against real data.
6. **Web panel (read path).** `panel.tsx`, `SkillsPanel.tsx`, `SkillsTab.tsx`, registration in
   `FORK_PANELS`, palette item "Open skills", `SkillRegistryShortcuts` for the keybinding.
   Loading, empty, partial and upstream-server states.
7. **Toggles.** `toggles.ts`: Claude settings file edit (strict JSON only, atomic write,
   only `"on"`/`"off"`), Codex `skills/config/write`, then snapshot refresh. Switches in the
   Skills tab with the scope notes from PRODUCT.md.
8. **Sources and installs.** `sources.ts` (URL policy, clone command, scan) as a stream
   command; `installs.ts` (create a missing target folder, copy, marker file, record, update,
   remove to trash); `suggestedSources.ts` (the constant from TECHNICAL.md) served by
   `sources`, and the `targets` handler. Sources tab UI with the Suggested list, fetch
   progress, grouped same-name entries with their subpaths, preselection per target family,
   target picker defaulting to the shared Claude folder, install, check updates, update with
   changed-file list, remove. The `"sources"` resource id (Sources tab, URL field focused)
   and palette item "Install skills from git", which opens it.
9. **Lab.** `lab.ts` (scaffold into any target from `targets`, including `~/.agents/skills`;
   read; write with compare-and-swap; `lab.test.ts`), Lab tab with the editor and
   live validation (debounced 300 ms, through `validate`), "Test in new thread" and "Move to
   trash". The `"lab"` resource id and palette item "Create a skill", which opens it.
10. **Docs and status.** `docs/fork/user/skill-registry.md`: what the panel shows, how
    enable/disable maps to provider files, what an install does and does not do, where
    removed skills go. Update the packet index Status and SEAMS.md.

## Pitfalls

- **Claude settings files.** Claude drops every override in a file when one value is invalid
  (`ClaudeSkills.ts:183-189`). Write only `"on"` and `"off"`, never booleans. Refuse to rewrite
  files with comments or trailing commas instead of silently stripping them.
- **Folder name is the skill name** for Claude (`ClaudeSkills.ts:346-351`). Toggles key on
  the folder name, not the frontmatter `name`.
- **Shared folders.** Writing a skill into `~/.claude_1/skills` writes into Kyle's shared
  `~/.claude/skills`. Resolve real paths first and show every account the change reaches;
  the default target is the shared folder itself.
- **Suggested sources are network fetches.** Nothing is fetched until the user clicks
  Fetch; tests never touch the network.
- **Codex per-cwd probes are expensive.** Never probe on keystrokes or on every render;
  cache per project.
- **Git safety.** No hooks, no submodules, no LFS smudge (`GIT_LFS_SKIP_SMUDGE=1`), no
  credential prompts, `https` only, and never run anything from the clone.
- **Symlinks inside a source** must not be followed out of the clone when copying.
- **Deleting.** Nothing is deleted; removal and update move folders into the trash folder.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- With Kyle's layout (two Claude config dirs sharing one `skills` symlink), a skill appears
  once with both accounts listed.
- Turning a Claude skill off for a project removes it from the composer's `$` menu for that
  project after the refresh, and turning it back on restores it.
- A skill installed from a git URL works in a new thread, updates cleanly, and removal moves
  it to the trash folder.
- A skill scaffolded in the Lab is picked up by a new thread through "Test in new thread".
