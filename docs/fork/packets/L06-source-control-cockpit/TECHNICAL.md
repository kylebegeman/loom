# L06 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`). Search for the quoted code
when a line has moved.

## Overview

```
 Right panel "source-control-cockpit" (ext-panels), views: Lane | Graph | Checks | Conflicts
   |                                     |
   | upstream, reused as is              | fork RPC loom.source-control-cockpit.* (by thread id)
   v                                     v
 vcsEnvironment.status (subscribeVcsStatus)     SourceControlCockpit service (ForkLayer)
 vcsEnvironment.switchRef / refreshStatus         |- lane facts: op in progress, stashes, head, upstream, default branch
 thread shells (useThreadShellsForProjectRefs)    |- graph: git log --topo-order
 thread.pullRequests snapshots                    |- checks: gh api check-runs + status
 useOpenPrLink, rightPanelStore.open("pull-requests") |- check log tail: gh api actions/jobs/<id>/logs
 composerDraftStore.setPrompt                     |- conflicts: git status v2 unmerged + git dir markers
 rightPanelStore.openFile                         |- switch preflight, stash push/apply/pop
                                                  |- optional varlock scan
```

What upstream already has, and what this packet adds (from a survey of the current tree):

| Need                           | Upstream today                                                                                                                                                                                                                  | This packet                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Branch, ahead/behind, dirty    | `subscribeVcsStatus` (`packages/contracts/src/rpc.ts:975`, schemas `packages/contracts/src/git.ts:214-253`); client atoms `packages/client-runtime/src/state/vcs.ts:243-360`, web `apps/web/src/state/vcs.ts:8`                 | Reused.                                        |
| PR state, review, mergeability | `thread.pullRequests[].snapshot` on the thread shell (`packages/contracts/src/orchestration.ts:671,718,815-860`); `ThreadPullRequestsPanel.tsx`; `PullRequestDetailPanel.tsx`                                                   | Reused; PR rows open upstream's panel.         |
| PR checks list                 | `PullRequestCheck { name, status, description, url }` (`packages/contracts/src/pullRequest.ts:137-154`), shown in `PullRequestSummaryTab.tsx:645-693` and `PullRequestChecksPopover.tsx`, only for PRs                          | Checks for any pushed head, plus logs.         |
| CI logs                        | None (only workflow approval, `apps/server/src/pullRequest/GitHubPullRequestCli.ts:501,2400`)                                                                                                                                   | Job log tail.                                  |
| Commit graph                   | None (`git log` only in `readRangeContext`, `GitVcsDriverCore.ts:2218`)                                                                                                                                                         | `git log --topo-order` graph.                  |
| Local conflicts, op state      | None. Porcelain v2 `u` records count as ordinary changes (`GitVcsDriverCore.ts:1779-1801`); no `MERGE_HEAD` or rebase checks anywhere                                                                                           | Conflicts view.                                |
| PR-level conflicts             | `mergeability: "conflicting"` and the "Resolve conflicts" handoff (`apps/web/src/components/pullRequest/pullRequestDetail.logic.ts:854`)                                                                                        | Linked from the lane card.                     |
| Branch switch                  | `vcs.switchRef` (`GitVcsDriverCore.ts:3451-3531`) with no dirty pre-check; git's reason is dropped (`executeGit`, `GitVcsDriverCore.ts:940-953`, detail "git checkout failed"); UI in `BranchToolbarBranchSelector.tsx:409-467` | Preflight plus stash; switch still upstream's. |
| Stash                          | None anywhere in `apps/server/src`                                                                                                                                                                                              | List, push, apply, pop.                        |
| Threads by branch              | No RPC; `apps/server/src/orchestration/ThreadPullRequestReactor.ts:125` groups internally                                                                                                                                       | Client-side filter of thread shells.           |

## Target resolution

Every fork RPC takes a `LaneTarget` and never a raw path, so a client cannot point git at an
arbitrary directory:

```ts
export const LaneTarget = Schema.Union([
  Schema.TaggedStruct("Thread", { threadId: ThreadId }),
  Schema.TaggedStruct("Project", { projectId: ProjectId }), // draft threads: project root
]);
```

