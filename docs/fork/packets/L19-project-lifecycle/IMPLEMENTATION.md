# L19 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Commit per step with
`feat(fork-project-lifecycle): ...` (extension points use their own `feat(fork): ...` commit).

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Seed the worktree `.t3` with a `VACUUM INTO` copy of `~/.t3/userdata/state.sqlite`
  (AGENTS.md, "Test data") so projects exist to match.
- Never point Park at a real checkout while developing. Use the fixture script in
  TESTING.md, which builds throwaway repositories and a bare "origin" under a temp directory,
  and set the dev server's Settings, General, "Add project starts in" to that directory (the
  dev server's own worktree state, never Kyle's live settings). That value is the clone
  location.
- Read `/Users/kyle/.local/bin/dev-park` once: its checks are the behavioral baseline.

## Steps

### 1. Extension points

Run the existence checks for `ext-core`, `ext-settings`, `ext-palette`, `ext-web-root` and
`ext-keybindings`. Create each missing one exactly as EXTENSION-POINTS.md specifies, one
commit each, before any packet code.

### 2. Contracts

- `packages/contracts/src/fork/project-lifecycle.ts`: the schemas, error and RPC group from
  TECHNICAL.md ("Contracts"). Build every `Rpc.make` with
  `error: Schema.Union([ProjectLifecycleError, EnvironmentAuthorizationError])`.
- `fork/index.ts`: `export * from "./project-lifecycle.ts";`
- `fork/rpc.ts`: add `ProjectLifecycleRpcGroup,` to the `.merge(`.
- `fork/keybindings.ts`: add `"loom.project-lifecycle.open"`.
- Typecheck `@t3tools/contracts`.

### 3. Pure server logic, test first

In `apps/server/src/fork/project-lifecycle/`:

- `ignoredFiles.ts`: `DEFAULT_SAFE_SEGMENTS`, `DEFAULT_KEEP_SUFFIXES`, `classifyIgnoredPath`,
  `parsePatterns`. Tests cover every default rule, `.env.example` and `.env.schema` not being
  Keep (they classify as Review when ignored), extra patterns taking precedence, and Windows
  separators normalized.
- `assessPark.ts`: `parseStatusZ(stdout)` (records into tracked, untracked, ignored),
  `parseForEachRef`, `parseWorktreeList`, `decideParkBlockers(facts)`,
  `assessmentToken(facts)`. Tests use recorded git output strings.
- `trash.ts` pure part: `trashDestinationName(basename, now)` producing
  `<basename>-<yyyymmdd-hhmmss>`.

Sketch of the blocker decision:

```ts
export function decideParkBlockers(facts: ParkFacts): ReadonlyArray<ParkBlocker> {
  const blockers: ParkBlocker[] = [];
  const add = (
    code: ParkBlockerCode,
    title: string,
    detail: string,
    items: string[] = [],
    fixableByPush = false,
  ) => blockers.push({ code, title, detail, items: items.slice(0, 20), fixableByPush });

  if (facts.protectedReason)
    add("protected-path", "This folder cannot be parked", facts.protectedReason);
  for (const step of facts.incompleteSteps)
    add("incomplete-check", "A safety check did not finish", step);
  if (facts.originUrl === null)
    add("no-origin", "No origin remote", "Add an origin on GitHub first.");
  else if (!facts.originReachable)
    add("origin-unreachable", "GitHub is unreachable", "Loom could not fetch from origin.");
  if (facts.tracked.length > 0)
    add("dirty-tracked", "Uncommitted changes", "Commit and push, or discard them.", facts.tracked);
  if (facts.untracked.length > 0)
    add("untracked", "Untracked files", "Commit, ignore or remove them.", facts.untracked);
  if (facts.operationInProgress)
    add("operation-in-progress", "A merge or rebase is in progress", facts.operationInProgress);
  if (facts.stashes.length > 0)
    add(
      "stashes",
      "Stashes",
      "Apply or drop them, or keep one with git stash branch <name>.",
      facts.stashes,
    );
  if (facts.unpushedCommits.length > 0)
    add("unpushed-commits", "Commits not on GitHub", "Push them.", facts.unpushedCommits, true);
  if (facts.missingTags.length > 0)
    add("missing-tags", "Tags not on GitHub", "Push them.", facts.missingTags, true);
  for (const wt of facts.dirtyLinkedWorktrees)
    add("linked-worktree-dirty", "Linked worktree has changes", wt);
  for (const nested of facts.nestedRepositories)
    add("nested-repository", "Nested repository", `Park ${nested} separately first.`, [nested]);
  if (facts.runningThreadIds.length > 0)
    add("thread-running", "A thread is still working", "Wait for it or stop it.");
  if (facts.cloneRunning)
    add("clone-in-progress", "A clone is in progress", "Wait for it to finish or cancel it.");
  return blockers;
}
```

