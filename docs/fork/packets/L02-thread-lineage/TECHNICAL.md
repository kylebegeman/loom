# L02 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## Overview

```
 Web (message button, palette, Related panel, thread pane, fork dialog)
   |  loom.thread-lineage.preview / fork / listForThread / listForProject / unlink  (fork RPC)
   v
 ThreadLineageService (ForkLayer)
   |- reads source thread        ProjectionSnapshotQuery.getThreadDetailById
   |- optional worktree          GitWorkflowService.createWorktree
   |- phase 2 native fork        Claude history worker / Codex app-server, then
   |                             ProviderSessionDirectory.upsert(child binding)
   |- dispatches existing cmds   thread.create -> thread.history.import
   |                             -> thread.turn.start (message.context = transcript records)
   '- writes lineage row         fork_thread_lineage_links
 ThreadLineageCleanupReactor (ForkLayer, forkParked): thread.deleted / project.deleted
```

No new orchestration commands or events. The only persisted fork state is the lineage
table. Everything a fork creates is an ordinary upstream thread.

## Key upstream facts this design relies on

- `thread.history.import` (`packages/contracts/src/orchestration.ts:1438-1450`) is an
  internal command (not client-dispatchable, `InternalOrchestrationCommand` at 1559-1577).
  The decider (`apps/server/src/orchestration/decider.ts:1970-2041`) requires the thread to be
  active and empty (no messages, no latest turn, no session, no open requests) and emits one
  `thread.message-sent` per message plus `thread.settled`, all with `metadata.historyImport`.
