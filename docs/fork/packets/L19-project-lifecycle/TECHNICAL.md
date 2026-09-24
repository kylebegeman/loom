# L19 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`). Search for the quoted code
when a line has moved.

## Overview

```
 web /loom/repositories (fork route)
   |  loom.project-lifecycle.* (fork RPC, per environment)       upstream RPCs reused
   v                                                              ------------------------
 ProjectLifecycleService (ForkLayer)                              projectClone.start  (clone)
   |- GitHubInventory     gh api user/repos, cached 10 min        orchestration dispatch
   |- LocalCheckouts      scan clone root + project roots             project.create (adopt)
   |- ParkAssessor        git status/for-each-ref/stash/worktree  subscribeProjectClones
   |- Trash               /usr/bin/trash | ~/.Trash rename | gio      (upstream clone toast)
   |- ParkedStore         fork_project_lifecycle_parked
   |- SettingsStore       fork_project_lifecycle_settings (extra patterns only)
   uses upstream services: VcsProcess, ProjectionSnapshotQuery, OrchestrationEngineService,
   ProjectCloneTracker, RepositoryIdentityResolver, VcsStatusBroadcaster, ServerConfig,
   ServerSettingsService (addProjectBaseDirectory, the clone location)

 web sidebar footer: RepositoriesSidebarItem (packet seam in SidebarChrome.tsx) -> /loom/repositories
```

What upstream already provides and this packet reuses instead of rebuilding:

- **Tracked project clone.** `projectClone.start` (`packages/contracts/src/rpc.ts:418`,
  schemas in `packages/contracts/src/projectClone.ts:68-86`) resolves the remote, dispatches
  `project.create` with `createWorkspaceRootIfMissing: true`, clones in the background and
  streams progress on `subscribeProjectClones`; the web shows it in
  `ProjectCloneToastCoordinator` (mounted in `apps/web/src/routes/__root.tsx`). Handler:
  `apps/server/src/ws.ts:2870-2911`. The service is `ProjectCloneTracker`
  (`apps/server/src/project/ProjectCloneTracker.ts:45-73`) with caller-owned hooks
  `createProject` and `onCloned` (`:80-92`). The web palette's clone flow is
  `submitAddProjectCloneFlow` (`apps/web/src/components/CommandPalette.tsx:2086-2270`),
  gated on `capabilities.projectCloneTracking`.
- **Destination rules.** `SourceControlRepositoryService.prepareDestination` expands `~`
  and refuses a non-empty destination
  (`apps/server/src/sourceControl/SourceControlRepositoryService.ts:196-230`).
- **Clone helpers.** `getCloneDirectoryName`, `getCloneDestinationPath`,
  `getDefaultCloneUrl`, `buildProjectCreateCommand`
  (`packages/client-runtime/src/operations/projects.ts:126,214,242,308`).
- **Remote normalization.** `normalizeGitRemoteUrl` (`packages/shared/src/git.ts:114`,
  subpath `@t3tools/shared/git`).
- **Process limiter.** `VcsProcess.run` (`apps/server/src/vcs/VcsProcess.ts:47-51`) is
  provided to the whole runtime (`apps/server/src/server.ts:803`) and caps git at 8 and
  GitHub at 4 concurrent processes (`VcsProcess.ts:57-58`).
- **Add project base directory.** Upstream's per-environment server setting
  `addProjectBaseDirectory` (`packages/contracts/src/settings.ts:1133`, default `""`) seeds
  the Add Project browser and is edited in Settings, General, "Add project starts in"
  (`apps/web/src/components/settings/SettingsPanels.tsx:2831-2858`). This packet uses it as
  the clone location and keeps no setting of its own (PRODUCT.md, Decisions).

`GitHubCli` is not reachable from ForkLayer as a service: it is provided only into the
source control provider registry (`apps/server/src/server.ts:278-290`,
`Layer.provide(Layer.mergeAll(..., GitHubCli.layer, ...))`). The fork calls
`VcsProcess.run({ command: "gh", ... })` directly, which is exactly what
`GitHubCli.execute` does when no credential is pinned
(`apps/server/src/sourceControl/GitHubCli.ts:381-416`).

## Contracts

`packages/contracts/src/fork/project-lifecycle.ts`, exported from `fork/index.ts` and merged
into `ForkRpcGroup`.

