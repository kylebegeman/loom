# L15 design session brief

**The session is complete (2026-09-24).** The decisions are in
[section 7](#7-decision-record); sections 1 to 6 are the brief as it was prepared and are kept
as history.

Everything needed to decide how Loom's AI code review should work, in one place: what old Loom
built and learned, what upstream T3 Code already has, the design axes with options and costs,
the questions to answer, and a recommended v1. Research details and citations are in
[TECHNICAL.md](./TECHNICAL.md) and [REFERENCES.md](./REFERENCES.md).

## 1. What old Loom did

Old Loom 0.13.10 (ledgers 0037 to 0043, plus 0045 to 0050 for review windows):

- **Engine.** A new orchestration command and event (`thread.review.start`,
  `thread.review-start-requested`) and a provider method `startReview`. Codex used the
  app-server's `review/start` with four targets (uncommitted changes, base branch, commit,
  custom instructions). Claude had no protocol, so it sent an ordinary turn containing
  `/code-review` plus instructions to tag each finding `[P0]` to `[P3]` with `file:line`.
- **Launcher.** One picker in the chat header and the diff panel: target, model, and "same
  thread" or "new thread". "New thread" created a child thread and ran the review inline
  there; Codex's own detached mode was never used.
- **Findings.** Parsed on the client from assistant text with a regex, on **every**
  non-streaming assistant message. Severity P0 to P3, title, body, location; no confidence;
  not persisted; ids unstable (they included the index).
- **Cards.** Severity badge, title, source, `file:line` link that opened the diff panel (the
  line was dropped), body, and "Fix this", which appended a prompt to the composer and never
  sent it.
- **What was fragile.** The whole pipeline depended on prose conventions; any `[P1] ...` line
  in any message rendered as a review card; Claude's review was only as structured as its
  willingness to follow formatting instructions; Codex refused review on threads with
  runtime restrictions; the planned structured `ReviewFinding[]` path never shipped; a
  review-only window route was built and then removed.