- **Imported messages are never sent to the model.**
  `ProviderCommandReactor.processTurnStartRequested`
  (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:1195-1499`) sends only the
  turn's own message. Upstream's importer (`apps/server/src/project/AgentSessionImporter.ts`)
  keeps context by binding the new thread to the provider's native session through
  `ProviderSessionDirectory.upsert(..., { onConflict: "ignore" })` (lines 218-233) before
  `thread.create` (244-257) and `thread.history.import` (261-271).
- Message ids starting with `import:` are treated as imported
  (`isImportedAgentSessionMessageId`, `packages/contracts/src/agentSessions.ts:24-26`): a
  revert keeps them (`projector.ts:216`), `latestUserMessageAt` ignores them
  (`ProjectionPipeline.ts:1013`), and `thread.turn.start` rejects them as new message ids.
- The turn's message may carry `context` (`OrchestrationMessageContext`,
  `packages/contracts/src/composerContext.ts:261`). The reactor turns it into provider text
  with `projectComposerContextForProvider({ text, records })`
  (`ProviderCommandReactor.ts:1470-1475`; implementation
  `packages/shared/src/composerContextReferences.ts:258`): each `t3-context://` link in the
  text becomes a marker and each referenced record's payload goes into a trailing envelope.
  Records of unknown kinds are allowed (`UnknownContextRecord`, `composerContext.ts:223-235`)
  with a JSON payload of at most 64,000 characters each, at most 200 records
  (`COMPOSER_CONTEXT_MAX_RECORDS`). The web renders an unknown kind as a fallback chip
  (`apps/web/src/components/composerContextPresentation.tsx:454`).
- The whole provider input is capped at `PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000`
  (`packages/contracts/src/orchestration.ts:164`).
- Server code calling `OrchestrationEngineService.dispatch`
  (`apps/server/src/orchestration/Services/OrchestrationEngine.ts:73-76`) cannot use
  `thread.turn.start`'s `bootstrap`: bootstrap is carried out only in `ws.ts`
  (`dispatchBootstrapTurnStart`, 1047-1720). A fork service creates the thread, the worktree
  and the turn step by step.
- The web's "Implement plan in new thread" (`apps/web/src/components/ChatView.tsx:8661-8800`)
  is the existing precedent for "create a thread, start its first turn, wait, navigate, clean
  up on failure".

## Contracts (`packages/contracts/src/fork/thread-lineage.ts`)

```ts
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { ModelSelection, ProviderInteractionMode, RuntimeMode } from "../orchestration.ts";

export const THREAD_LINEAGE_WS_METHODS = {
  preview: "loom.thread-lineage.preview",
  fork: "loom.thread-lineage.fork",
  listForThread: "loom.thread-lineage.listForThread",
  listForProject: "loom.thread-lineage.listForProject",
  unlink: "loom.thread-lineage.unlink",
} as const;

export const ThreadLineageKind = Schema.Literals(["fork", "sidecar", "delegate", "review"]);
export const ThreadLineageContextMode = Schema.Literals(["none", "transcript", "native"]);
export const ThreadLineageWorkspace = Schema.Literals(["source", "project-root", "new-worktree"]);

export const ThreadLineageLink = Schema.Struct({
  childThreadId: ThreadId,
  parentThreadId: ThreadId,
  projectId: ProjectId,
  kind: ThreadLineageKind,
  contextMode: ThreadLineageContextMode,
  /** Last parent message carried into the child, null when nothing was carried. */
  throughMessageId: Schema.NullOr(MessageId),
  carriedMessageCount: NonNegativeInt,
  createdBy: Schema.Literals(["user", "agent"]),
  createdAt: IsoDateTime,
});
export type ThreadLineageLink = typeof ThreadLineageLink.Type;

export const THREAD_LINEAGE_FIRST_MESSAGE_MAX_CHARS = 20_000;

export const ThreadLineageForkInput = Schema.Struct({
  sourceThreadId: ThreadId,
  kind: Schema.Literals(["fork", "sidecar"]),
  /** Carry messages up to and including this one. Null carries nothing. */
  throughMessageId: Schema.NullOr(MessageId),
  /** "auto" resolves to "native" when available (phase 2), else "transcript". */
  context: Schema.Literals(["auto", "none", "transcript", "native"]),
  firstMessage: Schema.optional(
    Schema.Struct({
      text: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_LINEAGE_FIRST_MESSAGE_MAX_CHARS)),
    }),
  ),
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  workspace: ThreadLineageWorkspace,
});

export const ThreadLineageForkResult = Schema.Struct({
  threadId: ThreadId,
  contextMode: ThreadLineageContextMode,
  carriedMessageCount: NonNegativeInt,
  /** Messages visible in the child but left out of the model's transcript. */
  omittedFromTranscript: NonNegativeInt,
  turnStarted: Schema.Boolean,
});

/** What a fork from this point would carry; drives the dialog before the user commits. */
export const ThreadLineagePreviewInput = Schema.Struct({
  sourceThreadId: ThreadId,
  throughMessageId: Schema.NullOr(MessageId),
  firstMessageLength: NonNegativeInt,
});
export const ThreadLineagePreview = Schema.Struct({
  carriedMessageCount: NonNegativeInt,
  omittedFromTranscript: NonNegativeInt,
  nativeAvailable: Schema.Boolean,
  /** Why native is unavailable, in user copy; null when available. */
  nativeUnavailableReason: Schema.NullOr(Schema.String),
  /** True when a native fork would keep the whole turn containing the chosen message. */
  nativeRoundsToTurnEnd: Schema.Boolean,
  sourceRunning: Schema.Boolean,
  /** False when the project root is not a git repository; the dialog disables "New worktree". */
  worktreeAvailable: Schema.Boolean,
});

export class ThreadLineageError extends Schema.TaggedError<ThreadLineageError>()(
  "ThreadLineageError",
  {
    reason: Schema.Literals([
      "source-not-found",
      "message-not-found",
      "first-message-required",
      "native-unavailable",
      "source-running",
      "workspace-failed",
      "dispatch-failed",
      "link-not-found",
    ]),
    detail: Schema.String,
  },
) {}

const PreviewRpc = Rpc.make(THREAD_LINEAGE_WS_METHODS.preview, {
  payload: ThreadLineagePreviewInput,
  success: ThreadLineagePreview,
  error: Schema.Union([ThreadLineageError, EnvironmentAuthorizationError]),
});
const ForkRpc = Rpc.make(THREAD_LINEAGE_WS_METHODS.fork, {
  payload: ThreadLineageForkInput,
  success: ThreadLineageForkResult,
  error: Schema.Union([ThreadLineageError, EnvironmentAuthorizationError]),
});
const ListForThreadRpc = Rpc.make(THREAD_LINEAGE_WS_METHODS.listForThread, {
  payload: Schema.Struct({ threadId: ThreadId }),
  success: Schema.Struct({
    parent: Schema.NullOr(ThreadLineageLink),
    children: Schema.Array(ThreadLineageLink),
    siblings: Schema.Array(ThreadLineageLink),
  }),
  error: Schema.Union([ThreadLineageError, EnvironmentAuthorizationError]),
});
const ListForProjectRpc = Rpc.make(THREAD_LINEAGE_WS_METHODS.listForProject, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: Schema.Struct({ links: Schema.Array(ThreadLineageLink) }),
  error: Schema.Union([ThreadLineageError, EnvironmentAuthorizationError]),
});
const UnlinkRpc = Rpc.make(THREAD_LINEAGE_WS_METHODS.unlink, {
  payload: Schema.Struct({ childThreadId: ThreadId }),
  success: Schema.Struct({ removed: Schema.Boolean }),
  error: Schema.Union([ThreadLineageError, EnvironmentAuthorizationError]),
});

export const ThreadLineageRpcGroup = RpcGroup.make(
  PreviewRpc,
  ForkRpc,
  ListForThreadRpc,
  ListForProjectRpc,
  UnlinkRpc,
);
```

Verify each imported name at implementation time (`MessageId`, `ThreadId`, `ProjectId` are
in `baseSchemas.ts:104-120`; `RuntimeMode` and `ProviderInteractionMode` in
`orchestration.ts:128-138`; `ModelSelection` at `orchestration.ts:92`). If `Schema.Union`
takes a different form in this Effect version, copy the form used by `rpc.ts`.

Registration: `export * from "./thread-lineage.ts";` in `fork/index.ts`,
`ThreadLineageRpcGroup,` in the `.merge(` of `fork/rpc.ts`. All five methods are unary, so
the stream tag unions stay unchanged.

Scopes (`FORK_RPC_REQUIRED_SCOPES`): `fork` and `unlink` need `AuthOrchestrationOperateScope`
(`orchestration:operate`); `preview` and both list methods need `AuthOrchestrationReadScope`
(`packages/contracts/src/auth.ts:81-98`).

## Storage

Migration set `ThreadLineageMigrations` (slug `thread-lineage`, tracking table
`fork_migrations_thread_lineage`), id 1 `Links`:

```sql
CREATE TABLE IF NOT EXISTS fork_thread_lineage_links (
  child_thread_id        TEXT PRIMARY KEY,
  parent_thread_id       TEXT NOT NULL,
  project_id             TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('fork', 'sidecar', 'delegate', 'review')),
  context_mode           TEXT NOT NULL CHECK (context_mode IN ('none', 'transcript', 'native')),
  through_message_id     TEXT,
  carried_message_count  INTEGER NOT NULL DEFAULT 0,
  created_by             TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_thread_lineage_links_parent
  ON fork_thread_lineage_links (parent_thread_id);
CREATE INDEX IF NOT EXISTS fork_thread_lineage_links_project
  ON fork_thread_lineage_links (project_id, created_at);
```

- One parent per child (primary key on the child). Siblings are rows sharing
  `parent_thread_id`, excluding the thread itself.
- The `delegate` kind exists so L08 can record agent-started children, and the `review` kind
  so L15 can record reviewer threads, each with `INSERT OR IGNORE` when this table exists.
  Keep the column list stable; L08's and L15's TECHNICAL.md document the same columns.
- No foreign keys into upstream tables (EXTENSION-POINTS.md, Persistence).
- Cleanup: the reactor deletes rows whose `child_thread_id` is deleted and all rows of a
  deleted project. Rows whose parent was deleted stay; the panel shows "Forked from a deleted
  thread".

Repository `ThreadLineageStore` (`apps/server/src/fork/thread-lineage/ThreadLineageStore.ts`)
follows upstream's repository pattern (`SqlClient`, `SqlSchema`, `Layer.effect`, as in
`apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`): `insert(link)`,
`getByChild(threadId)`, `listChildren(parentId)`, `listByProject(projectId, limit 2000)`,
`deleteByChild(threadId)`, `deleteByProject(projectId)`.

