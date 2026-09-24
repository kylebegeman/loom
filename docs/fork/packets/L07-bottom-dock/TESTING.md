# L07 testing

Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps. Test the pure logic each
phase adds; do not render components to markup to assert attributes.

## Automated tests

| Phase | File                                                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `apps/web/src/fork/bottom-dock/dockView.test.ts`               | Every row of the one-tab table: closed; terminal with and without registered tabs; fork tab; terminal plus fork tab resolves to terminal; an unknown persisted tab id resolves to closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1     | `apps/web/src/fork/bottom-dock/layout.test.ts`                 | Clamp at 180 px and 75% of the window height; tiny windows never go below the minimum.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1     | `apps/web/src/fork/bottom-dock/store.test.ts`                  | `showDockTab`, `showTerminalTab`, `hideDock` leave upstream's terminal store and the dock store in the expected combination (drive the real zustand stores); `lastForkTab` is remembered; persisted state with an unknown version or tab id loads safely; pruning keeps at most 200 threads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1     | `apps/web/src/fork/bottom-dock/registry.test.ts`               | Tab ids unique, kebab-case, not `"terminal"`; every `command` is in `FORK_KEYBINDING_COMMANDS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2     | `apps/web/src/fork/bottom-dock/tasks/taskModel.test.ts`        | Terminal id helpers and `isTaskTerminalId` (never matches `term-N` or `setup-*`); row state for each `TerminalSummary` combination; ad-hoc index allocation skips existing ids; recent commands dedupe and cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3     | `apps/web/src/fork/bottom-dock/activity/rows.test.ts`          | Built from a real-shaped thread fixture (copy one from `apps/web/src/session-logic.test.ts` fixtures where possible): each source maps to its kind and tone; messages absent with `includeMessages: false` (the default) and present with `true`; noise kinds excluded; streaming assistant partials skipped; newest-first order with sequence tie-break; payloads are not stringified until `detail()`; `detail()` caps at 20 KB.                                                                                                                                                                                                                                                                                                                                                 |
| 3     | `apps/web/src/fork/bottom-dock/activity/search.test.ts`        | Multi-token matching, case-insensitive; chips combine with the query; group by turn keeps order; empty query returns all; `activityEmptyState` returns `only-messages` for a messages-only thread with the toggle off and `empty` for an empty thread.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4     | `apps/web/src/fork/bottom-dock/approvals/grouping.test.ts`     | Only shells with pending flags; archived excluded; oldest first; first 20 marked for details; badge counts threads with approvals only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5     | `apps/server/src/fork/bottom-dock/pendingApproval.test.ts`     | Finds a pending approval by request id; `approval.resolved` and a stale `provider.approval.respond.failed` close it; a non-stale failure keeps it open; `requestKind` falls back from `requestType`; user-input requests are ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5     | `apps/server/src/fork/bottom-dock/decide.test.ts`              | `buildApprovalRiskState` sends only `request_kind`, `app_name` and `request_text`, capped at 4,000 estimated tokens with head and tail kept; the question has exactly the three options; `APPROVAL_RISK_FEATURE` has `agentTool: false` and `packet: "L07"`; `toRiskResult` maps `answered` to `labeled` and every fallback reason, including `low-confidence` with answers, to `none`. (Redaction is `decide`'s job and is tested in `ext-decide`.)                                                                                                                                                                                                                                                                                                                               |
| 5     | `apps/server/src/fork/bottom-dock/ApprovalRiskService.test.ts` | A test layer for `LoomDecide` that returns scripted `DecideResult`s and records its calls (EXTENSION-POINTS.md section 18, "Registering a packet"; TypeSafe is never called), and a fake `ProjectionSnapshotQuery`: an `answered` result gives `labeled` with its confidence; each scripted fallback (`disabled`, `no-key`, `project-off`, `timeout`, `error`, `low-confidence` with answers) gives `none` with that reason; the call uses origin `auto`, the thread's `projectId` and no `threshold`; a resolved request gives `not-pending` without calling `decide`; two concurrent calls for one request id call `decide` once (a `Deferred` gates the scripted result); `timeout` is not cached, `labeled` is; a dispatch spy on the orchestration engine records no command. |

Also run the extension point invariant tests this packet adds entries to:
`packages/contracts/src/fork/keybindings.test.ts` and the palette registry test; in phase 5
also `apps/server/src/fork/rpcAuthorization.test.ts`, `apps/server/src/fork/features.test.ts`
and `apps/server/src/fork/decide/registry.test.ts` (unique ids of the form `<slug>.<name>`,
`packet` like `L07`, threshold between 0 and 1).

## Commands

Phase 1:

```sh
vp test run apps/web/src/fork/bottom-dock packages/contracts/src/fork/keybindings.test.ts
vp lint apps/web/src/fork apps/web/src/components/ChatView.tsx packages/contracts/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
```

Phases 2 to 4: the same `vp test run` path (it covers the new subfolder), lint on
`apps/web/src/fork packages/contracts/src/fork`, and the same two typechecks.

If phase 1 created `ext-core` or `ext-keybindings`, also typecheck `t3`,
`@t3tools/client-runtime` and `@t3tools/mobile` (contracts changed).

Phase 5:

```sh
vp test run apps/server/src/fork/bottom-dock apps/web/src/fork/bottom-dock \
  apps/server/src/fork/rpcAuthorization.test.ts apps/server/src/fork/features.test.ts \
  apps/server/src/fork/decide/registry.test.ts
vp lint apps/server/src/fork apps/web/src/fork packages/contracts/src/fork packages/client-runtime/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

## Manual check

Ask Kyle before starting a dev server or a browser. With permission, on web and once on
desktop, with a seeded worktree `.t3`.

Phase 1 (with no tabs registered, then with one tab registered locally for the check):

1. No tabs: Cmd+J, the header button, splitting, new terminal, closing, resizing, switching
   threads with terminals open, and running a project script all behave as on upstream.
2. One tab registered: the strip appears above the open terminal; clicking the tab swaps
   the terminal for the tab at the same height with a steady transition; Cmd+J swaps back;
   the collapse button closes; each thread remembers its own tab; dragging the tab's top edge
   changes the terminal's height too.
3. Right panel terminal surface still works and its shortcuts still go to it when focused.

Phase 2: add scripts to a project; run the dev server and tests as tasks; select each to
see live output; type into a task that prompts; Stop and Restart; close the dock, switch
threads, come back: tasks still running; "Open in Terminal tab" activates the session; run
and remove an ad-hoc command; reload: recent commands remain.

Phase 3: open a long thread; no message rows show; turn "Messages" on and they appear;
search for a tool name; filter Errors; expand and copy a row; "Load older turns" extends
results; typing stays responsive. A thread with only messages shows "Only chat messages so
far." until the toggle is on.

Phase 4: two threads in Ask mode waiting for approval, one in another environment if
available; both appear; approve one, decline the other; both threads continue; a question
(user input) shows with "Open thread".

Phase 5 (needs Kyle's Jev key in the worktree's server secrets; ask before copying
`secrets`): two threads in Ask mode, one waiting on a `git status` command, one on a command
that deletes an untracked folder. The first shows Read-only, the second Irreversible, each
with the tooltip. Turn "Use Jev" off for "Approval risk badge" in Loom settings, Jev: badges disappear on the next
tab open (the feature row has no "Let agents use this" switch). Turn "Jev off for this
project" on for one project: its approvals show no badge.
Approve and decline work the same with and without badges. The decisions show in the Jev
decision log (and in L29's Decisions panel if L29 is present).

Upstream server: connect to an upstream T3 server and repeat phase 3 on one of its threads;
the dock works (client-only). Phase 4 there shows no risk badges.

Remote: from a second browser over the tailnet, run a task and answer an approval.

## Merge safety

- Before review: the `git merge-tree` preview in SEAMS.md. Expected clean or a ChatView
  conflict on the two marked hunks only.
- After Kyle merges to main: `scripts/fork/loom.sh integrate nightly --dry-run` from a clean,
  synced `main`. Record the result here.
- After each upstream integration, re-check the seam placement (SEAMS.md, Merge check).
