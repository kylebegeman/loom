# L28 technical design

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Search for the
quoted code when line numbers drift.

## Overview

```
 provider adapter --runtime events--> ProviderRuntimeIngestion (upstream)
                                          | dispatches thread.session-set (status "error",
                                          | lastError "Codex usage limit reached. ...")
                                          v
                                   orchestration event log
                                          |
            subscribeDomainEvents + readEvents(cursor)   (fork reactor, forkParked)
                                          v
   AutoResumeReactor --classify--> AutoResumeScheduler --> fork_auto_resume_jobs
                                          |  sleeps until the earliest resume_at
                                          v
                            OrchestrationEngineService.dispatch(thread.turn.start)
                            OrchestrationEngineService.dispatch(thread.activity.append)  markers
```

Everything is a fork service inside `ForkLayer`. Nothing in upstream changes: detection
reads events upstream already persists, and resuming uses commands upstream already has
(EXTENSION-POINTS.md, Orchestration rules 2 and 3).

## How upstream reports a usage limit today

| Driver                            | What happens                                                                                                                                                                                                             | Where the reset time is                                                                                                                                  | Citation                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`                           | The turn fails. The adapter replaces the provider sentence with its own `runtime.error` and `turn.completed.errorMessage`: `Codex usage limit reached. The <kind> limit resets in <wait>. <next step>`                   | The instance's usage windows (`ServerProvider.usageLimits.windows[].resetsAt`), merged from `account/rateLimits/updated`; the relative wait in the text  | `apps/server/src/provider/Layers/CodexAdapter.ts:2357-2397`; message built in `apps/server/src/provider/Layers/codexUsageLimits.ts:218-234` (exported `codexUsageLimitMessage`) |
| `claudeAgent`, turn fails         | `failureHint` "Claude usage limit reached. Send the message again once the limit resets." becomes the failed turn's error; `terminal_reason` `blocking_limit` reads "Claude stopped: a usage limit blocked the request." | The preceding `runtime.warning` activity's `payload.detail` (the SDK `rate_limit_event` info, `resetsAt` in epoch seconds); the instance's usage windows | `apps/server/src/provider/Layers/ClaudeAdapter.ts:3306-3318`, `:486-487`, warning at `:3911-3953`, `emitRuntimeWarning` detail at `:2336-2356`                                  |
| `claudeAgent`, turn parked        | The SDK holds the turn; the adapter emits one warning "Claude usage limit reached. This turn is paused until the ... limit resets in ..." and the session stays running                                                  | Warning detail                                                                                                                                           | `ClaudeAdapter.ts:3911-3953`, `docs/user/providers-claude.md:56-62`                                                                                                             |
| `grok`                            | The prompt fails with "Grok usage limit reached. Try again later."                                                                                                                                                       | None                                                                                                                                                     | `apps/server/src/provider/acp/XAiAcpExtension.ts:591-597`                                                                                                                       |
| `cursor`, `opencode`, antigravity | No usage-limit signal found                                                                                                                                                                                              |                                                                                                                                                          | not supported                                                                                                                                                                   |

Ingestion turns a failed `turn.completed` into `thread.session-set` with `status: "error"`
and `lastError: errorMessage` (`apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:1697-1727`),
and a `runtime.error` into the same with `lastError: message` (`:2038-2060`) plus a
`runtime.error` activity (`:494-508`). `OrchestrationSession` carries `status`,
`providerInstanceId`, `activeTurnId`, `lastError` (`packages/contracts/src/orchestration.ts:554-563`).

## Detection

The reactor looks at two event types only:

- `thread.session-set` (payload `ThreadSessionSetPayload`, `orchestration.ts:1864-1867`)
  with `session.status === "error"` and a `lastError` the classifier accepts.
- `thread.activity-appended` with `activity.kind === "runtime.warning"` whose `payload.detail`
  has a numeric `resetsAt`: remembered in memory per thread for 10 minutes as the Claude
  reset hint. Nothing is scheduled from a warning alone.

Classifier (pure, `apps/server/src/fork/auto-resume/classify.ts`):

```ts
export const USAGE_LIMIT_PATTERNS = [
  { driver: "codex", prefix: "Codex usage limit reached." },
  { driver: "claudeAgent", prefix: "Claude usage limit reached." },
  { driver: "claudeAgent", prefix: "Claude stopped: a usage limit blocked the request." },
  { driver: "grok", prefix: "Grok usage limit reached." },
] as const;