## Server

Files under `apps/server/src/fork/thread-lineage/`:

| File                      | Contents                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| `migrations.ts`           | `ThreadLineageMigrations`.                                          |
| `ThreadLineageStore.ts`   | Repository service and layer.                                       |
| `transcript.ts`           | Pure transcript builder (below).                                    |
| `ThreadLineageService.ts` | `fork`, `listForThread`, `listForProject`, `unlink`.                |
| `cleanupReactor.ts`       | `Layer.effectDiscard` reactor started with `forkParked`.            |
| `nativeFork.ts`           | Phase 2 only: `NativeForkPlanner` with Claude and Codex strategies. |
| `rpc.ts`                  | `makeThreadLineageRpcHandlers(auth)`.                               |

`ThreadLineageService` and `ThreadLineageStore` join `ForkServices`; the cleanup reactor
layer joins `ForkServicesLive`; `"thread-lineage"` is appended to `LOOM_SERVER_FEATURES`.

### `fork(input)`

Dependencies: `ProjectionSnapshotQuery` (`getThreadDetailById`, `getThreadShellById`,
`getProjectShellById`; `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:174,217,249`),
`OrchestrationEngineService`, `GitWorkflowService` (`apps/server/src/git/GitWorkflowService.ts:70-73`),
`ThreadLineageStore`, `Crypto`, and in phase 2 `ProviderSessionDirectory`.