The server resolves `Thread` with `ProjectionSnapshotQuery.getThreadShellById`
(`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217-219`) to
`worktreePath ?? project.workspaceRoot` (project via `getProjectShellById`, `:174`), and
`Project` to `workspaceRoot`. Unknown or deleted ids fail with `reason: "not-found"`.

## Contracts

`packages/contracts/src/fork/source-control-cockpit.ts`, exported from `fork/index.ts` and
merged into `ForkRpcGroup`. Tags are `loom.source-control-cockpit.<verb>`.

```ts
export const SOURCE_CONTROL_COCKPIT_WS_METHODS = {
  lane: "loom.source-control-cockpit.lane",
  graph: "loom.source-control-cockpit.graph",
  checks: "loom.source-control-cockpit.checks",
  checkLog: "loom.source-control-cockpit.checkLog",
  conflicts: "loom.source-control-cockpit.conflicts",
  switchPreflight: "loom.source-control-cockpit.switchPreflight",
  stashPush: "loom.source-control-cockpit.stashPush",
  stashApply: "loom.source-control-cockpit.stashApply",
  leakScan: "loom.source-control-cockpit.leakScan",
} as const;

export const GitOperation = Schema.Literals([
  "none",
  "merge",
  "rebase",
  "rebase-interactive",
  "am",
  "cherry-pick",
  "revert",
  "bisect",
]);

export const LaneFacts = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  isRepository: Schema.Boolean,
  headSha: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String), // null when detached
  upstream: Schema.NullOr(Schema.String), // e.g. origin/feature
  defaultBranch: Schema.NullOr(Schema.String), // from refs/remotes/origin/HEAD
  operation: GitOperation,
  operationDetail: Schema.NullOr(Schema.String), // "rebasing feature onto 1a2b3c4, step 3 of 7"
  conflictedCount: NonNegativeInt,
  stashes: Schema.Array(
    Schema.Struct({
      ref: Schema.String,
      message: Schema.String,
      branch: Schema.NullOr(Schema.String),
    }),
  ),
  leakCheck: Schema.Struct({ available: Schema.Boolean, reason: Schema.NullOr(Schema.String) }),
});

export const GraphCommit = Schema.Struct({
  sha: Schema.String,
  parents: Schema.Array(Schema.String),
  refs: Schema.Array(Schema.String), // decorations: "HEAD -> feature", "origin/main", "tag: v1"
  author: Schema.String,
  authoredAt: IsoDateTime,
  subject: Schema.String, // clamped to 200 chars
});
export const GraphResult = Schema.Struct({
  commits: Schema.Array(GraphCommit),
  mergeBase: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean,
});

export const CockpitCheck = Schema.Struct({
  id: Schema.String, // "run:<checkRunId>" or "status:<context>"
  name: Schema.String,
  workflowName: Schema.NullOr(Schema.String),
  status: PullRequestCheckStatus, // upstream literal set, same icons as the PR panel
  description: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  /** GitHub Actions job id parsed from details_url; null for third-party checks and statuses. */
  jobId: Schema.NullOr(Schema.String),
});
export const ChecksResult = Schema.Union([
  Schema.TaggedStruct("Ok", {
    repository: Schema.String,
    headSha: Schema.String,
    pushed: Schema.Boolean,
    checks: Schema.Array(CockpitCheck),
    fetchedAt: IsoDateTime,
  }),
  Schema.TaggedStruct("NotPushed", { headSha: Schema.String }),
  Schema.TaggedStruct("Unsupported", { remoteUrl: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("GhMissing", {}),
  Schema.TaggedStruct("GhUnauthenticated", { detail: Schema.String }),
  Schema.TaggedStruct("RateLimited", { resetAt: Schema.NullOr(IsoDateTime) }),
]);

export const CheckLogResult = Schema.Struct({
  text: Schema.String, // at most 64 KiB, from the end
  truncated: Schema.Boolean,
  failedSteps: Schema.Array(Schema.String),
  redactions: NonNegativeInt,
  htmlUrl: Schema.NullOr(Schema.String),
});

export const ConflictKind = Schema.Literals([
  "both-modified",
  "both-added",
  "both-deleted",
  "added-by-us",
  "added-by-them",
  "deleted-by-us",
  "deleted-by-them",
]);
export const ConflictFile = Schema.Struct({
  path: Schema.String,
  kind: ConflictKind,
  markerCount: Schema.NullOr(NonNegativeInt), // null for binary, deleted or oversized files
  hint: Schema.NullOr(Schema.Literals(["lockfile", "generated"])),
});
export const ConflictsResult = Schema.Struct({
  operation: GitOperation,
  operationDetail: Schema.NullOr(Schema.String),
  files: Schema.Array(ConflictFile), // capped at 200; `truncated` below
  truncated: Schema.Boolean,
  commands: Schema.Struct({
    continue: Schema.NullOr(Schema.String),
    abort: Schema.NullOr(Schema.String),
  }),
});

export const SwitchPreflightInput = Schema.Struct({
  target: LaneTarget,
  refName: TrimmedNonEmptyString, // as in VcsRef.name, e.g. "feature" or "origin/feature"
});
export const SwitchPreflightResult = Schema.Struct({
  verdict: Schema.Literals(["safe", "carry", "conflict", "blocked"]),
  dirtyCount: NonNegativeInt,
  overwritten: Schema.Array(Schema.String), // dirty or untracked paths the target changes, capped at 50
  blockedReason: Schema.NullOr(Schema.String), // operation in progress, unknown ref
  checkedOutAt: Schema.NullOr(Schema.String), // worktree path already holding the target branch
});

export const StashPushInput = Schema.Struct({
  target: LaneTarget,
  message: TrimmedNonEmptyString,
  includeUntracked: Schema.Boolean,
});
export const StashApplyInput = Schema.Struct({
  target: LaneTarget,
  ref: Schema.String.check(Schema.isPattern(/^stash@\{\d{1,4}\}$/)),
  drop: Schema.Boolean, // true = pop
});

export const LeakScanResult = Schema.Struct({
  clean: Schema.Boolean,
  findings: Schema.Array(
    Schema.Struct({ path: Schema.String, line: PositiveInt, key: Schema.String }),
  ),
  output: Schema.String, // ANSI-stripped, capped at 8 KiB, for anything the parser missed
});

export class SourceControlCockpitError extends Schema.TaggedErrorClass<SourceControlCockpitError>()(
  "SourceControlCockpitError",
  {
    reason: Schema.Literals([
      "not-found",
      "not-a-repository",
      "git-failed",
      "gh-failed",
      "stale",
      "unavailable",
    ]),
    message: Schema.String, // includes git's stderr first line where relevant
  },
) {}
```

