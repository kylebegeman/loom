# L29 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Four phases; each ends in a
usable state and can be reviewed on its own.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md (sections
  1 to 10 and 18) and this folder. Work in a worktree.
- Seed the worktree's `.t3` with a `VACUUM INTO` copy of real data (AGENTS.md, "Test data")
  so threads with turns, diffs and approvals exist for the context builders.
- The TypeSafe API key: Kyle pastes it into Settings, Loom, Jev in the dev app during the
  manual pass. It is stored by `ServerSecretStore` under the worktree's `.t3`. Never write it
  into a file, a test, a fixture, a log or a commit. Tests use a scripted `fetch`.
- Do not start dev servers or browsers without Kyle's permission.

## File layout

```
packages/contracts/src/fork/jev-hub.ts
packages/client-runtime/src/fork/jev-hub.ts
packages/client-runtime/src/fork/jevLint.ts        jevLint.test.ts
packages/client-runtime/src/fork/jevCost.ts        jevCost.test.ts
apps/server/src/fork/jev-hub/
  decide.ts  migrations.ts  HubStore.ts
  buckets.ts  contextShapes.ts  ContextBuilder.ts
  scoring.ts  draftBrief.ts  JevHubService.ts
  rpc.ts  mcp.ts
  *.test.ts
apps/web/src/fork/jev-hub/
  state.ts  panel.tsx  DecisionsPanel.tsx
  LogTab.tsx  DecisionDetail.tsx  AnswerView.tsx  RatingControls.tsx
  PlaygroundTab.tsx  ContextPreview.tsx  QuestionBuilder.tsx
  TemplatesTab.tsx  exportRequest.ts  exportRequest.test.ts
  TuningTab.tsx  CalibrationChart.tsx  DraftCard.tsx  composerFill.ts
  palette.tsx  commands.ts
docs/fork/user/jev-hub.md
```

## Phase 1: log, ratings, playground on pasted text, `loom_jev_hub_ask`

1. **Extension points.** Existence checks for `ext-core`, `ext-settings`, `ext-decide`,
   `ext-panels`, `ext-web-root`, `ext-keybindings`, `ext-palette`, `ext-mcp`, in that order.
   Create any missing one exactly as specified, one commit each
   (`feat(fork): add the <name> extension point`), with its FORK.md rows and its own tests
   and typechecks. For `ext-decide`, follow section 18 byte for byte, including the Jev
   settings section and the retention job; if a cited upstream line has moved, fix it
   minimally and update section 18 in the same commit (EXTENSION-POINTS.md, rule 3).
2. **Contracts.** `packages/contracts/src/fork/jev-hub.ts` from TECHNICAL.md with the tags
   phase 1 serves (`listDecisions`, `getDecision`, `rateDecision`, `deleteDecisions`,
   `subscribeChanges`, `run`, `listTemplates`, `saveTemplate`, `deleteTemplate`); each later
   phase adds its own tags with their handlers, so the exhaustive group never needs stubs.
   Export from `fork/index.ts`, merge `JevHubRpcGroup` in `fork/rpc.ts`, add
   `subscribeChanges` to `ForkSubscriptionRpcTag` (replace `never` or append with `|`;
   `replay` joins `ForkStreamCommandRpcTag` in phase 3). Typecheck contracts.
3. **Server, part 1.**
   - `decide.ts` (two features) appended to `FORK_DECIDE_FEATURES`.
   - `migrations.ts` (migration 1, all five tables) in `FORK_MIGRATION_SETS`.
   - `HubStore.ts` (templates now; the rest of the SQL can land with its phase).
   - `JevHubService.ts` with `run`, template CRUD, and pass-throughs to
     `LoomDecide.log` (list, get, rate, delete, changes).
   - `rpc.ts`: handlers for the phase 1 tags.
   - Register `JevHubService.layer` in `ForkServicesLive` (after `LoomDecide.layer`, or
     `Layer.provide` it), the service in `ForkServices`, `"jev-hub"` in
     `LOOM_SERVER_FEATURES`, scopes in `FORK_RPC_REQUIRED_SCOPES`.
   - `mcp.ts`: `loom_jev_hub_ask` only; toolkit registration in `ForkMcpToolkitsLive`.
   - Tests: `JevHubService.test.ts` (run, templates, ratings through a test `LoomDecide`
     over `SqlitePersistenceMemory` with a scripted fetch), `mcp.test.ts` (ask).