1. Load the source detail. Fail `source-not-found` when missing, deleted or archived.
2. Resolve the fork point. `throughMessageId === null` carries nothing (sidecar default).
   Otherwise find the message; fail `message-not-found`. Carried messages are the source's
   messages up to and including that index, keeping roles `user` and `assistant`, skipping
   `streaming` ones and empty text. The web sends the message before a user message when the
   user forked from a user message (PRODUCT.md), so the service never needs a "before" flag.
3. Resolve the context mode: `auto` becomes `native` if `NativeForkPlanner.available(source,
throughMessage)` (phase 2; always false in phase 1) else `transcript`; `transcript` with
   zero carried messages becomes `none`. `transcript` without `firstMessage` fails
   `first-message-required` (the transcript rides on the first message). `native` while the
   source session is `starting` or `running` fails `source-running`.
4. Resolve settings for the child: `modelSelection` defaults to the source's; with `native`
   it must use the same provider instance as the source binding (else `native-unavailable`).
   `runtimeMode` and `interactionMode` default to the source's. Title defaults to
   `Fork of <source title>` or `Sidecar: <source title>`, truncated to 200 characters.
5. Resolve the workspace:
   - `source`: the source's `branch` and `worktreePath`.
   - `project-root`: `branch: null, worktreePath: null`.
   - `new-worktree`: `GitWorkflowService.createWorktree({ cwd: project.workspaceRoot,
refName: source.branch ?? <current branch of the project root>, newRefName:
buildTemporaryWorktreeBranchName(randomHex), baseRefName: source.branch ?? undefined,
path: null })` (`packages/shared/src/git.ts:95-105`; schema `VcsCreateWorktreeInput`,
     `packages/contracts/src/git.ts:140-147`). Upstream renames a temporary `t3code/<hex>`
     branch after the first turn (`ProviderCommandReactor.maybeGenerateAndRenameWorktreeBranchForFirstTurn`,
     877-937), so the fork gets a real branch name for free. Failure: `workspace-failed`
     with git's message. Note in the dialog: a new worktree starts from the source branch's
     last commit, not from the source's uncommitted changes. `new-worktree` is the dialog's
     default for forks (PRODUCT.md decisions); the service itself has no default, the
     client always sends `workspace`.
