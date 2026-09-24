# L29 technical design

All upstream citations are to this fork at upstream v0.0.42 (`a931bd85f3`). Line numbers
drift; search for the quoted code. Jev facts are from <https://docs.typesafe.ai> as cached on
2026-09-24 (`/api`, `/models`, `/confidence`, `/concepts/state`, `/primitives`,
`/primitives/advanced`, `/model-jaggedness/jev-1.13`, `/agent-skill`).

## Overview

```
 ext-decide (EXTENSION-POINTS.md section 18)          L29 jev-hub
 ------------------------------------------          -----------------------------------------------
 LoomDecide.decide / evaluate                <----   JevHubService: run, templates, test items,
 DecisionLog (fork_decide_decisions): list, get,    <----     drafts, tuning notes
   rate, setKept, remove, changes                    ContextBuilder: thread, turn, diff, approval,
 redactState, fitBudget, diffExcerpt,        <----     file, pasted  (buckets computed in code)
   applyQuestionOverrides                            ReplayRunner (evaluate, concurrency 4)
 Jev settings section, loom.decide.* RPCs    <----   calibration, scoring (pure)
                                                     rpc.ts (loom.jev-hub.*), mcp.ts (loom_jev_hub_ask,
                                                       loom_jev_hub_submit), decide.ts (2 features)
                                                                 |
                              client-runtime: jevLint, jevCost, atoms
                                                                 |
                         web: Decisions panel (J): Log | Playground | Templates | Tuning
```

- `ext-decide` owns the Jev client, the key, modes, the per-project switch, redaction, the
  budget, diff excerpts, question overrides and the `fork_decide_decisions` log with its 30-day
  purge. L29 never talks to TypeSafe directly: runs go through `LoomDecide.decide` (logged)
  and replays through `LoomDecide.evaluate` (unlogged).
- L29 adds the server services that build context, store templates, test items, replays,
  drafts and tuning notes, and the web panel that shows and edits all of it.
- Lint and cost are pure client-runtime functions, so the question builder reacts per
  keystroke without RPCs.

## Registered decide features

`apps/server/src/fork/jev-hub/decide.ts`, appended to `FORK_DECIDE_FEATURES`:

```ts
export const jevHubDecideFeatures: ReadonlyArray<DecideFeature> = [
  {
    id: "jev-hub.playground",
    packet: "L29",
    label: "Playground and agent drafts",
    description:
      "Questions you run in the Decisions panel. Let agents use this also allows agent drafts for features without their own agent switch.",
    defaultMode: "manual",
    agentTool: true, // loom_jev_hub_submit
  },
  {
    id: "jev-hub.ask",
    packet: "L29",
    label: "Ask Jev from agents",
    description:
      "Agents run a template or a question with loom_jev_hub_ask. Off for agents until you allow it.",
    defaultMode: "manual",
    agentTool: true, // loom_jev_hub_ask
  },
];
```

`jev-hub.ask` in `manual` mode makes `decide` return `agent-not-allowed` for the tool (its
only caller), which is the "off until allowed" rule; turning on "Let agents use this" moves
it to `manual-agents`.

The draft gate (`loom_jev_hub_submit`) is the target feature's "Let agents use this": its mode
must be `manual-agents`. A feature registered with `agentTool: false` (L07's approval risk,
L08's compare ranking, L14's Auto preset) has no such switch, so for it the gate is
`jev-hub.playground`'s mode instead. `draftGateFeature(feature)` returns the id to check.

Neither feature passes a `threshold`; playground results are shown whatever their
confidence, so a playground run that falls below a configured threshold still shows its
answers from the `low-confidence` fallback.

## Contracts

File `packages/contracts/src/fork/jev-hub.ts`, exported from `fork/index.ts`, group merged in
`fork/rpc.ts`. It imports the Jev and decision schemas from `./decide.ts` (`ext-decide`).

