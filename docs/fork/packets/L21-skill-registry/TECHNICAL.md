# L21 technical design

Citations are to this fork at upstream v0.0.42, checked against
`v0.0.43-nightly.20260923.2173`.

## Overview

```
Skills panel (ext-panels) ── loom.skill-registry.* RPC ──> SkillRegistryService (ForkLayer)
                                                             ├─ ProviderReports: ServerProvider.skills
                                                             │    + instance.snapshotForCwd(projectRoot)
                                                             ├─ SkillScanner: bounded scan of known roots,
                                                             │    realpath and symlink resolution
                                                             ├─ Toggles: Claude skillOverrides files,
                                                             │    Codex skills/config/write
                                                             ├─ Sources: git clone into state dir, copy installs
                                                             └─ Lab: scaffold, read, write SKILL.md, validate
```

Upstream already discovers skills per provider instance, correctly and per the CLIs'
own rules (precedence, overrides, plugins). The registry does not re-implement that. It asks
each instance what it sees, scans the same folders to learn where files really live, and
merges the two by real path.

## How upstream discovers skills (what the registry relies on)

| Provider    | Source                                                                                                                                                                                                                               | Enabled state                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude      | Filesystem: `<config dir>/skills` (user, wins on collisions) and `<cwd>/.claude/skills` (project); `apps/server/src/provider/Drivers/ClaudeSkills.ts:308-384`. Skill name is the folder name, not the frontmatter name (`:346-351`). | `skillOverrides` merged from user, project, project-local, repository-root local and managed settings (`:122-155`, `skillOverrideSettingsPaths` exported at `:134`). One invalid value makes Claude drop the whole map (`:183-189`). |
| Codex       | `codex app-server` `skills/list` with `cwds` (`apps/server/src/provider/Layers/CodexProvider.ts:438,485`); scopes `user`, `repo`, `system`, `admin` (`packages/effect-codex-app-server/src/_generated/schema.gen.ts:6477`).          | Reported by Codex; written with `skills/config/write` `{ path                                                                                                                                                                        | name, enabled }` (`schema.gen.ts:39928`). |
| Cursor      | Filesystem: `.cursor`, `.agents`, `.codex`, `.claude` skill folders under the project and home, with a scan budget (`Drivers/CursorSkills.ts:218-252`).                                                                              | Read-only.                                                                                                                                                                                                                           |
| Grok        | `grok inspect --json` (`Drivers/GrokSkills.ts:1-15,99`).                                                                                                                                                                             | Read-only.                                                                                                                                                                                                                           |
| OpenCode    | SDK `app.skills` (`opencodeRuntime.ts:913`).                                                                                                                                                                                         | Read-only.                                                                                                                                                                                                                           |
| Antigravity | Filesystem under its profile, linked back to `~/.gemini` (`Drivers/AntigravitySkills.ts:37-50,160-190`).                                                                                                                             | Read-only.                                                                                                                                                                                                                           |

Machine-level skills ride `ServerProvider.skills`; project-level skills come from
`ProviderInstance.snapshotForCwd(cwd)` (every driver implements it; for Codex it spawns an
app-server, `Drivers/CodexDriver.ts:249-280`, bounded by 20 s). Upstream clients reach the
same data through `server.refreshProviders` with `cwd` (`packages/contracts/src/rpc.ts:463-475`,
`apps/server/src/provider/Layers/ProviderRegistry.ts:820-829`).

## Contracts (`packages/contracts/src/fork/skill-registry.ts`)