```ts
export const PROJECT_LIFECYCLE_WS_METHODS = {
  getSettings: "loom.project-lifecycle.getSettings",
  updateSettings: "loom.project-lifecycle.updateSettings",
  listRepositories: "loom.project-lifecycle.listRepositories",
  assessPark: "loom.project-lifecycle.assessPark",
  pushAll: "loom.project-lifecycle.pushAll",
  park: "loom.project-lifecycle.park",
  reopen: "loom.project-lifecycle.reopen",
  forgetParked: "loom.project-lifecycle.forgetParked",
} as const;

export const ProjectLifecycleSettings = Schema.Struct({
  extraSafePatterns: Schema.Array(TrimmedNonEmptyString),
  extraKeepPatterns: Schema.Array(TrimmedNonEmptyString),
});
export const DEFAULT_PROJECT_LIFECYCLE_SETTINGS: ProjectLifecycleSettings = {
  extraSafePatterns: [],
  extraKeepPatterns: [],
};

/** Used when upstream's addProjectBaseDirectory is empty. */
export const DEFAULT_CLONE_ROOT = "~/Developer/active";

export const GitHubRepositoryEntry = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String), // clamped to 200 chars on the server
  isPrivate: Schema.Boolean,
  isArchived: Schema.Boolean,
  isFork: Schema.Boolean,
  defaultBranch: Schema.NullOr(Schema.String),
  pushedAt: Schema.NullOr(IsoDateTime),
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
  cloneUrl: TrimmedNonEmptyString,
  /** normalizeGitRemoteUrl(cloneUrl): the join key. */
  remoteKey: TrimmedNonEmptyString,
});

export const GitHubInventory = Schema.Union([
  Schema.TaggedStruct("Ok", {
    fetchedAt: IsoDateTime,
    repositories: Schema.Array(GitHubRepositoryEntry),
    truncated: Schema.Boolean, // true past MAX_GITHUB_REPOSITORIES
  }),
  Schema.TaggedStruct("Missing", {}), // gh not on PATH
  Schema.TaggedStruct("Unauthenticated", { detail: Schema.String }),
  Schema.TaggedStruct("Failed", { detail: Schema.String }),
]);

export const LocalCheckout = Schema.Struct({
  path: TrimmedNonEmptyString, // absolute, realpath
  originUrl: Schema.NullOr(Schema.String),
  remoteKey: Schema.NullOr(Schema.String),
  /** From .git/HEAD; null when detached or unreadable. */
  branch: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(ProjectId),
  insideCloneRoot: Schema.Boolean,
});

export const ParkedRecord = Schema.Struct({
  id: TrimmedNonEmptyString,
  checkoutPath: TrimmedNonEmptyString,
  originUrl: TrimmedNonEmptyString,
  remoteKey: TrimmedNonEmptyString,
  nameWithOwner: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(ProjectId), // null when the project no longer exists
  headBranch: Schema.NullOr(Schema.String),
  trashPath: Schema.NullOr(Schema.String), // null when the trash tool does not report it
  archivedThreadIds: Schema.Array(ThreadId),
  parkedAt: IsoDateTime,
});

export const RepositoriesResult = Schema.Struct({
  platform: Schema.Literals(["darwin", "linux", "win32", "other"]),
  cloneRoot: TrimmedNonEmptyString, // resolved absolute path
  /** Where cloneRoot came from: upstream's "Add project starts in", or DEFAULT_CLONE_ROOT. */
  cloneRootSource: Schema.Literals(["add-project-setting", "default"]),
  canPark: Schema.Boolean,
  parkUnavailableReason: Schema.NullOr(Schema.String),
  github: GitHubInventory,
  local: Schema.Array(LocalCheckout),
  parked: Schema.Array(ParkedRecord),
});

export const ParkBlockerCode = Schema.Literals([
  "not-a-repository",
  "protected-path",
  "no-origin",
  "origin-unreachable",
  "dirty-tracked",
  "untracked",
  "stashes",
  "unpushed-commits",
  "missing-tags",
  "linked-worktree-dirty",
  "nested-repository",
  "thread-running",
  "clone-in-progress",
  "operation-in-progress",
  "incomplete-check",
]);
export const ParkBlocker = Schema.Struct({
  code: ParkBlockerCode,
  title: Schema.String,
  detail: Schema.String,
  /** Up to 20 example paths, branches or stashes. */
  items: Schema.Array(Schema.String),
  /** True when "Push all branches and tags" can clear it. */
  fixableByPush: Schema.Boolean,
});

export const IgnoredClass = Schema.Literals(["safe", "keep", "review"]);
export const IgnoredGroup = Schema.Struct({
  class: IgnoredClass,
  /** Capped at 1,000 for keep (the dialog lists each one) and 200 for safe and review; see `counts`. */
  paths: Schema.Array(Schema.String),
});

export const ParkAssessment = Schema.Struct({
  /** Hash of every fact below; park refuses if a fresh assessment differs. */
  token: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  originUrl: Schema.NullOr(Schema.String),
  blockers: Schema.Array(ParkBlocker),
  ignored: Schema.Array(IgnoredGroup),
  counts: Schema.Struct({ safe: NonNegativeInt, keep: NonNegativeInt, review: NonNegativeInt }),
  linkedWorktreesToTrash: Schema.Array(Schema.String),
  activeThreadIds: Schema.Array(ThreadId),
  assessedAt: IsoDateTime,
});
```