```ts
export const JEV_HUB_WS_METHODS = {
  listDecisions: "loom.jev-hub.listDecisions",
  getDecision: "loom.jev-hub.getDecision",
  rateDecision: "loom.jev-hub.rateDecision",
  deleteDecisions: "loom.jev-hub.deleteDecisions",
  subscribeChanges: "loom.jev-hub.subscribeChanges",
  buildContext: "loom.jev-hub.buildContext",
  run: "loom.jev-hub.run",
  listTemplates: "loom.jev-hub.listTemplates",
  saveTemplate: "loom.jev-hub.saveTemplate",
  deleteTemplate: "loom.jev-hub.deleteTemplate",
  featureStats: "loom.jev-hub.featureStats",
  listTestItems: "loom.jev-hub.listTestItems",
  saveTestItem: "loom.jev-hub.saveTestItem",
  deleteTestItems: "loom.jev-hub.deleteTestItems",
  replay: "loom.jev-hub.replay",
  listReplays: "loom.jev-hub.listReplays",
  calibration: "loom.jev-hub.calibration",
  recordTuning: "loom.jev-hub.recordTuning",
  startDraft: "loom.jev-hub.startDraft",
  closeDraft: "loom.jev-hub.closeDraft",
  listDrafts: "loom.jev-hub.listDrafts",
} as const;

export const JEV_HUB_LIMITS = {
  pageSizeMax: 100,
  runQuestionsMax: 20,
  templatesMax: 500,
  templateNameMax: 80,
  testItemsPerFeature: 500,
  replayConcurrency: 4,
  replayTimeoutMs: 10_000,
  replayRetries: 3,
  replaysKeptPerFeature: 20,
  playgroundTimeoutMs: 10_000,
  pastedCharsMax: 400_000,
  fileBytesMax: 256 * 1024,
  threadMessagesMax: 60,
  messageCharsMax: 4_000,
  draftTtlHours: 24,
  draftSubmissionsPerCall: { drafts: 5, edgeCases: 20 },
  draftEdgeCasesMax: 100,
  calibrationMinPoints: 30,
} as const;

/** TypeSafe price on 2026-09-24 (https://docs.typesafe.ai/models). Subject to change. */
export const JEV_INPUT_PRICE_USD_PER_MTOK = 0.042;
export const JEV_PRICE_AS_OF = "2026-09-24";

/** Where a context builder reads from. At most one source per kind in one build. */
export const ContextSource = Schema.Union([
  Schema.TaggedStruct("thread", { messages: Schema.optionalKey(PositiveInt) }), // default 20, max threadMessagesMax
  Schema.TaggedStruct("turn", { turnId: Schema.optionalKey(TurnId) }), // default: the latest settled turn
  Schema.TaggedStruct("diff", {
    scope: Schema.Literals(["turn", "thread"]),
    turnCount: Schema.optionalKey(NonNegativeInt), // default: latest
    maxTokens: Schema.optionalKey(PositiveInt), // default 8,000
  }),
  Schema.TaggedStruct("approval", { requestId: Schema.optionalKey(Schema.String) }), // default: the oldest pending
  Schema.TaggedStruct("file", { path: TrimmedNonEmptyString.check(Schema.isMaxLength(1_024)) }), // workspace-relative only
  Schema.TaggedStruct("pasted", {
    text: Schema.String.check(Schema.isMaxLength(JEV_HUB_LIMITS.pastedCharsMax)),
  }),
]);

export const ContextPreview = Schema.Struct({
  state: Schema.Json, // exactly what a run will send
  redactions: Schema.Array(Redaction), // from ext-decide: path, kind, count
  trimmed: Schema.Array(Trim), // from ext-decide
  budget: Schema.Struct({ before: BudgetReport, after: BudgetReport, fits: Schema.Boolean }),
  /** Exact values behind the buckets, for the preview only; never sent. */
  facts: Schema.Array(
    Schema.Struct({ name: Schema.String, value: Schema.String, bucket: Schema.String }),
  ),
  warnings: Schema.Array(Schema.String), // "No pending approval in this thread."
});

export const JevTemplate = Schema.Struct({
  id: Schema.String, // "tpl_<uuid>"
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(JEV_HUB_LIMITS.templateNameMax)),
  /** Attach to a feature and question key to allow "Use for this feature". */
  featureId: Schema.NullOr(Schema.String),
  questionKey: Schema.NullOr(Schema.String),
  question: JevQuestion,
  notes: Schema.String.check(Schema.isMaxLength(2_000)),
  /** A sample state kept with the template for export and the playground. */
  sampleState: Schema.NullOr(Schema.Json),
  source: Schema.Literals(["user", "agent"]),
  draftId: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

/** A label for one question: a Choice option key, a Score level index, or Noul yes/no. */
export const JevExpected = Schema.Union([Schema.String, NonNegativeInt, Schema.Boolean]);

export const TestItem = Schema.Struct({
  id: Schema.String, // "tst_<uuid>"
  featureId: Schema.String,
  source: Schema.Literals(["decision", "playground", "agent"]),
  decisionId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(ProjectId),
  state: Schema.Json, // redacted and fitted when stored
  questions: JevQuestions,
  labels: Schema.Record(Schema.String, JevExpected), // empty: unlabeled
  /** The agent's expected answers for its edge cases. A hint, never a label. */
  suggested: Schema.NullOr(Schema.Record(Schema.String, JevExpected)),
  note: Schema.String,
  estimatedTokens: NonNegativeInt,
  createdAt: IsoDateTime,
  labeledAt: Schema.NullOr(IsoDateTime),
});

export const ReplayCandidate = Schema.Struct({
  /** Wording overrides to test; omitted keeps the feature's current overrides. */
  overrides: Schema.optionalKey(Schema.Record(Schema.String, DecideQuestionOverride)),
  /** Model to test; omitted keeps the feature's current model. */
  model: Schema.optionalKey(TrimmedNonEmptyString),
  label: Schema.String, // "Template 'Risk v2' on jev-1.13.0"
});

export const ReplayItemResult = Schema.Struct({
  itemId: Schema.String,
  byKey: Schema.Record(
    Schema.String,
    Schema.Struct({
      expected: JevExpected,
      before: Schema.NullOr(JevAnswer), // null when the call failed
      after: Schema.NullOr(JevAnswer),
      beforeCorrect: Schema.NullOr(Schema.Boolean),
      afterCorrect: Schema.NullOr(Schema.Boolean),
    }),
  ),
  error: Schema.NullOr(Schema.String),
});

export const ReplayResult = Schema.Struct({
  id: Schema.String, // "rpl_<uuid>"
  featureId: Schema.String,
  baseline: Schema.Struct({ model: Schema.String, overridesLabel: Schema.String }),
  candidate: ReplayCandidate,
  accuracy: Schema.Record(
    Schema.String, // question key, plus "all"
    Schema.Struct({ n: NonNegativeInt, before: Schema.Number, after: Schema.Number }),
  ),
  counts: Schema.Struct({
    items: NonNegativeInt,
    fixed: NonNegativeInt,
    broke: NonNegativeInt,
    errors: NonNegativeInt,
    skipped: NonNegativeInt,
  }),
  answeredBy: Schema.Struct({
    before: Schema.Array(Schema.String),
    after: Schema.Array(Schema.String),
  }), // versioned ids
  inputTokens: NonNegativeInt,
  items: Schema.Array(ReplayItemResult),
  createdAt: IsoDateTime,
});

export const ReplayEvent = Schema.Union([
  Schema.TaggedStruct("progress", { done: NonNegativeInt, total: NonNegativeInt }),
  Schema.TaggedStruct("done", { result: ReplayResult }),
]);

export const Calibration = Schema.Struct({
  featureId: Schema.String,
  questionKey: Schema.String,
  source: Schema.Literals(["ratings", "replay"]),
  model: Schema.NullOr(Schema.String),
  n: NonNegativeInt,
  bins: Schema.Array(
    Schema.Struct({
      from: Schema.Number,
      to: Schema.Number,
      count: NonNegativeInt,
      accuracy: Schema.NullOr(Schema.Number),
    }),
  ),
  sweep: Schema.Array(
    Schema.Struct({
      threshold: Schema.Number,
      coverage: Schema.Number,
      accuracy: Schema.NullOr(Schema.Number),
      n: NonNegativeInt,
    }),
  ),
});

export const FeatureStats = Schema.Struct({
  featureId: Schema.String,
  registered: Schema.Boolean, // false: rows from a feature no longer registered ("Removed feature")
  last30Days: Schema.Struct({
    decisions: NonNegativeInt,
    answered: NonNegativeInt,
    fallbacks: Schema.Record(Schema.String, NonNegativeInt), // reason -> count
    inputTokens: NonNegativeInt,
  }),
  rated: Schema.Struct({ right: NonNegativeInt, wrong: NonNegativeInt }),
  modelsSeen: Schema.Array(
    Schema.Struct({ model: Schema.String, lastSeenAt: IsoDateTime, count: NonNegativeInt }),
  ),
  testItems: Schema.Struct({ labeled: NonNegativeInt, unlabeled: NonNegativeInt }),
  tuning: Schema.NullOr(
    Schema.Struct({
      thresholdModel: Schema.NullOr(Schema.String),
      thresholdSetAt: Schema.NullOr(IsoDateTime),
    }),
  ),
  lastReplay: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      createdAt: IsoDateTime,
      before: Schema.Number,
      after: Schema.Number,
    }),
  ),
});

export const DraftRequest = Schema.Struct({
  id: Schema.String, // "drf_<uuid>"
  featureId: Schema.String,
  threadId: ThreadId,
  templateId: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  closedAt: Schema.NullOr(IsoDateTime),
  submitted: Schema.Struct({ drafts: NonNegativeInt, edgeCases: NonNegativeInt }),
});

export class JevHubError extends Schema.TaggedError<JevHubError>()("JevHubError", {
  reason: Schema.Literals([
    "not-found",
    "thread-not-found",
    "no-pending-approval",
    "file-excluded", // .env* or a user-excluded path
    "file-outside-workspace",
    "file-too-large",
    "state-purged",
    "unlabeled",
    "limit",
    "name-taken",
    "invalid-question",
    "unavailable", // no key, Jev off, project off (message says which)
    "storage",
  ]),
  message: Schema.String,
}) {}
```