4. **Client runtime.** `jevCost.ts` with its test; `jev-hub.ts` atoms for phase 1.
5. **Web.** `state.ts`, `panel.tsx` (id `jev-hub`, letter `J`), `DecisionsPanel.tsx` (tabs,
   setup and banner states, deep link), `LogTab.tsx`, `DecisionDetail.tsx`, `AnswerView.tsx`,
   `RatingControls.tsx`, a first `PlaygroundTab.tsx` with the pasted source and inline JSON
   questions, `palette.tsx`, `commands.ts` (`loom.jev-hub.open` in
   `FORK_KEYBINDING_COMMANDS`, unbound). The first-run notice uses
   `loom:jev-hub:send-notice:v1` in localStorage inside try/catch.
6. **Checks** (TESTING.md). Commit
   `feat(fork-jev-hub): see and rate every Jev decision, and try questions in a playground`.

## Phase 2: context builders, question builder, templates

7. **Server.** `buckets.ts`, `contextShapes.ts` (pure, test-first), `ContextBuilder.ts`
   (service over `ProjectionSnapshotQuery`, `CheckpointDiffQuery`, `WorkspaceFileSystem`),
   the `buildContext` tag and handler. Tests: `buckets.test.ts`, `contextShapes.test.ts`,
   `ContextBuilder.test.ts`.
8. **Client runtime.** `jevLint.ts` and its test (the rule table in TECHNICAL.md).
9. **Web.** `ContextPreview.tsx`, `QuestionBuilder.tsx` (guided form, live lint),
   `TemplatesTab.tsx` (list, editor, "Use for this feature" and "Revert to built-in wording"
   through `loom.decide.updateFeature`, delete with the "In use by" confirmation),
   `exportRequest.ts` and its test; the playground gains source pickers, templates and
   "Add to test set" (the test set RPC lands in phase 3; until then the button is not
   rendered).
10. **Checks.** Commit
    `feat(fork-jev-hub): build Jev context from threads and lint saved question templates`.

## Phase 3: test sets, replay, calibration, model pin

11. **Server.** `scoring.ts` (pure, test-first), test item store and tags with handlers
    (`listTestItems`, `saveTestItem`, `deleteTestItems`, with `setKept`), `featureStats`,
    the replay runner (`replay` in `ForkStreamCommandRpcTag`, concurrency 4,
    `LoomDecide.evaluate`, retries, cancellation), `listReplays`, `calibration`,
    `recordTuning`. Tests: `scoring.test.ts`,
    `replay.test.ts`, `calibration.test.ts`, test items in `JevHubService.test.ts`.