6. Phase 2, `native` only: run the native strategy (below) to obtain a provider resume
   cursor, then `ProviderSessionDirectory.upsert({ threadId: child, provider,
providerInstanceId, status: "stopped", runtimeMode, resumeCursor, runtimePayload: { cwd } },
{ onConflict: "ignore" })`, exactly as `AgentSessionImporter.ts:225-240` does.
7. Dispatch, each with a server command id `server:loom-thread-lineage:<step>:<uuid>`
   (the helper shape is upstream's `serverCommandId`, `apps/server/src/ws.ts:734-735`):
   1. `thread.create` with `projectId`, title, model selection, modes, `branch`,
      `worktreePath`, `createdAt`, and `historyImport: true` when messages are carried
      (upstream uses the flag for threads created pre-populated;
      `orchestration.ts:1047-1062`).
   2. `thread.history.import` with the carried messages, when there are any. Message ids are
      `import:loom-fork:<childThreadId>:<index padded to 6>` so upstream treats them as
      imported. Text is cleaned with `replaceComposerContextReferences(text, (r) => r.label)`
      (`packages/shared/src/composerContextReferences.ts:95`) because imported messages carry
      no context records; attachments are dropped and replaced by a line such as
      `[1 image attachment not copied]`. `createdAt` keeps the source timestamps.
   3. `thread.turn.start` when `firstMessage` is present: a new `MessageId`, text, empty
      attachments, `modelSelection`, modes, `titleSeed` (only when the user did not give a
      title), `createdAt`, and for `transcript` mode `message.context` plus reference links
      (below).
8. Insert the lineage row. Order and cleanup: insert after `thread.create` succeeds; if any
   later step fails, dispatch `thread.delete` for the child and delete the row (mirrors the
   web's cleanup at `ChatView.tsx:8771-8783`), then fail `dispatch-failed` or the specific
   reason. A created worktree is left in place on failure (upstream's thread deletion flow
   offers worktree cleanup; do not delete directories from this service).
9. Return `{ threadId, contextMode, carriedMessageCount, omittedFromTranscript, turnStarted }`.

The service holds a per-source semaphore so two forks of the same source serialize (cheap,
avoids interleaved dispatches from double clicks).

### Transcript builder (`transcript.ts`, pure)

```ts
export const FORK_TRANSCRIPT_KIND = "loom-fork-transcript";
export const FORK_TRANSCRIPT_RECORD_MAX_CHARS = 60_000; // JSON-encoded; schema limit is 64,000
export const FORK_TRANSCRIPT_TOTAL_MAX_CHARS = 90_000; // leaves room under 120,000 for the ask
export const FORK_TRANSCRIPT_MESSAGE_MAX_CHARS = 16_000;

export interface ForkTranscriptInput {
  readonly source: { readonly threadId: string; readonly title: string };
  readonly messages: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>;
  readonly firstMessageText: string;
  readonly makeContextId: (index: number) => string; // "loomfork" + childId-derived suffix, matches ^[a-z0-9_-]+$
}

export interface ForkTranscriptOutput {
  // "[Forked conversation (1/2)](t3-context://v1/loom-fork-transcript/<id>) ...\n\n<first message>";
  // the first record's label becomes "Forked conversation (earlier messages trimmed)" when
  // omittedFromTranscript > 0, so the child thread shows the notice on its first message.
  readonly text: string;
  readonly records: ReadonlyArray<{
    readonly version: 1;
    readonly contextId: string;
    readonly kind: typeof FORK_TRANSCRIPT_KIND;
    readonly label: string;
    readonly payload: {
      readonly note: string; // "Earlier conversation this thread was forked from. Continue from it."
      readonly source: { readonly threadId: string; readonly title: string };
      readonly part: number;
      readonly parts: number;
      readonly omittedEarlierMessages: number;
      readonly messages: ReadonlyArray<{
        readonly role: "user" | "assistant";
        readonly text: string;
      }>;
    };
  }>;
  readonly omittedFromTranscript: number;
}
```

Rules: walk messages newest to oldest, truncate any single message longer than
`FORK_TRANSCRIPT_MESSAGE_MAX_CHARS` in the middle (`[... N characters omitted ...]`), keep
adding while the encoded total stays under `FORK_TRANSCRIPT_TOTAL_MAX_CHARS -
firstMessageText.length`, then split the kept messages (restored to oldest-first order) into
records whose `JSON.stringify(payload).length` stays under
`FORK_TRANSCRIPT_RECORD_MAX_CHARS`. When messages were omitted, the first record's
`label` is `Forked conversation (earlier messages trimmed)` (with ` (1/N)` appended when
split) and its `payload.note` adds "The oldest N messages of that conversation were
trimmed and are not included." so the model knows the transcript is partial. The budget
constants are fixed (decided, PRODUCT.md): there is no setting and no RPC field for them.
Links are built with `formatComposerContextReference`
(`packages/shared/src/composerContextReferences.ts:52`). The final text must decode through
`ClientThreadTurnStartCommand`'s message schema and the context through
`OrchestrationMessageContext`; the unit test asserts both, plus that
`projectComposerContextForProvider` of the result stays under
`PROVIDER_SEND_TURN_MAX_INPUT_CHARS`.

The same builder serves a sidecar started with "Conversation" context.

### Native forks (phase 2, `nativeFork.ts`)

A `NativeForkStrategy` per driver kind:

```ts
interface NativeForkStrategy {
  readonly driver: ProviderDriverKind;
  /** Cheap check used by "auto" and by `preview`; never spawns a process. */
  readonly available: (
    input: NativeForkContext,
  ) => Effect.Effect<{ ok: true } | { ok: false; reason: string }>;
  /** Creates the native fork and returns the child's resume cursor. */
  readonly fork: (input: NativeForkContext) => Effect.Effect<unknown, ThreadLineageError>;
}
interface NativeForkContext {
  readonly sourceThreadId: ThreadId;
  readonly binding: ProviderRuntimeBinding; // ProviderSessionDirectory.getBinding(source)
  readonly throughTurnId: TurnId | null; // turn of the fork message; the fork keeps whole turns
  readonly nextTurnId: TurnId | null; // first turn after the fork point
  readonly cwd: string;
}
```

- The fork point is rounded to a turn boundary: a native fork keeps whole turns through the
  fork message's turn. The dialog says so when the chosen message is mid-turn.
- **Claude.** Cursor shape `{ threadId, resume, resumeSessionAt?, turnCount,
turnStartMessageIds }` (`apps/server/src/provider/Layers/ClaudeAdapter.ts:875-918`). T3
  sets each SDK user message `uuid` to the T3 turn id (5067-5073), so the next turn's user
  message uuid is `nextTurnId`. Mirror `rollbackThread` (5103-5297): read the source session's
  messages, find the index of `nextTurnId`, fork with `upToMessageId` = the uuid just before
  it (or the whole session when forking at the end), read the fork's messages and remap the
  retained `turnStartMessageIds` by index ("Native forks replace every UUID", 5271-5279).
  Per-instance `CLAUDE_CONFIG_DIR`: the adapter runs SDK history helpers in a child process
  with the instance's environment (`runScopedHistoryCommand`, 5150-5172, using
  `apps/server/src/claude-history-worker.ts` and `makeClaudeEnvironment` from
  `apps/server/src/provider/Drivers/ClaudeHome.ts:20`). Reuse the worker the same way; do
  not call SDK helpers in-process unless the instance uses the server's own config dir.
  SDK API: `forkSession(sessionId, { dir, upToMessageId })` and `getSessionMessages`
  (`@anthropic-ai/claude-agent-sdk` 0.3.260, `sdk.d.ts:738-753,797-810`).
- **Codex.** Cursor shape `{ threadId: <codex thread id> }`
  (`apps/server/src/provider/Layers/CodexSessionRuntime.ts:2388,2490`). The app-server
  protocol has `thread/fork` with `lastTurnId` ("fork through, inclusive"), plus optional
  `cwd`, `model`, `developerInstructions`
  (`packages/effect-codex-app-server/src/_generated/schema.gen.ts:40055-40070`,
  `meta.gen.ts:10`). T3 never calls it. The strategy starts a short-lived app-server client
  for the source's provider instance (same binary and `CODEX_HOME` resolution as
  `CodexSessionRuntime`), sends `initialize`, then `thread/fork { threadId, lastTurnId }`,
  reads the new thread id and closes the client. Spike item: confirm that T3 turn ids equal
  Codex turn ids for Codex threads (search `turnId` mapping in `CodexAdapter.ts`); if they
  do not, map through `thread/read` (`CodexSessionRuntime.ts:1224-1265`).