### 4. Server effects and storage

- `migrations.ts`: `ProjectLifecycleMigrations` with ids 1 (`Parked`) and 2 (`Settings`),
  DDL from TECHNICAL.md; append to `FORK_MIGRATION_SETS`.
- `store.ts`: `ParkedStore` and `SettingsStore` repositories on `SqlClient` (pattern:
  `apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`).
- `githubInventory.ts`: `fetchGitHubInventory(process)` using `VcsProcess.run` with
  `command: "gh"` and the args in TECHNICAL.md; `makeInventoryCache` (Ref with TTL and shared
  in-flight Deferred).
- `localCheckouts.ts`: scan and join.
- `assessPark.ts` effectful part: `collectParkFacts(path)` running the git commands through
  `VcsProcess.run` with `Effect.all(..., { concurrency: 4 })`; every step maps failure or
  timeout into `incompleteSteps`.
- `trash.ts`: `moveToTrash` and `trashAvailability`. Detect `/usr/bin/trash` with
  `FileSystem.exists`; detect `gio` with `resolveCommandPath` from `@t3tools/shared/shell`
  (upstream helper, `packages/shared/src/shell.ts:619-627`).
- `ProjectLifecycle.ts`: the service and `layer`. Per-path `Semaphore` map for `park` and
  `pushAll`. `park` follows the sequence in TECHNICAL.md. Thread archive dispatch:

```ts
const archive = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const uuid = yield* Effect.sync(() => crypto.randomUUID());
    yield* engine.dispatch({
      type: "thread.archive",
      commandId: CommandId.make(`server:loom-park:${uuid}`),
      threadId,
    });
  });
```

- Reopen with an existing project:

```ts
yield *
  cloneTracker.start(
    {
      projectId,
      title: project.title,
      createdAt: nowIso,
      remoteUrl: record.originUrl,
      destinationPath: record.checkoutPath,
    },
    {
      createProject: () => Effect.void, // the project already exists
      onCloned: ({ workspaceRoot }) =>
        identity.resolve(workspaceRoot, { refresh: true }).pipe(
          Effect.andThen(dispatchMetaUpdate(projectId)), // project.meta.update { projectId }
          Effect.andThen(vcsStatus.refreshStatus(workspaceRoot)),
          Effect.andThen(unarchiveThreads ? unarchive(record.archivedThreadIds) : Effect.void),
          Effect.andThen(parked.markReopened(record.id)),
          Effect.ignoreCause({ log: true }),
        ),
    },
  );
```

Check `VcsStatusBroadcaster`'s method name and signature against
`apps/server/src/vcs/VcsStatusBroadcaster.ts:185-208` before using it; upstream's handler
calls it through the `refreshGitStatus` helper in `ws.ts`.

- Register: `ProjectLifecycleService.layer` in `ForkServicesLive`, the service in
  `ForkServices`, `"project-lifecycle"` in `LOOM_SERVER_FEATURES`.
- `rpc.ts`: `makeProjectLifecycleRpcHandlers(auth)` with each handler
  `auth.effect(TAG, withForkRuntime(...))`; spread into `fork/rpc.ts`; scopes in
  `FORK_RPC_REQUIRED_SCOPES` (read: getSettings, listRepositories, assessPark; operate: the
  rest).
- Typecheck `t3`.

### 5. Client runtime

`packages/client-runtime/src/fork/project-lifecycle.ts`: `createProjectLifecycleAtoms(runtime)`
with query families (`listRepositories`, `assessPark`, `settings`) and serial commands
(`updateSettings`, `pushAll`, `park`, `reopen`, `forgetParked`). Export from
`client-runtime/src/fork/index.ts`. Typecheck `@t3tools/client-runtime`.

### 6. Web

In `apps/web/src/fork/project-lifecycle/`:

1. `state.ts`: `export const projectLifecycle = createProjectLifecycleAtoms(connectionAtomRuntime);`
2. `repositoriesSearch.ts`: `parseRepositoriesSearch` (validates `environmentId`, `filter`,
   `park`), pure and tested.
