# L08 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## Overview

```
 Web: Compare dialog, Runs panel, settings section, palette
   | loom.multi-thread-runs.{startCompare,list,setArchived,remove,stopRun,rank,getSettings,setSettings}
   v
 RunService (ForkLayer) ----------------------------.-----------------------.
   |                                                |                       |
   v                                                v                       v
 ThreadStarter (ForkLayer)                     RunStore               decide.ts -> LoomDecide (ext-decide)
                                               (fork_multi_thread_     delegate-routing, compare-rank
                                                runs_*)
   GitWorkflowService.createWorktree
   engine.dispatch(thread.create)
   ProjectSetupScriptRunner.runForThread
   engine.dispatch(thread.turn.start)
   ^
   |  withForkRuntime
 MCP (ext-mcp): loom_multi_thread_runs_start_thread / loom_multi_thread_runs_get_thread
   McpInvocationContext { threadId, providerInstanceId }  (the calling agent's thread)

 RunCleanupReactor (forkParked): thread.deleted / project.deleted
```

No new orchestration commands or events. Members are ordinary threads; their live status
comes from upstream thread shells.

## Key upstream facts

- Server code cannot use `thread.turn.start`'s `bootstrap`; it is handled only in
  `apps/server/src/ws.ts` (`dispatchBootstrapTurnStart`, 1047-1720). The bootstrap does:
  optional origin fetch, `thread.create`, a provisional user message and session state for
  progress, `gitWorkflow.createWorktree` (1459-1514), `thread.meta.update`, the project setup
  script through `ProjectSetupScriptRunner.runForThread` (1185-1215, service at
  `apps/server/src/project/ProjectSetupScriptRunner.ts:111`), and the final turn start.
  `ThreadStarter` reproduces the essential steps without the progress tracker.
- `OrchestrationEngineService.dispatch` (`apps/server/src/orchestration/Services/OrchestrationEngine.ts:73-76`)
  with server command ids `server:<tag>:<uuid>` (`apps/server/src/ws.ts:734-735`).