| Tag                | Payload                                                                                                               | Success                                                      | Scope                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------- |
| `listDecisions`    | `DecisionQuery` (ext-decide)                                                                                          | `DecisionPage` (ext-decide)                                  | `orchestration:read`    |
| `getDecision`      | `{ decisionId }`                                                                                                      | `DecisionRecord`                                             | `orchestration:read`    |
| `rateDecision`     | `{ decisionId, rating: DecisionRating \| null }`                                                                      | `DecisionRecord`                                             | `orchestration:operate` |
| `deleteDecisions`  | `{ decisionIds } \| { featureId }`                                                                                    | `{ deleted }`                                                | `orchestration:operate` |
| `subscribeChanges` | `{}`                                                                                                                  | stream of `{ decisionId, featureId }`                        | `orchestration:read`    |
| `buildContext`     | `{ threadId, sources: ContextSource[], questions: JevQuestions }`                                                     | `ContextPreview`                                             | `orchestration:read`    |
| `run`              | `{ threadId, state: Json, questions: JevQuestions, featureId? }`                                                      | `{ result: DecideResult, decision: DecisionRecord \| null }` | `orchestration:operate` |
| `listTemplates`    | `{ featureId? }`                                                                                                      | `{ templates: JevTemplate[] }`                               | `orchestration:read`    |
| `saveTemplate`     | `JevTemplate` fields without `id`/timestamps, plus optional `id`                                                      | `JevTemplate`                                                | `orchestration:operate` |
| `deleteTemplate`   | `{ id }`                                                                                                              | `{}`                                                         | `orchestration:operate` |
| `featureStats`     | `{ featureId? }`                                                                                                      | `{ features: FeatureStats[] }`                               | `orchestration:read`    |
| `listTestItems`    | `{ featureId }`                                                                                                       | `{ items: TestItem[] }` (state included, capped per item)    | `orchestration:read`    |
| `saveTestItem`     | `{ fromDecisionId } \| { featureId, state, questions, labels, note, source: "playground" } \| { id, labels?, note? }` | `TestItem`                                                   | `orchestration:operate` |
| `deleteTestItems`  | `{ ids }`                                                                                                             | `{ deleted }`                                                | `orchestration:operate` |
| `replay`           | `{ featureId, candidate: ReplayCandidate, questionKeys? }`                                                            | stream of `ReplayEvent`                                      | `orchestration:operate` |
| `listReplays`      | `{ featureId }`                                                                                                       | `{ replays: ReplayResult[] }` without `items`                | `orchestration:read`    |
| `calibration`      | `{ featureId, questionKey, source, model?, since? }`                                                                  | `Calibration`                                                | `orchestration:read`    |
| `recordTuning`     | `{ featureId, thresholdModel: string \| null }`                                                                       | `FeatureStats`                                               | `orchestration:operate` |
| `startDraft`       | `{ featureId, threadId, templateId? }`                                                                                | `{ draft: DraftRequest, prompt: string, agentsAllowed }`     | `orchestration:operate` |
| `closeDraft`       | `{ draftId }`                                                                                                         | `DraftRequest`                                               | `orchestration:operate` |
| `listDrafts`       | `{ featureId? }`                                                                                                      | `{ drafts: DraftRequest[] }`                                 | `orchestration:read`    |

Every error union is `Schema.Union([JevHubError, EnvironmentAuthorizationError])`.
`subscribeChanges` goes into `ForkSubscriptionRpcTag` and `replay` into
`ForkStreamCommandRpcTag` (`fork/rpc.ts`). Settings, modes, thresholds, pinned models,
overrides and the model list use `ext-decide`'s `loom.decide.*` RPCs directly; L29 adds no
second path to them.

## Server

Directory `apps/server/src/fork/jev-hub/`.

| File                | Contents                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `decide.ts`         | The two `DecideFeature` entries above.                                                                                          |
| `migrations.ts`     | `JevHubMigrations` (slug `jev-hub`), migration 1 (Storage).                                                                     |
| `HubStore.ts`       | Repository: templates, test items, replays, drafts, tuning. SQL only.                                                           |
| `buckets.ts`        | Pure bucket functions and their label sets.                                                                                     |
| `contextShapes.ts`  | Pure: turn projection rows and diffs into the state fragments below.                                                            |
| `ContextBuilder.ts` | Service: reads threads, diffs, approvals and files through upstream services, then `contextShapes`, `redactState`, `fitBudget`. |
| `scoring.ts`        | Pure: `isCorrect`, `answerLabel`, accuracy, calibration bins and sweep.                                                         |
| `draftBrief.ts`     | Pure: builds the drafting prompt.                                                                                               |
| `JevHubService.ts`  | Service: run, templates, test items, replays (`ReplayRunner` inside), calibration, feature stats, drafts, agent submissions.    |
| `rpc.ts`            | `makeJevHubRpcHandlers(auth)`.                                                                                                  |
| `mcp.ts`            | `loom_jev_hub_ask`, `loom_jev_hub_submit`.                                                                                      |