3. `repositoriesModel.ts`: `buildRepositoryRows({ github, local, parked, projects })`,
   `filterRows`, `sortRows`. A GitHub row joins local checkouts by `remoteKey`; local
   checkouts with no match become "Local only" rows; parked records join by `remoteKey` and
   are hidden once a live checkout of the same remote exists. Tested.
4. `RepositoriesPage.tsx`: header (title, environment select, Refresh GitHub, Back link to
   `/`), filter tabs, search, table with row actions, section banners for GitHub states,
   capability gate message. Use upstream primitives (`~/components/ui/*`), not new ones.
5. `CloneDialog.tsx`: editable destination, protocol from `getDefaultCloneUrl`, calls
   `sourceControlEnvironment.startProjectClone`, then opens a new thread in the project like
   `CommandPalette.tsx:2236-2269`.
6. `ParkDialog.tsx`: runs `assessPark` on open, renders blockers, the push button (only when
   every remaining blocker is `fixableByPush`, or alongside others), the Keep list (every
   path, one per line, with "and N more" past 1,000) with the "I have these elsewhere"
   checkbox, the Review summary with the general acknowledgement, the archive checkbox, and
   "Move to Trash". Disabled while any blocker remains or a shown acknowledgement is
   unticked. Sends the assessment `token`, `acknowledgeKeep` and `acknowledgeReview`. On `stale-assessment`, re-runs the
   assessment and says "Something changed. Review the report again."
7. `ReopenDialog.tsx`: existing project path calls `reopen`; `not-found` falls back to the
   Clone dialog seeded with the old path, then `forgetParked`.
8. `settingsSection.tsx`: environment-scoped section (read the selected scope as described in
   EXTENSION-POINTS.md, Settings) showing the clone location in use and its source (from
   `listRepositories`) with a "Change in General settings" link to `/settings/general`, two
   pattern textareas (one pattern per line) and "Open Repositories". Shows "Needs a Loom
   server" when the scoped environment lacks the feature.
9. `palette.tsx`: items `action:loom:project-lifecycle:open`,
   `action:loom:project-lifecycle:park-active` (only with an active thread whose project is
   on an environment with the feature), `action:loom:project-lifecycle:reopen`. `run`
   navigates with search params.
10. `ShortcutHost.tsx`: `useEffect(() => onForkCommand("loom.project-lifecycle.open", () => navigate({ to: "/loom/repositories" })), [navigate])`;
    renders null. Register in `FORK_ROOT_COMPONENTS`.
11. Route file `apps/web/src/routes/loom.repositories.tsx` (SEAMS.md), then regenerate the
    route tree with `vp run --filter @t3tools/web build`.
12. `SidebarItem.tsx` (`RepositoriesSidebarItem`, TECHNICAL.md, Clients), then the two marked
    lines in `apps/web/src/components/sidebar/SidebarChrome.tsx` exactly as SEAMS.md shows,
    then `vp fmt` on that file and check both markers are still attached.
13. Typecheck `@t3tools/web`.

### 7. Documentation

- `docs/fork/user/project-lifecycle.md`: what Repositories does, how to open it, what Park
  checks, where parked folders go, how to reopen, and the Windows and Linux limits.
- FORK.md rows from SEAMS.md (the `SidebarChrome.tsx` row is new).
- Packet index Status in `docs/fork/packets/README.md`.

## Pitfalls

- `--ignored=matching` reports whole ignored directories; do not switch to
  `--ignored=traditional` plus `--untracked-files=all`, which lists every file in
  `node_modules`.
- `git status -z` rename records carry two paths; consume both.
- A `.git` file (linked worktree or submodule) is not a directory; `.git/HEAD` must follow the
  `gitdir:` pointer.
- `git fetch` can prompt for credentials; run with `GIT_TERMINAL_PROMPT=0` in `env` so it
  fails instead of hanging.
- `gh api --paginate --slurp` prints one JSON array of pages; decode as
  `Array<Array<Repo>>`.
- The server may run on a different machine from the client. Never use browser path APIs
  or client-side home directories; paths come from the server.
- Do not call `FileSystem.remove` anywhere in this packet. The grep test in TESTING.md fails
  the build if one appears.
- The archive dispatch uses new command ids per call; archiving an already archived thread is
  rejected by the decider, so filter to non-archived threads first.
- `ProjectCloneTracker.start` refuses a destination with a clone already claimed; surface its
  message as is.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Parking a fixture repository with a local-only branch refuses until "Push all" runs, then
  succeeds and the folder is in the Trash (Finder "Put Back" restores it on macOS 15+).
- No code path in the packet deletes a directory.
- Reopen of a kept project restores the same project id and its threads.
