# L28 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder. No real provider account is needed for the automated tests; they feed synthetic
orchestration events.

## File layout

```
packages/contracts/src/fork/auto-resume.ts
packages/client-runtime/src/fork/auto-resume.ts
apps/server/src/fork/auto-resume/
  classify.ts  resetTime.ts  switchTarget.ts  AutoResumeStore.ts  AutoResumeService.ts
  AutoResumeReactor.ts  migrations.ts  rpc.ts  index.ts (exports AutoResumeLive)
  classify.test.ts  resetTime.test.ts  switchTarget.test.ts  AutoResumeStore.test.ts
  AutoResumeReactor.test.ts
  upstreamWording.test.ts
apps/web/src/fork/auto-resume/
  ComposerChip.tsx  composer.ts  settings.tsx  palette.tsx  format.ts  state.ts  format.test.ts
docs/fork/user/auto-resume.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-composer`, `ext-settings`,
   `ext-palette`; create missing ones in their own commits.

2. **Contracts.** `packages/contracts/src/fork/auto-resume.ts` from TECHNICAL.md, with
   `AUTO_RESUME_DEFAULTS` exported for the server and the settings form. Register in
   `fork/index.ts`, `fork/rpc.ts`, and add `subscribeJobs` to `ForkSubscriptionRpcTag`.

3. **Pure logic, test first.**

   ```ts
   // classify.ts
   const WAIT = /resets in (?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?/;
   export function parseWait(text: string): number | undefined {
     const match = WAIT.exec(text);
     if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
     const [d, h, m] = [match[1], match[2], match[3]].map((v) => Number(v ?? 0));
     return ((d * 24 + h) * 60 + m) * 60_000;
   }
   export function classifyUsageLimitStop(lastError: string): UsageLimitStop | null {
     const pattern = USAGE_LIMIT_PATTERNS.find((p) => lastError.startsWith(p.prefix));
     if (!pattern) return null;
     return {
       driver: ProviderDriverKind.make(pattern.driver),
       waitHintMs: parseWait(lastError),
       workspaceCap: /workspace (has no credits|spend limit)/.test(lastError),
     };
   }
   ```

   ```ts
   // resetTime.ts
   export function exhaustedUntil(
     windows: ReadonlyArray<ServerProviderUsageWindow>,
     nowMs: number,
   ): number | undefined {
     let latest: number | undefined;
     for (const w of windows) {
       if (w.usedPercent < 100 || !w.resetsAt) continue;
       const at = Date.parse(w.resetsAt);
       if (Number.isFinite(at) && at > nowMs && (latest === undefined || at > latest)) latest = at;
     }
     return latest;
   }
   export function resolveResetTime(input: {
     windows: ReadonlyArray<ServerProviderUsageWindow> | undefined;
     claudeResetsAtSec: number | undefined;
     stop: UsageLimitStop;
     occurredAtMs: number;
     nowMs: number;
   }): { resetAtMs: number; known: true } | { known: false };
   ```

   ```ts
   // switchTarget.ts
   export type AccountKind = "subscription" | "metered";
   export function accountKind(provider: ServerProvider): AccountKind {
     const type = provider.auth.type;
     if (provider.driver === "codex") return type === "chatgpt" ? "subscription" : "metered";
     if (provider.driver === "claudeAgent")
       return type !== undefined && type !== "apiKey" ? "subscription" : "metered";
     return "metered"; // unknown drivers and types are never picked without an opt-in
   }
   export function isIncluded(
     provider: ServerProvider,
     rules: ReadonlyArray<AutoResumeAccountRule>,
   ): boolean {
     const rule = rules.find((r) => r.instanceId === provider.instanceId);
     return rule ? rule.include : accountKind(provider) === "subscription";
   }
   export function pickSwitchTarget(input: {
     providers: ReadonlyArray<ServerProvider>;
     stopped: ServerProvider;
     modelId: string;
     accountOrder: ReadonlyArray<ProviderInstanceId>;
     accountRules: ReadonlyArray<AutoResumeAccountRule>;
     nowMs: number;
   }): ServerProvider | undefined;
   ```

   `pickSwitchTarget` filters out the stopped instance and keeps entries with the same
   driver, `continuation?.groupKey` (both defined and equal), `enabled`,
   `isProviderAvailable` (`packages/contracts/src/server.ts:254-255`),
   `auth.status === "authenticated"`, the model id present in `models`,
   `exhaustedUntil(...) === undefined`, and `isIncluded`. Order: when every candidate has a
   non-empty `usageLimits.windows`, sort by headroom (`100 - max usedPercent`) descending,
   ties by fixed order; otherwise sort by the fixed order (index in `accountOrder`, unlisted
   last by `instanceId`).