- **Other drivers.** `available` returns false. OpenCode's `session.fork` needs the adapter's
  running OpenCode server (`OpenCodeAdapter.ts:3811-3907`); ACP `session/fork`
  (`packages/effect-acp`, `ForkSessionRequest`) has no message point and is unstable.

When `native` succeeds the child still gets the visible history through
`thread.history.import`, and the first message (optional in native mode) carries no
transcript.

### Cleanup reactor

```ts
export const ThreadLineageCleanupLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const store = yield* ThreadLineageStore;
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        switch (event.type) {
          case "thread.deleted":
            return store.deleteByChild(event.payload.threadId).pipe(logAndIgnore("thread.deleted"));
          case "project.deleted":
            return store
              .deleteByProject(event.payload.projectId)
              .pipe(logAndIgnore("project.deleted"));
          default:
            return Effect.void;
        }
      }),
    );
  }),
);
```

`forkParked` is at `apps/server/src/serverActivation.ts:12-26`; the upstream model is
`ThreadDeletionReactor.ts:92-106`. `logAndIgnore` is a local helper that logs a warning and
succeeds, so one bad row never stops the reactor. Payloads are `ThreadDeletedPayload
{ threadId, deletedAt }` and `ProjectDeletedPayload { projectId, deletedAt }`
(`orchestration.ts:1654-1677`). Events are hot (`streamDomainEvents`,
`OrchestrationEngine.ts:83`), so deletions while the server was down leave orphan rows. A
startup sweep (inside the same parked fiber, before subscribing) removes rows whose child no
longer exists in `getShellSnapshot().threads` (`ProjectionSnapshotQuery.ts:118`). Check the
exact payload field names of `thread.deleted` and `project.deleted` in `orchestration.ts`.

### `preview`

Runs steps 1 to 3 of `fork` without side effects and returns the counts, the native
availability with a reason ("Native forks are available for Claude and Codex threads",
"The source thread is running", "This thread has no provider session yet") and
`worktreeAvailable` from `GitWorkflowService.isRepository(project.workspaceRoot)`
(`apps/server/src/git/GitWorkflowService.ts:38`). The dialog calls it when it opens and when the first message length
crosses a budget boundary (debounced 300 ms), never per keystroke.

### `listForThread`, `listForProject`, `unlink`

Plain store reads; `unlink` deletes the child's row and returns `removed`. `listForProject`
caps at 2,000 rows (newest first).

## Clients

### Shared atoms (`packages/client-runtime/src/fork/thread-lineage.ts`)