Registrations: `JevHubService.layer` in `ForkServicesLive` (it depends on `LoomDecide`, so
it is listed after `LoomDecide.layer` inside `ForkServicesLive`, or provided with
`Layer.provide` if the merge order does not satisfy it), `JevHubService` in `ForkServices`,
`"jev-hub"` in `LOOM_SERVER_FEATURES`, `JevHubMigrations` in `FORK_MIGRATION_SETS`,
`jevHubDecideFeatures` in `FORK_DECIDE_FEATURES`, handlers in `ForkRpcGroup.of`, scopes in
`FORK_RPC_REQUIRED_SCOPES`, `JevHubToolkitRegistrationLive` in `ForkMcpToolkitsLive`.

### Buckets (`buckets.ts`)

Jev reads numbers and dates as text (jaggedness rules 2 and 3), so every count, size, age and
duration in a built state is a label from a fixed list. The exact value is kept in the
preview's `facts` for the user and is never sent.

```ts
export const bucket = (
  value: number,
  edges: ReadonlyArray<number>,
  labels: ReadonlyArray<string>,
) => labels[edges.findIndex((edge) => value < edge)] ?? labels[labels.length - 1]!;

export const countBucket = (n: number) =>
  bucket(n, [1, 2, 6, 21, 101], ["none", "one", "2 to 5", "6 to 20", "21 to 100", "more than 100"]);
export const linesBucket = (n: number) =>
  bucket(
    n,
    [50, 200, 1_000, 5_000],
    [
      "under 50 lines",
      "50 to 200 lines",
      "200 to 1,000 lines",
      "1,000 to 5,000 lines",
      "over 5,000 lines",
    ],
  );
export const durationBucket = (ms: number) =>
  bucket(
    ms,
    [60_000, 600_000, 3_600_000, 86_400_000, 604_800_000],
    [
      "under a minute",
      "1 to 10 minutes",
      "10 to 60 minutes",
      "1 to 24 hours",
      "1 to 7 days",
      "over a week",
    ],
  );
export const ageBucket = (from: Date, now: Date) => durationBucket(now.getTime() - from.getTime());
```

### Context builders (`ContextBuilder.ts`, `contextShapes.ts`)

`build({ threadId, sources, questions })` resolves the thread with
`ProjectionSnapshotQuery.getThreadShellById` and the project with `getProjectShellById`
(`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:174,217`), runs each
source, merges the fragments into one object (each under its own key), then applies
`redactState` with the environment's redaction settings and `fitBudget` against the
questions. Fragment shapes (oldest items first, so `fitBudget` trims the oldest):

| Source     | Reads                                                                                                                                                                                        | Fragment                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thread`   | `getThreadDetailSnapshot(threadId, { turnLimit })` (`ProjectionSnapshotQuery.ts:270-273`, window `OrchestrationThreadDetailWindow`, `packages/contracts/src/orchestration.ts:973-976`)       | `thread: { title, provider, model, turns: countBucket, age: ageBucket, last_activity: ageBucket }`, `messages: [{ role, text }]` (last N user and assistant messages, each capped at 4,000 characters, compaction messages skipped) |
| `turn`     | the same snapshot; the turn's user message, final assistant message, activities; `CheckpointDiffQuery.getTurnDiff` (`apps/server/src/checkpointing/CheckpointDiffQuery.ts:45-47`) for counts | `turn: { status, duration: durationBucket, files_changed: countBucket, lines_changed: linesBucket }`, `user_message`, `assistant_message`, `activity: [{ kind, summary }]` (last 30)                                                |
| `diff`     | `getTurnDiff` for `scope: "turn"`, `getFullThreadDiff` (`CheckpointDiffQuery.ts:54-56`) for `"thread"`, then `diffExcerpt`                                                                   | `diff: { scope: "last turn" \| "whole thread", files: countBucket, lines_changed: linesBucket, languages: string[] }`, `files: [{ path, added: linesBucket, removed: linesBucket, included }]`, `excerpt`                           |
| `approval` | thread activities with `kind === "approval.requested"` and no matching resolution (payload built in `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:435-466`)              | `approval: { kind: requestKind, request_type, detail, app }`, `pending_approvals: countBucket`                                                                                                                                      |
| `file`     | `WorkspaceFileSystem.readFile({ cwd, relativePath })` (`apps/server/src/workspace/WorkspaceFileSystem.ts:114-120`), cwd = the thread's worktree or the project root                          | `file: { path, language, lines: linesBucket }`, `content`                                                                                                                                                                           |
| `pasted`   | the payload                                                                                                                                                                                  | JSON that parses to an object or array is used as is under `pasted`; anything else becomes `pasted: { text }`                                                                                                                       |

Rules:

- **Languages** come from file extensions through a small fixed map (`.ts` TypeScript, `.swift`
  Swift, ...), computed in code.
- **Files:** only workspace-relative paths. `readFile` also accepts absolute host paths
  (`packages/contracts/src/project.ts:199-204`); the builder rejects any absolute path or
  `..` segment with `file-outside-workspace` before calling it. `.env*` and user-excluded
  paths fail with `file-excluded` ("This file is never sent to Jev."), not a silent
  redaction. Over 256 KB fails with `file-too-large`.
- **Approval:** none pending gives `no-pending-approval`, shown as a warning in the preview.
- **Thread and turn** read with a window (`turnLimit`) so a long thread is not loaded whole.
- The builder never calls TypeSafe; it only prepares and previews.

### Runs (`JevHubService.run`)

`run({ threadId, state, questions, featureId })`:

1. `featureId` defaults to `jev-hub.playground`; any other value must be a registered
   feature (a user trying a feature's own question on real context).
2. Decode the questions with `JevQuestions` and cap them at `runQuestionsMax` (20). The hard
   API limits (255 options, 2 to 10 levels, the budget) are enforced inside `LoomDecide`;
   lint warnings are client-side only (server code does not import client-runtime).
3. `LoomDecide.decide(featureId, { state, questions }, { origin: "user", threadId, timeoutMs: 10_000 })`.
   `decide` re-applies redaction and budget (idempotent on a previewed state), so what is
   logged is what was sent.
4. Return the result with the logged `DecisionRecord` (null when nothing was sent).

### Templates

Stored in `fork_jev_hub_templates` with a unique `name` (case-insensitive). `saveTemplate`
validates the question with `JevQuestion` and the hard limits (255 options, 2 to 10 levels,
non-empty instructions); lint warnings are client-side only. "Use for this feature" is a
client action: it builds a `DecideQuestionOverride` from the template (`instructions`,
`criteria`, `templateName`) and calls `loom.decide.updateFeature` with the feature's
existing overrides plus this key. "Revert to built-in wording" removes the key. The server
does not need a join: `ext-decide` stores the override itself, so deleting a template does
not change a feature's wording; the Templates tab says "In use by <feature>" and asks before
deleting such a template.

### Test sets

- **From a decision** (`saveTestItem { fromDecisionId }`): requires a rating and an unpurged
  state (`unlabeled`, `state-purged` otherwise). Labels: for each rated key, "right" becomes
  the answer's own value (`answerLabel`: the chosen option, the most probable Score level,
  or `noul >= 0.5`), "wrong" becomes `expected`. Copies state and questions, then
  `LoomDecide.log.setKept(decisionId, true)`. Deleting the last item made from a decision
  calls `setKept(decisionId, false)`.
- **From the playground**: same, from a run's decision (the run is logged under
  `jev-hub.playground`), with a target feature chosen in the menu (default the template's
  feature).
- **From agents**: unlabeled, with `suggested` (see Agent drafting).
- Limit 500 items per feature (`limit`). States are stored as sent (already redacted and
  fitted) with `estimated_tokens` for cost estimates.

### Scoring (`scoring.ts`)

```ts
/** The answer's value in label terms. Score uses the most probable level, never the interpolated score. */
export const answerLabel = (answer: JevAnswer): string | number | boolean =>
  answer.type === "choice"
    ? answer.choice
    : answer.type === "noul"
      ? answer.noul >= 0.5
      : Number(maxBy(Object.entries(answer.probabilities), ([, p]) => p)[0]);

