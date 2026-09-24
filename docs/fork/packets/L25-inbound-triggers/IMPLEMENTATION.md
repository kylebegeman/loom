# L25 implementation plan

Ordered for one agent; each phase leaves the tree compiling and can be its own commit
(`feat(fork-inbound-triggers): ...`). Both phases are required. Webhooks are a follow-up and
not part of this packet.

## Before starting

- The packet is approved by Kyle (2026-09-24), polling through `gh` only.
- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Seed a worktree `.t3` from real data. Never enable a trigger with `approval: "auto"`
  against a real repository during development; use `dryRun` and recorded responses.
- Capture real `gh api` responses once for fixtures (issues, notifications, actions runs,
  jobs) from a repository Kyle names, strip anything private, and commit them under
  `apps/server/src/fork/inbound-triggers/fixtures/`.

## Phase 1: server

1. Extension points: existence checks for `ext-core`, `ext-settings`, `ext-palette`,
   `ext-web-root`, `ext-keybindings`; create missing ones exactly as specified.
2. Contracts: `packages/contracts/src/fork/inbound-triggers.ts` (TECHNICAL.md), export,
   merge the group, add `typeof INBOUND_TRIGGERS_WS_METHODS.subscribeInbox` to
   `ForkSubscriptionRpcTag`, add `"loom.inbound-triggers.open"` to the keybinding list.
   Typecheck contracts.
3. Pure modules, test first:
   - `templates.ts`: `DEFAULT_TEMPLATES` per kind, `renderPrompt`.
   - `guards.ts`: `decideApproval`.
   - `sources.ts`: decoders and `toIncomingEvents(kind, response, context)` for each kind;
     `eventKeyFor`, `externalKeyFor`; subject URL parsing for notifications.
   - `ids.ts`: `triggerThreadId(triggerId, eventKey)` (SHA-256 to UUID form), command and
     message ids.
4. `migrations.ts` and `store.ts` (definitions, state, events with insert-or-ignore on the
   unique key, links, settings).
5. `github.ts`: `ghApi(args)` wrapper over `VcsProcess.run`, error classification, cached
   login.
6. `starter.ts`: model resolution (copy the order from
   `apps/server/src/serverRuntimeStartup.ts:207-262`), worktree creation mirroring
   `apps/server/src/ws.ts:1303-1470` (base ref, start from origin, temporary branch),
   `thread.create`, the setup script through `ProjectSetupScriptRunner.runForThread` with the
   three thread activities and the non-async wait (TECHNICAL.md, Starter), `thread.turn.start`,
   and the follow-up path.
7. `InboundTriggers.ts`: service methods for every RPC; `pollOnce` (settings, triggers,
   shared user-wide fetches, per-trigger fetches, insert, decide, auto-start, retry
   waiting, prune); the inbox summary in a `SubscriptionRef` with a revision counter.
8. `poller.ts`: `InboundTriggersPollerLive` with `forkParked` and the host check.
9. `rpc.ts`: handlers; `subscribeInbox` uses `auth.stream`.
10. Register: service layer and poller layer in `ForkServicesLive`, service in
    `ForkServices`, migration set, `"inbound-triggers"` in `LOOM_SERVER_FEATURES`, handlers,
    scopes.
11. Typecheck `t3`.

Deterministic id sketch:

```ts
import { createHash } from "node:crypto";

export function triggerHash(triggerId: string, eventKey: string): string {
  return createHash("sha256").update(`${triggerId}\0${eventKey}`).digest("hex");
}

export function triggerThreadId(hash: string): ThreadId {
  // Format 32 hex chars as a UUID-shaped string (version nibble 5 for readability).
  const h = hash.slice(0, 32).split("");
  h[12] = "5";
  h[16] = ((Number.parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return ThreadId.make(
    `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`,
  );
}

export const triggerCommandId = (
  hash: string,
  step: "create" | "setup-requested" | "setup-started" | "setup-failed" | "turn",
) => CommandId.make(`server:loom-trigger:${hash.slice(0, 16)}:${step}`);
```

## Phase 2: web

1. `packages/client-runtime/src/fork/inbound-triggers.ts` atoms; export.
2. `apps/web/src/fork/inbound-triggers/state.ts`.
3. `triggersSearch.ts` (pure, tested), `TriggersPage.tsx`, `InboxList.tsx`,
   `TriggerEditor.tsx` with `dryRun`, `DryRunResults.tsx`.
4. `notificationPrefs.ts`, `InboxNotifier.tsx` (system notification for events that wait
   on the user, in-app toasts for the rest; `inboxNotifier.logic.ts` holds the pure diff of
   two summaries into `{ waiting, informational }`) and `ShortcutHost.tsx`; register in
   `FORK_ROOT_COMPONENTS`.
5. `settingsSection.tsx` (environment-scoped: on or off, interval 1 to 120 minutes with
   default 5, "Check now", "Open triggers"; per device: the two notification switches and
   "Allow notifications"). "Check now" also goes in the Inbox header and on each trigger
   row.
6. `palette.tsx`.
7. Route file (SEAMS.md) and route tree regeneration.
8. Typecheck client-runtime and web.

## Documentation

`docs/fork/user/inbound-triggers.md`: what triggers watch (mentions only in the project's own
repository), the Inbox, auto-start guards, that triggered worktree threads run the project's
setup script, the check interval and "Check now", notifications (system notification for
events waiting on you, toasts for the rest, both switchable per device), that Loom must be
running to poll, and how to turn it off. FORK.md rows, packet index Status.

## Pitfalls

- `gh api` with `-f` on a GET adds query parameters only with `-X GET`; without it `gh`
  switches to POST. Always pass `-X GET`.
- `since` on `/issues` filters by `updated_at`, so old issues reappear on any update; the
  unique event key keeps them from firing twice.
- The REST `labels` parameter is AND across comma-separated labels; query one label at a
  time for OR.
- Notification `subject.url` can be null (for example for some CI activity); skip those.
- `workflow_run` `created` filter uses dates, not times; the overlap plus dedupe handles
  the granularity.
- Worktree creation is not idempotent; store the path before dispatching and reuse it on
  retry. The same goes for the setup script: record `setup_state` before waiting, and skip
  the script on a retry that finds it set.
- The setup script opens a terminal for the thread, so run it after `thread.create`, never
  before (upstream drains deletions through the create for the same reason,
  `apps/server/src/ws.ts:1400-1404`).
- `Notification` must be constructed only when permission is `granted`, and
  `requestPermission` only from a click; wrap construction in try/catch as upstream does.
- `thread.turn.start` for a thread whose session is running may be rejected or queued by
  upstream; the follow-up path checks first and uses `waiting`.
- The poller must never hold the semaphore while starting many threads in a row with long
  git work; start at most three events per tick and leave the rest pending for the next.
- Never interpolate event text into shell commands; everything goes through argv arrays and
  orchestration messages.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- With the feature on and one `issue-assigned` trigger in ask mode, assigning a test issue
  produces exactly one pending Inbox event within one interval, and Start creates exactly
  one thread even when Start is clicked twice or retried after a failure.
- A CI failure on a Loom thread's branch posts one follow-up to that thread after it is idle.
- Nothing polls when the feature is off.
- A worktree thread started from a trigger in a project with a setup script shows the setup
  script activities and its terminal, and the agent's turn starts after a non-async script
  finishes.
- With Loom in the background, a new "Ask me first" event raises one system notification on
  the desktop app; an auto-started thread raises none, only a toast once Loom is visible.