```ts
export const SKILL_REGISTRY_WS_METHODS = {
  inventory: "loom.skill-registry.inventory",
  targets: "loom.skill-registry.targets",
  setEnabled: "loom.skill-registry.setEnabled",
  fetchSource: "loom.skill-registry.fetchSource", // stream (progress, then result)
  install: "loom.skill-registry.install",
  sources: "loom.skill-registry.sources",
  checkUpdates: "loom.skill-registry.checkUpdates",
  update: "loom.skill-registry.update",
  remove: "loom.skill-registry.remove",
  scaffold: "loom.skill-registry.scaffold",
  readSkill: "loom.skill-registry.readSkill",
  writeSkill: "loom.skill-registry.writeSkill",
  validate: "loom.skill-registry.validate",
} as const;

export const SkillScope = Schema.Literals(["user", "project", "plugin", "system", "admin"]);

export const SkillVisibility = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  scope: SkillScope,
  enabled: Schema.Boolean,
  /** What the registry can change for this instance and skill. */
  toggle: Schema.Literals(["claude", "codex", "none"]),
  userInvocationOnly: Schema.Boolean,
});

export const SkillLocation = Schema.Struct({
  /** The path a provider or scan saw, e.g. ~/.claude_1/skills/foo/SKILL.md. */
  path: Schema.String,
  /** Real path of the skill folder after resolving symlinks. The merge key. */
  realDir: Schema.String,
  viaSymlink: Schema.Boolean,
  /** Known root this path is under, e.g. "claude-config:/Users/kyle/.claude_1". */
  root: Schema.String,
});

export const SkillProblem = Schema.Struct({
  kind: Schema.Literals([
    "malformedFrontmatter",
    "nameMismatch",
    "shadowed", // another skill with the same name wins for some instance
    "containsScripts",
    "modifiedSinceInstall",
  ]),
  detail: Schema.String,
});

export const SkillEntry = Schema.Struct({
  key: Schema.String, // realDir, or `${instanceId}:${name}` when no path is known
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  locations: Schema.Array(SkillLocation),
  visibility: Schema.Array(SkillVisibility),
  install: Schema.NullOr(
    Schema.Struct({ installId: Schema.String, sourceUrl: Schema.String, commit: Schema.String }),
  ),
  editable: Schema.Boolean, // user or project folder the lab may edit
  problems: Schema.Array(SkillProblem),
});

export const SkillInventory = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  entries: Schema.Array(SkillEntry),
  /** Instances whose report failed or timed out. */
  unavailable: Schema.Array(
    Schema.Struct({ instanceId: ProviderInstanceId, reason: Schema.String }),
  ),
  scanTruncated: Schema.Boolean,
  generatedAt: IsoDateTime,
});

export const SetEnabledInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  skillName: TrimmedNonEmptyString,
  skillPath: Schema.NullOr(Schema.String), // Codex path selector
  enabled: Schema.Boolean,
  /** Claude only: which settings file. */
  claudeTarget: Schema.optional(Schema.Literals(["project", "account", "allAccounts"])),
  projectId: Schema.optional(ProjectId),
});

export const InstallTarget = Schema.Union([
  /** ~/.claude/skills on the environment; the default Claude target. */
  Schema.Struct({ kind: Schema.Literal("claudeShared") }),
  /** One account's own <config dir>/skills. */
  Schema.Struct({ kind: Schema.Literal("claudeAccount"), instanceId: ProviderInstanceId }),
  Schema.Struct({ kind: Schema.Literal("claudeProject"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("codexHome"), instanceId: ProviderInstanceId }),
  Schema.Struct({ kind: Schema.Literal("agentsUser") }),
  Schema.Struct({ kind: Schema.Literal("agentsProject"), projectId: ProjectId }),
]);

export const FetchSourceInput = Schema.Struct({
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)), // https only, no credentials
  ref: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
});
export const SourceSkill = Schema.Struct({
  subpath: Schema.String, // folder holding SKILL.md, relative to the repo root
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  fileCount: Schema.Number,
  containsScripts: Schema.Boolean,
  problems: Schema.Array(SkillProblem),
});
export const FetchSourceEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("progress"),
    phase: Schema.Literals(["cloning", "scanning"]),
  }),
  Schema.Struct({
    type: Schema.Literal("fetched"),
    sourceId: Schema.String,
    commit: Schema.String,
    skills: Schema.Array(SourceSkill),
  }),
]);

export const ScaffoldInput = Schema.Struct({
  target: InstallTarget,
  name: TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
  description: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  userInvocationOnly: Schema.Boolean, // disable-model-invocation: true
  hideFromSlashMenu: Schema.Boolean, // user-invocable: false
  template: Schema.Literals(["blank", "workflow", "checklist"]),
});
export const SkillFile = Schema.Struct({
  path: Schema.String, // absolute SKILL.md path
  content: Schema.String.check(Schema.isMaxLength(200_000)),
  hash: Schema.String, // sha256 of content, for compare-and-swap
});
/** A target as the picker shows it, resolved on the server. */
export const ResolvedInstallTarget = Schema.Struct({
  target: InstallTarget,
  label: Schema.String, // "Shared Claude folder", "Only Claude 2", "All agents", ...
  dir: Schema.String, // absolute skills folder
  realDir: Schema.NullOr(Schema.String), // null when the folder does not exist yet
  /** Provider instances that read this folder (after resolving symlinks). */
  seenBy: Schema.Array(ProviderInstanceId),
  isDefault: Schema.Boolean,
});

export const SuggestedSkillSource = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  url: Schema.String,
  license: Schema.String,
  description: Schema.String,
  /** Subpaths preselected after a fetch, per target family; absent subpaths are ignored. */
  preselect: Schema.Struct({
    claude: Schema.Array(Schema.String),
    agents: Schema.Array(Schema.String),
  }),
});

export const ValidationIssue = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  message: Schema.String,
  line: Schema.NullOr(Schema.Number),
});
```

