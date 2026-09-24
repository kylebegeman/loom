# L02 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Phase 1 is the deliverable;
phase 2 (native forks) starts only after phase 1 is reviewed, and begins with a spike.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and every
file in this folder. Work in a worktree. For the manual check, seed the worktree's `.t3` with
a `VACUUM INTO` copy of `~/.t3/userdata/state.sqlite` (AGENTS.md, "Test data"); never point a
server at `~/.t3/userdata`.

## Phase 1

### 1. Extension points

Run the existence checks for `ext-core`, `ext-web-root`, `ext-panels`, `ext-palette` and
`ext-keybindings` (in that order; keybindings needs web root). Create each missing one exactly
as EXTENSION-POINTS.md specifies, one commit each (`feat(fork): add the <name> extension
point`), with its FORK.md rows. Record them in SEAMS.md.

### 2. Contracts

- `packages/contracts/src/fork/thread-lineage.ts` as sketched in TECHNICAL.md. Confirm every
  imported schema name against the current source.
- Register in `fork/index.ts` and in the `.merge(` of `fork/rpc.ts`.
- Add `"loom.thread-lineage.fork"`, `"loom.thread-lineage.sidecar"`,
  `"loom.thread-lineage.related"` to `FORK_KEYBINDING_COMMANDS`.
- Typecheck `@t3tools/contracts`.

### 3. Server storage

- `apps/server/src/fork/thread-lineage/migrations.ts` with the DDL from TECHNICAL.md; add to
  `FORK_MIGRATION_SETS`.
- `ThreadLineageStore.ts` (service plus layer) with a test on `SqlitePersistenceMemory`
  (`apps/server/src/persistence/Layers/Sqlite.ts:41-44`).

### 4. Transcript builder

`transcript.ts` plus `transcript.test.ts` first (test-first is worth it here: the budget and
the schema limits are the failure modes). Cover: small history fits one record; long history
splits into several records each under 60,000 encoded characters; oldest messages are
omitted first and counted; a single huge message is truncated in the middle; the resulting
text and context decode through the upstream message schemas; the provider projection
(`projectComposerContextForProvider`) stays under `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`.

### 5. Service and RPC

- `ThreadLineageService.ts`: `preview`, `fork`, `listForThread`, `listForProject`, `unlink`,
  following the numbered steps in TECHNICAL.md. Build command ids like
  `CommandId.make(\`server:loom-thread-lineage:${step}:${uuid}\`)`.
- `fork` in phase 1 treats `native` as unavailable (`preview.nativeAvailable = false`, reason
  "Native forks are not built yet").
- `rpc.ts`: `makeThreadLineageRpcHandlers = (auth: ForkRpcAuth) => Effect.succeed(ThreadLineageRpcGroup.of({ ... }))`,
  each handler `auth.effect(TAG, withForkRuntime(...))`. Spread into `fork/rpc.ts`; add the
  five scopes.
- Append `"thread-lineage"` to `LOOM_SERVER_FEATURES`; add the service and store to
  `ForkServices` and `ForkServicesLive`.
- Tests (`ThreadLineageService.test.ts`): see TESTING.md. Build the test layer the way
  upstream orchestration tests build an engine with an in-memory SQLite (search for an
  existing `OrchestrationEngine` test harness under `apps/server/src/orchestration/`), and
  wait on dispatch results, never on sleeps.

### 6. Cleanup reactor

`cleanupReactor.ts` with the startup sweep and the `thread.deleted` / `project.deleted`
handling; add to `ForkServicesLive`. Test with a `Deferred` that resolves when the store
delete runs, or by draining: dispatch `thread.delete`, then read the store after the
engine's dispatch returns and the reactor's handler has signalled (expose a test-only
`drain` if needed, as `ThreadDeletionReactor.drainThrough` does).

### 7. Client runtime

`packages/client-runtime/src/fork/thread-lineage.ts` (`createThreadLineageAtoms`), exported
from `client-runtime/src/fork/index.ts`. Typecheck `@t3tools/client-runtime`.

### 8. Web

In this order, checking each in the running app before moving on (with Kyle's permission for
browser use, AGENTS.md):

1. `state.ts`, `forkDialogStore.ts`, `lineageView.ts` (+ `lineageView.test.ts`: section
   grouping, sibling derivation excluding self, missing parent, fork point for a user message
   is the previous message).
