# L25 testing

Focused tests, no repo-wide checks, no sleeps. The poll loop is never tested with time;
tests call `pollOnce` and wait on its completion.

## Automated tests

| File                                                              | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/inbound-triggers/templates.test.ts`         | Every token replaced; unknown tokens kept; body clamped; output clamped; no template evaluation beyond plain replacement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/inbound-triggers/guards.test.ts`            | ask always pending; auto with private repo, trusted author, own login starts; public repo with unknown author stays pending with the reason; missing project stays pending.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/inbound-triggers/sources.test.ts`           | Recorded responses per kind: repository filtering, PR exclusion for assigned, one request per label, notification reasons and subject URL parsing (including null), CI runs filtered to thread branches; event and external keys.                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/inbound-triggers/ids.test.ts`               | Same inputs give the same thread and command ids; different event keys differ; thread id is UUID-shaped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/server/src/fork/inbound-triggers/store.test.ts`             | Migrations twice on `SqlitePersistenceMemory`; duplicate `(trigger_id, event_key)` ignored; status transitions; prune keeps pending events.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/server/src/fork/inbound-triggers/InboundTriggers.test.ts`   | With a stub `gh` (test `VcsProcess` answering `command: "gh"` from fixtures) and a real orchestration engine on `SqlitePersistenceMemory` (use the server's existing test harness for the engine): `pollOnce` inserts one pending event; `startEvent` twice creates one thread (assert on the read model); a failure after worktree creation reuses the stored path on retry (stub `GitWorkflowService`); ci-failure follow-up waits while the thread session is running and dispatches after it goes idle; feature off means `pollOnce` does nothing; a new trigger does not fire for items updated before its creation. |
| `apps/server/src/fork/inbound-triggers/webhook.test.ts` (phase 3) | Valid signature accepted; wrong signature 401; oversized body 413; ping 200; same event key as polling for the same issue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/web/src/fork/inbound-triggers/triggersSearch.test.ts`       | Search param validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Find the engine test harness with `rg -l "OrchestrationEngineLive|makeOrchestrationEngine" apps/server/src --glob '*.test.ts'`
and reuse its layer setup rather than stubbing `dispatch`, so the dedupe-by-command-id
behavior is real.

## Commands

```sh
vp test run apps/server/src/fork/inbound-triggers apps/web/src/fork/inbound-triggers
vp lint apps/server/src/fork/inbound-triggers apps/web/src/fork/inbound-triggers \
  packages/contracts/src/fork/inbound-triggers.ts packages/client-runtime/src/fork/inbound-triggers.ts \
  apps/web/src/routes/loom.triggers.tsx
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web build   # regenerates routeTree.gen.ts
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

Needs Kyle's permission for a dev server and a browser, and a test repository he chooses
(private, so nothing leaks). Seeded worktree `.t3`, `gh` signed in on the machine.

1. Settings, Loom, Inbound triggers: turn on, interval 2 minutes.
2. Create an `issue-assigned` trigger for the test project, ask mode. "Test" shows current
   assigned issues without recording them. Save.
3. On GitHub, open an issue and assign it to yourself. Within two minutes (or after "Check
   triggers now") the Inbox shows it and a toast appears.
4. Start with plan mode. A new thread appears in a new worktree, its first message is the
   rendered prompt, and the branch is renamed after the first turn. Start again from the
   palette or a second tab: no second thread.
5. Dismiss another event; Restore it.
6. Push a failing commit on the thread's branch (Kyle's choice of test). The run fails; the
   thread receives one follow-up once idle.
7. Turn the feature off; "Check triggers now" does nothing; no gh processes run (check with
   the server log).
8. Upstream-server case: the page says "Inbound triggers need a Loom server"; palette items
   are hidden; no toasts.

## Acceptance criteria

- One thread per external object, even across retries and double clicks.
- New triggers ignore the backlog.
- Nothing polls while the feature is off; polling continues with no client open.
- Public-repository events from untrusted authors never auto-start.
- Loom never writes to GitHub.

## Merge safety

Run the preview in CONVENTIONS.md ("Merge safety"); only the route tree may conflict from
this packet. After Kyle merges, run `scripts/fork/loom.sh integrate nightly --dry-run` from a
clean, synced `main`.
