# L08 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## Overview

```
 Web: Compare dialog, Runs panel, settings section, palette
   | loom.multi-thread-runs.{startCompare,list,setArchived,remove,stopRun,getSettings,setSettings}
   v
 RunService (ForkLayer) ----------------------------.
   |                                                |
   v                                                v
 ThreadStarter (ForkLayer)                     RunStore (fork_multi_thread_runs_*)
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

## Contracts (`packages/contracts/src/fork/multi-thread-runs.ts`)

```ts
export const MULTI_THREAD_RUNS_WS_METHODS = {
  startCompare: "loom.multi-thread-runs.startCompare",
  list: "loom.multi-thread-runs.list",
  setArchived: "loom.multi-thread-runs.setArchived",
  remove: "loom.multi-thread-runs.remove",
  stopRun: "loom.multi-thread-runs.stopRun",
  getSettings: "loom.multi-thread-runs.getSettings",
  setSettings: "loom.multi-thread-runs.setSettings",
} as const;

export const RunId = TrimmedNonEmptyString.pipe(Schema.brand("LoomRunId"));
export const RunKind = Schema.Literals(["compare", "delegation"]);
export const RunWorkspace = Schema.Literals(["worktree", "project-root", "origin"]);
export const RUN_PROMPT_MAX_CHARS = 20_000;
export const COMPARE_MIN_MEMBERS = 2;
export const COMPARE_MAX_MEMBERS = 6;

export const RunMember = Schema.Struct({
  threadId: ThreadId,
  position: NonNegativeInt,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  workspace: RunWorkspace,
  depth: NonNegativeInt,
  createdAt: IsoDateTime,
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
  members: Schema.Array(RunMember),
});