Method table (payload -> success; scope):

| Tag            | Payload -> success                                                                                  | Scope                |
| -------------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| `inventory`    | `{ projectId?, refresh?: boolean }` -> `SkillInventory`                                             | `orchestration:read` |
| `setEnabled`   | `SetEnabledInput` -> `SkillInventory`                                                               | `terminal:operate`   |
| `fetchSource`  | `FetchSourceInput` -> stream of `FetchSourceEvent` (`ForkStreamCommandRpcTag`)                      | `terminal:operate`   |
| `install`      | `{ sourceId, subpaths[], target }` -> `{ installed: InstallRecord[] }`                              | `terminal:operate`   |
| `sources`      | `{}` -> `{ sources: SourceRecord[], installs: InstallRecord[], suggested: SuggestedSkillSource[] }` | `orchestration:read` |
| `targets`      | `{ projectId? }` -> `{ targets: ResolvedInstallTarget[] }`                                          | `orchestration:read` |
| `checkUpdates` | `{ sourceId? }` -> `{ updates: { sourceId, latestCommit }[] }`                                      | `terminal:operate`   |
| `update`       | `{ installId }` -> `{ install: InstallRecord, changedFiles: string[] }`                             | `terminal:operate`   |
| `remove`       | `{ key }` (Loom install or lab-created skill) -> `{ trashPath }`                                    | `terminal:operate`   |
| `scaffold`     | `ScaffoldInput` -> `SkillFile`                                                                      | `terminal:operate`   |
| `readSkill`    | `{ path }` -> `SkillFile`                                                                           | `orchestration:read` |
| `writeSkill`   | `{ path, content, expectedHash }` -> `SkillFile & { issues: ValidationIssue[] }`                    | `terminal:operate`   |
| `validate`     | `{ content, folderName }` -> `{ issues: ValidationIssue[] }`                                        | `orchestration:read` |

Writing into agent skill folders changes what agents do on this machine, which is the power
of a terminal; hence `terminal:operate` for every write. Errors:
`LoomSkillRegistryError { operation, detail }` plus `EnvironmentAuthorizationError`.

## Server (`apps/server/src/fork/skill-registry/`)

### Known roots

`knownRoots(settings, project)` (pure over settings plus `os.homedir()` and the project's
workspace root) returns labeled roots:

- For each Claude instance: `<config dir>/skills` (config dir = `homePath` or `~/.claude`,
  the same rule as `ClaudeHome.ts:12-18`); plus `<project>/.claude/skills`.
