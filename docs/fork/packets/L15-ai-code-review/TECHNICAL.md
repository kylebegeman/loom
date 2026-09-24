# L15 technical notes

Two parts: **research findings** gathered before the design session, and the **design** that
implements the session's decisions ([DESIGN-SESSION.md, section 7](./DESIGN-SESSION.md#7-decision-record)).
Citations are to this fork at upstream v0.0.42 (`a931bd85f3`; paths re-checked at
`137e432394`). Line numbers drift; search for the quoted code when they do.

## Part 1: research findings

### Old Loom implementation

Old Loom (`bagelvault/loom@a79ec506`) implemented review across contracts, orchestration,
two adapters and the web client. Details and links in [REFERENCES.md](./REFERENCES.md).

- Contracts: `ReviewStartTarget` union (`uncommittedChanges`, `baseBranch {branch}`, `commit
{sha, title?}`, `custom {instructions <= 12k}`), `ReviewStartDelivery = inline | detached`,
  `ProviderReviewStartInput {threadId, target, delivery, modelSelection?}`
  (`packages/contracts/src/review.ts:6-27`, `provider.ts:125-139`); orchestration command
  `thread.review.start` and event `thread.review-start-requested`; capability flag
  `supportsNativeReview`.
- Codex: `CodexAdapter.startReview` (`CodexAdapter.ts:2575-2583`) called
  `client.request("review/start", {threadId, target, delivery})`
  (`CodexSessionRuntime.ts:2262-2296`), refused on threads with runtime restrictions, and
  replayed a completed review turn as notifications when the response was not in progress.
  "Entered/exited review mode" became work log rows.
- Claude: `buildClaudeReviewPrompt` (`ClaudeAdapter.ts:5729-5737`) sent `/code-review` plus a
  text convention (`[P0]` to `[P3]`, title, `file:line`); detached delivery rejected.
- Orchestration guard: refused to start while a turn was active; failures as
  `provider.review.failed` activities (`ProviderCommandReactor.ts:3735-3810`).
- Web: `parseReviewFindings` (`apps/web/src/reviewFindings.ts:120-217`) tried JSON then a
  line regex, on every assistant message; cards in `MessagesTimeline.tsx:2320-2385`;
  `buildReviewFindingFixPrompt` (`reviewFindings.ts:219-238`) appended to the composer.
- Ledger lessons: do not parse prose into findings until the protocol has a stable payload
  (0037); the parser is "pragmatic" and should become a normalization layer with fixtures
  (0040); the Claude path depends entirely on formatting compliance (0041); keep roadmap and
  brief in sync (0042); a review-only window route was built and removed (0048 to 0050).

In this fork, a new orchestration command and event are not acceptable
(EXTENSION-POINTS.md, Orchestration rule 1), so old Loom's engine cannot be ported as is.

### Upstream facilities a design can use

| Facility                        | Where                                                                                                                                                                                                                                    | Use                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Diff previews                   | `apps/server/src/review/ReviewService.ts`; `packages/contracts/src/review.ts`; RPC `review.getDiffPreview`, scope `review:write` (`apps/server/src/auth/RpcAuthorization.ts:132-133`)                                                    | Diff size check and excerpts for hand-back; the reviewer itself can run `git diff`.             |
| Review comments in the composer | `ReviewCommentContextSchema` and `buildFileReviewComment` (`apps/web/src/reviewCommentContext.ts:13-26,59`); draft `reviewComments` and `addReviewComment` (`apps/web/src/composerDraftStore.ts:235,665`)                                | "Fix this" hand-back that renders exactly like a human diff comment.                            |
| Thread commands                 | `thread.create` (`packages/contracts/src/orchestration.ts:1047-1062`), `thread.turn.start` (1238-1258), `thread.settle` (1083), `thread.archive` (1071)                                                                                  | Reviewer threads without new events.                                                            |
| Runtime modes                   | `RuntimeMode` literals `approval-required`, `auto-accept-edits`, `auto`, `full-access` (`packages/contracts/src/orchestration.ts:128-133`); `DEFAULT_RUNTIME_MODE` is `full-access` (135)                                                | Reviewer runs `approval-required`, set explicitly on every command.                             |
| MCP server on every session     | `apps/server/src/mcp/McpHttpServer.ts`; `pull-requests` capability always granted (`apps/server/src/provider/Layers/ProviderService.ts:906-913`)                                                                                         | `loom_ai_code_review_submit`.                                                                   |
| Headless structured generation  | `codex exec -s read-only --output-schema ... --output-last-message` (`apps/server/src/textGeneration/CodexTextGeneration.ts:196-217`); `claude -p --output-format json --json-schema ... --tools ""` (`ClaudeTextGeneration.ts:199-215`) | Option A3; private to `TextGeneration` (`TextGeneration.ts:83-114`, closed set of operations).  |
| Codex review protocol           | `V2ReviewStartParams` targets and delivery (`packages/effect-codex-app-server/src/_generated/schema.gen.ts:6105-6155`); `enteredReviewMode` / `exitedReviewMode` items with `review: string` (`schema.gen.ts:20535-20536`)               | Options A1 and A4. Output is text; no structured findings in the v2 protocol as generated here. |
| Adapter capability pattern      | `ProviderCompaction` native or slash-command (`apps/server/src/provider/Services/ProviderAdapter.ts:35-43,89`), triggered by a `/compact` message (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:91-94`)               | The shape an A1 `ProviderReview` capability would copy.                                         |
| Pull request review UI          | `apps/web/src/components/pullRequest/PullRequestReviewBar.tsx`, `PullRequestCommentComposer.tsx`                                                                                                                                         | Later: findings as a PR review draft.                                                           |
| Diff inline annotations         | `apps/web/src/components/diffs/DiffCommentAnnotation.tsx`, `AnnotatableCodeView.tsx`                                                                                                                                                     | Later: inline findings (needs a seam).                                                          |

Nothing in upstream calls `review/start`, and there is no AI review anywhere
(`rg "review/start" apps/server/src` finds nothing outside the generated client).

### Providers

| Provider                            | Native review                                                                                                                                             | MCP tools (A2)             | Headless JSON (A3)                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Codex                               | `review/start` in the app-server protocol (text result)                                                                                                   | Yes                        | `codex exec --output-schema` (used upstream)                                                                                          |
| Claude                              | CLI slash commands such as `/review` and `/security-review` exist; whether the Agent SDK path used by the adapter executes them as commands is unverified | Yes                        | `claude -p --json-schema` (used upstream)                                                                                             |
| Cursor, Grok, OpenCode, Antigravity | None known                                                                                                                                                | Yes (all attach `t3-code`) | Each has upstream text generation (`apps/server/src/textGeneration/*TextGeneration.ts`); structured output support varies, unverified |

### Reference tools

- **impeccable** (`pbakaus/impeccable`, Apache-2.0): deterministic Rust detector,
  `impeccable detect --json [--no-config] <files>`; exit 0 clean, 2 findings, 1 scan error;
  JSON array of `{antipattern, name, description, severity: warning|error|advisory, category:
slop|quality, file, line, snippet}` (`crates/foundation/src/findings.rs:13-31`,
  `crates/detect/src/cli.rs:24-64,211-213`); scannable extensions in
  `crates/detect/src/file_system.rs:19-34`. The npm shim downloads a binary from GitHub
  releases if none is found; Loom should require a user-installed binary (`IMPECCABLE_BIN` or
  PATH) and never run `impeccable install|update|link` (they write `.claude/settings.local.json`,
  `.codex/hooks.json` and more).
- **ponytail** (`DietrichGebert/ponytail`, MIT): prose rules, no rule-pack format. The
  `ponytail-review` skill (`skills/ponytail-review/SKILL.md`) defines a terse over-engineering
  review format usable as a lens prompt with attribution. Its hook installers edit agent config;
  never run them.
- **Graphify** via L26: blast radius for the reviewer's brief when L26 is present.

## Part 2: design

The design implements the decisions in
[DESIGN-SESSION.md, section 7](./DESIGN-SESSION.md#7-decision-record). Names below are the
ones to use; constants are named so they can be tuned in one place.

### Overview

```
Start dialog / palette / diff button / chip / agent tool
        |
        v
AiCodeReviewService.prepare     -> target diff, stats, estimate, defaults
AiCodeReviewService.resolveAuto -> Auto pick (Jev) for the dialog's Auto slots
AiCodeReviewService.start       -> review row + one run per reviewer
        |  thread.create + thread.turn.start (approval-required, server-built brief)
        v
Reviewer threads (ordinary threads, any provider)
        |  loom_ai_code_review_submit (MCP)       |  turn ends without submit
        v                                          v
findings stored per run                    fenced-JSON fallback (reviewer thread only)
        |                                          |  else failed + "Ask again"
        v                                          v
all runs terminal -> merge (Jev Noul per candidate pair, else rule) -> groups
        |
        v
Review panel (subscription per source thread) -> "Fix this" -> composer review comments
```

Side paths: the impeccable lens is a detector run inside the same review; the turn
suggestion is a reactor on `thread.turn-diff-completed`; cleanup follows `thread.deleted`.

### Contracts (`packages/contracts/src/fork/ai-code-review.ts`)

```ts
export const AI_CODE_REVIEW_WS_METHODS = {
  prepare: "loom.ai-code-review.prepare",
  resolveAuto: "loom.ai-code-review.resolveAuto",
  start: "loom.ai-code-review.start",
  cancel: "loom.ai-code-review.cancel",
  askAgain: "loom.ai-code-review.askAgain",
  subscribeThread: "loom.ai-code-review.subscribeThread", // ForkSubscriptionRpcTag
  get: "loom.ai-code-review.get",
  setGroupState: "loom.ai-code-review.setGroupState",
  getHandBack: "loom.ai-code-review.getHandBack",
  dismissSuggestion: "loom.ai-code-review.dismissSuggestion",
  getSettings: "loom.ai-code-review.getSettings",
  updateSettings: "loom.ai-code-review.updateSettings",
  getProjectSettings: "loom.ai-code-review.getProjectSettings",
  updateProjectSettings: "loom.ai-code-review.updateProjectSettings",
} as const;

export const AI_CODE_REVIEW_MAX_REVIEWERS = 3;
export const AI_CODE_REVIEW_MAX_FINDINGS_PER_SUBMIT = 100;

export const ReviewTarget = Schema.Union([
  Schema.TaggedStruct("uncommitted", {}),
  Schema.TaggedStruct("branch", { baseRef: Schema.NullOr(TrimmedNonEmptyString) }), // null: automatic base
  Schema.TaggedStruct("turn", { turnId: TurnId }),
  Schema.TaggedStruct("commit", {
    sha: TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{7,40}$/i)),
  }),
]);

export const ReviewSeverity = Schema.Literals(["blocking", "should-fix", "nit"]);
export const ReviewConfidence = Schema.Literals(["low", "medium", "high"]);
export const ReviewCategory = Schema.Literals([
  "correctness",
  "security",
  "performance",
  "simplicity",
  "design",
  "tests",
  "other",
]);
export const ReviewLens = Schema.Literals(["correctness", "simplicity", "impeccable"]);
export const ReviewEffortLevel = Schema.Literals(["low", "medium", "high", "max"]);
export const ReviewEffortPresetId = Schema.Literals(["quick", "balanced", "thorough"]);

/** What the reviewer submits (tool parameters and fallback JSON share it). */
export const ReviewFindingInput = Schema.Struct({
  severity: ReviewSeverity,
  confidence: ReviewConfidence,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  body: Schema.String.check(Schema.isMaxLength(4_000)),
  file: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(1_024))),
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  category: ReviewCategory,
  suggestedFix: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))),
});