Errors: one tagged error with a user-facing message.

```ts
export class ProjectLifecycleError extends Schema.TaggedErrorClass<ProjectLifecycleError>()(
  "ProjectLifecycleError",
  {
    reason: Schema.Literals([
      "invalid-path",
      "not-found",
      "blocked",
      "stale-assessment",
      "trash-unavailable",
      "trash-failed",
      "git-failed",
      "gh-failed",
      "destination-not-empty",
    ]),
    message: Schema.String,
  },
) {}
```

RPCs (all unary, none streaming; every `error` is
`Schema.Union([ProjectLifecycleError, EnvironmentAuthorizationError])`):

| Tag                | Payload                                                                                          | Success                                             | Scope                   |
| ------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------- |
| `getSettings`      | `{}`                                                                                             | `ProjectLifecycleSettings`                          | `orchestration:read`    |
| `updateSettings`   | `ProjectLifecycleSettings`                                                                       | `ProjectLifecycleSettings`                          | `orchestration:operate` |
| `listRepositories` | `{ refreshGitHub: boolean }`                                                                     | `RepositoriesResult`                                | `orchestration:read`    |
| `assessPark`       | `{ path: string }`                                                                               | `ParkAssessment`                                    | `orchestration:read`    |
| `pushAll`          | `{ path: string }`                                                                               | `{ pushedBranches: string[]; pushedTags: boolean }` | `orchestration:operate` |
| `park`             | `{ path; token; archiveThreads: boolean; acknowledgeKeep: boolean; acknowledgeReview: boolean }` | `ParkedRecord`                                      | `orchestration:operate` |
| `reopen`           | `{ parkedId; unarchiveThreads: boolean }`                                                        | `{ projectId; cwd }`                                | `orchestration:operate` |
| `forgetParked`     | `{ parkedId }`                                                                                   | `{ removed: boolean }`                              | `orchestration:operate` |

`orchestration:operate` matches upstream's scope for `projectClone.start/cancel` and
`sourceControl.cloneRepository` (`apps/server/src/auth/RpcAuthorization.ts:98-102`), which
also write and remove checkout directories.

Clone and Adopt use upstream RPCs directly from the web
(`sourceControlEnvironment.startProjectClone`, `projectEnvironment.create`), so they need no
fork contract.

## Server

`apps/server/src/fork/project-lifecycle/`:

| File                  | Role                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `ProjectLifecycle.ts` | `ProjectLifecycleService` (`Context.Service`) and `layer`.                   |
| `githubInventory.ts`  | `gh api` call, decode, cache.                                                |
| `localCheckouts.ts`   | Clone-root scan and project-root join.                                       |
| `assessPark.ts`       | Git facts collection (effectful) plus `decideParkBlockers` (pure).           |
| `ignoredFiles.ts`     | `classifyIgnoredPath` (pure) and default pattern lists.                      |
| `trash.ts`            | `moveToTrash` per platform.                                                  |
| `store.ts`            | Parked records and settings repositories.                                    |
| `migrations.ts`       | `ProjectLifecycleMigrations` (fork migration set, slug `project-lifecycle`). |
| `rpc.ts`              | `makeProjectLifecycleRpcHandlers(auth)`.                                     |