export const StartCompareInput = Schema.Struct({
  projectId: ProjectId,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(RUN_PROMPT_MAX_CHARS)),
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  members: Schema.Array(Schema.Struct({ modelSelection: ModelSelection })).check(
    Schema.isMinLength(COMPARE_MIN_MEMBERS),
    Schema.isMaxLength(COMPARE_MAX_MEMBERS),
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

export const RunSettings = Schema.Struct({
  agentToolsEnabled: Schema.Boolean,
  maxActiveChildrenPerThread: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  maxDepth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
});
export const DEFAULT_RUN_SETTINGS: typeof RunSettings.Type = {
  agentToolsEnabled: false,
  maxActiveChildrenPerThread: 4,
  maxDepth: 1,
};

export class RunError extends Schema.TaggedError<RunError>()("LoomRunError", {
  reason: Schema.Literals([
    "project-not-found",
    "run-not-found",
    "provider-unavailable",
    "invalid-model",
    "persistence",
  ]),
  detail: Schema.String,
}) {}

// list:        { projectId, includeArchived: boolean }  -> { runs: Run[] }   (newest first, cap 200)
// setArchived: { runId, archived: boolean }             -> { run: Run }
// remove:      { runId }                                -> { removed: boolean }  (grouping only)
// stopRun:     { runId }                                -> { interrupted: number } (thread.turn.interrupt per running member)
// getSettings: {}                                       -> RunSettings
// setSettings: RunSettings                              -> RunSettings
// Every error: Schema.Union([RunError, EnvironmentAuthorizationError]).
```

Check `Schema.isMinLength`, `Schema.isBetween` names against the Effect version in use;
`ProviderInstanceId` is in `packages/contracts/src/providerInstance.ts:82`.

Scopes (`packages/contracts/src/auth.ts:81-88`): `list` and `getSettings`
`AuthOrchestrationReadScope`; `startCompare`, `setArchived`, `remove`, `stopRun` and
`setSettings` `AuthOrchestrationOperateScope`, matching upstream, which gates
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
  archived_at       TEXT
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
  the defaults and log.
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
| `lineage.ts`        | Optional L02 integration (write a `delegate` row when `fork_thread_lineage_links` exists). |
| `cleanupReactor.ts` | Deletions, with `forkParked`.                                                              |
| `rpc.ts`            | `makeMultiThreadRunsRpcHandlers(auth)`.                                                    |
| `mcp.ts`            | Toolkit and handlers.                                                                      |

`RunStore`, `ThreadStarter` and `RunService` join `ForkServices` and `ForkServicesLive`;
`"multi-thread-runs"` joins `LOOM_SERVER_FEATURES`; `MultiThreadRunsToolkitRegistrationLive`
joins `ForkMcpToolkitsLive`.

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

Member titles for compare: `<title> (<instance display name> <model>)`, truncated to 200.
Members start concurrently with a concurrency of 3 (worktree creation is I/O bound and git
locks the repository briefly); each member's failure is collected, not fatal to the others.

### Delegation (MCP)

```ts
const StartThreadTool = Tool.make("loom_multi_thread_runs_start_thread", {
  description:
    "Start a new T3 Code thread in this project to work on a task in parallel, optionally with another provider or model, usually in its own git worktree. Returns the thread id. Use loom_multi_thread_runs_get_thread to check on it.",
  parameters: Schema.Struct({
    prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(RUN_PROMPT_MAX_CHARS)).annotate({
      description: "The full task for the new thread. It sees nothing of your conversation.",
    }),
    title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
    providerInstanceId: Schema.optional(
      TrimmedNonEmptyString.annotate({
        description: "Provider instance id, for example codex or claude. Defaults to yours.",
      }),
    ),
    model: Schema.optional(TrimmedNonEmptyString),
    worktree: Schema.optional(
      Schema.Boolean.annotate({
        description: "Default true: work in a new git worktree so edits do not collide with yours.",
      }),
    ),
    baseBranch: Schema.optional(TrimmedNonEmptyString),
    plan: Schema.optional(Schema.Boolean.annotate({ description: "Start in plan mode." })),
  }),
  success: StartThreadToolResult, // { threadId, title, providerInstanceId, model, branch, worktreePath, runId }
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
5. Model selection: `providerInstanceId ?? caller.modelSelection.instanceId`; `model ??
(same instance ? caller.modelSelection.model : default model of the instance)` (the model
   with `isDefault`, else the first).
6. Runtime mode: the caller thread's `runtimeMode` (never more permissive). Interaction mode:
   `plan ? "plan" : "default"`.
7. Workspace: `worktree !== false` gives `{ kind: "worktree", baseBranch: baseBranch ??
caller.branch, branch: null }`; otherwise `{ kind: "origin", ...caller }`.
8. Upsert the caller's delegation run (title `Delegated by <caller title>`,
   `origin_thread_id = caller`, `created_by = 'agent'`), start the thread with
   `ThreadStarter`, insert the member with `depth = callerDepth + 1`.
9. Optional lineage row (`lineage.ts`): `INSERT OR IGNORE INTO fork_thread_lineage_links
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

### RPC handlers

`startCompare` resolves defaults, creates the run (`created_by = 'user'`), starts members
with `ThreadStarter` (concurrency 3), inserts member rows for successes, and returns the run
plus failures. If every member failed, the run is deleted and the call fails with the first
reason. `stopRun` dispatches `thread.turn.interrupt` (`orchestration.ts:1280-1286`) for
members whose session is running.

## Clients

### Shared atoms (`packages/client-runtime/src/fork/multi-thread-runs.ts`)

`createMultiThreadRunsAtoms(runtime)`: query families `list` (`staleTimeMs: 5_000`) and
`getSettings`; commands `startCompare`, `setArchived`, `remove`, `stopRun`, `setSettings`,
each refreshing `list` (or `getSettings`) for the environment on success.

### Web (`apps/web/src/fork/multi-thread-runs/`)

| File                       | Purpose                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.ts`                 | Atom instances; capability check.                                                                                                                                                                               |
| `runView.ts` (+ test)      | Pure: aggregate run status from member shells, filters (status, provider, text), sort, member title formatting.                                                                                                 |
| `RunsPanel.tsx`            | Panel `multi-thread-runs` for the current thread's project.                                                                                                                                                     |
| `CompareDialog.tsx`        | The dialog; provider and model options from `deriveProviderInstanceEntries` (`apps/web/src/providerInstances.ts:94`) filtered by `isProviderInstancePickerReady` (78), models from each entry.                  |
| `CompareDialogHost.tsx`    | `ForkRoot` component: dialog store, `onForkCommand` for both commands.                                                                                                                                          |
| `RunsSettings.tsx`         | `ForkSettingsSection` "Multi-thread runs": toggle and two number inputs, scope-gated (reads the selected environment like upstream's General page, `apps/web/src/components/settings/useScopedSettings.ts:30`). |
| `panel.tsx`, `palette.tsx` | Registrations.                                                                                                                                                                                                  |

Runs panel details:

- `list({ projectId, includeArchived })` for the active thread's project; member status from
  `useThreadShells()` (`apps/web/src/state/entities.ts:77`) joined by thread id, with
  `resolveThreadStatusPill` (`apps/web/src/components/Sidebar.logic.ts:985`) and
  `ThreadStatusLabel` (`apps/web/src/components/ThreadStatusIndicators.tsx:426`).
- Aggregate status: any member needing approval or input gives "Needs you"; else any working
  gives "Working"; else any error gives "Error"; else "Done".
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

Two, described above. They are listed to every agent session on the environment, whether
or not delegation is enabled (tool lists are not filtered per credential,
`McpInvocationContext.ts:47-55` checks per call), so descriptions are short and the disabled
error explains how to enable. Why agents need them: cross-provider delegation and parallel
exploration without Kyle as the relay.

## Performance

- The panel subscribes to nothing new: member status comes from shells the sidebar already
  holds. `list` is a small unary call (at most 200 runs with their members).
- `get_thread` with `waitSeconds` holds one domain event subscription per waiting call,
  bounded by active children and 120 s; it filters by thread id before any work.
- Compare starts at most six threads with concurrency 3.
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