2. `ForkThreadDialog.tsx` and `ForkDialogHost.tsx`; register the host in `ForkRoot`;
   subscribe to the keybinding commands with `onForkCommand`.
3. `ForkFromMessageButton.tsx`, then apply the `MessagesTimeline.tsx` seams from SEAMS.md and
   run `vp fmt` on that file.
4. `ThreadPane.tsx`, `ThreadPanePanel.tsx` (thread picker without a resource id), then
   `RelatedThreadsPanel.tsx`; register both panels.
5. `palette.tsx`; register the source.

Dialog details:

- On open, call `preview` for the fork point. Show "N messages will be copied" and, when
  `omittedFromTranscript > 0`, "The oldest M messages are left out of the model's context".
- Context choices: Conversation (default for fork), None (default for sidecar), Native
  (disabled with `nativeUnavailableReason` in phase 1).
- Workspace default: sidecar "Same as source"; fork "New worktree" when
  `sourceUsesWorktree`, otherwise "Same as source". Remember the last choice per kind in
  `loom:thread-lineage:fork-defaults:v1` (try/catch around storage).
- First message: required for Conversation; prefilled from `prefillText`.
- Submit: call `fork`; on success, fork kind navigates with
  `navigate({ to: "/$environmentId/$threadId", params })`; sidecar kind opens
  `forkPanelSurface("thread-lineage:thread", threadId)` with `title` set to the new title.
  If the child's shell has not arrived yet, the pane shows its loading state; the upstream
  helper `waitForStartedServerThread` (`apps/web/src/components/ChatView.logic.ts:1152`)
  shows how to wait when navigation needs the shell first.

### 9. Documentation and status

- `docs/fork/user/thread-lineage.md`: fork, sidecar, related threads, side by side; that
  replay forks give the model a transcript (and what that means: tool output and reasoning
  are not carried); that imported history is visible in the child.
- FORK.md "Packet seams" row (SEAMS.md).
- Packet index Status in `docs/fork/packets/README.md`.

## Phase 2: native forks

### 10. Spike (stop and report if any answer is "no")

- Claude: run the history worker for a real instance with a custom `CLAUDE_CONFIG_DIR`, fork a
  real session at a turn boundary, bind a test thread to the new cursor, and confirm the next
  turn has the earlier context and the parent is untouched.
- Codex: start an app-server client for an instance the same way `CodexSessionRuntime` does,
  call `thread/fork { threadId, lastTurnId }`, confirm the returned thread resumes with
  `thread/resume` and that T3 turn ids map to Codex turn ids.

Record the findings in this folder (`SPIKE.md`) and update TECHNICAL.md.

### 11. Strategies

`nativeFork.ts` with the Claude and Codex strategies; wire `available` into `preview` and
`fork`; `ProviderSessionDirectory.upsert` the child binding before `thread.create`. Tests use
fake strategies through a test layer; a real-provider check is manual (TESTING.md).

## Pitfalls

- `thread.history.import` fails unless the thread is completely empty: dispatch it right
  after `thread.create` and before anything else touches the child.
- Imported message ids must be unique and start with `import:`; never reuse the source's
  message ids.
- Do not send `bootstrap` from the server; it is ignored outside `ws.ts`.
- The transcript must be referenced from the message text; unreferenced records are not sent
  to the provider (`projectComposerContextForProvider` only emits referenced records).
- Context ids must match `^[a-z0-9_-]+$` and be at most 128 characters.
- A sidecar in "Same as source" workspace shares files with the main thread: two agents can
  edit the same files. The dialog warns when the main thread is running.
- `useThread` subscribes to a thread's detail; never call it for every related row. Rows use
  shells; only the selected row's pane and open pane tabs subscribe.
- Do not add props or callbacks to `MessagesTimeline`'s shared row context; the seam reads
  `ctx.threadRef`, which already exists.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A fork from an assistant message mid-thread creates a child with the visible history and
  a first turn whose reply shows the model knew the earlier conversation.
- A fork from a user message pre-fills the dialog with that message and carries only the
  messages before it.
- Forking a Claude thread into Codex works (replay).
- Unlink removes the relationship; deleting the child removes the row (reactor).
- A sidecar opens next to the main thread and can be messaged and stopped from the pane.
- Everything is hidden against an upstream T3 server.