### Service shape

```ts
export class ProjectLifecycleService extends Context.Service<
  ProjectLifecycleService,
  {
    readonly getSettings: Effect.Effect<ProjectLifecycleSettings, ProjectLifecycleError>;
    readonly updateSettings: (
      s: ProjectLifecycleSettings,
    ) => Effect.Effect<ProjectLifecycleSettings, ProjectLifecycleError>;
    readonly listRepositories: (i: {
      refreshGitHub: boolean;
    }) => Effect.Effect<RepositoriesResult, ProjectLifecycleError>;
    readonly assessPark: (i: {
      path: string;
    }) => Effect.Effect<ParkAssessment, ProjectLifecycleError>;
    readonly pushAll: (i: {
      path: string;
    }) => Effect.Effect<{ pushedBranches: string[]; pushedTags: boolean }, ProjectLifecycleError>;
    readonly park: (i: ParkInput) => Effect.Effect<ParkedRecord, ProjectLifecycleError>;
    readonly reopen: (
      i: ReopenInput,
    ) => Effect.Effect<{ projectId: ProjectId; cwd: string }, ProjectLifecycleError>;
    readonly forgetParked: (i: {
      parkedId: string;
    }) => Effect.Effect<{ removed: boolean }, ProjectLifecycleError>;
  }
>()("loom/project-lifecycle/ProjectLifecycleService") {}
```

Dependencies, all available to ForkLayer (EXTENSION-POINTS.md, "What ForkLayer can use"):
`SqlClient`, `ServerConfig` (`cwd`, `baseDir`, `stateDir`, `worktreesDir`,
`apps/server/src/config.ts:34-41,82-83,133`), `VcsProcess`, `ProjectionSnapshotQuery`
(`getShellSnapshot`, `getProjectShellById`,
`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:118,174`),
`OrchestrationEngineService.dispatch`
(`apps/server/src/orchestration/Services/OrchestrationEngine.ts:73-76`),
`ProjectCloneTracker`, `RepositoryIdentityResolver`
(`apps/server/src/project/RepositoryIdentityResolver.ts:28-31`), `VcsStatusBroadcaster`,
`FileSystem`, `Path`.

All git and gh calls go through `VcsProcess.run` with an explicit `timeoutMs` and
`maxOutputBytes`, `allowNonZeroExit: true` where the exit code is the answer. Operation
names are `loom.projectLifecycle.<step>`.

### GitHub inventory

```
gh api --method GET --paginate --slurp user/repos
  -f per_page=100 -f affiliation=owner,collaborator,organization_member -f sort=pushed
```

This is the call old Loom used (see REFERENCES.md); `gh repo list` only lists one owner.
Run with `cwd: homedir`, `timeoutMs: 120_000`, `maxOutputBytes: 16 MiB`. Decode each page
with a narrow schema (`full_name`, `name`, `description`, `private`, `archived`, `fork`,
`default_branch`, `pushed_at`, `html_url`, `ssh_url`, `clone_url`) and keep at most
`MAX_GITHUB_REPOSITORIES = 2000`.

Errors: a spawn failure whose cause is ENOENT maps to `Missing`; `gh`'s "not logged into
any GitHub hosts" or HTTP 401 on stderr maps to `Unauthenticated`; anything else to
`Failed` with the first stderr line (clamped to 300 chars). Inventory failures never fail
`listRepositories`; they become the `github` field so local clones still show.

Cache: a `Ref<{ at: number; value: GitHubInventory } | null>` in the service with a 10 minute
TTL. `refreshGitHub: true` bypasses it. Concurrent callers share one in-flight fetch
(`Effect.cached` style: keep the running `Deferred` in the Ref).

### Local checkouts

1. Resolve `cloneRoot`: `ServerSettingsService.getSettings` on this environment gives
   `addProjectBaseDirectory`; when it is empty after trimming, use `DEFAULT_CLONE_ROOT`
   (`cloneRootSource` says which). Expand with `expandHomePath`
   (`apps/server/src/pathExpansion.ts:19`), then `realPath`. Missing root: return no scanned
   checkouts, not an error; the page still shows the path. This is the same value upstream's
   palette reads for Add Project (`apps/web/src/components/CommandPalette.tsx:976`).