export const ReviewVerdict = Schema.Struct({
  overall: Schema.Literals(["looks-good", "needs-changes", "blocking"]),
  summary: Schema.String.check(Schema.isMaxLength(2_000)),
});

export const ReviewSubmitInput = Schema.Struct({
  findings: Schema.Array(ReviewFindingInput).check(
    Schema.isMaxLength(AI_CODE_REVIEW_MAX_FINDINGS_PER_SUBMIT),
  ),
  verdict: ReviewVerdict,
});

export const ReviewFinding = Schema.Struct({
  ...ReviewFindingInput.fields,
  id: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
  ordinal: NonNegativeInt,
  source: Schema.Literals(["reviewer", "fallback-json", "impeccable"]),
  /** "deleted": the file is gone from the checkout; lines refer to the old version. */
  fileState: Schema.Literals(["present", "deleted", "none"]),
});

export const ReviewFindingGroup = Schema.Struct({
  id: TrimmedNonEmptyString,
  reviewId: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "dismissed", "sent-to-fix"]),
  /** Copied from the representative finding. */
  representativeId: TrimmedNonEmptyString,
  severity: ReviewSeverity, // highest member severity
  confidence: ReviewConfidence, // effective confidence, see "Merge"
  findingIds: Schema.Array(TrimmedNonEmptyString),
  reviewerRunIds: Schema.Array(TrimmedNonEmptyString), // distinct reviewer runs, for "Found by"
  mergedBy: Schema.Literals(["single", "rule", "jev"]),
});

export const ReviewerPick = Schema.Union([
  Schema.TaggedStruct("manual", {}),
  Schema.TaggedStruct("jev", {
    decisionId: TrimmedNonEmptyString,
    confidence: Schema.Number,
    effortConfidence: Schema.NullOr(Schema.Number), // null when the preset allowed one level
  }),
  Schema.TaggedStruct("fallback", {
    // ext-decide fallback reasons plus this packet's own pre-checks
    reason: Schema.Literals([
      "disabled",
      "no-key",
      "project-off",
      "agent-not-allowed",
      "timeout",
      "error",
      "low-confidence",
      "too-few-candidates",
    ]),
    decisionId: Schema.NullOr(TrimmedNonEmptyString),
  }),
]);

/** A reviewer slot as settings and the dialog describe it. */
export const ReviewerSlot = Schema.Union([
  Schema.TaggedStruct("auto", {}),
  Schema.TaggedStruct("model", {
    modelSelection: ModelSelection,
    effort: Schema.NullOr(ReviewEffortLevel), // null: the preset default
  }),
]);

/** What `start` receives per reviewer: unresolved Auto, or a resolved choice. */
export const StartReviewer = Schema.Union([
  Schema.TaggedStruct("auto", {}),
  Schema.TaggedStruct("resolved", {
    modelSelection: ModelSelection,
    effort: Schema.NullOr(ReviewEffortLevel),
    pick: ReviewerPick,
  }),
]);

export const ReviewerRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  reviewId: TrimmedNonEmptyString,
  kind: Schema.Literals(["reviewer", "impeccable"]),
  reviewerThreadId: Schema.NullOr(ThreadId),
  modelSelection: Schema.NullOr(ModelSelection),
  effort: Schema.NullOr(ReviewEffortLevel),
  pick: Schema.NullOr(ReviewerPick),
  state: Schema.Literals(["starting", "running", "completed", "failed", "cancelled"]),
  submitSource: Schema.NullOr(Schema.Literals(["tool", "fallback-json"])),
  verdict: Schema.NullOr(ReviewVerdict),
  failure: Schema.NullOr(
    Schema.Struct({
      reason: Schema.Literals([
        "no-submit",
        "provider-error",
        "start-failed",
        "thread-deleted",
        "impeccable-error",
      ]),
      message: Schema.String,
    }),
  ),
  findingCount: NonNegativeInt,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});

export const ReviewEstimate = Schema.Struct({
  files: NonNegativeInt,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changedLines: NonNegativeInt, // additions + deletions, computed in code
  tokensPerReviewer: NonNegativeInt,
  languages: Schema.Array(Schema.String),
  truncated: Schema.Boolean, // git output hit its cap; the estimate is a lower bound
});