| Tag               | Payload                        | Success                   | Scope                   |
| ----------------- | ------------------------------ | ------------------------- | ----------------------- |
| `lane`            | `{ target }`                   | `LaneFacts`               | `orchestration:read`    |
| `graph`           | `{ target; limit?: 50..500 }`  | `GraphResult`             | `orchestration:read`    |
| `checks`          | `{ target; refresh: boolean }` | `ChecksResult`            | `orchestration:read`    |
| `checkLog`        | `{ target; jobId }`            | `CheckLogResult`          | `orchestration:read`    |
| `conflicts`       | `{ target }`                   | `ConflictsResult`         | `orchestration:read`    |
| `switchPreflight` | `SwitchPreflightInput`         | `SwitchPreflightResult`   | `orchestration:read`    |
| `stashPush`       | `StashPushInput`               | `{ ref: string }`         | `orchestration:operate` |
| `stashApply`      | `StashApplyInput`              | `{ conflicted: boolean }` | `orchestration:operate` |
| `leakScan`        | `{ target; staged: boolean }`  | `LeakScanResult`          | `orchestration:operate` |

Every `error` is `Schema.Union([SourceControlCockpitError, EnvironmentAuthorizationError])`.
Scopes match upstream: VCS reads are `orchestration:read`, VCS writes
`orchestration:operate` (`apps/server/src/auth/RpcAuthorization.ts:117-131`). `leakScan` is
`operate` because varlock resolves the project's configured secrets to compare against.
All methods are unary; none goes into the stream tag unions.