2. Scan `cloneRoot` to depth 2. A directory that contains `.git` (file or directory) is a
   checkout; do not descend into it. Skip names starting with `.` and the usual heavy names
   (`node_modules`, `target`, `dist`, `build`, `Library`, `vendor`). Skip entries whose
   realpath leaves `cloneRoot` (symlink escape, a lesson from old Loom's audit). Cap at
   500 checkouts.
3. Add every active project's `workspaceRoot` from `getShellSnapshot()` (deduplicated by
   realpath), so projects outside the clone root can be parked too.
4. Per checkout, read `.git/HEAD` for the branch (a `.git` file means a linked worktree or
   submodule; follow its `gitdir:` line) and run `git remote get-url origin`
   (`timeoutMs: 5_000`). Do not run `git status` here; that is the expensive part and
   belongs to the assessment.
5. `projectId`: the project whose realpath'd `workspaceRoot` equals the checkout path.

T3's own thread worktrees live under `ServerConfig.worktreesDir` (`<baseDir>/worktrees`,
`apps/server/src/config.ts:133`), not in the clone root, so they never appear as checkouts.

### Park assessment

`assessPark({ path })` collects facts, then a pure function turns them into blockers.

Path guards (blocker `protected-path`, and `park` refuses outright): the path must be
absolute, exist, and equal `git rev-parse --show-toplevel`; it must not be `/`, the home
directory, `cloneRoot` itself, contain or equal `ServerConfig.baseDir` or
`ServerConfig.cwd` (the running server's own checkout, which is the Loom dev tree during
development), or be inside `worktreesDir`.

Facts (run with concurrency 4, each with a timeout; a failed or timed out step adds
`incomplete-check` rather than being treated as clean, the fail-closed rule from old Loom):

| Fact                       | Command                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Origin                     | `git remote get-url origin`                                                                                            |
| Reachability and freshness | `git fetch --prune --tags origin` (`timeoutMs: 60_000`); failure means `origin-unreachable`                            |
| Working tree               | `git status --porcelain=v1 -z --untracked-files=normal --ignored=matching`                                             |
| In-progress operation      | existence of `MERGE_HEAD`, `rebase-merge`, `rebase-apply`, `CHERRY_PICK_HEAD` under `git rev-parse --absolute-git-dir` |
| Stashes                    | `git stash list --format=%gd%x09%s`                                                                                    |
| Commits not on any remote  | `git log --branches --not --remotes --format=%h%x09%D%x09%s -n 50` (the `dev-park` check)                              |
| Branches needing a push    | `git for-each-ref --format=%(refname:short)%09%(upstream:short)%09%(upstream:track) refs/heads`                        |
| Tags missing on origin     | `git tag --list` compared with `git ls-remote --tags --refs origin`                                                    |
| Linked worktrees           | `git worktree list --porcelain`, then for each other worktree `git -C <wt> status --porcelain -z`                      |
| Threads                    | `getShellSnapshot()`: threads of `projectId`, plus threads whose `worktreePath` is a linked worktree                   |
| Clone in progress          | `ProjectCloneTracker.get(projectId)` with phase `running`                                                              |

From `git status -z` records: `!! path` is ignored, `?? path` untracked, anything else is a
tracked change. Unmerged records (`UU`, `AA`, `DU` and friends) also count as tracked
changes. An untracked or ignored directory that contains `.git` is a nested repository
(`nested-repository` blocker; submodules are tracked and are not affected).

Blockers (pure `decideParkBlockers(facts)`, unit tested):

- `no-origin`, `origin-unreachable`, `dirty-tracked`, `untracked`, `stashes`,
  `operation-in-progress`, `nested-repository`, `linked-worktree-dirty`, `clone-in-progress`,
  `incomplete-check`, `protected-path`.
- `unpushed-commits`: `git log --branches --not --remotes` is non-empty; `fixableByPush`.
- `missing-tags`: local tags absent from origin; `fixableByPush`.
- `thread-running`: a thread of the project with `session.status` in `starting | running`
  or with `backgroundLiveness` set (`packages/contracts/src/orchestration.ts:543-563,815-860`).