export const ReviewSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceThreadId: ThreadId,
  projectId: ProjectId,
  target: ReviewTarget,
  targetLabel: Schema.String,
  instructions: Schema.NullOr(Schema.String),
  lenses: Schema.Array(ReviewLens),
  origin: Schema.Literals(["user", "agent", "auto"]),
  state: Schema.Literals(["running", "completed", "failed", "cancelled"]),
  merge: Schema.Literals(["pending", "single", "rule", "jev"]),
  estimate: ReviewEstimate,
  runs: Schema.Array(ReviewerRun),
  openCounts: Schema.Struct({
    blocking: NonNegativeInt,
    shouldFix: NonNegativeInt,
    nit: NonNegativeInt,
    lowConfidence: NonNegativeInt,
  }),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});

export const ReviewSuggestion = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  turnNumber: PositiveInt,
  changedLines: NonNegativeInt,
  reason: Schema.Literals(["jev", "threshold"]),
  large: Schema.Boolean, // above the confirmation threshold
  createdAt: IsoDateTime,
});

/** Subscription payload per source thread: small, no findings. */
export const ThreadReviewsSnapshot = Schema.Struct({
  reviews: Schema.Array(ReviewSummary), // newest first, at most 20
  suggestion: Schema.NullOr(ReviewSuggestion),
});

export const ReviewDetail = Schema.Struct({
  summary: ReviewSummary,
  groups: Schema.Array(ReviewFindingGroup),
  findings: Schema.Array(ReviewFinding),
});

export const ReviewEffortRange = Schema.Struct({
  min: ReviewEffortLevel,
  max: ReviewEffortLevel,
  default: ReviewEffortLevel,
}); // checked: min <= default <= max in level order

export const AiCodeReviewSettings = Schema.Struct({
  /** Empty: one slot with the source thread's model. */
  defaultReviewers: Schema.Array(ReviewerSlot).check(
    Schema.isMaxLength(AI_CODE_REVIEW_MAX_REVIEWERS),
  ),
  candidates: Schema.Array(
    Schema.Struct({
      modelSelection: ModelSelection,
      description: Schema.String.check(Schema.isMaxLength(400)),
    }),
  ).check(Schema.isMaxLength(20)),
  effortPreset: ReviewEffortPresetId,
  effortPresets: Schema.Struct({
    quick: ReviewEffortRange,
    balanced: ReviewEffortRange,
    thorough: ReviewEffortRange,
  }),
  lenses: Schema.Struct({
    correctness: Schema.Boolean,
    simplicity: Schema.Boolean,
    impeccable: Schema.Boolean,
  }),
  extraInstructions: Schema.String.check(Schema.isMaxLength(4_000)),
  confirmAboveChangedLines: PositiveInt,
  suggestAfterTurns: Schema.Boolean,
  suggestAboveChangedLines: PositiveInt,
  allowAgents: Schema.Boolean,
});

export const AiCodeReviewProjectSettings = Schema.Struct({
  projectId: ProjectId,
  autoStartSuggested: Schema.Boolean,
});