export type UsageLimitStop = {
  readonly driver: ProviderDriverKind;
  readonly waitHintMs: number | undefined; // parsed "resets in 3h 20m" / "5d 5h" / "12m"
  readonly workspaceCap: boolean; // Codex credit or spend-limit wording
};

export function classifyUsageLimitStop(lastError: string): UsageLimitStop | null;
```

The prefixes are upstream strings. A test imports upstream's exported `codexUsageLimitMessage`
and asserts the classifier accepts its output for every `rateLimitReachedType`, and a
second test reads `ClaudeAdapter.ts` and `XAiAcpExtension.ts` as text and asserts the
literal prefixes still occur, so an upstream wording change fails the fork tests on the next
merge instead of silently disabling the feature.

Before scheduling, the reactor applies three gates, in order:

1. **Driver off**: the stopped instance's driver is not in `enabledDrivers`: nothing.
2. **Thread off**: the thread is in `fork_auto_resume_threads_off` (the per-thread "Don't
   auto-resume" switch): no schedule and no switch; one marker `loom.auto-resume.off`,
   "Auto-resume is off for this thread."
3. **Workspace cap** (Kyle's decision): `workspaceCap` is true (the Codex stop names
   `workspace_owner_credits_depleted` or a `workspace_*_usage_limit_reached` type) and the
   stopped instance has no window with `usedPercent >= 100` and a future `resetsAt`. Waiting
   cannot help and another account is not tried: the row is written in state
   `needs_attention` with marker `loom.auto-resume.needs-attention`, "Needs attention: <account>
   hit a workspace credit or spend limit. Loom will not retry. Add credits or raise the limit,
   then send a message." When a window with a reset time is also exhausted, the stop is handled
   like any other limit.

Deduplication: a Codex stop produces two `session-set` events (runtime error, then failed
turn). The job key is the thread; a second detection for the same `failedTurnId`
(`session.activeTurnId`, falling back to the thread's `latestTurn.turnId`) is ignored.

## Reset time

In order, first hit wins:

1. **Usage windows.** `ProviderRegistry.getProviders`
   (`apps/server/src/provider/Services/ProviderRegistry.ts:28`) gives `ServerProvider[]`;
   take the stopped instance's `usageLimits.windows`
   (`packages/contracts/src/providerUsageLimits.ts:20-28,50-60`). The reset is the latest
   `resetsAt` among windows with `usedPercent >= 100` and `resetsAt > now`, the same rule
   upstream's message uses (`codexUsageLimits.ts:224-232`).
2. **Claude warning detail** `resetsAt * 1000`, when within 30 days (upstream's own cap,
   `ClaudeAdapter.ts:536`).
3. **Message wait**: `event.occurredAt + waitHintMs`.
4. **Unknown**: probe schedule 30m, 1h, 2h, 4h, 4h, 4h (6 attempts), each probe first calls
   `ProviderRegistry.refreshInstance(instanceId)` (`ProviderRegistry.ts:47-49`) and resumes
   only if no window is at 100% with a future reset.

`resumeAt = resetAt + grace` (default 2 minutes). Before resuming, the scheduler re-reads
the windows; if they still show an exhausted window with a future reset, it moves
`resume_at` to that reset without counting an attempt.

## Account switching

On by default (Kyle's decision, a change from the first draft): when a thread stops on a
limit and another qualifying account exists, Loom moves the thread there right away instead
of waiting for the reset. When none qualifies, the thread waits for the reset on the same
account. Switching runs only when `allowAccountSwitch` is on (the default) and the stop
passed the detection gates (so never for a thread with auto-resume off or a workspace cap).

Candidates are `ServerProvider` entries with the same `driver`, the same
`continuation.groupKey` (`packages/contracts/src/server.ts:146-148,198`), `enabled`,
`isProviderAvailable` (`server.ts:254-255`), `auth.status === "authenticated"`, the thread's
model id in `models`, no window at 100% with a future reset, and included in automatic
switching:

- **Account kind** from `auth.type`: Codex `chatgpt` is a subscription account
  (`apps/server/src/provider/Layers/CodexProvider.ts:97-103,532-545`); Claude reports
  `apiKey` for API keys and the subscription type otherwise
  (`apps/server/src/provider/Layers/ClaudeProvider.ts:139-158`). `apiKey`, `amazonBedrock`,
  and a missing or unknown type count as metered.
- **Included by default**: subscription accounts. Metered accounts (Kyle's `~/.codex_api` and
  `~/.claude_api` instances) are never picked automatically unless their row in settings has
  "Include in automatic switching" on (`accountRules`). A subscription account can be
  excluded the same way.

Order (Kyle's decision): when every candidate reports usage windows (Codex reports an
account's usage once it has been used), pick the most headroom, `100 - max(usedPercent)`,
ties broken by the fixed order. When any candidate has no usage data, use the fixed order
from settings (`accountOrder`; instances not listed come after, sorted by `instanceId`).

Upstream enforces the same group rule when the turn starts
(`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:663-686`,
`apps/server/src/provider/Layers/ProviderService.ts:1438-1457`). Continuation keys are
`codex:home:<shared home>` for Codex, so shadow-home accounts over one shared home qualify
(`apps/server/src/provider/Drivers/CodexHomeLayout.ts:45-66`), and `claude:home:<home>` for
Claude (`apps/server/src/provider/Drivers/ClaudeHome.ts:40-45`).

Claude in practice: Kyle's `~/.claude_N` homes share only `CLAUDE.md`, `settings.json` and
skills, not session history, and each home is its own continuation group, so a Claude thread
has no candidate and waits for the reset on the same account. Follow-up (recorded, not
designed): investigate sharing Claude session folders across homes plus an upstream grouping
change, which would make Claude accounts switchable.

A switch schedules the resume at `now + 10 s` (so Cancel can still win) with
`target_instance_id` set, marker `loom.auto-resume.switching`, and the resume passes
`modelSelection: { ...thread.modelSelection, instanceId: target }`. If the target is no
longer a valid candidate at resume time (signed out, exhausted, disabled), pick again once;
with no candidate left, fall back to waiting for the original account's reset.

## Resuming

Checks right before dispatch (any failing check cancels with a reason):

- The thread exists, is not deleted or archived
  (`ProjectionSnapshotQuery.getThreadShellById`, `ProjectionSnapshotQuery.ts:217-219`).
- `session.status` is not `running` or `starting`.
- No user message newer than the job's `detected_at` (the user took over).

Then:

```ts
const commandId = CommandId.make(`server:loom-auto-resume:${yield * randomUUID}`);
yield *
  engine.dispatch({
    type: "thread.turn.start",
    commandId,
    threadId,
    message: { messageId, role: "user", text, attachments },
    ...(targetInstanceId
      ? { modelSelection: { ...thread.modelSelection, instanceId: targetInstanceId } }
      : {}),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    createdAt: nowIso,
  });