export const isCorrect = (answer: JevAnswer, expected: string | number | boolean) =>
  answerLabel(answer) === expected;
```

Jev 1.13's Score levels are weak in numerical calibration (jaggedness, "Math using score"),
so correctness uses the most probable level. Confidence is `answerConfidence` from
`ext-decide`.

### Replay (`ReplayRunner`, inside `JevHubService`)

`replay({ featureId, candidate, questionKeys? })` is a stream command:

1. Load the feature's current settings (`LoomDecide.settings`): overrides and model
   (`jev-latest` when unpinned). Load labeled items; skip items whose project now has "Jev off
   for this project" (counted as `skipped`).
2. For each item, baseline questions = `applyQuestionOverrides(item.questions,
current.overrides)`; candidate questions = the same with `candidate.overrides` when given.
   Items keep their stored state.
3. Call `LoomDecide.evaluate` for baseline and candidate with `replayTimeoutMs` (10 s) and
   `replayRetries` (3, with backoff honoring `retry-after`), 4 items at a time
   (`Effect.forEach` with `concurrency: 4`). The concurrency stays well under TypeSafe's
   documented 1,200 requests per minute.
4. Emit `progress` after each item; interrupting the stream (Cancel, or the client going away)
   stops the work.
5. Score per key and overall; count fixed (wrong before, right after) and broke; record the
   versioned models that answered; sum `inputTokens`.
6. Store the result in `fork_jev_hub_replays`, keep the newest 20 per feature, emit `done`.

When both sides use the same wording and model (a pure version check after `jev-latest`
moved), the runner still makes both calls: the stored answers may come from an older model.

The client shows an estimate before starting: labeled items times 2 times their
`estimatedTokens`, priced with `JEV_INPUT_PRICE_USD_PER_MTOK`. Replays are not written to
`fork_decide_decisions`.

### Calibration

`calibration({ featureId, questionKey, source, model?, since? })`:

- `source: "ratings"`: decisions of the feature with answers (answered or low-confidence) and
  a rating for `questionKey`, filtered to one answering model (default: the most recent one)
  and optionally since a date. Point = (`answerConfidence`, correct). For Choice and Score
  that is the API's `confidence`, the value `decide` gates on; for Noul it is the distance
  from 0.5, shown for insight only.
- `source: "replay"`: the newest replay's candidate side for that key.
- Bins: ten equal confidence bins with count and accuracy (null when empty).
- Sweep: thresholds 0.00 to 0.95 in steps of 0.05; `coverage` = share of points at or above,
  `accuracy` = accuracy of those, `n` = their count.

`ext-decide` applies a feature's threshold to every Choice and Score answer of a call that
passes none (EXTENSION-POINTS.md section 18), so "Set threshold" is offered only for Choice
and Score question keys; for a Noul key it is disabled with "Noul cut-offs are set in the
feature's code." When a feature asks several Choice or Score questions, one threshold
covers all of them; the sweep for each key shows what it would do to that key.

Setting a threshold from the chart calls `loom.decide.updateFeature({ featureId, threshold })`
and then `recordTuning({ featureId, thresholdModel })` with the model the calibration used,
so Tuning can warn when later answers come from another model. "Clear threshold" sends
`threshold: null` and `recordTuning` with null.

### Models

The pin menu lists `loom.decide.testKey`'s models (`GET /v1/models`, aliases such as
`jev-latest`) plus every versioned id in `FeatureStats.modelsSeen`, and accepts a typed id
(TypeSafe accepts versioned ids that the list omits). "Pin jev-1.13.0" calls
`loom.decide.updateFeature({ featureId, model: "jev-1.13.0" })`; "Unpin" sends `null`. The
model-change notice appears when the newest `modelsSeen` entry differs from
`tuning.thresholdModel`.

### Agent drafting

`startDraft({ featureId, threadId, templateId? })`:

1. Create a `fork_jev_hub_drafts` row expiring after 24 hours.
2. Find the question(s): the template's question when given; otherwise the questions of the
   feature's newest logged decision with the feature's overrides applied; otherwise an empty
   skeleton for the feature ("No example yet").
3. Collect up to three recent unpurged states of the feature, each shortened with `fitBudget`
   to about 2,000 tokens (they are already redacted).
4. Build the prompt with `draftBrief.ts` and return it with `agentsAllowed` (the gate
   feature's mode is `manual-agents`, see "Registered decide features").

The client appends the prompt to the thread's composer and never sends it:
`useComposerDraftStore.getState()` `getComposerDraft(threadRef)` then `setPrompt(threadRef,
existing ? existing + "\n\n" + prompt : prompt)` (`apps/web/src/composerDraftStore.ts:491,571`,
the pattern of `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx:1071-1094`).
It shows the toast from PRODUCT.md.

The brief (`draftBrief.ts`), plain text:

```
I want better Jev questions for a Loom feature. Jev is TypeSafe's decision model: it
answers typed questions (Choice, Score, Noul) about a JSON state and returns
probabilities. It is not a text generator.