12. **Web.** `TuningTab.tsx` (feature list, test set, replay with the cost estimate,
    calibration with `CalibrationChart.tsx`, set and clear threshold, pin and unpin with the
    model list from `loom.decide.testKey` plus `modelsSeen`, the model-change notice, "Delete
    all decisions"). "Add to test set" in the log detail and the playground.
13. **Checks.** Commit
    `feat(fork-jev-hub): tune each Jev feature with test sets, replays and calibration`.

## Phase 4: agent drafting

14. **Server.** `draftBrief.ts` (pure, test-first), the `startDraft`, `closeDraft` and
    `listDrafts` tags,
    `loom_jev_hub_submit` with the gate from `draftGateFeature`, per-index rejects, redaction and
    budget of submitted states, limits, expiry. Tests: `draftBrief.test.ts`, submit cases in
    `mcp.test.ts`.
15. **Web.** `DraftCard.tsx` (in Tuning and on each template), `composerFill.ts` (append to
    the thread's composer through `useComposerDraftStore`, never send), the agent switch
    warning with an inline switch, the "Install the TypeSafe skill in Skills" button only
    when `skill-registry` is in `loomFeatures` (opens `forkPanelSurface("skill-registry")`),
    "From agent" badges, unlabeled items with the agent's hint.
16. **Docs.** `docs/fork/user/jev-hub.md`: what the Decisions panel is for, adding the key
    (link to the Jev settings), what is sent and what is removed, retention, how to rate and
    build a test set, how thresholds and pinning work, drafting with an agent (the brief is
    only filled in, and the TypeSafe skill is optional), the catalog of Jev features in
    short. Update the packet index Status.
17. **Checks.** Commit `feat(fork-jev-hub): draft better Jev questions with an agent`.

## Code sketches

Replay runner core:

```ts
const runReplay = (featureId: string, candidate: ReplayCandidate) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const decide = yield* LoomDecide;
      const settings = yield* decide.settings;
      const feature = settings.features.find((f) => f.id === featureId);
      if (!feature)
        return yield* new JevHubError({ reason: "not-found", message: "Unknown feature." });
      const items = yield* store.labeledItems(featureId);
      const runnable = items.filter((item) => !isProjectOff(settings, item.projectId));
      const baselineModel = feature.model ?? JEV_DEFAULT_MODEL;
      const progress = yield* Queue.unbounded<ReplayEvent>();
      const work = Effect.forEach(
        runnable,
        (item, index) =>
          Effect.all([
            ask(decide, item, feature.overrides, baselineModel),
            ask(
              decide,
              item,
              candidate.overrides ?? feature.overrides,
              candidate.model ?? baselineModel,
            ),
          ]).pipe(
            Effect.map(([before, after]) => scoreItem(item, before, after)),
            Effect.tap(() =>
              Queue.offer(progress, { _tag: "progress", done: index + 1, total: runnable.length }),
            ),
          ),
        { concurrency: JEV_HUB_LIMITS.replayConcurrency },
      ).pipe(
        Effect.map((results) =>
          summarize(featureId, feature, candidate, results, items.length - runnable.length),
        ),
        Effect.tap((result) => store.saveReplay(result)),
        Effect.flatMap((result) => Queue.offer(progress, { _tag: "done", result })),
        Effect.ensuring(Queue.shutdown(progress)),
      );
      yield* Effect.forkScoped(work);
      return Stream.fromQueue(progress);
    }),
  );
// `ask` = decide.evaluate({ state, questions: applyQuestionOverrides(item.questions, overrides), model },
//   { timeoutMs: 10_000, retries: 3 }) mapped to Either so one failed item never stops the run.
```

(The `done` counter should count completions, not indexes; use a `Ref` counter. Effect
module names follow the installed version.)

Composer fill:

```ts
export function appendToComposer(threadRef: ScopedThreadRef, text: string): void {
  const store = useComposerDraftStore.getState();
  const current = store.getComposerDraft(threadRef)?.prompt ?? "";
  store.setPrompt(
    threadRef,
    current.trim().length === 0 ? text : `${current.trimEnd()}\n\n${text}`,
  );
}
```

Verify the mounted composer reflects an external `setPrompt` (L06 records the same check);
if it does not while mounted, fall back to the composer handle's `insertTextAtEnd`
(`apps/web/src/components/chat/ChatComposer.tsx:1216-1256`) and record the finding in
TECHNICAL.md.

## Pitfalls

- **The key never leaves the server.** No RPC returns it, no log prints it, exports use
  `$TYPESAFE_API_KEY`. A test searches every RPC response JSON for the test key.
- **Never bypass `ext-decide`.** Do not construct a `JevClient` in L29; runs use `decide`,
  replays `evaluate`, so redaction, budget, modes and the project switch always apply.
- **What is logged is what was sent.** The preview's state goes back to `run` unchanged; do
  not rebuild context on run.
- **Files.** Reject absolute paths and `..` before `WorkspaceFileSystem.readFile` (it accepts
  absolute host paths). `.env*` is refused, not redacted silently.
- **Buckets, not numbers.** No exact count, size, date or duration goes into a built state;
  the preview's `facts` carry the exact values for the user only.
- **Score correctness** uses the most probable level, never the interpolated `score`.
- **Thresholds** apply to Choice and Score only; "Set threshold" is disabled for Noul keys.
- **Labels are the user's.** Agent `expected` values go into `suggested`, never `labels`.
- **Replays** do not write `fork_decide_decisions`, honor "Jev off for this project", stop on
  Cancel, and never retry beyond 3 per call.
- **Draft gate** uses `draftGateFeature`: `jev-hub.playground` for features with
  `agentTool: false`.
- **Composer fill never sends** and appends rather than replacing a draft.
- **Deep link** reads `surface.resourceId` only as an initial selection.
- **No animation** in bars, charts or progress; static SVG and CSS widths.
- **The group is exhaustive**: add a tag, its handler and its scope in the same step.
- Never commit `pnpm-lock.yaml` (this packet adds no dependency).

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A playground run on a real thread's last turn shows the same state in the preview and in
  the logged decision, with `.env` content and a planted token redacted.
- Rating a decision and adding it to a test set survives the 30-day purge (checked in tests
  with `TestClock`).
- A replay of a 20-item test set shows before and after accuracy and can be cancelled.
- Setting a threshold from Tuning changes the next `decide` result of that feature (a
  low-confidence answer becomes a fallback) without a restart.
- "Draft with an agent" fills the composer without sending; the agent's `loom_jev_hub_submit`
  creates a draft template and unlabeled items only while the gate switch is on.
- No Jev UI appears on an upstream server or on a Loom server without `decide`.