```ts
export function createThreadLineageAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    preview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:thread-lineage:preview",
      tag: THREAD_LINEAGE_WS_METHODS.preview,
      staleTimeMs: 2_000,
    }),
    listForThread: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:thread-lineage:listForThread",
      tag: THREAD_LINEAGE_WS_METHODS.listForThread,
      staleTimeMs: 5_000,
    }),
    listForProject: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:thread-lineage:listForProject",
      tag: THREAD_LINEAGE_WS_METHODS.listForProject,
      staleTimeMs: 5_000,
    }),
    fork: createEnvironmentRpcCommand(runtime, {
      label: "loom:thread-lineage:fork",
      tag: THREAD_LINEAGE_WS_METHODS.fork,
    }),
    unlink: createEnvironmentRpcCommand(runtime, {
      label: "loom:thread-lineage:unlink",
      tag: THREAD_LINEAGE_WS_METHODS.unlink,
    }),
  };
}
```

Factories: `packages/client-runtime/src/state/runtime.ts:612,678`. Web instantiates them in
`apps/web/src/fork/thread-lineage/state.ts` with `connectionAtomRuntime` (as
`apps/web/src/state/device.ts:18` does) and reads queries with `useEnvironmentQuery`
(`apps/web/src/state/query.ts:25`). After `fork` and `unlink` succeed, refresh the two list
families for the environment (use the command's `onSuccess` to invalidate, or refetch in the
caller). Links change rarely; no subscription is needed. The panel also refetches when the
number of thread shells in the project changes, which covers forks created on another client.

### Web files (`apps/web/src/fork/thread-lineage/`)