Ignored-file classification (pure `classifyIgnoredPath(path, extras)` in `ignoredFiles.ts`).
`--ignored=matching` reports an ignored directory once (`node_modules/`), so the list stays
short. Order:

1. `extraKeepPatterns`, then `extraSafePatterns` from settings.
2. Safe when any segment is one of `node_modules`, `target`, `dist`, `build`, `.next`,
   `.nuxt`, `.svelte-kit`, `.output`, `.turbo`, `.cache`, `.parcel-cache`, `coverage`,
   `.pnpm-store`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache`,
   `.ruff_cache`, `.gradle`, `Pods`, `DerivedData`, `.build`, `.expo`, `.vercel`,
   `.wrangler`, `__screenshots__`; or the basename is `.DS_Store`, ends in `.tsbuildinfo`,
   `.pyc` or `.log`.
3. Keep when the basename matches `.env` or `.env.*` (except `.env.example`, `.env.sample`,
   `.env.template`, `.env.schema`), or ends in `.sqlite`, `.sqlite3`, `.db`, `.db-wal`,
   `.sqlite-wal`, `.pem`, `.key`, `.p12`, `.keystore`, `.jks`, `.mobileprovision`,
   `.mov`, `.mp4`, `.m4a`, `.wav`, `.webm`, `.mkv`; or a segment is `.t3` (a T3 worktree's
   local state).
4. Otherwise review.

Patterns in settings use a small, documented syntax: `name/` matches a path segment,
`*.ext` a suffix, anything else an exact basename. No full glob engine (no new dependency).

Token: SHA-256 over the sorted facts that matter for safety (status records, stash list,
unpushed list, worktree list, origin URL, HEAD commit). `park` recomputes the assessment
and refuses with `stale-assessment` if the token differs, so a file written between the
dialog and the click cannot be lost silently.

### Push all

`pushAll({ path })`: refuses on `protected-path`. For each local branch that has commits
not on a remote or has no upstream, `git push -u origin <branch>` (`timeoutMs: 120_000`),
then `git push --tags origin`. This mirrors `dev-park`, which pushes every branch because a
local-only backup branch once existed only on disk (workflow doc). Failures are reported per
branch; the dialog re-runs the assessment afterwards. Never `--force`.

### Park

```
park({ path, token, archiveThreads, acknowledgeKeep, acknowledgeReview })
  1. assessment := assessPark(path); refuse if assessment.token != token (stale-assessment)
  2. refuse if assessment.blockers is non-empty (blocked)
  3. refuse if counts.keep > 0 and not acknowledgeKeep (blocked: "Confirm you have the
     files to keep elsewhere")
  4. refuse if counts.review > 0 and not acknowledgeReview (blocked)
  5. serialize per path with a Semaphore keyed by realpath (one park at a time per checkout)
  6. moveToTrash(linked worktree paths), then moveToTrash(path)
  7. insert fork_project_lifecycle_parked row
  8. if archiveThreads: dispatch thread.archive for every non-archived thread of the
     project and of its linked worktrees (server command ids `server:loom-park:<uuid>`)
  9. return the record
```

Keep files are a confirmation, not a blocker: they never appear in `blockers` and never
change `decideParkBlockers`. Nothing in this packet reads, copies or uploads a Keep file's
content (`.env` files included); the assessment carries only paths.

Archiving comes after the move so a failed move leaves threads untouched. A failed archive
dispatch is logged and reported in the result but does not undo the park (the folder is
already in the Trash; the user can archive by hand).

### Trash

`trash.ts` exports `moveToTrash(path): Effect<{ trashPath: string | null }, ProjectLifecycleError>`
and `trashAvailability(): Effect<{ ok: true } | { ok: false; reason: string }>`.

- `darwin`: if `/usr/bin/trash` exists (macOS 15 and later; present on this Mac), run it
  with the path (`timeoutMs: 120_000`). It uses Finder semantics, so Put Back works; it does
  not print the destination, so `trashPath` is null. Otherwise rename to
  `~/.Trash/<basename>-<yyyymmdd-hhmmss>` with `fs.rename`, exactly like `dev-park`, and
  refuse on `EXDEV` (different volume) instead of copying.
- `linux`: `gio trash <path>` when `gio` is on PATH; otherwise unavailable.
- `win32` and others: unavailable.

There is no code path that calls `FileSystem.remove` on a checkout. A test asserts that
`trash.ts` and `ProjectLifecycle.ts` never import or call `remove`/`rm` (grep-based test,
cheap and meaningful given the old bug).

### Reopen

`reopen({ parkedId, unarchiveThreads })`:

- If the record's `projectId` still names an active project: call
  `ProjectCloneTracker.start` with `projectId`, the record's `originUrl` as `remoteUrl`, the
  record's `checkoutPath` as `destinationPath`, and hooks `createProject: () => Effect.void`
  (the project exists) and `onCloned` that refreshes identity and git status the way
  upstream's handler does (`apps/server/src/ws.ts:2887-2906`:
  `repositoryIdentityResolver.resolve(root, { refresh: true })`, dispatch
  `project.meta.update { projectId }`, `VcsStatusBroadcaster.refreshStatus(root)`). Progress
  then appears in upstream's clone toast for that project.
- Otherwise the web uses upstream's `projectClone.start` itself with a new project id (the
  same call as Clone), then calls `forgetParked`. The server returns
  `ProjectLifecycleError { reason: "not-found" }` for a missing project so the client knows
  to take that path.
- If the destination is not empty, fail with `destination-not-empty` and let the user pick
  another path (the dialog then uses the new-project path with an edited destination).
- `unarchiveThreads`: dispatch `thread.unarchive` for `archivedThreadIds` that still exist
  and are archived, after the clone finished (inside `onCloned`).
- On success the record gets `reopened_at` and disappears from the Parked filter.

Upstream's toast offers "Remove project" when a clone fails
(`apps/web/src/components/ProjectCloneToastCoordinator.tsx:194`). For a reopened project
that would delete its threads; the reopen dialog warns "If the clone fails, use Retry in
the progress toast." This is a known rough edge, not a seam.

## Storage

Fork migration set `ProjectLifecycleMigrations`, slug `project-lifecycle`, tracking table
`fork_migrations_project_lifecycle`.

```sql
-- 1_Parked
CREATE TABLE IF NOT EXISTS fork_project_lifecycle_parked (
  id TEXT PRIMARY KEY,
  checkout_path TEXT NOT NULL,
  origin_url TEXT NOT NULL,
  remote_key TEXT NOT NULL,
  name_with_owner TEXT,
  project_id TEXT,
  head_branch TEXT,
  trash_path TEXT,
  archived_thread_ids_json TEXT NOT NULL DEFAULT '[]',
  report_json TEXT NOT NULL,
  parked_at TEXT NOT NULL,
  reopened_at TEXT
);
CREATE INDEX IF NOT EXISTS fork_project_lifecycle_parked_remote_key
  ON fork_project_lifecycle_parked (remote_key);

-- 2_Settings
CREATE TABLE IF NOT EXISTS fork_project_lifecycle_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- `report_json` holds a compact copy of the assessment (counts, ignored Keep and Review
  paths, pushed branches) so the Parked list can show what went to the Trash.
- No foreign keys into upstream tables. `project_id` can go stale when a project is removed;
  `listRepositories` checks it against active projects and returns `projectId: null`
  instead. No reactor is needed.
- Settings are per environment by construction (each server has its own `state.sqlite`).
  Invalid JSON decodes to the defaults.
- Retention: records stay until Reopen or Forget. Reopened rows are deleted after 30 days
  on the next `listRepositories` call.

## Clients

- `packages/client-runtime/src/fork/project-lifecycle.ts`: `createProjectLifecycleAtoms(runtime)`
  returning query families for `getSettings`, `listRepositories` and `assessPark`, and
  commands for the rest (serial per environment, like upstream's clone commands in
  `packages/client-runtime/src/state/sourceControl.ts`).
- `apps/web/src/fork/project-lifecycle/`:
  - `state.ts`: instantiates the atoms with `connectionAtomRuntime`.
  - `RepositoriesPage.tsx`: header, environment select, filter tabs, search, table.
  - `repositoriesModel.ts`: pure join of GitHub rows, local checkouts, projects and parked
    records into `RepositoryRow[]`, plus filtering and sorting. Unit tested.
  - `ParkDialog.tsx` (Keep files listed one per line with the "I have these elsewhere"
    checkbox; Review files summarized with the general acknowledgement; Park enabled only
    when every blocker is gone and each shown acknowledgement is ticked), `ReopenDialog.tsx`,
    `CloneDialog.tsx` (destination field seeded with
    `getCloneDestinationPath(cloneRoot, getCloneDirectoryName(nameWithOwner))`).
  - `settingsSection.tsx`: the Loom settings section (clone location read only with a link
    to `/settings/general`, pattern textareas, "Open Repositories").
  - `SidebarItem.tsx`: `RepositoriesSidebarItem`, rendered by the packet seam in
    `SidebarChrome.tsx` (SEAMS.md). It returns `null` unless some connected environment's
    capabilities include `project-lifecycle` (the same test upstream uses for Pull Requests,
    `SidebarChrome.tsx:147-149`, with `supportsLoomFeature`), and otherwise renders the same
    markup as upstream's private `SidebarUtilityItem` (`SidebarChrome.tsx:103-126`:
    `SidebarMenuItem`, `Tooltip`, `SidebarMenuButton size="icon"`) with `FolderGit2Icon`
    (lucide) and the label "Repositories". Click closes the mobile sidebar (`useSidebar`) and
    navigates to `/loom/repositories`.
  - `palette.tsx`: palette source.
  - `ShortcutHost.tsx`: `ForkRoot` component subscribing to `loom.project-lifecycle.open`.