export class AiCodeReviewError extends Schema.TaggedError<AiCodeReviewError>()(
  "AiCodeReviewError",
  {
    reason: Schema.Literals([
      "thread-not-found",
      "reviewer-thread", // reviews of reviewer threads are refused
      "no-changes",
      "review-running",
      "model-unavailable",
      "too-many-reviewers",
      "turn-not-found",
      "commit-not-found",
      "confirmation-required",
      "review-not-found",
      "run-not-askable",
      "git-failed",
    ]),
    message: Schema.String,
  },
) {}
```

Defaults (`AI_CODE_REVIEW_DEFAULT_SETTINGS`): no default reviewers, no candidates, preset
`balanced`, presets `quick {low, medium, low}`, `balanced {medium, high, medium}`, `thorough
{high, max, high}`, lenses correctness only, empty extra instructions,
`confirmAboveChangedLines` 2,000, `suggestAfterTurns` true, `suggestAboveChangedLines` 200,
`allowAgents` false. At least one lens must be on (`updateSettings` rejects otherwise).

### RPCs

| Tag                     | Input                                                                                                       | Output                                                                                                                                                              | Scope                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `prepare`               | `{ sourceThreadId, target }`                                                                                | `{ targetLabel, resolvedBaseRef, estimate, noChanges, sourceBusy, reviewRunning, turns, recentCommits, reviewers: Array<{ slot, sameAsAuthor }>, lensesAvailable }` | `orchestration:read`    |
| `resolveAuto`           | `{ sourceThreadId, target, slots: Array<ReviewerSlot> (1 to 3) }`                                           | `{ reviewers: Array<{ slot, resolved?: StartReviewer }> }` (`resolved` set for each Auto slot)                                                                      | `orchestration:operate` |
| `start`                 | `{ sourceThreadId, target, instructions?, reviewers: Array<StartReviewer> (1 to 3), lenses, confirmLarge }` | `{ reviewId }`                                                                                                                                                      | `orchestration:operate` |
| `cancel`                | `{ reviewId }`                                                                                              | `{}`                                                                                                                                                                | `orchestration:operate` |
| `askAgain`              | `{ runId }`                                                                                                 | `{}`                                                                                                                                                                | `orchestration:operate` |
| `subscribeThread`       | `{ sourceThreadId }`                                                                                        | stream of `ThreadReviewsSnapshot` (`ForkSubscriptionRpcTag`)                                                                                                        | `orchestration:read`    |
| `get`                   | `{ reviewId }`                                                                                              | `ReviewDetail`                                                                                                                                                      | `orchestration:read`    |
| `setGroupState`         | `{ reviewId, groupIds, state }`                                                                             | `{}`                                                                                                                                                                | `orchestration:operate` |
| `getHandBack`           | `{ reviewId, groupIds }`                                                                                    | `Array<{ groupId, file, startLine, endLine, lines: string or null, text }>`                                                                                         | `orchestration:operate` |
| `dismissSuggestion`     | `{ threadId }`                                                                                              | `{}`                                                                                                                                                                | `orchestration:operate` |
| `getSettings`           | `{}`                                                                                                        | `{ settings, impeccable: { available, path } }`                                                                                                                     | `orchestration:read`    |
| `updateSettings`        | `AiCodeReviewSettings`                                                                                      | `AiCodeReviewSettings`                                                                                                                                              | `orchestration:operate` |
| `getProjectSettings`    | `{ projectId }`                                                                                             | `AiCodeReviewProjectSettings`                                                                                                                                       | `orchestration:read`    |
| `updateProjectSettings` | `AiCodeReviewProjectSettings`                                                                               | `AiCodeReviewProjectSettings`                                                                                                                                       | `orchestration:operate` |

All tags are `loom.ai-code-review.<name>` and every error union includes
`EnvironmentAuthorizationError` (EXTENSION-POINTS.md, server core). `getHandBack` reads file
contents from the checkout, so it takes the operate scope like the action it belongs to.
`prepare` never calls Jev; `resolveAuto` does, and every sent Jev request is paid and logged
in `fork_decide_decisions`, so it takes the operate scope like `start`.
Jev availability is not part of L15's RPCs: the web asks
`useDecideFeature(environmentId, "ai-code-review.reviewer-pick")`
(`apps/web/src/fork/decide/state.ts`) and offers "Auto (Jev)" only when `usable` is true,
hiding it entirely when `supported` is false.

### Server layout (`apps/server/src/fork/ai-code-review/`)

| File                     | Role                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `migrations.ts`          | `AiCodeReviewMigrations` (slug `ai-code-review`, tracking table `fork_migrations_ai_code_review`).                                  |
| `AiCodeReviewStore.ts`   | Repository for the tables in [Storage](#storage).                                                                                   |
| `targetDiff.ts`          | Diff text, refs and label per target (below).                                                                                       |
| `diffStats.ts`           | Pure: parse a unified diff into files, additions, deletions, languages, file kinds, size and file-count buckets; token estimate.    |
| `ReviewBrief.ts`         | Pure: the reviewer brief per target, lenses, instructions and optional impact summary.                                              |
| `findingValidation.ts`   | Pure plus a file probe: path normalization, checkout containment, line clamping, per-run dedupe.                                    |
| `fallbackParser.ts`      | Pure: the last fenced `json` block of a reviewer's final message, decoded with `ReviewSubmitInput`.                                 |
| `mergeRule.ts`           | Pure: candidate pairs, the deterministic "same issue" rule, union-find, group fields.                                               |
| `effort.ts`              | Pure: preset ranges, level order, mapping a level to a model's provider option.                                                     |
| `decide.ts`              | `aiCodeReviewDecideFeatures` for `ext-decide` and the pure state and question builders for each feature.                            |
| `impeccable.ts`          | Binary lookup, argv builder (pure), run, JSON to findings mapping.                                                                  |
| `integrations.ts`        | Optional L02 lineage row, L18 reviewer binding, L26 impact summary; each a no-op when the other packet is absent.                   |
| `AiCodeReviewService.ts` | `Context.Service`: prepare, resolve Auto, start, cancel, ask again, submit handling, turn-end handling, merge, hand-back, settings. |
| `AiCodeReviewReactor.ts` | `Layer.effectDiscard` with `forkParked`: domain event watcher, startup reconciliation, suggestions, cleanup.                        |
| `rpc.ts`, `mcp.ts`       | RPC handlers and the two MCP tools.                                                                                                 |

The service is named `AiCodeReviewService` so it never collides with upstream's
`ReviewService` (`apps/server/src/review/ReviewService.ts:22`), which it uses.

### Targets (`targetDiff.ts`)

The reviewer's working directory is the source thread's checkout: `worktreePath` or the
project's `workspaceRoot` (the same rule as upstream's `resolveThreadWorkspaceCwd`,
`apps/server/src/checkpointing/Utils.ts:12`). Every target yields `{ label, diff, refs,
truncated, command }`, where `command` is what the brief tells the reviewer to run.

| Target      | Diff source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reviewer command                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Uncommitted | `ReviewService.getDiffPreview({ cwd })`, the `working-tree` source (`packages/contracts/src/review.ts:6-26`), so the diff matches the diff panel's working tree scope.                                                                                                                                                                                                                                                                                                                                                                                                                                      | `git status --short` and `git diff HEAD` |
| Branch      | `ReviewService.getDiffPreview({ cwd, baseRef })`, the `branch-range` source; its `baseRef` is the resolved base shown in the label.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `git diff <base>...HEAD`                 |
| Turn        | Resolve `turnId` to its `checkpointTurnCount` n through the thread's checkpoints (`ProjectionSnapshotQuery.getThreadCheckpointContext`, `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:201`); diff with `CheckpointDiffQuery.getTurnDiff({ threadId, fromTurnCount: n - 1, toTurnCount: n })` (`apps/server/src/checkpointing/CheckpointDiffQuery.ts:45`). Refs: the checkpoint summary's `checkpointRef` for n and n - 1; for n - 1 = 0 the baseline `checkpointRefForThreadTurn(threadId, 0)` (`apps/server/src/checkpointing/Utils.ts:6`), as `CheckpointDiffQuery.ts:141-147` does. | `git diff <refA> <refB>`                 |
| Commit      | `GitVcsDriver.execute` (`apps/server/src/vcs/GitVcsDriver.ts:41,277`): `rev-parse --verify <sha>^{commit}` (else `commit-not-found`), then `show --format= --no-color <sha>` with `maxOutputBytes`.                                                                                                                                                                                                                                                                                                                                                                                                         | `git show <sha>`                         |

Checkpoint refs live under `refs/t3/checkpoints/` (`Utils.ts:4`), which git shares across
worktrees, so the reviewer can run the turn command from any checkout of the repository.
All git output is capped (`TARGET_DIFF_MAX_BYTES = 4_000_000`); `truncated` is set when the cap
or the upstream preview's own `truncated` flag hit.

`prepare` also returns, for the dialog's pickers, completed turns from the checkpoint
summaries (`{ turnId, turnNumber, files, changedLines }`, newest first, at most 50) and the
20 most recent commits (`git log -20 --format=%H%x00%s%x00%cI`).

### Estimate (`diffStats.ts`)

`changedLines = additions + deletions`, counted from the unified diff in code (Jev never
counts). `tokensPerReviewer = ESTIMATE_OVERHEAD_TOKENS + ceil(diffChars / 4) *
ESTIMATE_DIFF_MULTIPLIER`, rounded up to the next 5k, with `ESTIMATE_OVERHEAD_TOKENS = 8_000`
(brief, tools, repository instructions) and `ESTIMATE_DIFF_MULTIPLIER = 3` (the diff once, and
about twice as much surrounding code). It is a rough guide and the UI says "about". Languages
come from a small extension map; file kinds (`source`, `tests`, `docs`, `config`, `styles`)
from path patterns. Size buckets for Jev state: `tiny` (under 20 changed lines), `small` (20 to
199), `medium` (200 to 999), `large` (1,000 to 4,999), `very large` (5,000 or more).
File-count buckets: `one` (1 file), `few` (2 to 5), `several` (6 to 20), `many` (21 to 100),
`very many` (more than 100).

### Lifecycle

**prepare** (read only; never calls Jev):

1. Load the source thread shell (`ProjectionSnapshotQuery.getThreadShellById`,
   `ProjectionSnapshotQuery.ts:217`); refuse a thread that is a reviewer thread of any run
   (`reviewer-thread`).
2. Compute the target diff, stats and estimate. `noChanges` when the diff is empty.
3. `sourceBusy` when the source thread's latest turn is `running`
   (`OrchestrationLatestTurn`, `packages/contracts/src/orchestration.ts:608-624`); the dialog
   shows a warning for Uncommitted and Branch targets and still allows starting.
4. `reviewRunning` when a review of this source thread is in state `running`.
5. Default slots: the L18 project binding when present (it replaces the whole list with one
   slot), else `settings.defaultReviewers`, else one slot with the source thread's
   `modelSelection`. `sameAsAuthor` compares `instanceId` and `model`.

**resolveAuto** (the dialog calls it after `prepare` when a slot is Auto, and again when the
user switches a slot to Auto): load the source thread and compute the target diff and stats
as `prepare` steps 1 and 2 do, then run
[reviewer-pick](#jev-feature-ai-code-reviewreviewer-pick) for the Auto slots with origin
`user`, excluding models already in other slots.

**start** (the server recomputes everything; client estimates are never trusted):

1. Validate: thread exists and is not a reviewer thread, 1 to 3 reviewers, no running review
   for this source (`review-running`), changes exist (`no-changes`), every resolved model's
   provider instance is available (`model-unavailable`, checked against the provider instance
   registry the model picker reads).
2. Size: when `changedLines > confirmAboveChangedLines`, a user start needs `confirmLarge`
   (else `confirmation-required`); agent and automatic starts create or update the thread's
   suggestion with `large: true` instead and return without starting.
3. Resolve remaining Auto slots (reviewer-pick with the review's origin).
4. Insert the review and one run per reviewer (`starting`), plus an `impeccable` run when that
   lens is on and the binary is available.
5. Per reviewer run, dispatch through `OrchestrationEngineService.dispatch` with server
   command ids `server:ai-code-review:<uuid>` (the `serverCommandId` shape in
   `apps/server/src/ws.ts:734`):
   - `thread.create` (`packages/contracts/src/orchestration.ts:1047-1062`): new `threadId`,
     same `projectId`, `branch` and `worktreePath` as the source, `title` "Review: <source
     title>" (or "Review (<model short name>): <source title>" with several reviewers, capped at
     120 characters), `modelSelection` with the effort option applied, `runtimeMode:
"approval-required"`, `interactionMode: "default"`.
   - `thread.turn.start` (`orchestration.ts:1238-1258`) with the brief as the user message,
     the same `modelSelection`, **`runtimeMode: "approval-required"` set explicitly** (the
     command's decoding default is `full-access`, `orchestration.ts:1251`) and
     `interactionMode: "default"`.
   - A dispatch failure fails that run with `start-failed`; other runs continue.
6. Optional integrations: L02 lineage row per reviewer thread (below).
7. Clear the thread's suggestion if it pointed at this target's turn; publish the snapshot.

**Running.** `AiCodeReviewReactor` keeps an in-memory map `reviewerThreadId -> runId` for runs
in `starting` or `running`, loaded from the store at start. It subscribes to
`orchestrationEngine.streamDomainEvents` (EXTENSION-POINTS.md, Background work) and handles:

- `thread.session-set` for a reviewer thread (`ThreadSessionSetPayload`,
  `orchestration.ts:1864`): `activeTurnId` set moves the run to `running`; `activeTurnId: null`
  after running is the end of the reviewer's turn (see below). Status `error` with no submit
  fails the run with `provider-error` and the session's `lastError`.
- `thread.deleted` for a reviewer thread: a running run fails with `thread-deleted`; a
  finished run keeps its findings. For a source thread: delete its reviews, runs, findings,
  groups and suggestion (history belongs to the source thread).
- `thread.turn-diff-completed` (`orchestration.ts:1874-1883`) for non-reviewer threads:
  [suggestions](#suggestions-and-automatic-starts).
- `project.deleted`: delete that project's project settings row.

Startup reconciliation: for every run still `starting` or `running`, read the reviewer thread
shell; if its latest turn is not `running`, handle the turn end now. No event cursor table is
needed, because run state is re-derived from thread state.

**Turn end.** If the run already has a tool submit, it is complete. Otherwise read the
reviewer thread's final assistant message (`latestTurn.assistantMessageId` through
`ProjectionSnapshotQuery.getThreadDetailById`, `ProjectionSnapshotQuery.ts:249`) and run
`fallbackParser`. A valid block completes the run with `submitSource: "fallback-json"`;
otherwise the run fails with `no-submit`. Either way dispatch `thread.settle` for the reviewer
thread (`orchestration.ts:1083`). When every run of the review is terminal, run
[Merge](#merge-mergerulets-decidets) and set the review state: `completed` if any reviewer run completed, `failed`
if all failed, `cancelled` if the user cancelled.

**Cancel.** Dispatch `thread.turn.interrupt` (`orchestration.ts:1281`) for each running
reviewer thread and mark those runs `cancelled`; findings already submitted stay and are
merged.

**Ask again.** Allowed for a run that failed with `no-submit` while its thread exists. Dispatch
one `thread.turn.start` on the reviewer thread (same model, `approval-required` explicit) with
the text: "You ended without calling loom_ai_code_review_submit. Call it now with your
findings and verdict. If you found nothing, submit an empty findings list and a looks-good
verdict." The run returns to `running`; the review returns to `running` and its merge to
`pending`. A new turn un-settles the thread through the decider's activity rule
(`apps/server/src/orchestration/decider.ts`, `thread.unsettled` with reason `activity`, around
line 1884); confirm this during implementation and dispatch nothing extra.

### The brief (`ReviewBrief.ts`)

Pure function of `{ targetLabel, command, refs, diff, diffFiles, lenses, instructions,
settingsInstructions, impactSummary }`. Sections, in order:

1. Role and rules: "You are reviewing code changes for the user. Do not modify files, create
   commits or run commands that write to the working tree. Read the repository's AGENTS.md or
   CLAUDE.md for project rules and apply them."
2. How to finish, first time: call `loom_ai_code_review_submit` exactly once with every
   finding and a verdict.
3. Target: the label, the refs, and the command.
4. The diff inline when it is at most `BRIEF_DIFF_MAX_CHARS = 60_000` characters (so most
   reviews need no commands and so no approvals); otherwise the per-file list with additions
   and deletions and "Run `<command>` to see the diff."
5. Lens sections (below).
6. Extra instructions from settings, then from this review.
7. Impact summary from L26 when present.
8. The finding fields in prose, with severity definitions ("blocking: must be fixed before
   this change is kept", "should-fix: a real problem worth fixing now", "nit: optional
   polish") and confidence definitions ("high: verified in the code", "medium: likely",
   "low: a suspicion worth checking").
9. How to finish, repeated: the submit call; and "Only if that tool is not available, end your
   final message with one fenced json block of the same shape."

**Correctness lens** (default): bugs, edge cases, error handling, security, data loss,
concurrency, and missing or wrong tests; categories `correctness`, `security`, `performance`,
`tests`.

**Simplicity lens** (ponytail-style, adapted from `ponytail-review`, MIT, with an attribution
comment in the source): over-engineering only, never correctness. Each finding's title starts
with one tag, `delete`, `stdlib`, `native`, `yagni` or `shrink`, followed by what to do; category
`simplicity`; severity `should-fix` or `nit`.

**impeccable lens:** not a prompt section; see [impeccable](#impeccable-lens-impeccablets).

### Submit tool and validation (`mcp.ts`, `findingValidation.ts`)

`loom_ai_code_review_submit`, registered in `ForkMcpToolkitsLive` (EXTENSION-POINTS.md, MCP
tools):

- Parameters: `ReviewSubmitInput` (a non-empty struct, as required by the comment at
  `apps/server/src/mcp/toolkits/device/tools.ts:31-33`).
- Description (short, it is listed to every session): "Only for Loom review threads: submit
  your code review findings and verdict when you finish. Other threads get an error."
- Caller check: read `McpInvocationContext.threadId`
  (`apps/server/src/mcp/McpInvocationContext.ts:13-20`) and find a run whose
  `reviewer_thread_id` matches, of kind `reviewer`. No match: failure `not-a-review-run`. A run
  accepts submits while it is `starting` or `running`, and after a tool submit until its
  reviewer turn ends (a second submit in that turn replaces the first); any other state gives
  failure `run-closed`.
- Validation per finding, against the checkout: a relative path, or an absolute path inside the
  checkout (made relative); no `..` escaping the root; the file exists (`fileState:
"present"`) or appears as deleted in the target diff (`"deleted"`, lines kept as given);
  otherwise the finding is rejected with a reason. `endLine < startLine` is swapped; lines past
  the end of a present file are clamped; `endLine` without `startLine` becomes both.
  `file: null` gives `fileState: "none"` and no lines. Exact duplicates (same file, lines,
  title) inside one submit are collapsed.
- Success result: `{ accepted, rejected: Array<{ index, reason }>, message }` with message
  "Recorded <n> findings. You can stop here." plus one line per rejected finding, so the
  reviewer can fix and resubmit.
- The submit marks the run `completed` with `submitSource: "tool"` and publishes the
  snapshot; the settle waits for the turn end.

`fallbackParser.ts` reads only the final assistant message of a reviewer thread, takes the
last fenced block whose info string is `json`, decodes it with `ReviewSubmitInput`, and runs
the same validation. Prose, `[P1]`-style lines and other blocks are ignored. It is never
called for other threads.

### Merge (`mergeRule.ts`, `decide.ts`)

Merge runs when all runs of a review are terminal (and provisionally, rule only, after each
reviewer run completes, so the panel shows partial results).

1. Findings from `reviewer` runs are merge candidates; `impeccable` findings each form their
   own group (`mergedBy: "single"`) and never count toward "Found by".
2. Candidate pairs (code): findings from different runs with the same `file` (both `null`
   counts as the same "general" bucket) whose ranges, widened by `MERGE_CANDIDATE_SLACK = 20`
   lines, overlap (a finding without lines pairs with any finding in the same file).
3. With Jev available: [finding-merge](#jev-feature-ai-code-reviewfinding-merge) answers the
   first `MAX_MERGE_PAIRS = 120` pairs in one request. Noul at or above `MERGE_SAME = 0.7` is
   "same", at or below `MERGE_DIFFERENT = 0.3` is "different", in between falls back to the
   rule for that pair. Pairs beyond the cap, and every pair when Jev falls back, use the rule.
4. Rule: same file bucket; ranges overlap after widening each by `MERGE_LINE_SLACK = 3`
   lines (or neither has lines); and title word-set Jaccard similarity at least
   `MERGE_TITLE_SIMILARITY = 0.4` (lowercase words of three or more letters, minus a short
   stop-word list).
5. Union-find over "same" pairs (transitivity lives in code, never in Jev). Each set is a
   group: representative = highest severity, then highest confidence, then earliest run,
   then ordinal; `severity` = highest; `confidence` = highest member confidence, raised to at
   least `medium` when the group was found by two or more reviewer runs; `mergedBy` = `jev`
   if any Jev "same" answer joined it, else `rule`, or `single` for one finding.
6. Re-merge (after "Ask again") recomputes groups; a new group inherits the strongest state of
   the old groups its findings came from (`sent-to-fix` over `dismissed` over `open`).

"Found by N of M": N = `reviewerRunIds.length`, M = reviewer runs of the review that
completed. Shown only when M is 2 or more.

### Jev features (`ext-decide`)

The features live in `apps/server/src/fork/ai-code-review/decide.ts` as
`aiCodeReviewDecideFeatures` (type `DecideFeature` from
`apps/server/src/fork/decide/registry.ts`) and are appended to `FORK_DECIDE_FEATURES` there
(EXTENSION-POINTS.md, section 18, "Registering a packet"; create the extension point if its
existence check fails, exactly as specified). All three default to mode `manual` and use
`jev-latest` unless the user pins a version in L29.

Every call is `yield* LoomDecide` then
`decide(featureId, { state, questions }, { origin, threadId, projectId })`
(`apps/server/src/fork/decide/LoomDecide.ts`). `decide` never fails and resolves within its
timeout (1,000 ms default); it runs `redactState` and `fitBudget` on every request itself and
applies the feature's threshold to every Choice and Score answer, so L15 passes no `threshold`
and keeps its thresholds in `defaultThreshold` (where L29's tuning can change them). L15 builds
state with named fields and `diffExcerpt(diff, { maxTokens })`
(`apps/server/src/fork/decide/diffExcerpt.ts`, returning `{ text, files, totals, truncated }`;
`text` is what goes into the state). Arrays that may be trimmed (file lists) put the least
important items first, because `fitBudget` drops array elements from the start before it
shortens strings. Numbers go in as named buckets computed in code, never as arithmetic for Jev
([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). Every
`{ status: "fallback" }` takes the non-Jev path described per feature, and the decision id (when
present) is kept with the result for display and L29 ratings.

```ts
import type { DecideFeature } from "../decide/registry.ts";

