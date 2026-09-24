# L15 technical notes

Two parts: **research findings** that hold whatever the session decides, and a **provisional
design** for the recommended v1 in [DESIGN-SESSION.md](./DESIGN-SESSION.md#5-recommended-v1).
Revise the second part after the session. Citations are to this fork at upstream v0.0.42
(`a931bd85f3`).

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
| Runtime modes                   | `RuntimeMode = approval-required                                                                                                                                                                                                         | auto-accept-edits                                                                               | auto | full-access` (`orchestration.ts:128-133`) | Reviewer runs `approval-required`. |
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

## Part 2: provisional design for the recommended v1

Everything below assumes the session picks option A2. Replace it if not.

### Contracts (`packages/contracts/src/fork/ai-code-review.ts`)

```ts
export const AI_CODE_REVIEW_WS_METHODS = {
  start: "loom.ai-code-review.start",
  cancel: "loom.ai-code-review.cancel",
  listRuns: "loom.ai-code-review.listRuns",
  subscribeRuns: "loom.ai-code-review.subscribeRuns", // ForkSubscriptionRpcTag, per source thread
  getRun: "loom.ai-code-review.getRun",
  setFindingState: "loom.ai-code-review.setFindingState",
  askAgain: "loom.ai-code-review.askAgain",
  getSettings: "loom.ai-code-review.getSettings",
  updateSettings: "loom.ai-code-review.updateSettings",
} as const;

export const ReviewTarget = Schema.Union([
  Schema.TaggedStruct("uncommitted", {}),
  Schema.TaggedStruct("branch", { baseRef: Schema.NullOr(TrimmedNonEmptyString) }), // null: automatic base
]);

export const ReviewSeverity = Schema.Literals(["P0", "P1", "P2", "P3"]);
export const ReviewCategory = Schema.Literals([
  "correctness",
  "security",
  "performance",
  "simplicity",
  "design",
  "tests",
  "other",
]);

export const ReviewFindingInput = Schema.Struct({
  // what the reviewer submits
  severity: ReviewSeverity,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  body: Schema.String.check(Schema.isMaxLength(4_000)),
  file: Schema.NullOr(TrimmedNonEmptyString),
  startLine: Schema.NullOr(PositiveInt),
  endLine: Schema.NullOr(PositiveInt),
  category: ReviewCategory,
  confidence: Schema.Number.check(Schema.isBetween(0, 1)),
  suggestedFix: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))),
});

export const ReviewFinding = Schema.Struct({
  ...ReviewFindingInput.fields,
  id: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "dismissed", "sent-to-fix"]),
  source: Schema.Literals(["reviewer", "fallback-json", "impeccable"]),
});

export const ReviewRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceThreadId: ThreadId,
  reviewerThreadId: Schema.NullOr(ThreadId),
  target: ReviewTarget,
  modelSelection: ModelSelection,
  lenses: Schema.Array(Schema.Literals(["correctness", "simplicity"])),
  state: Schema.Literals(["starting", "running", "completed", "failed", "cancelled"]),
  verdict: Schema.NullOr(
    Schema.Struct({
      overall: Schema.Literals(["looks-good", "needs-changes", "blocking"]),
      summary: Schema.String,
    }),
  ),
  failure: Schema.NullOr(Schema.String),
  diffStats: Schema.Struct({
    files: Schema.Number,
    additions: Schema.Number,
    deletions: Schema.Number,
  }),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  findingCount: Schema.Number,
});
```

Scopes: `start`, `cancel`, `askAgain`, `setFindingState` and `updateSettings` need
`orchestration:operate`; reads need `orchestration:read`. `start` also dispatches
orchestration commands server-side, which the operate scope already covers.

### Server (`apps/server/src/fork/ai-code-review/`)

- `ReviewRunStore.ts`: tables below.
- `ReviewBrief.ts`: pure brief builder (target, how to inspect it, lenses, optional L26 impact
  summary, submit instructions repeated at the end, the finding schema in prose).
- `ReviewService.ts` (name it `AiCodeReviewService` to avoid upstream's `ReviewService`):
  - `start`: resolve the source thread shell and project; compute diff stats with upstream's
    `ReviewService.getDiffPreview` or a plain `git diff --shortstat`; refuse "no changes";
    create the reviewer thread with `thread.create` (same `projectId`, `branch`,
    `worktreePath`, `runtimeMode: "approval-required"`, `interactionMode: "default"`, title
    "Review: <source title>") and `thread.turn.start` with the brief, both through
    `OrchestrationEngineService.dispatch` with server command ids; insert the run.
  - Watches the reviewer thread through `streamDomainEvents` (`thread.session-set`,
    `thread.turn-diff-completed`, `thread.activity-appended`) and the thread shell's latest
    turn state: on turn end without a submit, run the fallback parser on the final assistant
    message, else mark `failed`. On completion dispatch `thread.settle` for the reviewer
    thread.
  - `cancel`: `thread.turn.interrupt` on the reviewer thread, run `cancelled`.
  - `askAgain`: one follow-up `thread.turn.start` asking for the submit call.
  - Cleanup reactor on `thread.deleted` for source or reviewer threads.
- `mcp.ts`: `loom_ai_code_review_submit({ findings, verdict })`. The handler looks up the
  calling `threadId` (from `McpInvocationContext`) in `fork_ai_code_review_runs` as an active
  reviewer thread; any other caller gets a typed "not a Loom review run" error. It validates
  each finding's file against the checkout (relative, exists or deleted in the diff) and clamps
  lines. Idempotent per run: a second submit replaces the first while the run is active.

### Storage

```sql
CREATE TABLE IF NOT EXISTS fork_ai_code_review_runs (
  run_id              TEXT PRIMARY KEY,
  source_thread_id    TEXT NOT NULL,
  reviewer_thread_id  TEXT,
  target_json         TEXT NOT NULL,
  model_json          TEXT NOT NULL,
  lenses_json         TEXT NOT NULL,
  state               TEXT NOT NULL,
  verdict_json        TEXT,
  failure             TEXT,
  diff_stats_json     TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS fork_ai_code_review_runs_source ON fork_ai_code_review_runs (source_thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS fork_ai_code_review_runs_reviewer ON fork_ai_code_review_runs (reviewer_thread_id);

CREATE TABLE IF NOT EXISTS fork_ai_code_review_findings (
  finding_id  TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  ordinal     INTEGER NOT NULL,
  finding_json TEXT NOT NULL,
  state       TEXT NOT NULL,
  source      TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_ai_code_review_findings_run ON fork_ai_code_review_findings (run_id);

CREATE TABLE IF NOT EXISTS fork_ai_code_review_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), settings_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

Finding ids are server-generated UUIDs, stable across renders (old Loom's ids were not).

### Clients

- Client runtime atoms for runs (subscription per source thread, small payloads: runs plus
  finding counts), `getRun` for findings, commands for the rest.
- Web: `apps/web/src/fork/ai-code-review/` with a Review panel (`ext-panels`, id
  `ai-code-review`, launcher letter `W`), start dialog (target, model picker reusing upstream's
  model picker component if it can be used standalone; otherwise a simple list from provider
  instances), finding cards, palette items, settings section.
- "Fix this": build a `ReviewCommentContext` with `buildFileReviewComment` when the finding's
  lines are inside the current diff (excerpt from `review.getDiffPreview`), otherwise a context
  with the file and range and no excerpt; add with
  `useComposerDraftStore.getState().addReviewComment(sourceThreadRef, comment)`.

### Performance

Runs and findings are small; the subscription carries run summaries only, findings load on
demand. No polling: completion is driven by domain events.

### Alternatives to revisit after the session

See DESIGN-SESSION.md, section 3. The most likely swap is A3 (headless structured runner)
for a "quick review" mode alongside A2.