| File                        | Purpose                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.ts`                  | Atom instances; `useThreadLineageSupported(environmentId)` from `supportsLoomFeature`.                                                                                                                                                                              |
| `forkDialogStore.ts`        | Small zustand store: `{ open, sourceRef, throughMessageId, kind, prefillText }`, `openForkDialog(...)`.                                                                                                                                                             |
| `ForkDialogHost.tsx`        | Registered in `ForkRoot`; renders the dialog; subscribes to the three fork commands via `onForkCommand`.                                                                                                                                                            |
| `ForkThreadDialog.tsx`      | Form: title, provider and model (upstream `ProviderModelPicker` if it can be used standalone, else a select built from `deriveProviderInstanceEntries`), context, workspace, first message; submit calls `fork`, then navigates (fork) or opens the pane (sidecar). |
| `ForkFromMessageButton.tsx` | The seam component in `MessagesTimeline`; renders nothing when unsupported.                                                                                                                                                                                         |
| `RelatedThreadsPanel.tsx`   | Panel `thread-lineage`.                                                                                                                                                                                                                                             |
| `ThreadPane.tsx`            | Compact view of one thread: header, recent messages, status, compact composer.                                                                                                                                                                                      |
| `ThreadPanePanel.tsx`       | Panel `thread-lineage:thread`: a `ThreadPane` for `surface.resourceId`, or a thread picker without one.                                                                                                                                                             |
| `panels.tsx`                | Two `ForkPanelDefinition`s.                                                                                                                                                                                                                                         |
| `palette.tsx`               | `ForkCommandPaletteSource`.                                                                                                                                                                                                                                         |
| `lineageView.ts`            | Pure: groups links plus plan links into panel sections; derives the fork point for a message.                                                                                                                                                                       |

`ForkFromMessageButton` props: `{ threadRef: ScopedThreadRef | null; message: ChatMessage }`.
It renders a ghost icon button (`GitForkIcon` from lucide) with the tooltip "Fork from here",
hidden when `threadRef` is null, the environment lacks `thread-lineage`, or the message is
streaming. Imported messages (ids starting with `import:`) are valid fork points. Click:
for an assistant message `openForkDialog({ kind: "fork", sourceRef, throughMessageId:
message.id })`; for a user message `throughMessageId` is the id of the
message before it (or null when it is the first) and `prefillText` is the message text with
context references replaced by labels. The capability read must be cheap: one
`useServerConfigs()` read per row is acceptable because rows are virtualized, but prefer a
shared memoized selector hook in `state.ts`.

`RelatedThreadsPanel` sections: Parent, Sidecars, Forks, Agent threads (`delegate`),
Reviews (`review`, reviewer threads written by L15 when present),
Siblings, Implemented plans (from the current thread detail's `proposedPlans[].implementationThreadId`,
`orchestration.ts:525-535`). Each row joins the link with the thread shell
(`useThreadShells()`, `apps/web/src/state/entities.ts:77`) for title, branch and status and
uses upstream's status pill (`resolveThreadStatusPill`,
`apps/web/src/components/Sidebar.logic.ts:985`; `ThreadStatusLabel`,
`apps/web/src/components/ThreadStatusIndicators.tsx:426`). Row actions: Open (navigate
`{ to: "/$environmentId/$threadId", params }`, `apps/web/src/threadRoutes.ts:42`), Open side
by side (`openSurface(ref, forkPanelSurface("thread-lineage:thread", threadId))` with the
title set), Unlink. Selecting a row shows a `ThreadPane` for it in the lower half of the
panel (the "small composer to message them"). Buttons: "New sidecar", "Fork thread".

`ThreadPane` renders, for a `ScopedThreadRef`:

- Header: title, status pill, provider and model label, "Open full view", "Stop" while
  running (`threadEnvironment.interruptTurn`, `packages/client-runtime/src/state/threadCommands.ts:215`).
- Messages: the last 60 user and assistant messages from `useThread(ref)`
  (`apps/web/src/state/entities.ts:128`), assistant text through upstream's `ChatMarkdown`
  (default export of `apps/web/src/components/ChatMarkdown.tsx`), user text with context
  references replaced by labels. "Show earlier" grows the window by 60. No work log; a
  single line per turn says "Worked for 2m, 14 tool calls" from `deriveWorkLogEntries`
  (`apps/web/src/session-logic.ts:451`) when cheap, otherwise omitted.
- Requests: if `derivePendingRequests(activities)` (`packages/client-runtime/src/pendingRequests.ts:122`)
  returns approvals or questions, a notice with "Open thread".
- Composer: a textarea with Send (Enter) and Shift+Enter for a newline. Send dispatches
  `threadEnvironment.startTurn` (`threadCommands.ts:209`) with a new message id
  (`newMessageId`, `apps/web/src/lib/utils.ts:51`), `attachments: []`, the thread's
  `modelSelection`, `runtimeMode` and `interactionMode`, `createdAt`. Disabled while the
  thread is running or has pending requests; the queue and steering features of the main
  composer are not reproduced.

Draft text in panes persists per thread in memory only (module-level map), not in upstream's
composer draft store.

### Registrations

- Panels: `threadLineagePanel` (`id: "thread-lineage"`, title "Related threads", icon
  `GitForkIcon`, shortcut `"R"`) and `threadPanePanel` (`id: "thread-lineage:thread"`, title
  "Side by side", icon `ColumnsIcon`, shortcut `"H"`). Both `isAvailable` when
  `threadRef !== null && loomFeatures.includes("thread-lineage")`. The letters are
  assigned in EXTENSION-POINTS.md, "Launcher letters".
- Palette source `threadLineagePaletteSource` (values `action:loom:thread-lineage:fork`,
  `...:sidecar`, `...:related`, `...:side-by-side`), all returning `[]` without the feature or
  without an active server thread. "Fork thread" forks from the latest settled message
  (dialog prefilled with nothing).
- Keybinding commands: `loom.thread-lineage.fork`, `loom.thread-lineage.sidecar`,
  `loom.thread-lineage.related`. No defaults.
- `ForkRoot`: `{ id: "thread-lineage-dialog", Component: ForkDialogHost }` (renders `null`
  while closed; the keybinding listener component from `ext-keybindings` is registered by
  that extension point).

## Agent-facing tools

None. Agent-started threads belong to L08.

## Performance

- The message button adds one small component per rendered (virtualized) row. It must not
  subscribe to thread detail; it reads the capability and the dialog store's `open` action.
- Each open thread pane holds one extra thread detail subscription (the same atoms upstream
  uses for the sidebar's thread), bounded by the number of open pane tabs. Closing the tab
  unmounts the pane and lets the atom's idle TTL release it.
- Pane messages render at most 60 at a time with `ChatMarkdown`, which is memoized. No
  continuous animation; the streaming message re-renders as upstream's does.
- `listForProject` is capped at 2,000 rows and only used by the side-by-side picker's
  "related first" ordering; the Related panel uses `listForThread`.
- The fork itself runs on the server; the transcript is at most 90,000 characters and is
  sent to the provider once.

## Alternatives considered

- **New `thread.fork` command and lineage fields on the thread** (old Loom 0035). Rejected:
  new events are a one-way door (EXTENSION-POINTS.md, Orchestration rule 1) and upstream
  merges would conflict in the decider, projector and every read model.
- **Transcript in the visible first message text.** Rejected: clutters the thread and the
  model cannot tell context from instruction. The context record path is upstream's own
  mechanism and shows as a single chip.
- **Transcript injected through a server-side turn-input hook** (the shared
  `ext-turn-input`, EXTENSION-POINTS.md section 16). Not needed here: the context record
  reaches every provider without a seam, and the user can see what was sent.
- **Share the parent's native session** by copying its resume cursor to the child.
  Rejected: both threads would append to the same Claude session or Codex thread.
- **Two `ChatView`s in a split route** for side by side. Rejected: `ChatView` is bound to
  the route and 10,000 lines; rendering it twice is untested upstream territory. The right
  panel pane is small, fork-owned and works with upstream's panel layout controls.