export const aiCodeReviewDecideFeatures: ReadonlyArray<DecideFeature> = [
  {
    id: "ai-code-review.reviewer-pick",
    packet: "L15",
    label: "Pick the reviewer model",
    description:
      "Picks the model and effort for Auto reviewer slots; without Jev, Auto uses the default reviewer and the preset's default effort.",
    defaultMode: "manual",
    defaultThreshold: 0.5,
    // agentTool defaults to true: loom_ai_code_review_start reaches it for agent-started reviews.
  },
  {
    id: "ai-code-review.turn-suggest",
    packet: "L15",
    label: "Suggest a review after a turn",
    description:
      "Decides whether to show 'Review this turn?' after a turn; without Jev, a changed-line threshold decides.",
    defaultMode: "manual",
    defaultThreshold: 0.5,
    agentTool: false, // automatic only; no MCP tool reaches it
  },
  {
    id: "ai-code-review.finding-merge",
    packet: "L15",
    label: "Merge findings across reviewers",
    description:
      "Decides whether findings from different reviewers are the same issue; without Jev, a file, line and title rule decides.",
    defaultMode: "manual",
    agentTool: false, // automatic only; Noul answers, never gated by a threshold
  },
];
```

**Agent switches.** Only `reviewer-pick` can be reached by an agent: `loom_ai_code_review_start`
resolves Auto slots with origin `agent`, and `decide` returns `agent-not-allowed` unless the
user turned on that feature's "Let agents use this" in the Jev section; the review then uses
the default reviewer, and the tool result says so in one line. The start tool itself is gated
by L15's own "Let agents use this" (`allowAgents`), because starting a review spends reviewer
tokens whether or not Jev is involved; L15 adds no second Jev gate. `turn-suggest` and
`finding-merge` always run with origin `auto` (also inside agent-started reviews), so they
follow only their "Use Jev" switch.

#### Jev feature `ai-code-review.reviewer-pick`

Origin: `user` (dialog), `agent` (agent tool), `auto` (automatic start). Skipped in code, with
`too-few-candidates`, when fewer than two candidates are available after removing models that
are unavailable or already in another slot; one remaining candidate is used directly with
`pick: manual`.

State:

```json
{
  "change": {
    "target": "uncommitted changes",
    "size": "medium (200 to 999 changed lines)",
    "file_count": "several (6 to 20 files)",
    "kinds": ["source", "tests"],
    "languages": ["TypeScript", "CSS"],
    "files": ["apps/web/src/..."]
  },
  "author_model": "Claude Opus (Claude)",
  "extra_instructions": "Focus on the migration.",
  "diff_excerpt": "..."
}
```

`files` holds at most 100 paths; `diff_excerpt` uses `diffExcerpt(diff, { maxTokens: 6_000 })`.

Questions:

- `reviewer`: Choice, instructions "Which candidate is the best reviewer for the change in
  `change` and `diff_excerpt`?", criteria = one entry per candidate: key = a unique readable
  label built in code (model name and provider instance), value = the user's description (or
  null). Keys map back to `ModelSelection` in code.
- `effort` (only when the preset range has two or more levels): Score, instructions "How much
  reasoning effort does a careful review of the change in `change` and `diff_excerpt` need?",
  criteria = the preset's levels in order, each described: low "Small or mechanical change",
  medium "Ordinary feature or fix", high "Tricky logic, concurrency, security or data
  handling", max "Large, subtle or high-risk change".

Use:

- `answered`: both answers are confident. Take the `reviewer` choice, and the effort level
  `clamp(round(score), 0, levels - 1)`.
- `fallback` with reason `low-confidence`: the result still carries `answers` and
  `lowConfidenceKeys` (EXTENSION-POINTS.md section 18), which names the unsure questions. If
  only `effort` is
  unsure, keep the `reviewer` pick (`pick: jev`, `effortConfidence` recorded) with the preset
  default effort. If `reviewer` is unsure, use the default model and the preset default effort
  (`pick: fallback`, reason `low-confidence`, the decision id kept).
- Any other fallback: the default model (the first non-Auto default slot, else the source
  thread's model) and the preset default effort, with the reason. The dialog shows it: "Auto
  unavailable (no Jev key): using Claude Opus", or "Jev was not sure: using Claude Opus".

#### Jev feature `ai-code-review.turn-suggest`

Runs in the reactor on `thread.turn-diff-completed` with origin `auto`. Code pre-gates, in
order: `suggestAfterTurns` on; the thread is not a reviewer thread; no running review for the
thread; the checkpoint status is `ready`; `changedLines` (sum over the payload's `files`) is at
least `SUGGEST_MIN_CHANGED_LINES = 20`. Then:

State: `{ "turn": { "size", "file_count", "kinds", "languages", "files" }, "request": <first 500
characters of the turn's user message>, "diff_excerpt": <diffExcerpt, 4_000 tokens> }`.

Question `worth_review`: Score, instructions "How useful would an independent code review of
the changes in `turn` and `diff_excerpt` be before the user keeps them?", criteria ["Not
useful: docs, formatting, renames or other mechanical changes", "Somewhat useful: small logic
changes with low risk", "Clearly useful: new logic, security, data handling, concurrency, or
code many callers depend on"].

Use: `answered` suggests when `score >= 1.5` and does not suggest below it. Any fallback,
including `low-confidence` (its answer is not used), suggests when
`changedLines >= suggestAboveChangedLines` (`reason: "threshold"`).

#### Jev feature `ai-code-review.finding-merge`

Origin `auto`. State: `{ "findings": { "f1": { "file", "lines": "L10 to L14", "title",
"category", "body": <first 600 characters> }, ... } }` with only the findings that appear in
candidate pairs. Questions, one Noul per pair `same_f1_f2`: instructions "Do `findings.f1` and
`findings.f2` describe the same problem in the code?", criteria true "The same underlying
problem, even if worded differently or with different fixes", false "Different problems, even
if they are in the same place". Use as described in [Merge](#merge-mergerulets-decidets). One request per review;
the pair cap keeps it inside the 64k request budget
([speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)).

### Effort (`effort.ts`)

Levels are ordered `low < medium < high < max`. A preset's range bounds Auto's effort pick and
supplies the default for manual slots. A level maps to a model's provider option through its
`ModelCapabilities.optionDescriptors` (`packages/contracts/src/model.ts:125-127`): the `select`
descriptor whose id is `effort` (Claude, `apps/server/src/provider/ClaudeModelCatalog.ts:196`)
or `reasoningEffort` (Codex, `apps/server/src/provider/Layers/CodexProvider.ts:180`; Grok,
`GrokProvider.ts:197`). Exact choice id match first (`low`, `medium`, `high`), `max` to the
last choice; otherwise by position scaled to the choice count. A model without such a
descriptor gets no effort option, and the dialog shows no effort control for it. The result
goes into `modelSelection.options` as `{ id, value }` (`ProviderOptionSelection`,
`model.ts:49-52`).

### Suggestions and automatic starts

- A suggestion is stored per thread (the latest only) with the turn, changed lines, reason and
  `large`. It is published in `ThreadReviewsSnapshot.suggestion`, dismissed by
  `dismissSuggestion`, replaced by the next turn's suggestion, and cleared when a review of
  that turn starts.
- With the project's `autoStartSuggested` on, a suggestion that is not `large` starts a
  review instead (origin `auto`, default reviewers, default lenses, target `turn`). A `large`
  suggestion stays a chip.

### Agent tool `loom_ai_code_review_start` (`mcp.ts`)

- Parameters: `{ target: "uncommitted" | "branch" | "turn" | "commit", baseRef?: string,
commitSha?: string, instructions?: string (max 4,000) }`. `turn` means the latest completed
  turn of the calling thread.
- Description: "Start a Loom code review of this thread's changes by other models. Findings go
  to the user, not to you. Only works when the user allows it."
- Gate: `settings.allowAgents` (else failure `disabled`); the caller is not a reviewer thread
  (`reviewer-thread`). The caller's own turn is running by definition, so the source-busy
  warning does not apply.
- Starts with origin `agent`, default reviewers and lenses. Auto slots call reviewer-pick with
  origin `agent`, which falls back to the default model unless that decide feature allows
  agents. Above the confirmation threshold it creates a `large` suggestion and returns
  `{ status: "suggested", message: "The change is large; the user was asked to start the
review." }`; otherwise `{ status: "started", reviewId, message }`.

### impeccable lens (`impeccable.ts`)

- Availability: the `IMPECCABLE_BIN` environment variable when it names an executable file,
  else a PATH lookup for `impeccable`; a filesystem check only, nothing is executed. Cached
  for 60 seconds; reported by `getSettings`.
- Run: `impeccable detect --json <files>` in the checkout, where files are the target's
  present (not deleted) changed files with an extension in `IMPECCABLE_EXTENSIONS` (copied
  from `crates/detect/src/file_system.rs:19-34` at the reviewed commit), at most 500 files,
  timeout 60 s, output cap 5 MB, environment unchanged. The argv builder is pure and only
  ever produces the `detect` subcommand; Loom never runs `install`, `update`, `link` or any
  hook command.
- Exit 0: no findings. Exit 2: parse the JSON array (`crates/foundation/src/findings.rs:13-31`).
  Exit 1 or anything else: the run fails with `impeccable-error` and the first line of stderr.
- Mapping: severity `error` to `should-fix`, `warning` and `advisory` to `nit`; confidence
  `high`, or `medium` for `advisory`; category `design`; title = `name`; body = `description`
  plus the snippet in a fence; `startLine = endLine = line`; `source: "impeccable"`.

### Hand-back (web `handBack.ts`)

1. `getHandBack({ reviewId, groupIds })` returns, per group, the representative's file and
   range, `lines` (the current text of those lines from the checkout, at most 200 lines,
   `null` when the file is missing, binary or over 2 MB), and `text`: "<Severity>: <title>",
   the body, and "Suggested fix: ..." when present.
2. The client builds a `ReviewCommentContext` (`apps/web/src/reviewCommentContext.ts:13-42`)
   with the same field conventions as `buildFileReviewComment` (`reviewCommentContext.ts:59-81`):
   `id` "loom-acr-<groupId>" (letters, digits, `-` and `_` only, the composer context id
   pattern, `packages/contracts/src/composerContext.ts:31`), `sectionId` "file:<path>",
   `sectionTitle` "AI review", `startIndex`/`endIndex` zero-based, `rangeLabel` "L10" or "L10
   to L14", `diff` = `lines` (or ""), `fenceLanguage` from
   `inferReviewCommentFenceLanguage`. A group without a file uses `filePath` "(general)",
   because the persisted record requires a non-empty path
   (`packages/contracts/src/composerContext.ts:193`), `rangeLabel` "General" and indexes 0.
   Text and diff are clamped to `COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS` and
   `COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS` (`composerContext.ts:42-43`).
3. `useComposerDraftStore.getState().addReviewComment(sourceThreadRef, comment)`
   (`apps/web/src/composerDraftStore.ts:665-669`) per group, then
   `setGroupState(sent-to-fix)`. Nothing is sent; the draft's `reviewComments`
   (`composerDraftStore.ts:235`) render as the usual chips.
4. "Copy as Markdown": client-side from `ReviewDetail`, one list item per group:
   `- **Should fix** path:L10-L14: title` and the body indented.

Opening code: "Open file" calls
`useRightPanelStore.getState().openFile(threadRef, path, startLine)`
(`apps/web/src/rightPanelStore.ts:137`). "Open in diff" selects the matching scope in
`useDiffPanelStore` (`selectGitScope`, `selectBranchBaseRef`, or `selectTurn(ref, turnId,
path)`, `apps/web/src/diffPanelStore.ts:19-21`) and opens the diff surface with
`useRightPanelStore.getState().open(threadRef, "diff")` (`rightPanelStore.ts:130`). Commit
targets have no diff scope, so they show "Open file" only.

### Optional integrations (`integrations.ts`)

- **L02 present** (`fork_thread_lineage_links` exists): per reviewer thread
  `INSERT OR IGNORE INTO fork_thread_lineage_links (child_thread_id, parent_thread_id,
project_id, kind, context_mode, through_message_id, carried_message_count, created_by,
created_at) VALUES (?, ?, ?, 'review', 'none', NULL, 0, 'user', ?)` (`created_by` is
  `'agent'` for agent-started reviews), guarded by the `sqlite_master` check L08 uses. L02
  defines the `review` kind in `ThreadLineageKind` and its `CHECK` (L02 TECHNICAL.md,
  Storage); on an older L02 table whose `CHECK` predates it, `INSERT OR IGNORE` skips the row
  (SQLite applies IGNORE to CHECK violations). Failures are logged and ignored.
- **L18 present** (`project-profiles` in `LOOM_SERVER_FEATURES` and its service in the
  runtime): the web registers a `ProfileBindingSource` in L18's `PROFILE_BINDING_SOURCES`
  (`apps/web/src/fork/project-profiles/bindingSources.ts`, L18 TECHNICAL.md) with kind
  `ai-code-review-reviewer`, label "Reviewer", feature `ai-code-review`, options = "Auto
  (Jev)" plus the available models. The binding id is the JSON of a `ReviewerSlot`. The
  server reads the project's profile in `prepare` with `ProjectProfileService.get(projectId)`
  (L18 TECHNICAL.md, "Binding sources"), looked up as an optional service; the first binding
  of that kind wins. Without L18 there is no per-project reviewer.
- **L26 present** (`code-graph` in `LOOM_SERVER_FEATURES`): `prepare`/`start` call the code
  graph service's impact query server-side (`CodeGraphImpactInput` with the target's changed
  files, depth 2; L26 TECHNICAL.md, "Impact") regardless of L26's agent switch, and the brief
  gets at most 40 lines: files by minimum depth with hit counts, and "truncated" when capped.
  Absent, stale or failing graph: no section. Wire it with an optional service lookup so L15
  builds and runs without L26.