- Environment selection: `useEnvironments()` (`apps/web/src/state/environments.ts:37`),
  filtered to connected environments whose `serverConfig.environment.capabilities` include
  `project-lifecycle`. Default: the active thread's environment, else the primary. Labels
  use `resolveEnvironmentOptionLabel` (`apps/web/src/components/BranchToolbar.logic.ts:27`);
  confirmations always use the environment label, never "This Mac".
- Clone: `sourceControlEnvironment.startProjectClone`
  (`packages/client-runtime/src/state/sourceControl.ts`, instantiated in
  `apps/web/src/state/sourceControl`) with `{ projectId: newProjectId(), title, createdAt,
remoteUrl, destinationPath }`, then navigate to a new thread in that project the way the
  palette does (`CommandPalette.tsx:2250-2269`). Disabled with "Needs a newer server" when
  `capabilities.projectCloneTracking !== true`.
- Adopt: `projectEnvironment.create` (`apps/web/src/state/projects.ts:10`) with
  `buildProjectCreateCommand`.
- Gate: every entry checks `supportsLoomFeature(capabilities, "project-lifecycle")`.

## Agent-facing tools

None. Parking moves folders and pushes branches; it stays a human action with a
confirmation. An agent can already read git state itself.

## Performance

- `listRepositories` is a one-shot query, never a subscription. GitHub payload is at most
  2000 rows of about 300 bytes (descriptions clamped), under 1 MB, and cached for 10 minutes.