- **What worked.** One launcher for every entry point; review in a child thread (the working
  thread's context stays clean); "Fix this" into the composer, never auto-send; severity
  ranking.

## 2. What upstream T3 Code has today

- **Diff panel** with working tree, branch range and per-turn scopes, inline comments that
  attach to the composer as structured review comments (`ReviewCommentContext` with file,
  range, diff excerpt; `apps/web/src/reviewCommentContext.ts`, composer draft
  `reviewComments`, `apps/web/src/composerDraftStore.ts:665`).
- **Review service**: `review.getDiffPreview` and `review.getDiffFileContents`
  (`apps/server/src/review/ReviewService.ts`), diff text only, under the `review:write`
  scope. No AI.
- **Pull request panels**: list, detail, timeline, code tab, review bar, comment composer,
  reviewers (`apps/web/src/components/pullRequest/`). Human review of real PRs is covered.
- **Codex protocol support in the generated client**: `review/start` with targets
  `uncommittedChanges | baseBranch | commit | custom` and delivery `inline | detached`
  (`packages/effect-codex-app-server/src/_generated/schema.gen.ts:6105-6155`). The result is
  an `exitedReviewMode` item whose `review` field is **text** (`schema.gen.ts:20536`). The
  upstream Codex adapter does not call it.
- **Headless structured generation** for commit messages and PR text: `codex exec -s read-only
--output-schema` and `claude -p --json-schema` (`apps/server/src/textGeneration/`), private to
  the `TextGeneration` service with a closed set of operations.
- **The `t3-code` MCP server** attached to every provider session, which fork toolkits can
  extend (EXTENSION-POINTS.md, MCP tools).
- **Threads** can be created, started, settled and archived through existing commands, so a
  fork service can run an agent without new orchestration events.

## 3. Design axes and options

### Axis A: the review engine

| Option                                                      | How                                                                                                                                                                                                           | Providers                                      | Structured findings                        | Upstream seams                                                                                                                    | Notes                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **A1. Native provider review**                              | Add `startReview` to the adapter contract; Codex calls `review/start`; others fall back                                                                                                                       | Codex native; others by prompt                 | No: Codex returns text                     | 4 to 6 in provider code (`ProviderAdapter.ts`, `CodexAdapter.ts`, `CodexSessionRuntime.ts`, `ProviderService.ts`, a trigger path) | Old Loom's approach. Highest merge risk; Codex-only benefit; text output.                       |
| **A2. Reviewer agent thread plus MCP submit** (recommended) | A fork service creates a reviewer thread with existing `thread.create` / `thread.turn.start`, a review brief, `approval-required` runtime mode; the reviewer calls `loom_ai_code_review_submit` with findings | All six (every adapter attaches `t3-code` MCP) | Yes, schema-validated at the tool boundary | None                                                                                                                              | Transparent (a real transcript you can continue); costs a sidebar thread (settled when done).   |
| **A3. Headless structured runner**                          | Fork code runs `codex exec --output-schema` or `claude -p --json-schema` read-only in the checkout, like upstream's text generation does                                                                      | Codex, Claude (others later)                   | Yes, provider-enforced JSON schema         | None, but duplicates upstream's private CLI plumbing and must read each provider instance's binary path and environment           | No transcript; nothing in the sidebar; cannot "continue the conversation" with the reviewer.    |
| **A4. Headless Codex app-server**                           | Fork spawns its own `codex app-server` and calls `review/start` with the generated client                                                                                                                     | Codex                                          | No (text)                                  | None                                                                                                                              | Native Codex review quality without adapter seams, but a second Codex process and text parsing. |
| **A5. Same-thread review turn**                             | Send a review prompt as the next turn of the working thread                                                                                                                                                   | All                                            | Via MCP submit                             | None                                                                                                                              | Pollutes the working context; old Loom offered it and preferred child threads.                  |

### Axis B: what is reviewed

B1 uncommitted changes of the thread's checkout; B2 branch against a base (merge-base diff);
B3 one commit; B4 one turn's diff (checkpoint range, which Loom already has); B5 a pull
request (upstream PR data, possibly someone else's branch); B6 custom instructions only.
Recommendation: B1 and B2 in v1, B4 in v1.1, B5 later.

### Axis C: how findings get their structure

C1 regex over prose (old Loom); C2 fenced JSON block in the final message; C3 MCP tool call
with a typed schema (A2); C4 provider JSON schema (A3). Recommendation: C3, with C2 as a
fallback parser for a reviewer that forgets the tool, applied **only** to reviewer threads.

Draft finding shape:

```ts
{ severity: "P0" | "P1" | "P2" | "P3", title: string, body: string,
  file: string | null, startLine: number | null, endLine: number | null,
  category: "correctness" | "security" | "performance" | "simplicity" | "design" | "tests" | "other",
  confidence: number /* 0..1 */, suggestedFix?: string }
```

plus a run verdict: `{ summary: string, overall: "looks-good" | "needs-changes" | "blocking" }`.

### Axis D: where findings appear

D1 a fork Review panel (cards, filters, run history); D2 inline annotations in the diff panel
(upstream renders comment annotations via `DiffCommentAnnotation`; injecting fork annotations
needs a seam into the diff code view); D3 in the reviewer thread only; D4 as a PR review
draft. Recommendation: D1 in v1 with "open in diff" and "open file at line"; D2 later if the
panel proves too far from the code.

### Axis E: hand-back

E1 append text to the composer (old Loom); E2 add each finding as an upstream
`ReviewCommentContext` to the working thread's composer, so it renders like a human diff
comment and carries file, range and a diff excerpt (recommended); E3 auto-send a fix turn
(rejected: violates the never-auto-send invariant); E4 open a new fix thread per finding.

### Axis F: extra review lenses

- **F1 correctness** (default): bugs, edge cases, error handling, security, data loss.
- **F2 simplicity**, modeled on ponytail's `ponytail-review` skill (MIT): one line per
  finding `<file>:L<line>: <tag> <what>. <replacement>.` with tags `delete`, `stdlib`,
  `native`, `yagni`, `shrink`, explicitly excluding correctness. As a lens it becomes a prompt
  section plus the `simplicity` category.
- **F3 UI design** with impeccable (Apache-2.0): its Rust detector (`impeccable detect --json
<files>`) is deterministic, needs no LLM, scans `.tsx .jsx .css .html .vue .svelte` and
  more, and returns `{antipattern, name, description, severity, category, file, line,
snippet}`. Loom can run it on changed UI files and convert results to findings directly
  (no model needed), and optionally hand them to the reviewer as evidence. Its `install`,
  `update` and hook commands write agent config and must never run.
- **F4 blast radius** from L26 (if present): the list of symbols and files the change can
  affect, added to the reviewer's brief so it checks callers.
- **F5 project rules**: prose rule packs per project (for example "all Effect services use
  `Context.Service`"), stored as fork data or read from a repository file. "Rule packs" in
  ponytail are only prose files; impeccable's are compile-time Rust registries, so there is no
  standard format to adopt.

### Axis G: multiple reviewers

G1 one reviewer; G2 fan out to two or three models in parallel and merge findings (same
file, lines within a few lines, similar title), showing "found by 2 of 3"; G3 a second pass
where one model verifies another's findings to cut false positives. Recommendation: G1 in v1,
G2 in v1.1 (the data model should allow several reviewer runs per review from the start).

### Axis H: when reviews run

H1 on demand only; H2 suggested after a turn that changed many lines; H3 automatic after
every turn or before "Commit" or "Create PR" (upstream's git actions). Recommendation: H1 in
v1; H2 as a quiet suggestion later; H3 only with explicit per-project opt-in, because it
spends tokens on every turn.

## 4. Questions for the session

1. **Engine.** A2 (reviewer thread plus MCP submit), A3 (headless structured), or both (A3 for
   quick checks, A2 for deep reviews)? Is native Codex review quality (A1 or A4) worth its
   cost?
2. **Visibility.** If reviews run as threads, should reviewer threads appear in the sidebar
   (settled on completion), be grouped under the source thread (only when L02 is present),
   or be archived automatically?
3. **Reviewer choice.** A per-project default reviewer model (L18 profile could hold it), a
   global default in Loom settings, or always ask?
4. **Permissions.** Reviewer runtime mode: `approval-required` (safe, may prompt if the model
   tries to run tests) or allow read-only commands such as running the test suite?
5. **Targets.** Which of B1 to B6 in v1? Is reviewing another person's PR in scope at all
   (upstream's PR panel already supports human review)?
6. **Finding shape.** Is P0 to P3 the right scale, or blocking / should-fix / nit? Keep a
   confidence score and hide low-confidence findings by default?
7. **Hand-back.** E2 (upstream review comments in the composer) as the only hand-back, or also
   "Fix all selected in a new thread"?
8. **Lenses.** Which lenses ship in v1: correctness only, plus simplicity (ponytail-style),
   plus impeccable UI checks (needs the `impeccable` binary installed by the user)?
9. **Diff panel entry.** Is a "Review changes" button in the diff panel header wanted? If so
   it registers in the shared `ext-diff-header` extension point (EXTENSION-POINTS.md section
   17, also used by L26), so it costs no packet seam.
10. **Automation.** Any automatic triggers in v1 (H2 or H3), or strictly on demand?
11. **History.** Keep review runs and findings forever, per thread, or prune (for example
    after 30 days or when the thread is deleted)?
12. **Multi-model.** Is G2 wanted soon enough that v1 should include the merge UI, or only
    the data model?
13. **Cost guard.** Should a review show an estimate (diff size) and refuse above a size
    limit without confirmation?
14. **Mobile.** Anything on mobile (for example "review finished" notification, read-only
    findings), or web and desktop only?

## 5. Recommended v1

A reviewer agent thread with structured findings submitted through a Loom MCP tool, shown in a
Review panel, handed back as upstream review comments.

1. **Start.** Command palette, Review panel, and (per question 9) the diff panel. The user
   picks the target (uncommitted changes or branch against base) and the reviewer model
   (default from settings). Loom checks there are changes and shows the diff size.
2. **Run.** A fork service creates a reviewer thread in the same project and checkout
   (`thread.create` with the source thread's `worktreePath` and branch, runtime mode
   `approval-required`), titled "Review: <source title>", and starts it with a server-built
   brief: the target and how to see it (`git diff`, `git diff <base>...HEAD`), the enabled
   lenses, the L26 impact summary when present, and the instruction to finish by calling
   `loom_ai_code_review_submit` once. The source thread is untouched.
3. **Collect.** The MCP tool validates findings (schema, file inside the checkout, lines
   within the file) and stores them in fork tables linked to the run. If the reviewer's turn
   ends without a submit, the service tries the fenced-JSON fallback on the reviewer thread's
   final message only, otherwise marks the run "failed: no findings submitted" with a
   "Ask again" button that sends one follow-up turn.
4. **Show.** The Review panel lists runs for the thread (running, completed, failed), each
   with a verdict and finding cards sorted by severity then confidence; filters by severity and
   category; "Open file at line", "Open in diff"; dismiss and restore.
5. **Hand back.** "Fix this" adds the finding to the source thread's composer as a
   `ReviewCommentContext` (file, range, a diff excerpt when the lines are in the diff, and the
   finding text); "Fix selected" adds several. Nothing is sent automatically. Findings handed
   back are marked "sent to fix".
6. **Finish.** The reviewer thread is settled on completion, so it leaves the active sidebar
   but stays reachable from the run ("Open review thread").
7. **Settings.** Default reviewer model, lenses (correctness on; simplicity off), extra
   instructions, and the per-project override if L18 is present.

Why this over the alternatives: it works with every provider Loom supports, needs no
provider or orchestration seams, gives typed findings instead of parsed prose, keeps the
review inspectable and continuable, and reuses upstream's review comment hand-back so fixes
look exactly like Kyle's own diff comments.

Later versions, in likely order: per-turn target; impeccable UI lens; multi-model fan-out and
merge; headless quick review (A3); diff inline annotations; PR targets and posting findings as
a PR review draft; quiet suggestions after large turns.

## 6. Risks to discuss

- **Reviewer threads in the sidebar** could feel noisy; settling helps, and grouping is
  possible only when L02 is present.
- **Tool-call reliability.** Some models may skip the submit tool; the fallback and "Ask
  again" cover it, and the brief repeats the requirement at the end.
- **Token cost.** A review reads the diff and surrounding code; large branches are expensive.
  The size check and on-demand default limit surprises.
- **Worktree contention.** The reviewer shares the checkout with the working thread; with
  `approval-required` it cannot edit silently, but it could run commands that touch files
  (tests writing caches). Question 4 decides.
- **MCP tool visibility.** `tools/list` is not filtered per session, so the submit tool is
  visible to every agent; the handler must reject calls from threads that are not reviewer
  threads of an active run, and its description must say it is only for Loom review runs.
- **False positives** remain the main quality risk of any AI reviewer; confidence plus
  dismiss plus lens separation are the mitigations.

## 7. Decision record

The session ran with Kyle on 2026-09-24 in three groups, plus the cross-cutting Jev decisions.
Sections 1 to 6 above are kept as history; where they disagree with this table, this table
wins. The resulting design is in [PRODUCT.md](./PRODUCT.md) and [TECHNICAL.md](./TECHNICAL.md).

| Axis / question             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Reason                                                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine (A, Q1)              | A2: a reviewer agent thread that submits findings through the `loom_ai_code_review_submit` MCP tool. No native Codex review (A1, A4). Headless quick check (A3) is a follow-up.                                                                                                                                                                                                                                                                                                                                 | Works with all six providers, zero provider or orchestration seams, typed findings, and a transcript the user can read and continue. Native review only helps Codex and returns text.                                                            |
| Visibility (Q2)             | Reviewer threads appear in the sidebar as "Review: <source title>", are settled when their run ends, are grouped under the source thread in Related threads when L02 is present, and are never archived automatically.                                                                                                                                                                                                                                                                                          | Transparent without clutter; settling moves them out of the active list; archiving is the user's call.                                                                                                                                           |
| Reviewer choice (Q3)        | A global default in Loom settings, a per-project override through L18 when present, always preselected and changeable in the start dialog, with a hint when the reviewer is the author's model. Plus "Auto (Jev)": a Jev Choice over a user-edited candidate pool (each candidate has an editable description) using diff stats, file list, languages, author model and a capped diff excerpt; Jev also picks the reasoning effort inside the bounds of the selected effort preset (Quick, Balanced, Thorough). | A sensible default with an easy change per review. Jev makes the model and effort choice fast and cheap; the excerpt gives it the content it needs. Falls back to the default model (and says so) on no key, error, over 1 s, or low confidence. |
| Permissions (Q4)            | The reviewer always runs `approval-required` in v1. Command approvals appear in the reviewer thread like any other.                                                                                                                                                                                                                                                                                                                                                                                             | The reviewer shares the checkout; it must not edit files or run commands silently. The brief embeds the diff so most reviews need no commands at all.                                                                                            |
| Targets (B, Q5)             | Uncommitted changes, branch against base, a single turn (checkpoint refs, plain `git diff <refA> <refB>`), a single commit (`git show`). Each with optional extra instructions. Other people's pull requests are out of scope.                                                                                                                                                                                                                                                                                  | These cover Kyle's review moments; the turn target reuses Loom's checkpoints. Upstream's PR panel already covers human review of real PRs.                                                                                                       |
| Finding structure (C)       | C3 (MCP submit with a typed schema), with C2 (one fenced JSON block in the final message) as a fallback applied only to reviewer threads, plus "Ask again" (one follow-up turn asking for the submit call).                                                                                                                                                                                                                                                                                                     | Schema-validated findings at the tool boundary; no prose parsing, and never on non-reviewer threads (old Loom's biggest false-positive source).                                                                                                  |
| Finding shape (Q6)          | Severity Blocking / Should fix / Nit. Reviewer confidence low / medium / high (not a number). Low-confidence findings are hidden behind "Show N low-confidence". Multi-reviewer cards show "Found by 2 of 3".                                                                                                                                                                                                                                                                                                   | Three levels map to what Kyle does next (must fix, should fix, optional). Words are easier for models to report honestly than numbers.                                                                                                           |
| Presentation (D)            | D1: a fork Review panel (launcher letter W) with runs, cards, filters and history. No inline diff annotations in v1.                                                                                                                                                                                                                                                                                                                                                                                            | No seam into the diff code view; "Open file at line" and "Open in diff" bridge the distance.                                                                                                                                                     |
| Hand-back (E, Q7)           | E2 only: "Fix this" and "Fix selected" add upstream review comments (`ReviewCommentContext`) to the working thread's composer; the user sends. No fix-in-new-thread. "Copy as Markdown" for use elsewhere.                                                                                                                                                                                                                                                                                                      | Findings render exactly like Kyle's own diff comments; never auto-send (old Loom invariant).                                                                                                                                                     |
| Lenses (F, Q8)              | Correctness (on by default). Simplicity, ponytail-style (off by default, per-review toggle). impeccable UI checks (off by default, offered only when the `impeccable` binary is installed; runs the deterministic `impeccable detect --json`; never its install, update or hook commands). Project rules come from the repository's AGENTS.md / CLAUDE.md, which the reviewer reads. L26 blast radius in the brief when present.                                                                                | Separate lenses keep correctness findings uncluttered. impeccable is deterministic and free once installed. Project rules already live in the repository.                                                                                        |
| Diff panel entry (Q9)       | A "Review changes" button through `ext-diff-header` (no packet seam). It preselects the target matching the diff panel's scope (working tree, branch, turn).                                                                                                                                                                                                                                                                                                                                                    | The diff panel is where Kyle looks at changes; the shared extension point carries the merge cost with L26.                                                                                                                                       |
| Triggers (H, Q10)           | Manual; a quiet "Review this turn?" chip after a turn (Jev score, or a changed-line threshold without Jev); agents through `loom_ai_code_review_start` when "Let agents use this" is on. Per-project opt-in "Start suggested reviews automatically". No pre-Commit or pre-PR hook.                                                                                                                                                                                                                              | Suggestions are cheap and ignorable; automatic spending is an explicit per-project choice. A pre-Commit hook would need an upstream seam in git actions.                                                                                         |
| History (Q11)               | Runs and findings (dismissed included) belong to the source thread and are deleted with it. Reviewer threads follow the normal thread lifecycle.                                                                                                                                                                                                                                                                                                                                                                | No separate retention policy to reason about; the data lives as long as the work it describes.                                                                                                                                                   |
| Multiple reviewers (G, Q12) | G2 in v1: fan-out to up to three reviewers in parallel and a merged view. Merge by a Jev Noul "same issue?" per candidate pair, with a deterministic fallback (same file, lines within a few lines, similar title).                                                                                                                                                                                                                                                                                             | Different models catch different mistakes; agreement is a strong signal. The deterministic rule keeps merging working without Jev.                                                                                                               |
| Cost guard (Q13)            | The start dialog always shows files, changed lines, estimated tokens and reviewer count ("3 reviewers, about 3 x 40k tokens"). Confirmation above 2,000 changed lines (configurable); never refuses. Automatic and agent-started reviews above the threshold become a suggestion instead.                                                                                                                                                                                                                       | Kyle sees the cost every time and decides; nothing automatic spends a lot unasked.                                                                                                                                                               |
| Mobile (Q14)                | Nothing fork-specific in v1. Reviewer threads are ordinary threads, visible in upstream mobile. The Review panel is web and desktop.                                                                                                                                                                                                                                                                                                                                                                            | Mobile has no right panel system; the transcript is already reachable there.                                                                                                                                                                     |
| Jev (cross-cutting)         | Three decide features through the new shared `ext-decide` extension point: `ai-code-review.reviewer-pick`, `ai-code-review.turn-suggest`, `ai-code-review.finding-merge`. Every use is optional, has a non-Jev fallback, never blocks, and is logged in `fork_decide_decisions`. Agents reach Jev only when the feature's "Let agents use this" is on.                                                                                                                                                          | Kyle's policy: use Jev wherever it is useful during a testing period, always optional and always with a fallback.                                                                                                                                |
| Status                      | Ready to build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | All questions answered.                                                                                                                                                                                                                          |