4. **Migrations and store.** `migrations.ts` with id 1 `Tables` (TECHNICAL.md, Storage).
   `AutoResumeStore` methods: `getSettings`, `putSettings`, `getCursor`, `putCursor`,
   `upsertDetected(job)` (ignores a same-turn duplicate, carries `attempt`), `pending()`,
   `earliestDue()`, `claimDue(nowIso)` (update `scheduled` to `resuming` and return rows in one
   transaction), `finish(threadId, state, detail)`, `reschedule(threadId, resumeAt, attempt)`,
   `remove(threadId)`, `pruneFinished(beforeIso)`, `failStaleResuming(beforeIso)`.

5. **Service.** `AutoResumeService` holds a `PubSub<AutoResumeJobsSnapshot>` and a wake
   `Queue<void>`; every store mutation publishes the new pending snapshot and offers a wake.
   `resume(job)`:

   ```ts
   const resume = Effect.fn("AutoResume.resume")(function* (job: StoredJob) {
     const detail = yield* snapshots.getThreadDetailById(job.threadId);
     if (Option.isNone(detail) || detail.value.archivedAt !== null) return yield* cancel(job, "archived");
     const thread = detail.value;
     if (thread.session?.status === "running" || thread.session?.status === "starting")
       return yield* cancel(job, "turn-running");
     if (thread.messages.some((m) => m.role === "user" && m.createdAt > job.detectedAt))
       return yield* cancel(job, "user-message");
     const providers = yield* registry.getProviders;
     // A switch target that stopped qualifying is replaced once (pickSwitchTarget again);
     // with no candidate left, the job falls back to the original account's reset.
     const instance = providers.find((p) => p.instanceId === (job.targetInstanceId ?? job.instanceId));
     const still = instance?.usageLimits ? exhaustedUntil(instance.usageLimits.windows, nowMs) : undefined;
     if (still !== undefined) return yield* defer(job, still + graceMs); // no attempt consumed
     const { text, attachments } = chooseMessage(thread, job, settings.continueMessage);
     const commandId = CommandId.make(`server:loom-auto-resume:${yield* uuid}`);
     yield* store.markResuming(job.threadId, commandId);
     const dispatched = yield* engine.dispatch({ type: "thread.turn.start", commandId, threadId: job.threadId,
       message: { messageId: MessageId.make(yield* uuid), role: "user", text, attachments },
       ...(job.targetInstanceId ? { modelSelection: { ...thread.modelSelection, instanceId: job.targetInstanceId } } : {}),
       runtimeMode: thread.runtimeMode, interactionMode: thread.interactionMode, createdAt: nowIso,
     }).pipe(
       Effect.as(true),
       Effect.catch((error) => fail(job, describe(error)).pipe(Effect.as(false))),
     );
     if (!dispatched) return;
     yield* store.finish(job.threadId, "resumed");
     yield* marker(job.threadId, "resumed", ...);
   });
   ```

   Pass `detail.value.messages` through a bounded window if `getThreadDetailById` accepts a
   query (it takes an optional `ProjectionThreadDetailQuery`); only the last turn's
   messages and activities are needed.

6. **Reactor.** `AutoResumeReactor.ts`:

   ```ts
   export const AutoResumeReactorLive = Layer.effectDiscard(
     forkParked(
       Effect.gen(function* () {
         const engine = yield* OrchestrationEngineService;
         const live = yield* engine.subscribeDomainEvents; // subscribe first
         const cursor = yield* store.getCursor.pipe(
           Effect.flatMap(
             Option.match({
               onNone: () => engine.latestSequence.pipe(Effect.tap(store.putCursor)),
               onSome: Effect.succeed,
             }),
           ),
         );
         const catchUp = engine.readEvents(cursor, 10_000);
         yield* Stream.concat(catchUp, live).pipe(
           Stream.filter(dedupeBySequence()),
           Stream.runForEach((event) =>
             handle(event).pipe(
               Effect.catchCause((cause) =>
                 Effect.logWarning("auto-resume event failed", { cause }),
               ),
               Effect.andThen(store.putCursor(event.sequence)),
             ),
           ),
           Effect.forkScoped,
         );
         yield* scheduler.pipe(Effect.forkScoped);
       }),
     ),
   );
   ```

   `handle` covers the tables in TECHNICAL.md (detection with its three gates: driver off,
   thread off with the `off` marker, workspace cap with a `needs_attention` row and marker;
   Claude hint cache; cancellation). On a stop that passes the gates, with
   `allowAccountSwitch` on, call `pickSwitchTarget` first: a target schedules at `now + 10 s`
   with the `switching` marker; no target schedules at the reset on the same account.
   `scheduler` loops over `earliestDue`, `Effect.sleep` raced with `wake.take`, then
   `claimDue` and `resume` each job sequentially. The cursor advances after every event,
   whether its handler succeeded or failed (a failure is logged), so one bad event can never
   block the stream or be retried forever.

   Settings changes: disabling a driver cancels its pending jobs with reason "disabled".
   `setThreadAutoResume(threadId, false)` inserts into `fork_auto_resume_threads_off` and
   cancels that thread's pending job ("turned off for this thread"); `true` deletes the row.
   `dismiss` moves a `needs_attention` row to `cleared`.