## Server

`apps/server/src/fork/source-control-cockpit/`:

| File                      | Role                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `SourceControlCockpit.ts` | `SourceControlCockpitService` (`Context.Service`), `layer`, target resolution. |
| `laneFacts.ts`            | Operation detection, stash list, head and upstream.                            |
| `graph.ts`                | `git log` call and parser.                                                     |
| `checks.ts`               | GitHub check runs, statuses, job id parsing, cache.                            |
| `checkLog.ts`             | Job log fetch, tail truncation, redaction, failed steps.                       |
| `conflicts.ts`            | Unmerged records, marker counts, hints, commands.                              |
| `switchPreflight.ts`      | Overwrite prediction.                                                          |
| `stash.ts`                | Push, apply, pop.                                                              |
| `leakScan.ts`             | varlock detection and output parsing.                                          |
| `parsers.ts`              | Pure parsers shared by the above (unit tested).                                |
| `rpc.ts`                  | `makeSourceControlCockpitRpcHandlers(auth)`.                                   |

Dependencies (all reachable from ForkLayer): `VcsProcess` (provided to the whole runtime,
`apps/server/src/server.ts:803`; concurrency 8 for git and 4 for GitHub,
`apps/server/src/vcs/VcsProcess.ts:57-58`), `ProjectionSnapshotQuery`, `VcsStatusBroadcaster`
(to refresh local status after a stash, `apps/server/src/vcs/VcsStatusBroadcaster.ts:185-208`),
`FileSystem`, `Path`. `GitHubCli` is not reachable (it is provided only inside the source
control registry, `apps/server/src/server.ts:278-290`), so gh runs through `VcsProcess.run`
with `command: "gh"`, which is what `GitHubCli.execute` does without a pinned credential
(`apps/server/src/sourceControl/GitHubCli.ts:381-416`).