```

`ThreadTurnStartCommand` is at `packages/contracts/src/orchestration.ts:1238-1258`;
upstream dispatches it server-side the same way in
`ProviderCommandReactor.ts:337-351` with a `server:<tag>:<uuid>` command id (pattern from
`apps/server/src/ws.ts:734-735`). `OrchestrationEngineService.dispatch` is at
`apps/server/src/orchestration/Services/OrchestrationEngine.ts:73-76`.

Message choice: if the failed turn has no assistant message
(`latestTurn.assistantMessageId === null`, `orchestration.ts:616-624`) and no activity with
that `turnId` and tone `tool`, resend the text and attachments of the user message whose
`turnId` is the failed turn (a new `messageId`). Otherwise send the configured continue
message. Reading the thread uses `ProjectionSnapshotQuery.getThreadDetailById`
(`ProjectionSnapshotQuery.ts:249-252`).

Our own `thread.turn-start-requested` event carries our `commandId` prefix; the reactor
ignores it when checking for "user took over".

Markers: `thread.activity.append` (`orchestration.ts:1492-1498`) with
`tone: "info"` (`needs-attention` uses `"error"`),
`kind: "loom.auto-resume.<scheduled|resumed|cancelled|gave-up|failed|switching|deferred|needs-attention|off>"`,
`summary` as the PRODUCT.md copy, `payload: { jobId, resumeAt, attempt, instanceId }`,
`turnId: null`. Upstream's work log renders unknown kinds as generic rows
(`apps/web/src/session-logic.ts:451-512` filters only known noise kinds), so markers show on
every client. They are markers, not storage: the job row is the source of truth.

## Cancellation triggers (reactor)

| Event                               | Condition                                           | Result                                                                   |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `thread.turn-start-requested`       | `commandId` not ours                                | cancel "You sent a message"; a `needs_attention` row is cleared silently |
| `thread.session-set`                | `status` `running` or `starting` and not our resume | cancel "A turn is already running"                                       |
| `thread.archived`, `thread.deleted` | any                                                 | cancel silently (deleted: job row and the thread's "off" row removed)    |
| `project.deleted`                   | threads of that project                             | rows removed                                                             |

## Contracts (`packages/contracts/src/fork/auto-resume.ts`)

```ts
export const AUTO_RESUME_WS_METHODS = {
  getSettings: "loom.auto-resume.getSettings",
  setSettings: "loom.auto-resume.setSettings",
  subscribeJobs: "loom.auto-resume.subscribeJobs",
  cancel: "loom.auto-resume.cancel",
  resumeNow: "loom.auto-resume.resumeNow",
  setThreadAutoResume: "loom.auto-resume.setThreadAutoResume",
  dismiss: "loom.auto-resume.dismiss",
} as const;