- **L29 present:** nothing to do; the Decisions panel shows L15's decide calls from
  `fork_decide_decisions`.

### Storage

Migration set `AiCodeReviewMigrations`, tracking table `fork_migrations_ai_code_review`. No
foreign keys into upstream tables.

```sql
CREATE TABLE IF NOT EXISTS fork_ai_code_review_reviews (
  review_id          TEXT PRIMARY KEY,
  source_thread_id   TEXT NOT NULL,
  project_id         TEXT NOT NULL,
  target_json        TEXT NOT NULL,
  target_label       TEXT NOT NULL,
  instructions       TEXT,
  lenses_json        TEXT NOT NULL,
  origin             TEXT NOT NULL CHECK (origin IN ('user', 'agent', 'auto')),
  state              TEXT NOT NULL,
  merge_state        TEXT NOT NULL,
  estimate_json      TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  completed_at       TEXT
);
CREATE INDEX IF NOT EXISTS fork_ai_code_review_reviews_source
  ON fork_ai_code_review_reviews (source_thread_id, created_at);

CREATE TABLE IF NOT EXISTS fork_ai_code_review_runs (
  run_id              TEXT PRIMARY KEY,
  review_id           TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('reviewer', 'impeccable')),
  reviewer_thread_id  TEXT,
  model_json          TEXT,
  effort              TEXT,
  pick_json           TEXT,
  state               TEXT NOT NULL,
  submit_source       TEXT,
  verdict_json        TEXT,
  failure_json        TEXT,
  started_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS fork_ai_code_review_runs_review ON fork_ai_code_review_runs (review_id);
CREATE UNIQUE INDEX IF NOT EXISTS fork_ai_code_review_runs_reviewer
  ON fork_ai_code_review_runs (reviewer_thread_id) WHERE reviewer_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fork_ai_code_review_findings (
  finding_id    TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  review_id     TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  finding_json  TEXT NOT NULL,
  source        TEXT NOT NULL,
  group_id      TEXT
);
CREATE INDEX IF NOT EXISTS fork_ai_code_review_findings_review ON fork_ai_code_review_findings (review_id);

CREATE TABLE IF NOT EXISTS fork_ai_code_review_groups (
  group_id           TEXT PRIMARY KEY,
  review_id          TEXT NOT NULL,
  representative_id  TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('open', 'dismissed', 'sent-to-fix')),
  merged_by          TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_ai_code_review_groups_review ON fork_ai_code_review_groups (review_id);

CREATE TABLE IF NOT EXISTS fork_ai_code_review_suggestions (
  thread_id       TEXT PRIMARY KEY,
  turn_id         TEXT NOT NULL,
  turn_number     INTEGER NOT NULL,
  changed_lines   INTEGER NOT NULL,
  reason          TEXT NOT NULL,
  large           INTEGER NOT NULL,
  decision_id     TEXT,
  state           TEXT NOT NULL CHECK (state IN ('open', 'dismissed', 'started')),
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_ai_code_review_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), settings_json TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_ai_code_review_project_settings (
  project_id            TEXT PRIMARY KEY,
  auto_start_suggested  INTEGER NOT NULL,
  updated_at            TEXT NOT NULL
);
```

Ids are server-generated UUIDs, stable across renders (old Loom's were not). Group
membership is `findings.group_id`. Cleanup on a source thread's `thread.deleted` deletes its
reviews and, by `review_id`, their runs, findings and groups, plus its suggestion row, in one
transaction. Settings JSON decodes with `AiCodeReviewSettings` merged over the defaults, so
new fields need no migration.

### Capability and version skew

Append `"ai-code-review"` to `LOOM_SERVER_FEATURES`. Every client entry point checks
`supportsLoomFeature(capabilities, "ai-code-review")`; Auto slots and Jev wording also need
`decide`. Upstream clients on a Loom server see reviewer threads as ordinary threads. No
upstream wire schema or event type changes.

### Web (`apps/web/src/fork/ai-code-review/`)

- `state.ts`: atoms from `packages/client-runtime/src/fork/ai-code-review.ts`: a subscription
  atom family per source thread (`ThreadReviewsSnapshot`), `get` on demand when a review is
  expanded, settings query atoms.
- `panel.tsx`: `ForkPanelDefinition` id `ai-code-review`, title "Review", letter `W`,
  description "AI review of this thread's changes, with findings you can send back as fixes."
- `ReviewPanel.tsx`, `ReviewCard.tsx`, `FindingCard.tsx`, `FindingFilters.tsx`: reviews
  newest first; the latest expanded. Reviewer rows derive "Waiting for approval" from the
  reviewer thread's shell (`hasPendingApprovals`, the flag the sidebar status uses,
  `apps/web/src/components/Sidebar.logic.ts:840`).
- `StartReviewDialog.tsx` and `startDialogStore.ts` (zustand, session only): mounted once
  through `ext-web-root`; opened by the panel, palette, diff button, chip and keybinding.
  Model choice per slot reuses upstream's model picker if it can be rendered standalone,
  otherwise a list built from the provider instances' models; either way it only offers
  available models. "Auto (Jev)" is offered only when
  `useDecideFeature(environmentId, "ai-code-review.reviewer-pick").usable`; a saved Auto slot
  shows the fallback line otherwise. Auto slots resolve through `resolveAuto` after `prepare`.
- `handBack.ts` (above), `markdown.ts` (Copy as Markdown).
- `palette.tsx`: items `action:loom:ai-code-review:uncommitted`, `:branch`, `:turn`, `:commit`,
  `:panel`, each with `shortcutCommand` where relevant.
- `diffHeaderAction.tsx`: `ForkDiffHeaderAction` id `ai-code-review`, an icon button "Review
  changes" mapping `DiffPanelSelection` (`apps/web/src/diffPanelStore.ts:8-11`): `unstaged`
  to Uncommitted, `branch` to Branch with its `baseRef`, `turn` to Turn with its `turnId`.
- `composerChip.tsx`: a `FORK_COMPOSER_BLOCKS` entry (`ext-composer`) rendering the "Review
  this turn?" chip from the thread's snapshot; renders null when there is no open suggestion.
- `keybinding.ts`: `loom.ai-code-review.start` in `FORK_KEYBINDING_COMMANDS`, unbound;
  `StartReviewDialogHost` subscribes with `onForkCommand("loom.ai-code-review.start", ...)`;
  no packet keydown listener.
- `settings.tsx`: section id `ai-code-review`, title "AI code review", with the project scope
  subsection for `autoStartSuggested`. The Auto candidates field is hidden when
  `useDecideFeature(...).supported` is false (effort presets stay: they also set manual slots); Jev's own switches stay in the Jev section.
- `profileBinding.ts`: the L18 binding source, registered only when L18 is present.

### Mobile

Nothing in v1. The client-runtime atoms are shared, so a later mobile view needs only UI.

### Performance

- The subscription carries summaries and counts only (at most 20 reviews); findings load on
  demand with `get`.
- Completion is driven by domain events and tool calls; no polling. The reactor's filter is a
  map lookup per event.
- Jev calls are at most one per Auto resolution, one per completed turn that passes the code
  pre-gates, and one per finished multi-reviewer review; all are bounded by the 1 s timeout
  and never on a request path longer than the dialog's Auto slot.
- The chip is a static element; no animation.