All commands set `env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }` (read commands
must not take the index lock that an agent's git might need), a `timeoutMs`, and
`maxOutputBytes`.

### Lane facts

- `git rev-parse --absolute-git-dir --abbrev-ref HEAD HEAD` (one call).
- `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` (non-zero exit means none).
- `git symbolic-ref --short refs/remotes/origin/HEAD` for the default branch.
- Operation: `MERGE_HEAD` (merge), `rebase-merge/` (read `interactive`, `head-name`, `onto`,
  `msgnum`, `end`), `rebase-apply/` (`applying` present means `am`, else rebase),
  `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`. Existence checks with `FileSystem.exists`
  on the git dir.
- `git stash list --format=%gd%x09%gs` (the subject carries "On <branch>: ...").
- `conflictedCount`: count of `u ` records from `git status --porcelain=v2 -z` only when an
  operation is in progress (skip the status call otherwise; upstream's stream already has
  the dirty count).
- `leakCheck.available`: `resolveCommandPath("varlock")` (`packages/shared/src/shell.ts:619-627`)
  and `<cwd>/.env.schema` exists.

### Graph

```
git log --topo-order --date=iso-strict -n <limit+1>
  --format=%H%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s%x1e
  HEAD [<upstream>] [origin/<default>]
```

Refs that do not exist are dropped before the call (`git rev-parse --verify --quiet`).
`git merge-base HEAD origin/<default>` gives `mergeBase`. `limit` defaults to 200, maximum
500; one extra commit tells `truncated`. Parsing splits on `\x1e` and `\x1f`, so subjects
with tabs or newlines are safe.

### Checks

1. Resolve the repository: the branch's upstream remote (`git config branch.<b>.remote`),
   else `origin`; `git remote get-url <remote>`; `parseGitHubRepositoryNameWithOwnerFromRemoteUrl`
   (`packages/shared/src/git.ts:213`). Not GitHub: `Unsupported`.
2. `pushed`: `git branch -r --contains HEAD` non-empty. Not pushed: `NotPushed`.
3. In parallel (GitHub concurrency is capped by `VcsProcess`):
   - `gh api repos/<o>/<r>/commits/<sha>/check-runs?per_page=100`
   - `gh api repos/<o>/<r>/commits/<sha>/status`
4. Map check runs: `status != "completed"` gives `pending`; otherwise the conclusion maps
   `success`, `failure`, `timed_out` (failure), `cancelled`, `skipped`, `neutral`,
   `action_required`, `stale` (neutral). Commit statuses map `success`, `failure`, `error`
   (failure), `pending`. Deduplicate check runs by name keeping the latest `started_at`
   (upstream dedupes the same way for PRs with `dedupeChecks`,
   `apps/server/src/pullRequest/pullRequestChecks.ts:30`; import it if its input type fits).
5. `jobId`: from `details_url` matching `/actions/runs/\d+/job(?:s)?/(\d+)`. (For GitHub
   Actions the check run id is also the job id; the URL parse avoids relying on that.)
6. Errors: ENOENT spawn is `GhMissing`; stderr with "gh auth login" or HTTP 401 is
   `GhUnauthenticated`; HTTP 403 or 429 with "rate limit" is `RateLimited` (read
   `X-RateLimit-Reset` when `gh api -i` is used; otherwise `resetAt: null`).
7. Cache in memory per `(repository, sha)` for 20 seconds; `refresh: true` bypasses it. At
   most 100 entries (drop oldest).

### Check log

`gh api repos/<o>/<r>/actions/jobs/<jobId>/logs` (gh follows the redirect to the log blob)
with `timeoutMs: 60_000` and `maxOutputBytes: 16 MiB`, then:

- Keep the last 64 KiB, cut at a line boundary, `truncated` when anything was dropped. This
  fixes old Loom's head truncation.
- Redact with a small fixed list: `gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_[A-Za-z0-9_]{50,}`,
  `sk-[A-Za-z0-9-_]{20,}`, `xox[abpr]-[A-Za-z0-9-]{10,}`, `AKIA[0-9A-Z]{16}`, PEM private key
  blocks, and `Bearer <token>`. GitHub already masks registered secrets; this is a second
  net, counted in `redactions`.
- `failedSteps`: `gh api repos/<o>/<r>/actions/jobs/<jobId>` then steps with
  `conclusion == "failure"`.
- `htmlUrl`: the job's `html_url`.

### Conflicts

1. Read HEAD (`git rev-parse HEAD`).
2. `git status --porcelain=v2 -z`, keep `u` records: `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`.
   XY: `UU` both-modified, `AA` both-added, `DD` both-deleted, `AU` added-by-us, `UA`
   added-by-them, `DU` deleted-by-us, `UD` deleted-by-them.
3. Marker count: read each file up to 2 MiB with `FileSystem.readFile`, count lines starting
   with `<<<<<<< `; binary (NUL byte) or larger files give `null`.
4. Hints: lockfile when the basename is `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
   `bun.lock`, `bun.lockb`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `uv.lock`,
   `Package.resolved`, `go.sum`; generated when the path contains `.gen.` or `/generated/`.
5. Re-read HEAD; if it moved, fail with `stale` (the old Loom probe's revalidation, see
   REFERENCES.md).
6. `commands`: merge `git merge --continue` / `git merge --abort`; rebase
   `git rebase --continue` / `git rebase --abort`; am `git am --continue` / `git am --abort`;
   cherry-pick and revert likewise. The panel only displays them.

### Switch preflight

1. Operation in progress: `blocked`.
2. Verify the ref: `git rev-parse --verify --quiet <refName>^{commit}`; unknown: `blocked`.
3. Tracked dirty paths and untracked paths: `git status --porcelain=v1 -z --untracked-files=all`
   (capped at 2 MiB of output; beyond that, treat as `conflict` with a note).
4. Paths the switch would change: `git diff --name-only -z HEAD <refName>`.
5. `overwritten` = dirty tracked paths in that set, plus untracked paths that exist in the
   target (`git ls-tree -r --name-only -z <refName> -- <untracked paths>` in batches of 100).
6. `checkedOutAt`: from `git worktree list --porcelain`, a worktree whose `branch` equals the
   local branch name (remote refs map to their local name with upstream's
   `deriveLocalBranchNameFromRemoteRef`, `packages/shared/src/git.ts:87`).
7. Verdict: `blocked` if 1 or 2; `safe` when nothing is dirty; `carry` when dirty but
   `overwritten` is empty (git carries the changes across); `conflict` otherwise.

The client performs the switch with upstream's calls, exactly as the branch selector does
(`apps/web/src/components/BranchToolbarBranchSelector.tsx:409-467` and its `setThreadBranch`
at `:170-205`): `resolveBranchSelectionTarget` (`apps/web/src/components/BranchToolbar.logic.ts:237`)
to reuse an existing worktree, else `vcsEnvironment.switchRef({ cwd, refName })`, then the
thread metadata update and, when the worktree changes, the session stop.

### Stash

- Push: `git stash push [--include-untracked] -m <message>`; the message is prefixed
  `loom: ` and clamped to 200 chars. Returns `stash@{0}`.
- Apply or pop: `git stash apply <ref>` or `git stash pop <ref>`. Exit 1 with conflict
  output returns `{ conflicted: true }` (git keeps the stash on a conflicted pop).
- After either, `VcsStatusBroadcaster.refreshLocalStatus(cwd)` so upstream's status stream
  (and every client) updates.
- Serialized per cwd with a keyed `Semaphore`.

### Leak scan (optional part)

`varlock scan` with `--staged` when requested (`cwd` = lane cwd, `timeoutMs: 60_000`,
`maxOutputBytes: 256 KiB`, `allowNonZeroExit: true`). Parse after stripping ANSI:

- Exit 0: clean (this includes "No sensitive values found in config", which the panel shows
  as an info line).
- Exit 1 and a line matching `Found \d+ sensitive value`: findings from lines matching
  `^(.+?):(\d+):(\d+)\s+(\S+)`.
- Exit 1 otherwise: a config error; return the output with `clean: false` and no findings,
  and the panel says "varlock could not load the project's configuration."

varlock resolves the project's sensitive values to compare them, which can call secret
plugins (for example 1Password) on the environment. The scan only ever runs on an explicit
click. The output format is human text, not a stable interface; see REFERENCES.md.

### Registration

`SourceControlCockpitService.layer` in `ForkServicesLive`, the service in `ForkServices`,
`"source-control-cockpit"` in `LOOM_SERVER_FEATURES`, handlers spread into `fork/rpc.ts`,
scopes in `FORK_RPC_REQUIRED_SCOPES`.

## Storage

None. Caches (checks per sha) live in the service and die with the process. The panel's
last view is a client preference: `loom:source-control-cockpit:view:v1` in localStorage
(through `resolveStorage`, wrapped in try/catch).

## Clients

- `packages/client-runtime/src/fork/source-control-cockpit.ts`:
  `createSourceControlCockpitAtoms(runtime)` with query families `lane`, `graph`, `checks`,
  `conflicts`, `switchPreflight`, `checkLog`, and commands `stashPush`, `stashApply`,
  `leakScan` (serial per environment).
- `apps/web/src/fork/source-control-cockpit/`:
  - `panel.tsx`: the `ForkPanelDefinition` (id `source-control-cockpit`, title "Source
    control", icon `GitBranchIcon`, shortcut `G`, `isAvailable` =
    `threadRef !== null && loomFeatures.includes("source-control-cockpit")`,
    `unavailableHint` "Needs a Loom server").
  - `CockpitPanel.tsx`: view tabs and the shared header (branch, environment).
  - `LaneView.tsx`: reads upstream status via `vcsEnvironment.status({ environmentId, input: { cwd } })`
    (the same family `GitActionsControl` uses), the thread shell (`useThreadShell`,
    `apps/web/src/state/entities.ts:99`), sibling threads (`useThreadShellsForProjectRefs`,
    `entities.ts:89`, filtered on the same `worktreePath` and `branch`), and the fork `lane`
    facts, refetched when the status stream's local snapshot changes (debounced 500 ms).
    PR rows use `useOpenPrLink(threadRef)` (`apps/web/src/lib/openPullRequestLink.ts:278`);
    "All linked PRs" calls `useRightPanelStore.getState().open(threadRef, "pull-requests")`
    (`apps/web/src/rightPanelStore.ts:130-133`).
  - `graphLayout.ts`: pure lane assignment (each commit takes the column reserved by its
    first child, else the first free column; merge parents reserve new columns) returning
    rows with column, edges and color index. Unit tested.
  - `GraphView.tsx`: fixed-height rows, one inline SVG per row, ref chips, merge base
    marker. 500 rows at most, so no virtualization.
  - `ChecksView.tsx`: list with upstream's check status icons (reuse the icon mapping from
    `PullRequestChecksPopover.tsx` if it is exported; otherwise a local copy of the small
    switch), "Open log" drawer inside the panel (monospace, `whitespace-pre`, no syntax
    highlighting), "Open on GitHub", "Ask the agent to fix".
  - `ConflictsView.tsx`: file list with kind, marker count, hint, "Open file"
    (`useRightPanelStore.getState().openFile(threadRef, path)`, `rightPanelStore.ts:137`),
    "Ask the agent to resolve", command chips with copy.
  - `SafeSwitch.tsx`: ref picker using upstream's `vcsEnvironment.listRefs`, preflight
    result, actions.
  - `prompts.ts`: pure prompt builders for fix and resolve. Pattern after upstream's
    `buildResolveConflictsPrompt` (`pullRequestDetail.logic.ts:854`).
  - `palette.tsx`, `ShortcutHost.tsx` (toggle via `onForkCommand`).
- "Ask the agent" writes the prompt into the thread's composer with
  `useComposerDraftStore.getState().setPrompt(threadRef, prompt)`
  (`apps/web/src/composerDraftStore.ts:571`) and focuses the composer; the user sends it.
  If the prompt is not empty, append after a blank line instead of replacing.
- Gate every entry on `supportsLoomFeature(capabilities, "source-control-cockpit")` for the
  thread's environment.

## Agent-facing tools

None in this packet. Agents run git themselves; the prompt builders hand them the facts.
A later `loom_source_control_cockpit_checks` tool (failing checks plus log tail for the
thread's branch) would be useful for autonomous CI fixing; it is left out to keep per-turn
tool tokens down (EXTENSION-POINTS.md, MCP).

## Performance

- No subscriptions. Upstream's status stream is already open for the thread (the composer
  toolbar subscribes to it), so the lane card adds no stream.
- `lane` is a handful of fast git calls plus file existence checks; refetch is debounced
  and only while the panel is mounted.
- Graph at most 500 commits, about 150 bytes each on the wire.
- Checks poll every 30 seconds only while the Checks view is visible, the document is
  visible, and a check is pending. The server caches per sha for 20 seconds, so several
  clients share one gh call.
- Logs are fetched on demand, 64 KiB at most on the wire.
- No animation other than upstream's spinner; the graph is static SVG.

## Alternatives considered

- **Port old Loom's `GitForgeCockpit`** (3.4k lines plus 1.9k logic and tests). Rejected: its
  graph was a table of lane records, its conflict view listed placeholder paths, and its safe
  switch tray was not wired to anything (see REFERENCES.md).
- **Separate right panels per view.** Rejected: more launcher letters and tabs for one object.
- **Adding a conflict flag to upstream's status schema.** Rejected: an upstream wire schema
  change; the fork RPC carries it instead.
- **Running the checkout in the fork to get git's stderr.** Rejected: upstream's `switchRef`
  handles remote tracking branches and refreshes status; the preflight makes its missing
  stderr matter less.
- **`gh run view --log-failed`.** Rejected in favor of the jobs API: it needs a run id and
  prints every failed job; the per-job log is smaller and maps to one check row.
- **Persisted lanes.** Rejected: they go stale when agents switch branches.