- For each Codex instance: `<effective CODEX_HOME>/skills` (`resolveCodexHomeLayout`,
  `CodexHomeLayout.ts:44`; in a shadow home `skills` is a symlink to the shared home's).
- `~/.claude/skills` (the shared Claude folder), whether or not a Claude instance uses the
  default config dir.
- `~/.agents/skills` and `<project>/.agents/skills`.
- Cursor's four project and home roots (`CursorSkills.ts:224-229`), for display only.

### Scanner (`SkillScanner.ts`)

For each root: `realpath` the root, list folders (one level), read `SKILL.md` (at most
256 KB each), parse frontmatter with the `yaml` package upstream already uses
(`ClaudeSkills.ts:25`), record `realDir`, `viaSymlink`, a file count and whether any file is
executable or under a `scripts/` folder. Budget like Cursor's: stop after 2,000 folders or
64 MB read and set `scanTruncated`. No watchers; results cached in memory for 60 s keyed by
the root list.

### Provider reports (`ProviderReports.ts`)

- Machine level: `ProviderInstanceRegistry.listInstances`, then each enabled instance's
  `snapshot.getSnapshot` (cheap, cached upstream).
- Project level (when `projectId` is given): `instance.snapshotForCwd(workspaceRoot)` for
  each enabled instance, concurrency 2, 20 s limit each, cached per `(instanceId, cwd)` until
  `refresh: true` or 5 minutes pass. Codex's per-cwd probe spawns an app-server, so the panel
  asks for project-level data once per open, not per keystroke.
- A failure puts the instance in `unavailable`, never fails the inventory.

### Merge (`mergeInventory.ts`, pure)

1. Index scan results by `realDir`.
2. For each reported skill with a `path`, resolve its folder's real path (from the scan index
   when present, else `realpath` once) and attach a `SkillVisibility`. Skills without a path
   (some plugin or system skills) get their own entry keyed by instance and name.
3. Mark `shadowed` when, for one instance, two folders provide the same name and the one the
   provider reports is not this folder.
4. Attach install records by `realDir`, then `modifiedSinceInstall` by content hash.
5. `editable` is true for folders under a user or project root that are not plugin, system
   or admin scope.

### Toggles (`toggles.ts`)

- **Claude.** Files: `project` -> `<repo root or project root>/.claude/settings.local.json`
  (repository root when the project sits inside a git repository, matching Claude's
  precedence, `ClaudeSkills.ts:122-131`); `account` -> `<config dir>/settings.json`;
  `allAccounts` -> every Claude instance's `<config dir>/settings.json`. Read the file; if it
  does not parse as strict JSON (Claude accepts comments and trailing commas, upstream reads
  it leniently), refuse with "This settings file has comments or trailing commas. Edit it by
  hand." Otherwise set `skillOverrides[<folder name>] = "off"` or `"on"` (only those two of
  the four valid values, `ClaudeSkills.ts:189`), keep every other key and key order, and write
  atomically with upstream's `writeFileStringAtomically` (`apps/server/src/atomicWrite.ts:5`).
  A managed-policy override cannot be changed; report it.
- **Codex.** One-shot `withCodexAppServerClient` on the instance's effective home and
  environment, `skills/config/write` with `{ path, enabled }` (falls back to `{ name }` when the
  path is unknown). Shadow-home accounts share `config.toml` with the main home, so the change
  applies to all of them; the UI says so.
- After a write, refresh the affected instances' snapshots
  (`ProviderRegistry.refresh` for the instance, and the cwd probe when a project was
  involved) and return a fresh inventory.

### Install targets (`targets.ts`)

`resolveTargets({ instances, project })` lists every target the pickers offer, each with the
instances that read it:

- `claudeShared`: `path.join(homedir, ".claude", "skills")`. `seenBy` is every Claude
  instance whose `<config dir>/skills` realpath equals this folder's realpath (on Kyle's Mac
  `~/.claude_1/skills`, `~/.claude_2/skills`, `~/.claude_3/skills` and
  `~/.claude_api/skills` are symlinks to it, checked 2026-09-24).
- `claudeAccount` for each Claude instance whose skills folder does not resolve to the
  shared folder ("Only <account>"). An account whose folder is a symlink to the shared one
  has no separate folder to install into, so it is not listed twice.
- `claudeProject` and `agentsProject` when a project is given; `codexHome` per Codex
  instance (effective home); `agentsUser` for `~/.agents/skills`, with `seenBy` the Codex and
  Cursor instances.
- `isDefault`: `claudeShared` when its `seenBy` is not empty; otherwise the first
  `claudeAccount`; with no Claude instance at all, `agentsUser`.