- Reads: `ProjectionSnapshotQuery.getThreadShellById` (217), `getThreadDetailById` (249),
  `getProjectShellById` (174), `getShellSnapshot` (118)
  (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts`).
- Turn completion shows as `thread.session-set` events leaving `running`
  (`ProviderRuntimeIngestion.ts:1686-1767`); the shell's `latestTurn.state` becomes
  completed, interrupted or error. The receipt bus is a no-op in production
  (`Layers/RuntimeReceiptBus.ts:22-38`), so waiting uses domain events.
- Provider snapshots: `ProviderRegistry.getProviders` (`apps/server/src/provider/Services/ProviderRegistry.ts:28`)
  returns `ServerProvider[]` (`packages/contracts/src/server.ts:187-240`: `instanceId`,
  `driver`, `enabled`, `status`, `availability`, `models[]` with `slug` and `isDefault`).
- Model selection is `{ instanceId, model, options? }` (`packages/contracts/src/orchestration.ts:75-92`);
  runtime modes `approval-required < auto-accept-edits < auto < full-access`
  (`orchestration.ts:128-133`).
- MCP: tools are registered on T3's one MCP server; every provider adapter already connects
  to it with a per-thread credential. Handlers read `McpInvocationContext`
  (`apps/server/src/mcp/McpInvocationContext.ts:13-25`: `environmentId`, `threadId`,
  `providerSessionId`, `providerInstanceId`, `capabilities`). The pull request toolkit is the
  closest pattern: tools with `dependencies`, typed failures, handlers that dispatch
  orchestration commands (`apps/server/src/mcp/toolkits/pullRequests/tools.ts:15-231`,
  `handlers.ts:150-248`). Do not extend `McpCapability` (EXTENSION-POINTS.md, MCP tools).
- Git status for a worktree: `GitWorkflowService.localStatus({ cwd })`
  (`apps/server/src/git/GitWorkflowService.ts:46-48`), returning `workingTree.files` and
  totals (`VcsStatusLocalResult`, `packages/contracts/src/git.ts:212-240`).
- Temporary worktree branches: `buildTemporaryWorktreeBranchName`
  (`packages/shared/src/git.ts:95-105`); upstream renames them after the first turn
  (`ProviderCommandReactor.ts:877-937`).
- Reasoning effort is not a field of its own: it is a `select` option descriptor on the model
  (`ModelCapabilities.optionDescriptors`, `packages/contracts/src/model.ts:24-31,125-127`;
  `ServerProviderModel.capabilities`, `packages/contracts/src/server.ts:69-80`) whose id is
  `reasoningEffort` (Codex) or `effort` (Claude) (ids as used in
  `packages/shared/src/model.test.ts`), and a selection is `{ id, value }` in
  `ModelSelection.options` (`packages/contracts/src/model.ts:49-53`).
- Whole-thread diff for a member: `CheckpointDiffQuery.getFullThreadDiff({ threadId,
toTurnCount })` (`apps/server/src/checkpointing/CheckpointDiffQuery.ts:37-58`), returning
  `ThreadTurnDiff` with a `diff` string (`packages/contracts/src/orchestration.ts:2127-2133`).
  It is provided in `RuntimeCoreDependenciesLive` (`apps/server/src/server.ts:387-390,487`),
  so `ForkLayer` can use it. It works the same for worktree and shared-workspace members,
  because checkpoints are per thread.

## Contracts (`packages/contracts/src/fork/multi-thread-runs.ts`)

```ts
export const MULTI_THREAD_RUNS_WS_METHODS = {
  startCompare: "loom.multi-thread-runs.startCompare",
  list: "loom.multi-thread-runs.list",
  setArchived: "loom.multi-thread-runs.setArchived",
  remove: "loom.multi-thread-runs.remove",
  stopRun: "loom.multi-thread-runs.stopRun",
  rank: "loom.multi-thread-runs.rank",
  getSettings: "loom.multi-thread-runs.getSettings",
  setSettings: "loom.multi-thread-runs.setSettings",
} as const;

export const RunId = TrimmedNonEmptyString.pipe(Schema.brand("LoomRunId"));
export const RunKind = Schema.Literals(["compare", "delegation"]);
export const RunWorkspace = Schema.Literals(["worktree", "project-root", "origin"]);
export const RUN_PROMPT_MAX_CHARS = 20_000;
export const COMPARE_MIN_MEMBERS = 2;
export const COMPARE_MAX_MEMBERS = 6;
export const RANK_RUBRIC_MAX_CHARS = 1_000;
export const ROUTING_MAX_CANDIDATES = 12;
export const CompareMode = Schema.Literals(["models", "samples"]);

/** How a delegated child's model was chosen. Compare members use "explicit". */
export const MemberRouting = Schema.Struct({
  by: Schema.Literals(["explicit", "jev", "fallback"]),
  confidence: Schema.NullOr(Schema.Number),
  decisionId: Schema.NullOr(Schema.String),
  /** For "fallback": an ext-decide fallback reason, or "no-candidates" / "candidate-unavailable". */
  reason: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
});

export const RunMember = Schema.Struct({
  threadId: ThreadId,
  position: NonNegativeInt,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  workspace: RunWorkspace,
  depth: NonNegativeInt,
  routing: MemberRouting,
  createdAt: IsoDateTime,
});

/** A stored Jev ranking hint. Only answered rankings are stored; fallbacks are returned, not kept. */
export const RunRank = Schema.Struct({
  rubric: Schema.String,
  /** Member positions, best first, ordered by Jev's Choice probabilities. */
  order: Schema.Array(NonNegativeInt),
  probabilities: Schema.Array(
    Schema.Struct({ position: NonNegativeInt, probability: Schema.Number }),
  ),
  confidence: Schema.Number,
  decisionId: Schema.String,
  model: Schema.String, // the versioned Jev model that answered
  rankedAt: IsoDateTime,
});

export const Run = Schema.Struct({
  runId: RunId,
  projectId: ProjectId,
  kind: RunKind,
  title: TrimmedNonEmptyString,
  prompt: Schema.NullOr(Schema.String),
  originThreadId: Schema.NullOr(ThreadId),
  createdBy: Schema.Literals(["user", "agent"]),
  createdAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  /** Compare runs only; null for delegation runs. */
  compareMode: Schema.NullOr(CompareMode),
  rank: Schema.NullOr(RunRank),
  members: Schema.Array(RunMember),
});

export const StartCompareInput = Schema.Struct({
  projectId: ProjectId,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(RUN_PROMPT_MAX_CHARS)),
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  /**
   * "models": 2 to 6 members. "samples": exactly one member, started `samples` times.
   * Either way at most COMPARE_MAX_MEMBERS threads start.
   */
  members: Schema.Array(Schema.Struct({ modelSelection: ModelSelection })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COMPARE_MAX_MEMBERS),
  ),
  samples: Schema.optional(
    Schema.Int.check(
      Schema.isBetween({ minimum: COMPARE_MIN_MEMBERS, maximum: COMPARE_MAX_MEMBERS }),
    ),
  ),
  workspace: Schema.Literals(["worktree", "project-root"]),
  /** Worktrees start from this branch; defaults to the project root's current branch. */
  baseBranch: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export const StartCompareResult = Schema.Struct({
  run: Run,
  failures: Schema.Array(Schema.Struct({ position: NonNegativeInt, detail: Schema.String })),
});

export const RoutingCandidate = Schema.Struct({
  id: TrimmedNonEmptyString, // stable, generated by the client ("rc_" + 8 hex)
  modelSelection: Schema.Struct({ instanceId: ProviderInstanceId, model: TrimmedNonEmptyString }),
  /** Sent to Jev as the option's criteria. */
  description: TrimmedNonEmptyString.check(Schema.isMinLength(10), Schema.isMaxLength(300)),
  /** Effort option values Jev may pick for this model; empty = the model's default effort. */
  efforts: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(8)),
});

export const RunSettings = Schema.Struct({
  agentToolsEnabled: Schema.Boolean,
  maxActiveChildrenPerThread: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  maxDepth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
  routingCandidates: Schema.Array(RoutingCandidate).check(
    Schema.isMaxLength(ROUTING_MAX_CANDIDATES),
  ),
  rankRubric: TrimmedNonEmptyString.check(Schema.isMaxLength(RANK_RUBRIC_MAX_CHARS)),
});
export const DEFAULT_RANK_RUBRIC =
  "Does what the prompt asks, is correct, changes only what is needed, and says what is left open.";