/** Overrides the default inclusion (subscription accounts in, metered accounts out). */
export const AutoResumeAccountRule = Schema.Struct({
  instanceId: ProviderInstanceId,
  include: Schema.Boolean, // "Include in automatic switching"
});

export const AutoResumeSettings = Schema.Struct({
  enabledDrivers: Schema.Array(ProviderDriverKind), // default ["codex", "claudeAgent", "grok"]
  allowAccountSwitch: Schema.Boolean, // default true
  accountOrder: Schema.Array(ProviderInstanceId), // fixed order when headroom is unknown; default []
  accountRules: Schema.Array(AutoResumeAccountRule), // default []
  continueMessage: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  graceMinutes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(60)), // default 2
  maxAttempts: PositiveInt.check(Schema.isLessThanOrEqualTo(10)), // default 6
});

export const AutoResumeJobState = Schema.Literals(["scheduled", "resuming", "needs_attention"]);
export const AutoResumeJob = Schema.Struct({
  threadId: ThreadId,
  state: AutoResumeJobState,
  driver: ProviderDriverKind,
  instanceId: ProviderInstanceId,
  targetInstanceId: Schema.NullOr(ProviderInstanceId),
  resetAt: Schema.NullOr(IsoDateTime),
  resumeAt: IsoDateTime,
  resetKnown: Schema.Boolean,
  attempt: PositiveInt,
  maxAttempts: PositiveInt,
  reason: Schema.String, // the stop message, truncated to 300 characters
  detectedAt: IsoDateTime,
});

export const AutoResumeJobsSnapshot = Schema.Struct({
  jobs: Schema.Array(AutoResumeJob),
  /** Threads with the per-thread "Don't auto-resume" switch on. */
  threadsOff: Schema.Array(ThreadId),
});
export const AutoResumeThreadInput = Schema.Struct({ threadId: ThreadId });
export const AutoResumeThreadSwitchInput = Schema.Struct({
  threadId: ThreadId,
  enabled: Schema.Boolean,
});