A target folder that does not exist yet (for example `~/.agents/skills` on Kyle's Mac today)
is created with `makeDirectory(..., { recursive: true })` on the first install or scaffold
into it, never earlier.

### Suggested sources (`suggestedSources.ts`)

A constant list served by `sources`; nothing is fetched until the user clicks Fetch.

| id            | URL                                          | License    | Preselect (Claude targets)                                        | Preselect (agents, Codex targets) |
| ------------- | -------------------------------------------- | ---------- | ----------------------------------------------------------------- | --------------------------------- |
| `impeccable`  | `https://github.com/pbakaus/impeccable`      | Apache-2.0 | `.claude/skills/impeccable`                                       | `.agents/skills/impeccable`       |
| `ponytail`    | `https://github.com/DietrichGebert/ponytail` | MIT        | `skills/ponytail`, `-audit`, `-debt`, `-gain`, `-help`, `-review` | same                              |
| `typesafe-ai` | `https://github.com/typesafe-ai/skills`      | MIT        | `skills/typesafe-ai`                                              | same                              |

Licenses and paths checked with `gh api` on 2026-09-24. impeccable ships one copy of its
skill per tool (`.claude/`, `.agents/`, `.cursor/`, `plugin/` and more), so the fetched list
groups entries with the same name and shows each subpath; the preselection picks the copy
for the chosen target family. A preselected subpath missing after a fetch (the repository
changed) is simply not preselected. The TypeSafe skill is listed, never installed without a
click (L29 decision).

### Sources and installs (`sources.ts`, `installs.ts`)

- URL rules: `https:` only, no username or password, no query or fragment, host not a loopback
  or private address. Source id: `sha256(normalizedUrl)`.
- Fetch: `git clone --depth 1 --no-tags --single-branch [--branch <ref>]
--filter=blob:limit=5m -c core.hooksPath=/dev/null -c protocol.file.allow=never
-c submodule.recurse=false <url> <tmp>` with `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS` unset,
  5 minute limit, into `<stateDir>/fork/skill-registry/sources/<sourceId>/<commit>/`
  (renamed into place after `git rev-parse HEAD`). Spawn with upstream's `ChildProcessSpawner`
  and `resolveSpawnCommand`. Stream `progress` events, then scan for `SKILL.md` up to depth 4
  (skip `.git`, `node_modules`), then `fetched`. Keep the last two commits per source.
- Install: create the target folder if missing (above); for each chosen subpath, copy the folder (no symlinks followed out of the repo; a
  symlink inside the skill that points outside the source is skipped and reported) into
  `<target root>/<folder name>/`. Refuse when the destination exists, unless it is a Loom
  install from the same source (then it is an update). Write `.loom-skill.json`
  (`{ sourceUrl, commit, subpath, installedAt }`) inside the installed folder so provenance
  survives even without the database, and record the install with a content hash.
- Check updates: `git ls-remote <url> <ref or HEAD>`, 30 s limit.
- Update: fetch the new commit, compute the changed-file list for the subpath, copy the new
  folder to a temp sibling, move the old folder to trash, rename the new one into place.
  Refuse without `force` when `modifiedSinceInstall`.
- Remove: rename the folder to `<stateDir>/fork/skill-registry/trash/<ISO time>-<name>/`,
  mark the record removed. Only Loom installs and lab-created skills; anything else shows
  "Loom did not install this skill. Remove it from its folder by hand."

### Lab (`lab.ts`, `validate.ts`)

- `scaffold`: target root as for installs, refuse existing folder, write `SKILL.md`:

  ```md
  ---
  name: <name>
  description: <description>
  disable-model-invocation: true # only when userInvocationOnly
  user-invocable: false # only when hideFromSlashMenu
  ---

  # <Title>

  <template body>
  ```

  Record it in `fork_skill_registry_installs` with `source_url = "lab"` so it can be removed.

- `readSkill` / `writeSkill`: the path must be a `SKILL.md` whose folder is an `editable`
  entry of the current inventory (checked on the server against a fresh scan, after
  `realpath`). `writeSkill` compares `expectedHash` with the file on disk and fails with a
  conflict error when they differ.
- `validate` (pure): frontmatter present and parseable; `name` equals the folder name
  (warning otherwise, since Claude uses the folder name); `description` present, at most 1,024
  characters; boolean fields parse with Claude's YAML 1.1 rules (copy
  `parseFrontmatterBoolean`, `ClaudeSkills.ts:50-70`); unknown keys are warnings, not errors.

## Storage

Migration set `skill-registry`, tracking table `fork_migrations_skill_registry`:

```sql
-- 1_SourcesAndInstalls
CREATE TABLE IF NOT EXISTS fork_skill_registry_sources (
  source_id TEXT PRIMARY KEY,       -- sha256 of the normalized URL
  url TEXT NOT NULL,
  ref TEXT,                         -- null: default branch
  last_commit TEXT,
  fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS fork_skill_registry_installs (
  install_id TEXT PRIMARY KEY,
  source_id TEXT,                   -- null for lab-created skills
  source_url TEXT NOT NULL,         -- 'lab' for lab-created skills
  subpath TEXT,
  commit_sha TEXT,
  skill_name TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  installed_dir TEXT NOT NULL,      -- real path at install time
  content_hash TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT,
  removed_at TEXT,
  trash_path TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS fork_skill_registry_installs_dir
  ON fork_skill_registry_installs (installed_dir) WHERE removed_at IS NULL;
```

Files: `<stateDir>/fork/skill-registry/sources/` (clones), `.../trash/` (removed skills).
Clones of sources with no remaining installs are pruned at server start (fork layer effect).

## Clients

- `packages/client-runtime/src/fork/skill-registry.ts`: query families for `inventory` and
  `targets` keyed by `{ environmentId, projectId }`, and `sources`; commands for the writes;
  a stream command for `fetchSource`. Target pickers (Sources and Lab) read `targets` and
  preselect the entry with `isDefault`.
- `apps/web/src/fork/skill-registry/`:
  - `panel.tsx`: `ForkPanelDefinition` `{ id: "skill-registry", title: "Skills", icon:
SparklesIcon, shortcut: "K", unavailableHint: "Needs a Loom server", isAvailable: threadRef
!== null && loomFeatures.includes("skill-registry") }`.
  - `SkillsPanel.tsx` (tabs), `SkillsTab.tsx`, `SourcesTab.tsx`, `LabTab.tsx`,
    `inventory.logic.ts` (filters, grouping, badge derivation; pure).
  - `palette.ts`, `keybindings.ts` (subscribe to `loom.skill-registry.toggle` with
    `onForkCommand`; open the panel with `openSurface`, or close it when active).
  - Test in new thread: `server.refreshProviders({ instanceId, cwd })` through upstream's
    client, then upstream's new-thread flow (`useHandleNewThread().handleNewThread`,
    `apps/web/src/hooks/useHandleNewThread.ts:442-479`) and
    `useComposerDraftStore.getState().setPrompt(target, "$<name> <sample>")`
    (`apps/web/src/composerDraftStore.ts:571`). Verify these signatures when implementing.
  - Reveal folder: desktop only through `ensureLocalApi().shell` when the environment is the
    local one; hidden otherwise.
- The project comes from the thread the panel is attached to. Inventory is requested on open
  and on explicit refresh; the panel does not poll.

## Agent-facing tools

None in v1. A later `loom_skill_registry_scaffold` tool could let an agent draft a skill into
the Lab; it would cost prompt tokens in every session (EXTENSION-POINTS.md, MCP tools), so it
waits for a need.

## Performance

- Inventory payload: one entry per skill, without file contents. Expect a few hundred entries
  at most; cap at 2,000 with `scanTruncated`.
- Project probes are the expensive part (Codex spawns an app-server): concurrency 2, cached
  per project for 5 minutes, only on panel open or refresh.
- `SKILL.md` content travels only for the file open in the Lab.
- No file watchers, no polling, no animations.

## Alternatives considered

- **Own discovery for every provider.** Would drift from each CLI's rules (precedence,
  overrides, plugins). Upstream already encodes them per driver; the registry reuses the
  reports.
- **A Loom-side enable filter** (hide skills in the composer per project). Would not stop the
  agent from using a skill it still sees, and needs a composer seam. Rejected.
- **Symlink installs into a Loom cache.** Updates become instant, but skills break when the
  cache moves or Loom is removed, and the symlink crosses into Loom's state folder. Copies are
  simpler and portable.
- **Running vendor installers** (for example `npx impeccable install`, which detects and
  writes into `~/.claude`, `~/.codex` and others and installs hooks). Forbidden by the brief;
  the registry copies only skill folders.
- **Codex plugin marketplaces** (`marketplace/add`, `plugin/install`). Out of scope; the
  inventory still shows plugin skills Codex reports.