export const DEFAULT_RUN_SETTINGS: typeof RunSettings.Type = {
  agentToolsEnabled: false,
  maxActiveChildrenPerThread: 4,
  maxDepth: 1,
  routingCandidates: [],
  rankRubric: DEFAULT_RANK_RUBRIC,
};

export class RunError extends Schema.TaggedError<RunError>()("LoomRunError", {
  reason: Schema.Literals([
    "project-not-found",
    "run-not-found",
    "provider-unavailable",
    "invalid-model",
    "invalid-request",
    "not-compare",
    "not-ready",
    "persistence",
  ]),
  detail: Schema.String,
}) {}

// list:        { projectId, includeArchived: boolean }  -> { runs: Run[] }   (newest first, cap 200)
// setArchived: { runId, archived: boolean }             -> { run: Run }
// remove:      { runId }                                -> { removed: boolean }  (grouping only)
// stopRun:     { runId }                                -> { interrupted: number } (thread.turn.interrupt per running member)
// rank:        { runId, rubric?: string (max 1,000) }   -> { run: Run, fallbackReason: string | null }
//              (compare runs only, every member stopped; rubric defaults to settings.rankRubric;
//               `clear: true` instead of a rubric removes the stored hint)
// getSettings: {}                                       -> RunSettings
// setSettings: RunSettings                              -> RunSettings
// Every error: Schema.Union([RunError, EnvironmentAuthorizationError]).
```

Check `Schema.isMinLength`, `Schema.isBetween` names against the Effect version in use;
`ProviderInstanceId` is in `packages/contracts/src/providerInstance.ts:82`.

Scopes (`packages/contracts/src/auth.ts:81-88`): `list` and `getSettings`
`AuthOrchestrationReadScope`; `startCompare`, `setArchived`, `remove`, `stopRun`, `rank`
(it sends excerpts to a third party) and `setSettings` `AuthOrchestrationOperateScope`, matching upstream, which gates
`serverUpdateSettings` with the operate scope (`apps/server/src/auth/RpcAuthorization.ts:51-52`).

## Storage

Migration set slug `multi-thread-runs` (tracking table `fork_migrations_multi_thread_runs`),
id 1 `Runs`:

```sql
CREATE TABLE IF NOT EXISTS fork_multi_thread_runs_runs (
  run_id            TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('compare', 'delegation')),
  title             TEXT NOT NULL,
  prompt            TEXT,
  origin_thread_id  TEXT,
  created_by        TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
  created_at        TEXT NOT NULL,
  archived_at       TEXT,
  compare_mode      TEXT CHECK (compare_mode IN ('models', 'samples')),
  rank_json         TEXT               -- RunRank, null until ranked
);
CREATE INDEX IF NOT EXISTS fork_multi_thread_runs_runs_project
  ON fork_multi_thread_runs_runs (project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS fork_multi_thread_runs_runs_origin
  ON fork_multi_thread_runs_runs (origin_thread_id) WHERE kind = 'delegation';

CREATE TABLE IF NOT EXISTS fork_multi_thread_runs_members (
  run_id                TEXT NOT NULL,
  thread_id             TEXT NOT NULL,
  position              INTEGER NOT NULL,
  provider_instance_id  TEXT NOT NULL,
  model                 TEXT NOT NULL,
  workspace             TEXT NOT NULL CHECK (workspace IN ('worktree', 'project-root', 'origin')),
  depth                 INTEGER NOT NULL DEFAULT 0,
  routing_json          TEXT NOT NULL,    -- MemberRouting
  created_at            TEXT NOT NULL,
  PRIMARY KEY (run_id, thread_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fork_multi_thread_runs_members_thread
  ON fork_multi_thread_runs_members (thread_id);

CREATE TABLE IF NOT EXISTS fork_multi_thread_runs_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

- Settings live in a fork table, never in upstream `ServerSettings` (EXTENSION-POINTS.md,
  Persistence). A missing row means `DEFAULT_RUN_SETTINGS`; decode failures also fall back to
  the defaults and log. Missing keys in a stored value (for example `routingCandidates` in a
  value written before them) take their defaults.
- Jev decisions themselves are logged by `ext-decide` in `fork_decide_decisions`; the run tables keep
  only the decision id, confidence and the outcome.
- `depth` is 0 for compare members and `parentDepth + 1` for delegated children, where
  `parentDepth` is the calling thread's own member depth (0 when the caller is not a member).
- Cleanup: `thread.deleted` deletes the member row, then the run if it has no members left;
  `project.deleted` deletes the project's runs and members; a startup sweep removes members
  whose thread is gone.

## Server (`apps/server/src/fork/multi-thread-runs/`)

| File                | Contents                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `migrations.ts`     | `MultiThreadRunsMigrations`.                                                               |
| `RunStore.ts`       | Repository: runs, members, settings.                                                       |
| `ThreadStarter.ts`  | `startThread(input)` below.                                                                |
| `RunService.ts`     | RPC logic, delegation logic for the tools, `describeThread` for `get_thread`.              |
| `decide.ts`         | The two `DecideFeature`s, routing options and question, ranking state and question.        |
| `lineage.ts`        | Optional L02 integration (write a `delegate` row when `fork_thread_lineage_links` exists). |
| `cleanupReactor.ts` | Deletions, with `forkParked`.                                                              |
| `rpc.ts`            | `makeMultiThreadRunsRpcHandlers(auth)`.                                                    |
| `mcp.ts`            | Toolkit and handlers.                                                                      |

`RunStore`, `ThreadStarter` and `RunService` join `ForkServices` and `ForkServicesLive`;
`"multi-thread-runs"` joins `LOOM_SERVER_FEATURES`; `MultiThreadRunsToolkitRegistrationLive`
joins `ForkMcpToolkitsLive`; the two features in `decide.ts` join `FORK_DECIDE_FEATURES`
(`apps/server/src/fork/decide/registry.ts`). `RunService` depends on `LoomDecide` (from `ext-decide`) and `CheckpointDiffQuery`.

### `ThreadStarter.startThread`

```ts
export interface StartThreadInput {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly prompt: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspace:
    | { readonly kind: "project-root" }
    | {
        readonly kind: "worktree";
        readonly baseBranch: string | null;
        readonly branch: string | null;
      }
    | {
        readonly kind: "origin";
        readonly branch: string | null;
        readonly worktreePath: string | null;
      };
}
export interface StartedThread {
  readonly threadId: ThreadId;
  readonly branch: string | null;
  readonly worktreePath: string | null;
}
```

1. Validate the project (`getProjectShellById`) and the provider instance
   (`ProviderRegistry.getProviders`: exists, `enabled`, available, `status === "ready"`; the
   model is one of `models[].slug`, else `invalid-model`).
2. Workspace:
   - `project-root`: `branch: null, worktreePath: null`.
   - `origin`: the caller's branch and worktree path (delegation with `worktree: false`).
   - `worktree`: `GitWorkflowService.createWorktree({ cwd: project.workspaceRoot, refName:
baseBranch ?? currentBranch, newRefName: branch ?? buildTemporaryWorktreeBranchName(randomHex),
baseRefName: baseBranch ?? undefined, path: null })` (`GitWorkflowService.ts:70-73`;
     input `VcsCreateWorktreeInput`, `packages/contracts/src/git.ts:140-147`). The current
     branch comes from `localStatus({ cwd: project.workspaceRoot }).refName`.
3. `thread.create` with the project, title, model selection, modes, branch and worktree path.
4. For a new worktree: `ProjectSetupScriptRunner.runForThread({ threadId, projectId,
projectCwd, worktreePath })` if the project has a setup script; a failure is logged and
   reported in the result, and the thread still starts (upstream records setup failures the
   same way rather than aborting). Confirm the service is available to `ForkLayer`; if it is
   provided above `ForkLayer`, skip setup scripts and document the gap.
5. `thread.turn.start` with `message: { messageId, role: "user", text: prompt, attachments: [] }`,
   `modelSelection`, `titleSeed` (only when no explicit title), modes, `createdAt`.
6. On a failure after step 3, dispatch `thread.delete` for the thread. A created worktree is
   left in place (upstream's thread deletion flow owns worktree cleanup UI).

Member titles for compare: `<title> (<instance display name> <model>)`; for samples
`<title> (<instance display name> <model>, run <k> of <n>)`; truncated to 200.
Members start concurrently with a concurrency of 3 (worktree creation is I/O bound and git
locks the repository briefly); each member's failure is collected, not fatal to the others.

### Delegation (MCP)

```ts
const StartThreadTool = Tool.make("loom_multi_thread_runs_start_thread", {
  description:
    "Start a new T3 Code thread in this project to work on a task in parallel, optionally with another provider or model, in its own git worktree unless worktree is false (read-only jobs only). Returns the thread id. Use loom_multi_thread_runs_get_thread to check on it.",
  parameters: Schema.Struct({
    prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(RUN_PROMPT_MAX_CHARS)).annotate({
      description: "The full task for the new thread. It sees nothing of your conversation.",
    }),
    title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
    providerInstanceId: Schema.optional(
      TrimmedNonEmptyString.annotate({
        description:
          "Provider instance id, for example codex or claude. Omit with model to use yours (or Loom's routing).",
      }),
    ),
    model: Schema.optional(TrimmedNonEmptyString),
    worktree: Schema.optional(
      Schema.Boolean.annotate({
        description:
          "Default true: a new git worktree. false: your workspace, for read-only jobs (research, review) only.",
      }),
    ),
    baseBranch: Schema.optional(TrimmedNonEmptyString),
    plan: Schema.optional(Schema.Boolean.annotate({ description: "Start in plan mode." })),
  }),
  success: StartThreadToolResult, // { threadId, title, providerInstanceId, model, effort, routedBy, routingNote, branch, worktreePath, runId }
  failure: RunToolError, // tagged, reasons below
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Start a thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const GetThreadTool = Tool.make("loom_multi_thread_runs_get_thread", {
  description:
    "Read the status, last reply and changed files of a thread you started with loom_multi_thread_runs_start_thread. Pass waitSeconds to wait until it stops working.",
  parameters: Schema.Struct({
    threadId: TrimmedNonEmptyString,
    waitSeconds: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 120 }))),
  }),
  success: GetThreadToolResult,
  failure: RunToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Read a started thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const MultiThreadRunsToolkit = Toolkit.make(StartThreadTool, GetThreadTool);
```

`RunToolError` reasons: `disabled`, `limit-reached`, `depth-exceeded`,
`provider-unavailable`, `invalid-model`, `not-your-thread`, `thread-not-found`,
`workspace-failed`, `start-failed`. Each carries a human sentence (PRODUCT.md copy).

`start_thread` handler (through `withForkRuntime`):

1. Read `McpInvocationContext` (the caller's `threadId`, `providerInstanceId`).
2. Settings: `agentToolsEnabled` else `disabled`.
3. Caller shell (`getThreadShellById`); caller depth from its member row (0 if none); if
   `callerDepth + 1 > maxDepth`, `depth-exceeded`.
4. Active children: members of the caller's delegation run whose shells have a session
   `starting` or `running`, or pending requests; if `>= maxActiveChildrenPerThread`,
   `limit-reached`.
5. Model selection:
   - The agent named a provider or model: `providerInstanceId ?? caller.modelSelection.instanceId`;
     `model ?? (same instance ? caller.modelSelection.model : default model of the instance)`
     (the model with `isDefault`, else the first); options (effort) copied from the caller
     when the instance and model match, else none. `routing.by = "explicit"`.
   - The agent named neither: Jev routing (below). On any fallback the child gets the
     caller's full `modelSelection` (instance, model and options, so the same effort), which
     was the behavior before Jev. `routing.by = "jev"` or `"fallback"`.
6. Runtime mode: the caller thread's `runtimeMode` (never more permissive). Interaction mode:
   `plan ? "plan" : "default"`.
7. Workspace: `worktree !== false` (the default) gives `{ kind: "worktree", baseBranch:
baseBranch ?? caller.branch, branch: null }`; otherwise `{ kind: "origin", ...caller }`, and
   the prompt sent to the child starts with the line
   `You share this workspace with another agent thread. Read and report only; do not edit files.`
   followed by a blank line and the agent's prompt. Loom does not enforce read-only (runtime
   modes cannot express it); the note and the tool description are the guard, and the
   default stays a new worktree.
8. Upsert the caller's delegation run (title `Delegated by <caller title>`,
   `origin_thread_id = caller`, `created_by = 'agent'`), start the thread with
   `ThreadStarter`, insert the member with `depth = callerDepth + 1`.
9. The tool result carries `effort` (the chosen effort value or null), `routedBy`
   (`explicit`, `jev` or `fallback`) and, for a fallback, `routingNote`, one line such as
   "Jev routing is not allowed for agents; used your model." (section 18: the tool reports a
   Jev refusal in one line), so the calling agent knows what it got.
10. Optional lineage row (`lineage.ts`): `INSERT OR IGNORE INTO fork_thread_lineage_links
(child_thread_id, parent_thread_id, project_id, kind, context_mode, through_message_id,
carried_message_count, created_by, created_at) VALUES (?, ?, ?, 'delegate', 'none', NULL,
0, 'agent', ?)` only when `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name =
'fork_thread_lineage_links'` returns a row. The column list matches L02's TECHNICAL.md;
    failures are logged and ignored.

`get_thread` handler:

1. Settings enabled (else `disabled`), and the thread is a member of the caller's delegation
   run (else `not-your-thread`), so agents cannot read arbitrary threads.
2. If `waitSeconds > 0` and the shell's session is `starting` or `running`: subscribe with
   `engine.subscribeDomainEvents` (`OrchestrationEngine.ts:89-93`, subscribed before the
   check to avoid a race), wait for a `thread.session-set` event for that thread whose status
   is not `starting`/`running`, or for a `thread.activity-appended` that opens an approval or
   question, with `Effect.timeout(waitSeconds)`. A timeout is not an error: return the current
   status.
3. Build the result:

```ts
const GetThreadToolResult = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  status: Schema.Literals([
    "starting",
    "working",
    "needs-approval",
    "needs-input",
    "completed",
    "interrupted",
    "error",
    "idle",
  ]),
  error: Schema.NullOr(Schema.String),
  providerInstanceId: Schema.String,
  model: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  lastAssistantMessage: Schema.NullOr(
    Schema.Struct({ text: Schema.String, truncated: Schema.Boolean }),
  ),
  changes: Schema.NullOr(
    Schema.Struct({
      files: NonNegativeInt,
      insertions: NonNegativeInt,
      deletions: NonNegativeInt,
      topFiles: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          insertions: NonNegativeInt,
          deletions: NonNegativeInt,
        }),
      ),
    }),
  ),
  updatedAt: IsoDateTime,
});
```

- Status: pending approval or input from shell flags first; then session `starting` or
  `running` gives `starting` / `working`; then `latestTurn.state` (`completed`,
  `interrupted`, `error`); otherwise `idle`. `error` is `session.lastError`.
- Last assistant message: `latestTurn.assistantMessageId` looked up in
  `getThreadDetailById(threadId).messages`, falling back to the last assistant message; text
  capped at 8,000 characters (tail kept, `truncated: true`).
- Changes: `GitWorkflowService.localStatus({ cwd: worktreePath ?? project.workspaceRoot })`
  when the thread has its own worktree; for `project-root` and `origin` members, the last
  checkpoint's files instead (the working tree is shared). Top files: five by size of change.

### Jev routing for delegated threads (`multi-thread-runs.delegate-routing`)

Feature registration (`apps/server/src/fork/multi-thread-runs/decide.ts`, appended to
`FORK_DECIDE_FEATURES`, EXTENSION-POINTS.md section 18):

```ts
import type { DecideFeature } from "../decide/registry.ts";

export const DELEGATE_ROUTING_FEATURE: DecideFeature = {
  id: "multi-thread-runs.delegate-routing",
  packet: "L08",
  label: "Delegated thread routing",
  description:
    "Picks the model and reasoning effort for a thread an agent delegates without naming a model; without Jev the child uses the caller's model and effort.",
  defaultMode: "manual",
  defaultThreshold: 0.5,
  // agentTool defaults to true: loom_multi_thread_runs_start_thread reaches this feature.
};
```

Routing is triggered by an agent's tool call and its state is agent-written text, so it runs
with `origin: "agent"`. Section 18's modes gate it without any extra check here: `decide`
returns `disabled` when "Use Jev" is off (globally or for the feature, mode `off`) and
`agent-not-allowed` when the mode is `manual` ("Let agents use this" off, the default); only
`manual-agents` lets it run. Both are ordinary fallbacks. `start_thread` adds no second gate
and still starts the child.

Steps, inside `start_thread` step 5 when the agent named neither provider nor model:

1. Options, built in code from `settings.routingCandidates`: drop candidates whose instance
   is not ready or whose model is not in the instance's `models[]`
   (`ProviderRegistry.getProviders`). For each remaining candidate, find the model's effort
   descriptor (a `select` descriptor with id `reasoningEffort` or `effort`); for each allowed
   effort that is one of the descriptor's choice ids, add option key `c<i>.<effort>`; a
   candidate with no efforts (or a model without an effort descriptor) adds `c<i>`. Keys are
   opaque; the criteria carry the meaning. At most 12 x 8 options, far under Jev's 255.
2. Fewer than two options: fallback with reason `no-candidates`, no Jev call.
3. State (built in code; `task` capped at 6,000 estimated tokens with `estimateTokens`
   from `apps/server/src/fork/decide/budget.ts`, head kept; `decide` itself runs
   `redactState` and `fitBudget` on what it sends):

   ```ts
   {
     task: string,              // the prompt the agent passed (before the shared-workspace note)
     plan_mode: boolean,
     workspace: "new worktree" | "shared workspace, read-only",
   }
   ```

   No caller model, thread history or file contents: less unrelated state, better answers
   (https://docs.typesafe.ai/model-jaggedness/jev-1.13).

4. Question (one Choice):

   ```ts
   {
     route: {
       type: "choice",
       instructions: "Which option should handle the task in `task`? Pick the option whose description fits the task best.",
       criteria: Object.fromEntries(options.map((o) => [o.key, o.criteria])),
     },
   }
   ```

   `o.criteria` is `candidate.description`, plus for effort options the sentence
   `Reasoning effort: <choice label>. <choice description>` taken from the model's effort
   descriptor (`ProviderOptionChoice.label` and `description`,
   `packages/contracts/src/model.ts:10-15`).

5. `LoomDecide.decide("multi-thread-runs.delegate-routing", { state, questions }, { origin:
"agent", threadId: caller.threadId, projectId })`, with no `threshold`: `decide` applies the
   feature's configured threshold (else `defaultThreshold` 0.5) itself, so `answered` is
   already confident and is used as is. `answered` maps `answers.route.choice` back to
   `{ instanceId, model, options: effort ? [{ id: effortDescriptorId, value: effort }] : undefined }`
   and records `routing = { by: "jev", confidence: answers.route.confidence, decisionId, effort }`.
   Every `fallback` (including `low-confidence`, whose answers are ignored) records
   `{ by: "fallback", reason, decisionId: decisionId ?? null }` and uses the caller's
   selection.
6. The chosen selection is validated again by `ThreadStarter` (ready instance, known model);
   a failure there is a fallback with reason `candidate-unavailable`, never a failed tool
   call.

Latency: `start_thread` waits for Jev at most `ext-decide`'s timeout (1 s by default).

### Jev ranking hint for compare runs (`multi-thread-runs.compare-rank`)

```ts
export const COMPARE_RANK_FEATURE: DecideFeature = {
  id: "multi-thread-runs.compare-rank",
  packet: "L08",
  label: "Compare ranking hint",
  description:
    "Suggests which compare member best meets a rubric, from excerpts of each result; without Jev no hint is shown.",
  defaultMode: "manual",
  defaultThreshold: 0.5,
  agentTool: false,
};
```

User-started only (`origin: "user"`). No MCP tool reaches it, so it is registered with
`agentTool: false`: its modes are `off` and `manual`, and the Jev settings section hides
"Let agents use this" for it.

`rank({ runId, rubric })`:

1. The run must be `kind = 'compare'` (else `not-compare`) and every member's shell must have
   no session `starting` or `running` and no pending approval or input (else `not-ready`
   with "Waiting for N members to finish").
2. Per member, labeled `A` to `F` by position (provider and model names are never sent, so
   Jev cannot favor a brand):
   - `status`: `completed`, `interrupted` or `error` (from `describeThread`);
   - `final_reply`: the last assistant message (as in `get_thread`), trimmed to the member's
     reply share;
   - `diff_excerpt`: `.text` of `diffExcerpt(diff, { maxTokens })`
     (`apps/server/src/fork/decide/diffExcerpt.ts`), where `diff` is
     `CheckpointDiffQuery.getFullThreadDiff({ threadId, toTurnCount: latestCheckpointTurnCount })`;
     `.env*` files are already reduced to their header there;
   - `changed_files`: up to 20 `path`s from that call's `files`, in diff order;
   - a member with no checkpoint gets `null` for both.
3. Budget: 28,000 tokens of state in total (under Jev's 32k for state plus the longest
   question), `prompt` and `rubric` first, then an equal share per member, one third of each
   share for `final_reply` (capped with `estimateTokens`) and the rest as `diffExcerpt`'s
   `maxTokens`. `decide` then runs `redactState` and `fitBudget` on the whole state, as it
   does for every request.
4. Question (one Choice; the implied order comes from its probabilities, so no counting or
   arithmetic is asked of Jev):

   ```ts
   {
     best: {
       type: "choice",
       instructions: "Which result in `results` best meets `rubric` for the task in `prompt`?",
       criteria: Object.fromEntries(labels.map((l) => [l, `The result in \`results.${l}\``])),
     },
   }
   ```

5. `LoomDecide.decide("multi-thread-runs.compare-rank", { state, questions }, { origin:
"user", projectId, timeoutMs: 5_000 })`: user-started work with a larger state, so it uses
   the per-call timeout section 18 allows; no `threshold` (the feature's configured one, else
   0.5, applies inside `decide`). `answered`: store `RunRank` (order = positions sorted by
   `answers.best.probabilities`, descending; ties keep position order; `confidence` from
   `answers.best.confidence`) in `rank_json` and return it with `fallbackReason: null`.
   `fallback`: keep any previous hint unchanged and return the reason (`low-confidence`, whose
   answers are not shown, reads "Jev had no clear pick for this rubric.").
6. `rank({ runId, clear: true })` sets `rank_json` to null.

The client shows "Results changed since this hint." when any member's shell `updatedAt` is
later than `rankedAt`.

### RPC handlers

`startCompare` resolves defaults, creates the run (`created_by = 'user'`, `compare_mode` from
the input), starts members with `ThreadStarter` (concurrency 3), inserts member rows for
successes (`routing.by = "explicit"`), and returns the run plus failures. With `samples` set,
exactly one member is allowed (else `invalid-request`) and it is started `samples` times;
without it, 2 to 6 members are required. If every member failed, the run is deleted and the
call fails with the first reason. `stopRun` dispatches `thread.turn.interrupt`
(`orchestration.ts:1280-1286`) for members whose session is running. `rank` is described
above.

## Clients

### Shared atoms (`packages/client-runtime/src/fork/multi-thread-runs.ts`)

`createMultiThreadRunsAtoms(runtime)`: query families `list` (`staleTimeMs: 5_000`) and
`getSettings`; commands `startCompare`, `setArchived`, `remove`, `stopRun`, `rank`,
`setSettings`, each refreshing `list` (or `getSettings`) for the environment on success.

### Web (`apps/web/src/fork/multi-thread-runs/`)

| File                       | Purpose                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.ts`                 | Atom instances; capability check.                                                                                                                                                                                                                                   |
| `runView.ts` (+ test)      | Pure: aggregate run status from member shells, filters (status, provider, text), sort, member title formatting.                                                                                                                                                     |
| `RunsPanel.tsx`            | Panel `multi-thread-runs` for the current thread's project.                                                                                                                                                                                                         |
| `CompareDialog.tsx`        | The dialog with its two modes ("Different models", "Same model, several times"); provider and model options from `deriveProviderInstanceEntries` (`apps/web/src/providerInstances.ts:94`) filtered by `isProviderInstancePickerReady` (78), models from each entry. |
| `RankHint.tsx`             | "Rank with Jev" button, rubric dialog, result line, stale note, "Re-rank" and "Clear hint". Rendered only when `useDecideFeature(env, "multi-thread-runs.compare-rank").usable`.                                                                                    |
| `RoutingSettings.tsx`      | Routing candidates editor (provider and model, description, allowed efforts from the model's effort descriptor) and the default rubric, inside the settings section; shown only with `decide`.                                                                      |
| `CompareDialogHost.tsx`    | `ForkRoot` component: dialog store, `onForkCommand` for both commands.                                                                                                                                                                                              |
| `RunsSettings.tsx`         | `ForkSettingsSection` "Multi-thread runs": toggle and two number inputs, scope-gated (reads the selected environment like upstream's General page, `apps/web/src/components/settings/useScopedSettings.ts:30`).                                                     |
| `panel.tsx`, `palette.tsx` | Registrations.                                                                                                                                                                                                                                                      |

Runs panel details:

- `list({ projectId, includeArchived })` for the active thread's project; member status from
  `useThreadShells()` (`apps/web/src/state/entities.ts:77`) joined by thread id, with
  `resolveThreadStatusPill` (`apps/web/src/components/Sidebar.logic.ts:985`) and
  `ThreadStatusLabel` (`apps/web/src/components/ThreadStatusIndicators.tsx:426`).
- Aggregate status: any member needing approval or input gives "Needs you"; else any working
  gives "Working"; else any error gives "Error"; else "Done".
- Delegated member rows show how the model was chosen from `member.routing`: "Picked by Jev
  (confidence 0.74)", "Caller's model: <reason in words>", or "Chosen by the agent".
- Compare runs show the ranking hint under the run header when `run.rank` is set; the best
  member's row gets a "Jev pick" marker. Nothing reorders the member list.
- Jev UI state comes from `useDecideFeature(environmentId, featureId)`
  (`apps/web/src/fork/decide/state.ts`, EXTENSION-POINTS.md section 18), which returns
  `{ supported, mode, usable, agentsAllowed, feature }` and sends no `loom.decide.*` request
  to a server without the `decide` capability:
  - "Rank with Jev" renders only when `useDecideFeature(env, "multi-thread-runs.compare-rank").usable`.
  - The routing candidates editor renders when
    `useDecideFeature(env, "multi-thread-runs.delegate-routing").supported`; when that state's
    `agentsAllowed` is false it shows "Jev routing runs only when "Let agents use this" is on
    for Delegated thread routing (Loom settings, Jev)."
  - Routing labels on member rows come from stored `member.routing` and need no check.
- Refetch `list` when the number of shells in the project changes (covers runs started on
  another client or by agents) and when the panel becomes visible.
- Member actions: Open (navigate), Stop (`threadEnvironment.interruptTurn`), Open side by
  side only when `findForkPanel("thread-lineage:thread") !== null` (registry from
  `ext-panels`), using `openSurface(ref, forkPanelSurface("thread-lineage:thread", threadId))`.
- Rendering: runs collapsed by default except the newest; at most 200 runs; no
  virtualization needed at that size.

Registrations: panel `{ id: "multi-thread-runs", title: "Runs", icon: LayersIcon, shortcut:
"N" }`; palette values `action:loom:multi-thread-runs:compare` and `...:runs`; keybinding
commands `loom.multi-thread-runs.compare` and `loom.multi-thread-runs.runs`; settings section
`{ id: "multi-thread-runs", title: "Multi-thread runs", Component: RunsSettings }`.

## Agent-facing tools

Two, described above. Jev routing adds no tool: it runs inside `start_thread`, and the
ranking hint is user-only. They are listed to every agent session on the environment, whether
or not delegation is enabled (tool lists are not filtered per credential,
`McpInvocationContext.ts:47-55` checks per call), so descriptions are short and the disabled
error explains how to enable. Why agents need them: cross-provider delegation and parallel
exploration without Kyle as the relay.

## Performance

- The panel subscribes to nothing new: member status comes from shells the sidebar already
  holds. `list` is a small unary call (at most 200 runs with their members).
- `get_thread` with `waitSeconds` holds one domain event subscription per waiting call,
  bounded by active children and 120 s; it filters by thread id before any work.
- Compare starts at most six threads with concurrency 3, in both modes.
- Jev: at most one call per `start_thread` without a named model (bounded by `ext-decide`'s
  1 s timeout) and one per user "Rank with Jev" click. Ranking reads each member's diff once
  per click, capped before it is sent.
- No continuous animation; status dots use upstream's static indicators.

## Alternatives considered

- **Client-side compare through `thread.turn.start` with `bootstrap`** (how the web starts
  worktree threads, `apps/web/src/components/ChatView.tsx:7918-7938`). Would get upstream's
  worktree progress card for free, but needs client orchestration of partial failures and a
  second code path for the MCP tools. Server-side keeps one path; the trade-off is no setup
  progress card for run members (the setup script still runs).
- **Old Loom's orchestration toolkit** (`OrchestratorMcpService`, 1,414 lines: start, send,
  list, read, wait, transfer, interrupt, delegate task). Rejected by Kyle's decision: two
  tools.
- **Old Loom's Swarm scheduler** (DAGs, leases, budgets, retries, recipes). Rejected: runs
  are a grouping, not a scheduler.
- **A separate MCP server for fork tools.** Every adapter would need a second server entry
  (six adapter seams); `ext-mcp` registers on the existing one.
- **Storing runs as thread metadata.** No generic metadata exists on threads, and new events
  are forbidden (EXTENSION-POINTS.md, Orchestration).
- **Jev Score per member for ranking.** One Score per member would add N questions and a
  confidence per score to reconcile; one Choice gives the pick, its confidence and an order
  from its probabilities.
- **Enforcing read-only for `worktree: false`.** No runtime mode means "no edits"; the
  approval-required mode would bury Kyle in approvals. The default worktree, the tool
  description and the prompt note are enough for v1.