export class AutoResumeError extends Schema.TaggedError<AutoResumeError>()("AutoResumeError", {
  reason: Schema.Literals(["no-pending-resume", "thread-not-found", "invalid-settings"]),
  message: Schema.String,
}) {}
```

RPCs (error: `Schema.Union([AutoResumeError, EnvironmentAuthorizationError])`):

| Tag                   | Payload                       | Success                                                                                   | Stream                        | Scope                   |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------- | ----------------------- |
| `getSettings`         | `{}`                          | `AutoResumeSettings`                                                                      | no                            | `orchestration:read`    |
| `setSettings`         | `AutoResumeSettings`          | `AutoResumeSettings`                                                                      | no                            | `orchestration:operate` |
| `subscribeJobs`       | `{}`                          | `AutoResumeJobsSnapshot` (full snapshot on every change)                                  | yes, `ForkSubscriptionRpcTag` | `orchestration:read`    |
| `cancel`              | `AutoResumeThreadInput`       | `{}`                                                                                      | no                            | `orchestration:operate` |
| `resumeNow`           | `AutoResumeThreadInput`       | `{}`                                                                                      | no                            | `orchestration:operate` |
| `setThreadAutoResume` | `AutoResumeThreadSwitchInput` | `{}` (turning it off also cancels a pending job with reason "turned off for this thread") | no                            | `orchestration:operate` |
| `dismiss`             | `AutoResumeThreadInput`       | `{}` (clears a `needs_attention` row)                                                     | no                            | `orchestration:operate` |

Only pending and attention rows (`scheduled`, `resuming`, `needs_attention`) are in the
snapshot; finished jobs are
history in the table and in the timeline markers.

## Server (`apps/server/src/fork/auto-resume/`)

| File                   | Contents                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classify.ts`          | Patterns, `classifyUsageLimitStop`, `parseWait`. Pure.                                                                                                                                                                                                   |
| `resetTime.ts`         | `resolveResetTime(windows, claudeHint, stop, occurredAt, now)`, `exhaustedUntil(windows, now)`. Pure.                                                                                                                                                    |
| `switchTarget.ts`      | `accountKind(provider)`, `isIncluded(provider, accountRules)`, `pickSwitchTarget({ providers, stopped, modelId, accountOrder, accountRules, nowMs })`. Pure.                                                                                             |
| `AutoResumeStore.ts`   | Repository over the four tables (`SqlClient`, `SqlSchema`, as upstream's `apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`).                                                                                                    |
| `AutoResumeService.ts` | Settings, job changes (`PubSub` of snapshots for `subscribeJobs`), `cancel`, `resumeNow`, `resume(job)`.                                                                                                                                                 |
| `AutoResumeReactor.ts` | `Layer.effectDiscard` started with `forkParked` (`apps/server/src/serverActivation.ts:12-26`): catch up from the cursor with `readEvents(cursor)` then consume `subscribeDomainEvents` (`OrchestrationEngine.ts:47-50,89-93`); plus the scheduler fiber. |
| `migrations.ts`        | `AutoResumeMigrations` (slug `auto-resume`).                                                                                                                                                                                                             |
| `rpc.ts`               | `makeAutoResumeRpcHandlers(auth)`.                                                                                                                                                                                                                       |

Subscribe before catching up (acquire `subscribeDomainEvents`, then read
`readEvents(cursor)` to the subscription's first sequence, dropping duplicates by
`sequence`), so nothing falls between. On first run (no cursor row) the cursor starts at
`latestSequence` (`OrchestrationEngine.ts:100`): old stops are not resumed after install.

Scheduler: one fiber that loops: read the earliest pending `resume_at`; sleep until then
or until woken by a `Queue` signal (any job change); process due jobs one at a time. Sleeps
use `Effect.sleep`, so tests drive them with `TestClock`. A job moves `scheduled` to
`resuming` in the same transaction that reads it, so a restart during a resume cannot run it
twice; on startup, `resuming` rows older than 2 minutes are marked failed with "Server
restarted during resume" (the new turn may or may not have been started; the user sees the
marker and decides).

Dependencies (all available to `ForkLayer`): `SqlClient`, `OrchestrationEngineService`,
`ProjectionSnapshotQuery`, `ProviderRegistry`, `ServerSettingsService` (not written),
`Clock`, `Random`/`Crypto` for ids.

## Storage

Migrations set `auto-resume`, tracking table `fork_migrations_auto_resume`.

```sql
-- 1_Tables
CREATE TABLE IF NOT EXISTS fork_auto_resume_jobs (
  thread_id           TEXT PRIMARY KEY,
  state               TEXT NOT NULL CHECK (state IN
                        ('scheduled','resuming','needs_attention','resumed','cancelled',
                         'gave_up','failed','cleared')),
  driver              TEXT NOT NULL,
  instance_id         TEXT NOT NULL,
  target_instance_id  TEXT,
  failed_turn_id      TEXT,
  reason              TEXT NOT NULL,
  reset_at            TEXT,
  reset_known         INTEGER NOT NULL,
  resume_at           TEXT NOT NULL,
  attempt             INTEGER NOT NULL,
  resume_command_id   TEXT,
  outcome_detail      TEXT,
  detected_at         TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_auto_resume_jobs_due
  ON fork_auto_resume_jobs (state, resume_at);

CREATE TABLE IF NOT EXISTS fork_auto_resume_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_auto_resume_threads_off (
  thread_id   TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_auto_resume_cursor (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  sequence  INTEGER NOT NULL
);
```