7. **Handlers and registration.** `rpc.ts` (the stream handler wraps `withForkRuntime` with
   `Stream.unwrap`, as in the `ext-core` pattern), scopes, `LOOM_SERVER_FEATURES`,
   `ForkServices`, `ForkServicesLive`, `FORK_MIGRATION_SETS`.

8. **Client runtime and web.** Atoms; `ComposerChip.tsx`:

   ```tsx
   export function AutoResumeComposerChip({
     environmentId,
     threadRef,
     size,
   }: ForkComposerBlockProps) {
     const supported = useLoomFeature(environmentId, "auto-resume");
     const jobs = useAtomValue(autoResumeJobsAtom(environmentId));
     const job = supported ? findJob(jobs, threadRef.threadId) : undefined;
     const now = useMinuteClock(job !== undefined); // setInterval(60_000) only while shown
     if (!job) return null;
     return (
       <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
         <TimerIcon className="size-3" />
         {job.state === "resuming"
           ? "Resuming"
           : `Resumes in ${formatWait(Date.parse(job.resumeAt) - now)}`}
         <Button size={size} variant="ghost" onClick={resumeNow}>
           Resume now
         </Button>
         <Button size={size} variant="ghost" onClick={cancel}>
           Cancel
         </Button>
       </span>
     );
   }
   ```

   Add the other chip states from TECHNICAL.md (switching, needs attention with Dismiss) and a
   small menu with "Don't auto-resume this thread". Use upstream's button, menu and tooltip
   primitives from `apps/web/src/components/ui/`; the tooltip shows the local time and
   account. `settings.tsx` uses `SettingsSection` /
   `SettingsRow` (`apps/web/src/components/settings/settingsLayout.tsx`); the accounts list
   reads the environment's providers from the server config the settings page already has,
   groups them by `continuation.groupKey`, shows each account's kind with upstream's auth
   label, and edits `accountRules` and `accountOrder`. `palette.tsx` returns the resume and
   cancel items only for an active thread with a pending job, and the per-thread toggle for
   any active thread; to know that synchronously it reads the jobs atom value (including
   `threadsOff`) from the web atom registry.

9. **Docs.** `docs/fork/user/auto-resume.md`: what triggers it, which providers, how to
   cancel or take over, the per-thread switch, account switching (on by default, which
   accounts qualify, why API-key accounts need an opt-in, the order rule, and why Claude
   accounts wait for the reset), "Needs attention" for workspace credit and spend limits,
   that the continue message is visible, and that turns Claude pauses by itself are left
   alone. Set the
   packet index Status.

## Pitfalls

- A resume's own turn can stop on a limit again. That is a new stop for the same thread:
  carry `attempt + 1` only when the stop follows our resume command; a user-started turn
  resets the count.
- Do not treat every `thread.session-set` with status `running` as the user taking over:
  our own resume causes one. Compare with `resume_command_id` via the
  `thread.turn-start-requested` event's `commandId` first.
- `thread.activity.append` markers must not trigger the reactor (they are
  `thread.activity-appended` with kind `loom.auto-resume.*`; skip them explicitly).
- `readEvents` has a page limit; loop until caught up to the subscription's first sequence.
- Never block the event consumer on the scheduler: detection writes a row and offers a wake;
  resuming happens in the scheduler fiber.
- The provider snapshot can be stale for an instance that has not run recently; that is why
  the resume-time recheck may defer, and why unknown resets probe with `refreshInstance`.
- Keep marker summaries under `TrimmedNonEmptyString` rules (non-empty, trimmed) and short.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A synthetic Codex stop schedules a job for the window's reset plus grace, and at that time
  (TestClock) exactly one `thread.turn.start` is dispatched with the continue message.
- A user message in between cancels it; archiving cancels it; a restart mid-schedule keeps
  it; a restart mid-resume marks it failed rather than resuming twice.
- With default settings and a second Codex subscription account in the same group, a Codex
  stop continues on it after the 10 second grace; an API-key account in the same group is
  never picked until "Include in automatic switching" is on.
- A Claude stop with a second Claude home configured waits for the reset on the same
  account.
- A workspace credit stop with no exhausted window gets one "Needs attention" marker and no
  schedule.
- A thread with "Don't auto-resume" on gets the "off" marker and no schedule.
- Upstream wording-guard tests pass.