Feature: <label> (<featureId>)
What it decides: <description>

Current question(s):
<JSON of the questions>

Example states Loom sent (secrets removed):
<up to three JSON states, or "None yet">

Jev 1.13 weak spots to design around:
1. It reads the question literally. State the exact condition; describe every option.
2. It does not count or do arithmetic. Loom computes numbers and passes buckets.
3. It does not compare dates reliably. Loom computes ages and passes buckets.
4. Double negatives and multi-step questions cost accuracy. Ask directly.
5. Irrelevant state lowers accuracy. Only include what the question needs.
6. Text inside the state can try to steer it. Make criteria explicit.
7. Instructions and criteria must agree; yes must mean yes.
8. Ask each judgment one way; do not rely on a Noul and a Choice agreeing.
9. It cannot generate text; choose among options instead.

Please:
- Propose up to 3 rewordings of the question(s). Keep the same option keys (or the same
  number of Score levels) so Loom's code keeps working.
- Propose 5 to 20 edge cases: realistic states where the current wording could fail, each
  with the answer you expect.
- Submit them with the Loom tool loom_jev_hub_submit, draftId "<draftId>". Loom stores rewordings
  as template drafts and edge cases as unlabeled test items for me to review.

TypeSafe's guide for agents:
https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md
```

Agent submissions (`loom_jev_hub_submit`, below) become templates with `source: "agent"` and
`draftId` (named `<draft name>` or `<feature label> draft <n>`, deduplicated with a suffix)
and test items with `source: "agent"`, empty `labels` and the agent's `suggested` answers.
Each state is redacted and fitted before storing. `closeDraft` or expiry stops submissions.

### Deep link

Another packet can open a decision without importing L29:
`useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("jev-hub",
"decision:<decisionId>"))` when `jev-hub` is in the environment's `loomFeatures`. The panel
reads `surface.resourceId`; `decision:<id>` opens that decision's detail, whose Back button
shows the log. Other resource ids are ignored.

### Errors

SQL failures map to `JevHubError` with `storage` and a short message; the cause is logged
with `Effect.logWarning`. Fallbacks from `decide` are results, not errors. `buildContext`
errors are typed so the preview can show them next to the source.

## Storage

Migration 1 (`[1, "Hub", ...]`) in the packet's own set, tracking table
`fork_migrations_jev_hub`:

```sql
CREATE TABLE IF NOT EXISTS fork_jev_hub_templates (
  template_id    TEXT PRIMARY KEY,               -- 'tpl_<uuid>'
  name           TEXT NOT NULL,
  name_key       TEXT NOT NULL UNIQUE,           -- lower(name)
  feature_id     TEXT,
  question_key   TEXT,
  question_json  TEXT NOT NULL,                  -- JevQuestion
  notes          TEXT NOT NULL DEFAULT '',
  sample_state_json TEXT,
  source         TEXT NOT NULL,                  -- user | agent
  draft_id       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_jev_hub_test_items (
  item_id          TEXT PRIMARY KEY,             -- 'tst_<uuid>'
  feature_id       TEXT NOT NULL,
  source           TEXT NOT NULL,                -- decision | playground | agent
  decision_id      TEXT,
  project_id       TEXT,
  draft_id         TEXT,
  state_json       TEXT NOT NULL,
  questions_json   TEXT NOT NULL,
  labels_json      TEXT NOT NULL DEFAULT '{}',
  suggested_json   TEXT,
  note             TEXT NOT NULL DEFAULT '',
  estimated_tokens INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  labeled_at       TEXT
);
CREATE INDEX IF NOT EXISTS fork_jev_hub_test_items_feature
  ON fork_jev_hub_test_items (feature_id, created_at);

CREATE TABLE IF NOT EXISTS fork_jev_hub_replays (
  replay_id    TEXT PRIMARY KEY,                 -- 'rpl_<uuid>'
  feature_id   TEXT NOT NULL,
  result_json  TEXT NOT NULL,                    -- ReplayResult
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_jev_hub_replays_feature
  ON fork_jev_hub_replays (feature_id, created_at);

CREATE TABLE IF NOT EXISTS fork_jev_hub_drafts (
  draft_id     TEXT PRIMARY KEY,                 -- 'drf_<uuid>'
  feature_id   TEXT NOT NULL,
  thread_id    TEXT NOT NULL,
  template_id  TEXT,
  drafts       INTEGER NOT NULL DEFAULT 0,
  edge_cases   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  closed_at    TEXT
);

CREATE TABLE IF NOT EXISTS fork_jev_hub_tuning (
  feature_id        TEXT PRIMARY KEY,
  threshold_model   TEXT,
  threshold_set_at  TEXT,
  updated_at        TEXT NOT NULL
);
```

- Decisions, ratings, modes, thresholds, pinned models and overrides live in `ext-decide`'s
  tables; L29 duplicates none of them.
- No foreign keys into upstream tables. Test items keep their own copy of the state, so they
  survive the decision's purge or deletion; their `project_id` is only used to honor "Jev off
  for this project" in replays.
- Retention: test items and templates until deleted; replays capped at 20 per feature;
  drafts rows older than 30 days are deleted when a new draft is created.
- Size: at the limits, 500 items per feature of at most about 100 KB each (the 32k-token
  budget); in practice a few KB each.

## Clients

### Shared (client-runtime)

- `packages/client-runtime/src/fork/jevLint.ts` (pure): `lintQuestion(question)` and
  `lintRequest({ questions, state? })` returning `LintIssue[]` with `{ rule, severity:
"error" | "warning" | "info", questionKey, message, path }`.
- `packages/client-runtime/src/fork/jevCost.ts` (pure): `estimateCostUsd(inputTokens)` and
  `formatCost` ("about $0.0021", "under $0.0001").
- `packages/client-runtime/src/fork/jev-hub.ts`: `createJevHubEnvironmentAtoms(runtime)`:
  query atom families for `listDecisions` (by query key), `getDecision`, `listTemplates`,
  `featureStats`, `listTestItems`, `listReplays`, `calibration`, `listDrafts`; a subscription
  atom for `subscribeChanges`; commands for the mutations; `replay` through the stream
  command helper.

### Lint rules (`jevLint.ts`)

From the [Jev 1.13 jaggedness page](https://docs.typesafe.ai/model-jaggedness/jev-1.13) (rule
numbers refer to its table) and the API limits. Text rules scan every string inside
`instructions` (and criteria where stated), case-insensitively.

| Rule                      | Severity | Trigger                                                                                                                                                             | Message                                                                                      |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `empty-instructions`      | error    | No text in `instructions`.                                                                                                                                          | "Write the question."                                                                        |
| `too-many-options`        | error    | Choice with more than 255 options (API limit).                                                                                                                      | "Jev accepts at most 255 options."                                                           |
| `too-few-options`         | error    | Choice with fewer than 2 options.                                                                                                                                   | "Add at least two options."                                                                  |
| `score-levels`            | error    | Score with fewer than 2 or more than 10 levels (API limit).                                                                                                         | "A Score needs 2 to 10 levels."                                                              |
| `oversized-state`         | error    | `fitBudget(...).fits` is false: the questions alone exceed 32k (with the longest question) or 64k (all).                                                            | "The questions are too long for Jev."                                                        |
| `state-trimmed`           | warning  | The state had to be trimmed to fit.                                                                                                                                 | "The state is over Jev's limit and will be trimmed. Send only what the question needs."      |
| `large-state`             | warning  | Estimated state over 8,000 tokens (rule 5; a heuristic, not an API limit).                                                                                          | "Large states cost accuracy. Filter to what the question needs."                             |
| `negation`                | warning  | A negation in the instructions: `\b(not                                                                                                                             | no                                                                                           | never | none | neither | nor | without | except | unless | cannot)\b`or`n't` (rule 1). | "Jev reads negations literally. Ask the positive question and handle the opposite in code." |
| `double-negative`         | warning  | Two or more negations in one sentence, or a negated question with a negated `true` criterion (rule 4).                                                              | "Double negatives lower accuracy. Rewrite it as a direct question."                          |
| `option-without-criteria` | warning  | A Choice option whose description is null or empty (rule 1).                                                                                                        | "Describe what this option covers, and what it does not."                                    |
| `noul-without-criteria`   | info     | A Noul without `true` and `false` descriptions.                                                                                                                     | "Say what yes and no mean when the boundary is subtle."                                      |
| `noul-contradiction`      | warning  | Noul `true` and `false` are identical, or `true` reads as a no (starts with "no", "not", "none", "never", "does not") while `false` does not (rule 7).              | "Yes should mean yes. Swap or rewrite the criteria."                                         |
| `count-or-math`           | warning  | `how many`, `count`, `number of`, `sum`, `total`, `average`, `percent`, `ratio`, `more than <n>`, `less than <n>`, `at least <n>`, `fewer than` (rule 2).           | "Jev does not count or do math reliably. Compute it in code and pass a bucket in the state." |
| `date-comparison`         | warning  | A date or time token (ISO date, a month name with a day, `yesterday`, `last week`) or `earlier than`, `later than`, `days ago`, `how long ago`, `how old` (rule 3). | "Jev does not compare dates reliably. Compute the age in code and pass a bucket."            |
| `generation`              | warning  | Instructions asking to `write`, `generate`, `summarize`, `explain`, `rewrite` or `list` (rule 9).                                                                   | "Jev chooses; it does not write. Turn the answer space into options."                        |
| `similar-options`         | warning  | Two Choice option keys equal after lowercasing and removing spaces, dashes and underscores.                                                                         | "These options look the same to a reader."                                                   |

Errors block Save, Run and Export; warnings and info never block. The patterns are
heuristics and will have false positives ("before" alone is not flagged for that reason).
The table in the Templates tab links each rule to the jaggedness page.

### Web (`apps/web/src/fork/jev-hub/`)

| File                   | Purpose                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.ts`             | `jevHubEnvironment = createJevHubEnvironmentAtoms(connectionAtomRuntime)`; hooks; `useJevHubSupported(environmentId)`.                                                                                                                                        |
| `panel.tsx`            | `jevHubPanel: ForkPanelDefinition` (id `jev-hub`, title "Decisions", letter `J`, icon `Scale` from lucide, description from PRODUCT.md, `isAvailable: threadRef !== null && loomFeatures.includes("jev-hub")`, hint "Needs a Loom server with the Jev hub."). |
| `DecisionsPanel.tsx`   | Tabs, setup and banner states, deep-link handling (`surface.resourceId`), last tab in `loom:jev-hub:tab:v1`.                                                                                                                                                  |
| `LogTab.tsx`           | Filters (kept in `loom:jev-hub:filters:v1`), virtualized list (`@legendapp/list`), totals footer, "N new decisions" from the change subscription.                                                                                                             |
| `DecisionDetail.tsx`   | Sent state (JSON viewer, collapsed over 200 lines), redactions and trims, questions, answers (`AnswerView`), rating, actions.                                                                                                                                 |
| `AnswerView.tsx`       | Choice and Score probability bars, Noul value, confidence; static bars (no animation).                                                                                                                                                                        |
| `RatingControls.tsx`   | Right, Wrong with the option, level or yes/no picker, Clear.                                                                                                                                                                                                  |
| `PlaygroundTab.tsx`    | Source pickers, questions (templates or inline builder), Preview, Run, result, rate, "Add to test set" with a feature menu.                                                                                                                                   |
| `ContextPreview.tsx`   | "Sent to Jev", "Removed before sending", "Trimmed to fit", facts behind buckets, token meter against 32,000 and 64,000.                                                                                                                                       |
| `QuestionBuilder.tsx`  | The guided form (type switch, instructions with a "Structured" JSON mode, options or levels editor, Noul criteria), live lint (debounced 150 ms), counters "12 of 255".                                                                                       |
| `TemplatesTab.tsx`     | List with "From agent" badges and "In use by", editor, Use for this feature, Revert, export.                                                                                                                                                                  |
| `exportRequest.ts`     | Pure: `toJsonBody({ state, model, questions })` and `toCurl(...)` (below).                                                                                                                                                                                    |
| `TuningTab.tsx`        | Feature list with stats and notices; per feature: test set, replay, calibration, model, drafting, "Delete all decisions".                                                                                                                                     |
| `CalibrationChart.tsx` | Inline SVG reliability diagram (bars per bin, a diagonal, counts), and the sweep table with a threshold slider.                                                                                                                                               |
| `DraftCard.tsx`        | "Draft with an agent", agent switch warning, open draft status, Close draft, the L21 skill button when present.                                                                                                                                               |
| `composerFill.ts`      | Appends text to the thread's composer draft (see Agent drafting).                                                                                                                                                                                             |
| `palette.tsx`          | `action:loom:jev-hub:open`, `action:loom:jev-hub:playground`, `action:loom:jev-hub:settings`.                                                                                                                                                                 |
| `commands.ts`          | `loom.jev-hub.open` handler (toggle) with `onForkCommand`, mounted from a `ForkRoot` component.                                                                                                                                                               |

Gating: every entry checks `supportsLoomFeature(capabilities, "jev-hub")` for the thread's
environment, and Jev actions also check `useDecideFeature` (from `ext-decide`) for
`jev-hub.playground` or the selected feature. Settings navigation uses `/settings/loom` with
hash `loom-decide` (the `ext-settings` anchor).

Export:

```ts
export const toJsonBody = (request: { state: Json; model: string; questions: JevQuestions }) =>
  JSON.stringify(request, null, 2);

/** Never includes a key. A quoted heredoc avoids shell quoting of the JSON. */
export const toCurl = (request: { state: Json; model: string; questions: JevQuestions }) =>
  [
    "curl https://api.typesafe.ai/v1/systemone \\",
    '  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  --data-binary @- <<'JSON'",
    toJsonBody(request),
    "JSON",
  ].join("\n");
```

The state in an export is the previewed (redacted) state, or the template's sample state, or
`""` when there is none.

### Keybindings and palette

`FORK_KEYBINDING_COMMANDS` gains `"loom.jev-hub.open"`, unbound (no default binding, no fork
default shortcut). Palette source items return `[]` without `jev-hub` in `loomFeatures`;
"Open Jev playground" requires an active thread.

## Agent-facing tools

Both in `mcp.ts`, registered in `ForkMcpToolkitsLive`. Short descriptions (every tool costs
prompt tokens in every session). Names follow CONVENTIONS.md
(`loom_<slug_underscored>_<verb>`): `loom_jev_hub_ask` and `loom_jev_hub_submit`.

```ts
const AskJevTool = Tool.make("loom_jev_hub_ask", {
  description:
    "Ask Jev, a fast decision model, a Choice, Score or Noul question about a state. Use a saved template by name or pass a question.",
  parameters: AskJevInput, // { template?: string, question?: JevQuestion, state: Json, threshold?: number }
  success: AskJevOutput, // { status, answers?, reason?, model?, decisionId? }
  failure: JevHubToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Ask Jev")
  .annotate(Tool.Readonly, true);

const SubmitJevDraftsTool = Tool.make("loom_jev_hub_submit", {
  description:
    "Submit Jev question rewordings and edge cases for a Loom draft request (the draftId in the user's brief).",
  parameters: SubmitDraftsInput, // { draftId, drafts?: [{ name?, question }], edgeCases?: [{ state, expected?: Record<key, label>, note? }] }
  success: SubmitDraftsOutput, // { accepted: { drafts, edgeCases }, rejected: [{ index, kind, reason }] }
  failure: JevHubToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
}).annotate(Tool.Title, "Submit Jev drafts");
```

- `loom_jev_hub_ask`: exactly one of `template` and `question`. The handler reads `threadId` from
  `McpInvocationContext` (`apps/server/src/mcp/McpInvocationContext.ts:13-25`) and calls
  `LoomDecide.decide("jev-hub.ask", { state, questions: { answer: question }, threshold },
{ origin: "agent", threadId })`. Fallbacks come back as a result with `reason` and one line
  of text ("Jev is not allowed for agents. The user can turn on Let agents use this for Ask
  Jev from agents in Settings, Loom, Jev."), not as a tool failure.
- `loom_jev_hub_submit`: fails with a typed error when the draft does not exist, is closed or
  expired, belongs to another thread, or when the gate feature (`draftGateFeature`: the
  draft's feature, or `jev-hub.playground` for a feature with `agentTool: false`) is not in
  `manual-agents` mode ("Let agents use this is off for <label>."). Up to 5 drafts and 20 edge cases per
  call, 100 edge cases per draft. Each question is decoded with `JevQuestion` and checked
  against the hard limits and the feature's option keys or level count (from the draft's
  questions); rejects are reported per index. States are redacted and fitted before storing.
- Parameters are non-empty structs (EXTENSION-POINTS.md, MCP tools).

## Provider decisions

- MCP tools: served by the existing `t3-code` MCP server to every adapter (Codex, Claude,
  Cursor, Grok, OpenCode, Antigravity); nothing adapter-specific.
- Drafting fills the composer, so it works with whichever provider the thread uses.
- Context builders read the provider-neutral projection, so every provider's threads can be
  used as context.

## Performance

- The log is paged (50 rows, at most 100) and virtualized; the list payload carries no state
  or questions. Details load on demand.
- The change subscription carries only ids; the panel shows a "N new" chip instead of
  refetching on every event, and holds the subscription only while the Log tab is visible.
- Lint and cost run on the client; lint is debounced 150 ms and pure (regexes over the
  question text only).
- Previews and runs are explicit button presses; nothing builds context or calls Jev on a
  keystroke.
- Replays run on the server with a concurrency of 4 and stream small progress events;
  results are stored once and listed without per-item data.
- The chart is static SVG; no animation, no continuous repaint.
- The panel subscribes to nothing while closed.

## Alternatives considered

- **Calling TypeSafe from L29 directly:** a second client and key path; rejected for
  `ext-decide`'s single path, so redaction, budget, modes and logging cannot be bypassed.
- **Logging replays in `fork_decide_decisions`:** would flood the log and skew ratings and
  calibration; replays have their own table.
- **Templates as files in the repository:** shared through Git, but a Loom-private concern
  and a merge surface; kept in a fork table like snippets.
- **Server-side lint:** would need an RPC per keystroke; lint is pure and client-side, and
  the server enforces only the hard API limits.
- **A chart library:** a ten-bar reliability diagram is simpler as inline SVG than a new
  dependency.
- **Installing the TypeSafe skill for drafting:** its installer writes into `~/.claude` and
  agent configurations (<https://docs.typesafe.ai/agent-skill>); a link in the brief is
  enough, and L21 can install it on request.
- **Letting agents label test items:** labels must be the user's judgment; agent answers are
  stored as hints only.