- One row per thread: a new stop on a thread with a finished row replaces it, carrying
  `attempt + 1` when the previous row is `resumed` and the new stop comes from the turn it
  started (its `resume_command_id` matches the turn's command), otherwise `attempt = 1`.
- `settings_json` is decoded with `AutoResumeSettings` and a decoding default for every
  field, so older rows keep working as fields are added. Missing row means defaults.
- Retention: rows in a final state older than 14 days are deleted by the scheduler once a
  day. No foreign keys (EXTENSION-POINTS.md, Persistence).

## Clients

Shared atoms (`packages/client-runtime/src/fork/auto-resume.ts`):
`autoResumeJobsAtomFamily` (subscription over `subscribeJobs`, keyed by environment),
`autoResumeSettingsAtomFamily` (query), and commands for `setSettings`, `cancel`,
`resumeNow`, `setThreadAutoResume`, `dismiss` via `createEnvironmentRpcCommand`
(`packages/client-runtime/src/state/runtime.ts:612,646,678`).

Web (`apps/web/src/fork/auto-resume/`):

| File               | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ComposerChip.tsx` | `ForkComposerBlockProps` component: finds the job for `threadRef.threadId`; renders nothing when none or when the environment lacks the feature. "Resumes in 3h 20m" (or "Continuing on <account> in a few seconds" while switching, "Needs attention" for a workspace cap) with Resume now, Cancel (Dismiss for attention), and a menu item "Don't auto-resume this thread". Countdown text from a one-minute `setInterval` started only while a job is shown (the 10 second switch grace shows "in a few seconds", no per-second timer). |
| `composer.ts`      | `FORK_COMPOSER_BLOCKS` entry `{ id: "auto-resume", Component: AutoResumeComposerChip }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `settings.tsx`     | Loom settings section: per-driver toggles; "Switch accounts when one hits a limit" (on) with the qualifying rule; an accounts list per continuation group from the server config's providers (name, "Subscription" or "API key", usage when known, "Include in automatic switching", up and down buttons for the fixed order); continue message, grace, max attempts; pending and attention list across threads with Cancel or Dismiss; threads with auto-resume off, each with "Allow".                                                   |
| `palette.tsx`      | On the active thread: "Resume now after usage limit" and "Cancel auto-resume" when a job is pending; "Don't auto-resume this thread" or "Allow auto-resume for this thread" always.                                                                                                                                                                                                                                                                                                                                                        |
| `format.ts`        | `formatWait(ms)` matching upstream's style (`3h 20m`, `5d 5h`, `12m`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The chip is a footer block, so it hides on narrow composers
(EXTENSION-POINTS.md, Composer: blocks are hidden from the end when space runs out). The
timeline marker still shows there.

## Provider-by-provider decisions

| Driver                        | v1 behavior                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex                         | Supported: detection, reset from windows or message, account switching on by default among subscription shadow-home accounts in one group; workspace caps get "Needs attention".                  |
| Claude (failed turn)          | Supported: detection, reset from warning detail or windows. Waits for the reset on the same account: separate Claude homes are separate groups (follow-up recorded under Account switching).      |
| Claude (parked turn)          | Not handled; Claude continues by itself.                                                                                                                                                          |
| Grok                          | Supported with the probe schedule (no reset time). Whether the message reaches `lastError` verbatim is UNVERIFIED; the implementing agent confirms with a unit test on ingestion or a manual run. |
| Cursor, OpenCode, Antigravity | Not supported: no usage-limit signal.                                                                                                                                                             |

## Agent-facing tools

None.

## Performance

- The reactor inspects two event types and ignores the rest with a tag check; no reads on the
  hot path except for matching events.
- One timer fiber; no polling loop while no job is pending.
- `subscribeJobs` sends the pending list only (normally zero to a handful of rows) on
  change.
- The chip's countdown updates once a minute, only while shown. No animation.

## Alternatives considered

- **Resume through the provider's own thread resume** (old Loom called
  `ProviderRuntimeRecovery.recover` with the stored resume cursor and held back the "turn
  failed" state in ingestion). It needs seams in `ProviderRuntimeIngestion.ts`, one of
  upstream's busiest files, and fails when the provider has no turn to restore. A new turn
  with a visible message is simpler and honest.
- **A new orchestration event such as `thread.resume-scheduled`.** Forbidden: it would make
  the event log unreadable for upstream T3 Code (EXTENSION-POINTS.md, Orchestration rule 1).
- **Polling every few seconds for due jobs** (old Loom polled every 5 s with leases). A
  single process owns the table, so a sleeping fiber woken on change is enough.
- **Doing it on the client.** Clients are often closed overnight.
- **Matching a generic regex** (`/usage limit|rate limit|429/`, old Loom). Too broad (tool
  output and GitHub rate limits can say "rate limit") and it missed Claude's hyphenated
  message. Exact upstream prefixes plus wording-guard tests are narrower and fail loudly.
