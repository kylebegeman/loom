# L02 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. Server tests wait on
dispatch results, deferreds or drains.

## Automated tests

| File                                                                 | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/thread-lineage/transcript.test.ts`             | Budget and splitting rules; oldest-first omission count; middle truncation of a huge message; output decodes through the upstream turn-start message schema and `OrchestrationMessageContext`; the provider projection stays under `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`; context ids match the id pattern.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/fork/thread-lineage/ThreadLineageStore.test.ts`     | Insert, lookups by child, parent and project; delete by child and project; migration runs twice without changes (on `SqlitePersistenceMemory`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/thread-lineage/ThreadLineageService.test.ts`   | With a real engine on in-memory SQLite (model the layer on `apps/server/src/project/AgentSessionImporter.test.ts:561-577`): fork from an assistant message creates a thread with exactly the carried messages as `import:` ids and a settled state; the first turn's message carries the transcript context and reference links; `none` context sends no records; `transcript` without a first message fails `first-message-required`; unknown message fails `message-not-found`; a failure after `thread.create` deletes the child and leaves no row; `preview` has no side effects; `unlink` removes the row. The provider side is not exercised (no provider layer): assert on the dispatched `thread.turn-start-requested` event. |
| `apps/server/src/fork/thread-lineage/cleanupReactor.test.ts`         | `thread.deleted` removes the child's row; `project.deleted` removes the project's rows; the startup sweep removes orphans. Waits on a `Deferred` signalled by the handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/src/fork/thread-lineage/lineageView.test.ts`               | Section grouping, siblings exclude the current thread, missing parent, implemented-plan links, fork point for a user message is the previous message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Extension point tests (created with the extension points if missing) | `rpcAuthorization.test.ts` (fork tags have scopes, start with `loom.`, do not collide), `features.test.ts`, `panels/registry.test.ts` (unique ids and launcher letters), `commandPalette` item value test, `fork/keybindings.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Phase 2 adds `nativeFork.test.ts` with fake strategies: `auto` picks native when available,
falls back to transcript otherwise, and the child binding is written before `thread.create`.

No render tests of markup (AGENTS.md).

## Commands

```sh
vp test run apps/server/src/fork/thread-lineage/transcript.test.ts \
  apps/server/src/fork/thread-lineage/ThreadLineageStore.test.ts \
  apps/server/src/fork/thread-lineage/ThreadLineageService.test.ts \
  apps/server/src/fork/thread-lineage/cleanupReactor.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts \
  apps/web/src/fork/thread-lineage/lineageView.test.ts \
  apps/web/src/fork/panels/registry.test.ts

vp lint apps/server/src/fork apps/web/src/fork packages/contracts/src/fork packages/client-runtime/src/fork \
  apps/web/src/components/chat/MessagesTimeline.tsx

vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck   # contracts changed; mobile imports them
```

## Manual check

With Kyle's permission for a dev server and browser (AGENTS.md), on a worktree seeded with a
copy of real data:

1. Open a thread with at least ten messages on Claude. Hover an assistant message in the
   middle, click "Fork from here". The dialog shows the copied count. Choose Conversation,
   New worktree, type "Summarize what we decided so far." Fork. The app opens the child: the
   history is visible up to that message, the first message shows a "Forked conversation"
   chip, and the reply reflects the earlier conversation.
2. Fork from a user message: the dialog is prefilled with that message; the child carries
   only earlier messages.
3. Fork the same thread into Codex (change the model in the dialog). The reply reflects the
   earlier conversation.
4. Open Related threads on the parent: the fork is listed under Forks with its status. Select
   it and send "Thanks" from the compact composer; the reply streams into the pane. Stop a
   running reply from the pane.
5. New sidecar with context None: it opens in the right panel next to the main thread; ask
   a question; the main thread's context is untouched (its own next reply does not mention
   the sidecar).
6. Side by side: open another thread from the launcher's thread picker; widen the panel with
   the layout controls.
7. Unlink the fork: it disappears from Related threads and stays in the sidebar. Delete the
   sidecar thread: it disappears from Related threads.
8. Reload the page and reconnect: panels restore; rows are unchanged.
9. Point the web client at an upstream T3 server (or remove `thread-lineage` from
   `LOOM_SERVER_FEATURES` temporarily): no fork button, panels unavailable, palette items
   absent; a restored panel tab explains itself.
10. Remote: repeat step 1 over the tailnet share (`vp run dev --share`).

Performance check: with the Related panel and two panes open, scroll a long thread and watch
for dropped frames; the profiler must show no continuous re-renders while idle.

## Merge safety

- On the branch: `git merge-tree --write-tree --name-only --no-messages HEAD <newest nightly>`;
  record the result in SEAMS.md. Only marked lines may conflict.
- After Kyle merges to main: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
  synced main.

## Acceptance criteria

- Fork, sidecar, related threads and side by side work on web and desktop, locally and
  remotely.
- No new orchestration event types; the event log after a fork contains only upstream event
  types (check with `SELECT DISTINCT event_type FROM orchestration_events` on the worktree
  database, verifying the table and column names against the migrations first).
- Upstream T3 can open the same database after a rollback (fork tables are ignored).