- The local scan costs one `git remote get-url` per checkout, limited by `VcsProcess`'s
  concurrency; no `git status` in the list.
- `assessPark` runs only when the Park dialog opens or after a push; it is the one
  expensive call and it is bounded by timeouts and `maxOutputBytes` (status output capped
  at 2 MB; truncated output adds `incomplete-check`).
- The page renders a plain list with `content-visibility: auto` rows or upstream's list
  virtualization if more than 500 rows; no animation beyond upstream's spinners.
- Search is client-side over the loaded rows with a 150 ms debounce.

## Alternatives considered

- **Port old Loom's estate** (about 9.5k lines: provider identity, bindings, receipts,
  leases, projections). Rejected: the workflow needs a list, a clone, a guarded park and a
  reopen. The fail-closed blocker list and the ignored-file classification are the parts
  worth keeping, and they are kept.
- **A fork clone implementation.** Rejected: upstream's tracked clone already has progress,
  cancel, retry and project creation.
- **Deleting the project on park.** Rejected as the default: it deletes threads.
- **A right panel.** Rejected: repositories are environment-wide, not thread-bound; a page
  like upstream's `/usage` fits (`apps/web/src/routes/usage.tsx`).
- **Using `GitHubCli` from upstream.** Not reachable from ForkLayer without re-providing an
  upstream layer; `VcsProcess.run` with `command: "gh"` is the same thing.
- **A Node trash dependency** (the `trash` npm package). Rejected: a new production
  dependency for what `/usr/bin/trash`, a rename and `gio` already do.
