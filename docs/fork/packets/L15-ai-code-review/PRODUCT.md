# L15 product

Status: design session complete (2026-09-24). Ready to build. The decision record with reasons
is in [DESIGN-SESSION.md, section 7](./DESIGN-SESSION.md#7-decision-record).

## Problem

Agents in Loom write a lot of code, and Kyle reviews it in the diff panel line by line. A
second pair of eyes, run on demand, would catch bugs, risky changes and over-engineering
before a commit or pull request, and would let Kyle send precise fixes back to the working
agent without retyping context. Upstream T3 Code has excellent human review tools (the diff
panel with inline comments that attach to the composer, and a full pull request review
panel) but no AI reviewer. Old Loom had one; it worked but was fragile in known ways.

## Session outcome

v1 is a reviewer agent thread per reviewer, with findings submitted through a Loom MCP tool,
shown in a Review panel, merged across reviewers, and handed back as upstream review comments.

- **Engine.** Each reviewer is an ordinary thread ("Review: <source title>") in the same
  project and checkout, running `approval-required`, started with a server-built brief. It
  finishes by calling `loom_ai_code_review_submit`. If it forgets, Loom reads one fenced JSON
  block from its final message (reviewer threads only), and otherwise offers "Ask again".
- **Targets.** Uncommitted changes, branch against base, a single turn, a single commit; each
  with optional extra instructions.
- **Reviewers.** One to three per review, in parallel. Each slot is a model or "Auto (Jev)".
  Defaults come from Loom settings, overridden per project by L18 when present.
- **Findings.** Blocking / Should fix / Nit, confidence low / medium / high, file and line
  range, category. Findings from several reviewers are merged into one card with "Found by 2
  of 3".
- **Lenses.** Correctness (default on), simplicity (ponytail-style, off by default), impeccable
  UI checks (off by default, only when the binary is installed).
- **Hand-back.** "Fix this" and "Fix selected" add review comments to the working thread's
  composer; nothing is sent automatically. "Copy as Markdown".
- **Triggers.** Manual (Review panel, palette, diff panel button, keybinding); a quiet
  "Review this turn?" chip after a turn; agents through `loom_ai_code_review_start` when
  allowed; per-project automatic start of suggested reviews.
- **Jev** (optional everywhere, always with a fallback): picks the reviewer model and effort,
  decides whether a turn is worth a review, and decides which findings from different
  reviewers are the same issue.
- **Moved to later versions:** see [Out of scope](#out-of-scope-and-follow-ups).

## What the user can do

- Start a review of the thread's uncommitted changes, its branch against a base, one turn, or
  one commit, with optional extra instructions.
- See the cost before starting: files, changed lines, estimated tokens, reviewer count.
- Pick one to three reviewers, each a specific model and effort or "Auto (Jev)", and see
  which model Auto picked, with what confidence, before starting.
- Turn the simplicity and impeccable lenses on for one review.
- Watch the reviewers run (each is a normal thread), cancel the review, open any reviewer
  thread.
- Read merged findings sorted by severity then confidence, with "Found by N of M"; filter by
  severity, category and reviewer; reveal low-confidence findings; dismiss and restore.
- Press "Fix this" on a finding, or select several and press "Fix selected", to add them to the
  working thread's composer as review comments, then edit and send. "Copy as Markdown" copies
  the selected findings.
- Accept or dismiss a "Review this turn?" suggestion after a turn.
- Let agents start reviews (off by default), and let a project start suggested reviews
  automatically (off by default).
- See past reviews for the thread and whether their findings were fixed or dismissed.

## Flows

### Start a review

1. Kyle opens the start dialog from the Review panel ("New review"), the command palette, the
   diff panel's "Review changes" button, the "Review this turn?" chip, or the
   `loom.ai-code-review.start` keybinding.
2. The dialog preselects the target: the diff panel's scope when opened from there (working
   tree becomes Uncommitted changes, branch becomes Branch with the same base, a turn becomes
   that turn), the suggested turn from the chip, otherwise Uncommitted changes when there are
   any, else the latest turn.
3. The dialog loads the estimate: "12 files, 840 changed lines". With reviewers, "3
   reviewers, about 3 x 40k tokens". "No changes to review" disables Start.
4. Reviewer slots are preselected from settings (project override first). An "Auto (Jev)"
   slot shows the pick when it resolves: "Auto: GPT-5 Codex, high effort (confidence 0.82)",
   with a menu to replace it by any model. If Jev is not used, the slot says why: "Auto
   unavailable (no Jev key): using Claude Opus". A slot whose model equals the source
   thread's model shows "Same model as the author. A different model catches different
   mistakes."
5. Lenses: Correctness (on), Simplicity (per settings), UI checks with impeccable (shown only
   when installed). Optional "Extra instructions".
6. Above the confirmation threshold (2,000 changed lines by default) the Start button reads
   "Start large review" and a line explains the size. Nothing is refused.
7. Start creates one reviewer thread per slot and opens the Review panel on the new review.

### Watch and finish

- The review card shows each reviewer: model, state ("Reviewing", "Waiting for approval",
  "Done: 4 findings", "Failed: no findings submitted"), elapsed time, and "Open review
  thread".
- Findings appear as each reviewer submits; the merged view settles when all reviewers are
  done.
- "Cancel review" interrupts every running reviewer. A reviewer that asks for a command
  approval shows "Waiting for approval" with "Open review thread", where Kyle answers it.
- A reviewer that ended without submitting shows "Ask again" (sends one follow-up turn
  asking for the submission).
- When a reviewer's run ends, its thread is settled; it stays reachable from the review and
  the sidebar.

### Read and hand back findings

- Cards: severity badge, title, "Found by 2 of 3" (multi-reviewer reviews), category, file and
  line range, the body, an optional suggested fix, and the reviewer names on expand.
- Filters: severity, category, reviewer, state (Open, Dismissed, Sent to fix). "Show 3
  low-confidence" reveals low-confidence findings.
- "Open file at line" opens the file at the range; "Open in diff" opens the diff panel on the
  review's target scope at that file.
- "Fix this" adds a review comment chip to the working thread's composer (file, range, the
  current lines, and the finding text) and marks the finding "Sent to fix". "Fix selected"
  does the same for several. Nothing is sent. Kyle can remove a chip in the composer as usual.
- "Dismiss" and "Restore".
- "Copy as Markdown" copies selected findings (or all open ones) as a Markdown list.

### Suggested reviews

- After a turn that changed code in a thread (not a reviewer thread), Loom may show a quiet
  chip in the composer footer: "Review this turn?" with a close button. With Jev, the
  decision is a score of how useful a review would be; without Jev, the turn must change at
  least 200 lines (configurable).
- Clicking the chip opens the start dialog with that turn preselected. Closing it dismisses
  the suggestion. The Review panel shows the same suggestion at the top.
- With "Start suggested reviews automatically" on for the project, a suggested review starts
  with the default reviewers instead of showing the chip, unless it is above the
  confirmation threshold, in which case the chip appears with "Large: 2,400 changed lines".

### Agent-started reviews

With "Let agents use this" on, an agent can call `loom_ai_code_review_start` to review its own
thread's changes. The review uses the default reviewers and lenses, appears in the Review panel
like any other, and is labeled "Started by the agent". Above the confirmation threshold it
becomes a suggestion instead, and the tool says so. Findings still go back only through Kyle.

## Entry points

| Entry                                                                                                                              | Behavior                                                                                  | Reverse                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Right panel launcher: "Review" (letter W)                                                                                          | Opens the Review panel for the thread: suggestion, reviews, findings.                     | Close tab.                                              |
| Review panel: "New review"                                                                                                         | Opens the start dialog.                                                                   | Cancel in the dialog; "Cancel review" once started.     |
| Command palette: "Review uncommitted changes", "Review branch changes", "Review last turn", "Review a commit", "Open Review panel" | Opens the start dialog with that target (or the panel).                                   | Same as above.                                          |
| Diff panel header: "Review changes" (`ext-diff-header`)                                                                            | Opens the start dialog with the diff panel's scope as target.                             | Same as above.                                          |
| Composer footer chip: "Review this turn?"                                                                                          | Opens the start dialog on the suggested turn; the close button dismisses it.              | Dismiss; "Suggest reviews after turns" off in settings. |
| Keybinding `loom.ai-code-review.start` (unbound by default)                                                                        | Opens the start dialog with the default target.                                           | n/a                                                     |
| Agent tool `loom_ai_code_review_start`                                                                                             | Starts a review of the calling thread when "Let agents use this" is on.                   | "Cancel review" in the panel; the setting off.          |
| Reviewer threads in the sidebar                                                                                                    | "Review: <source title>" (with the model name when there are several), settled when done. | Unsettle, archive or delete like any thread.            |
| Settings, Loom, "AI code review"                                                                                                   | Defaults, candidates, effort presets, lenses, thresholds, agent and suggestion switches.  | Same section.                                           |
| Settings, Loom, "AI code review", project scope                                                                                    | "Start suggested reviews automatically".                                                  | Same switch.                                            |
| L18 project profile (when present), Bindings, "Reviewer"                                                                           | Per-project default reviewer.                                                             | Remove the binding.                                     |

## States

| State                        | What the user sees                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Server lacks the feature     | Launcher entry, palette items, diff button, chip and settings section hidden; a direct panel tab shows "Needs a Loom server".              |
| No thread selected           | Panel: "Open a thread to review its changes."                                                                                              |
| No changes for the target    | Dialog: "No changes to review" and Start disabled.                                                                                         |
| Source thread is working     | Uncommitted and Branch targets: a warning, "The agent is still working. The review sees the changes as they are now." Start stays enabled. |
| A review is already running  | Dialog: "A review of this thread is running." with "Open".                                                                                 |
| Estimating                   | Dialog shows a skeleton for the estimate line; Start disabled until it loads.                                                              |
| Auto picking                 | The Auto slot shows "Picking..." for at most about a second, then the pick or the fallback line.                                           |
| Reviewer model unavailable   | Slot: "<model> is not available on this server" and Start disabled until changed.                                                          |
| Large review                 | "Start large review" and "2,400 changed lines is above your 2,000 line limit."                                                             |
| Running                      | Per reviewer: "Reviewing" with elapsed time, or "Waiting for approval".                                                                    |
| Partly done                  | "2 of 3 reviewers done". Findings so far shown; merge settles at the end.                                                                  |
| Cancelled                    | "Cancelled". Findings already submitted stay.                                                                                              |
| Reviewer failed              | "Failed: no findings submitted" with "Ask again", or "Failed: <provider error>" with "Open review thread".                                 |
| All reviewers failed         | Review: "Review failed" with the per-reviewer reasons.                                                                                     |
| Completed, no findings       | "No issues found" with each reviewer's verdict summary.                                                                                    |
| Completed with findings      | Verdict line per reviewer ("Needs changes: 2 blocking") and the cards.                                                                     |
| Only low-confidence findings | "No confident findings" with "Show N low-confidence".                                                                                      |
| Reviewer thread deleted      | That reviewer: "Review thread deleted"; its findings stay.                                                                                 |
| impeccable missing           | The UI checks lens is not shown.                                                                                                           |
| impeccable failed            | A line under the review: "UI checks failed: <message>". Other findings unaffected.                                                         |
| Jev unavailable              | Auto slots fall back with the reason; suggestions use the line threshold; merging uses the rule. Nothing else changes.                     |

## Copy

- Panel title "Review"; empty state "No reviews yet. Review this thread's changes to get a
  second opinion before you commit." with "New review".
- Dialog title "Review changes". Target labels: "Uncommitted changes", "Branch against
  <base>", "Turn <n> (<files> files, <lines> changed lines)", "Commit <short sha> <subject>". Fields:
  "Reviewers", "Add reviewer", "Auto (Jev)", "Effort", "Lenses", "Correctness", "Simplicity",
  "UI checks (impeccable)", "Extra instructions". Buttons "Start review", "Start large
  review", "Cancel".
- Estimate: "<files> files, <lines> changed lines. <n> reviewers, about <n> x <k>k tokens."
  (one reviewer: "About <k>k tokens.")
- Severity badges "Blocking", "Should fix", "Nit". Confidence shown as "Low confidence" only
  when low.
- Buttons on cards: "Fix this", "Dismiss", "Restore", "Open file", "Open in diff". Bulk:
  "Fix selected", "Dismiss selected", "Copy as Markdown".
- Chip: "Review this turn?"; large: "Review this turn? (large)".
- Agent label: "Started by the agent". Automatic label: "Started automatically".
- Reviewer thread title: "Review: <source title>", or "Review (<model short name>): <source
  title>" when a review has several reviewers.
- No emojis, no em dashes, no AI-attribution text.

## Settings

Loom settings page, section "AI code review" (server-side, per environment):

| Setting                              | Default                                       | Notes                                                                                                                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default reviewers                    | One slot: the source thread's model           | One to three slots; each a model (with effort) or "Auto (Jev)" (shown only when Jev is available).                                                                                                                                                                                |
| Auto candidates                      | Empty                                         | Models Auto may choose from, each with an editable description ("Strong at TypeScript and UI"). Auto needs at least two available candidates.                                                                                                                                     |
| Effort preset                        | Balanced                                      | Quick, Balanced, Thorough. Each preset has an editable range (lowest and highest effort) and a default effort. Defaults: Quick low to medium (low), Balanced medium to high (medium), Thorough high to max (high). Bounds Auto's effort pick and sets the effort of manual slots. |
| Lenses                               | Correctness on, Simplicity off, UI checks off | Defaults for the start dialog. UI checks only when impeccable is installed.                                                                                                                                                                                                       |
| Extra instructions                   | Empty                                         | Added to every brief (up to 4,000 characters).                                                                                                                                                                                                                                    |
| Confirm reviews above                | 2,000 changed lines                           | Also the limit above which automatic and agent-started reviews become suggestions.                                                                                                                                                                                                |
| Suggest reviews after turns          | On                                            | The "Review this turn?" chip.                                                                                                                                                                                                                                                     |
| Suggest when a turn changes at least | 200 lines                                     | Used when Jev is not used for the suggestion.                                                                                                                                                                                                                                     |
| Let agents use this                  | Off                                           | Allows `loom_ai_code_review_start`.                                                                                                                                                                                                                                               |

Project scope of the same section: "Start suggested reviews automatically" (off). Per-project
default reviewer: through the L18 project profile when L18 is present (binding "Reviewer");
without L18 there is no per-project reviewer override.

Jev switches live in the Jev section owned by `ext-decide`, one row per feature: "Pick the
reviewer model" (Use Jev, and "Let agents use this", which lets agent-started reviews use Auto;
off means they use the default reviewer), "Suggest a review after a turn" and "Merge findings
across reviewers" (Use Jev only; they are automatic, so they have no agent switch), plus "Jev off
for this project". L15's own "Let agents use this" above decides whether agents may start
reviews at all.

## Surfaces

- Web and desktop: full feature.
- Mobile: nothing fork-specific in v1. Reviewer threads are normal threads and show in the
  mobile thread list with their transcripts.
- Remote: everything runs on the server over the environment WebSocket (reviewers, git,
  impeccable, Jev), so it works locally, over Tailscale and through T3 Connect.
- Upstream T3 server: every entry point hidden; a restored panel tab shows "Needs a Loom
  server". Upstream clients on a Loom server see reviewer threads as ordinary threads.

## Decisions

- Discovery first, then a design session (Kyle, 2026-09-24). Held; this file records it.
- Findings are handed back through the composer and never sent automatically. Old Loom's
  invariant from ledger 0040; it worked.
- Findings are never parsed out of ordinary assistant messages. The JSON fallback reads only
  a reviewer thread's final message. Old Loom's biggest false-positive source.
- No new orchestration commands or events. Reviewer threads use `thread.create`,
  `thread.turn.start`, `thread.turn.interrupt` and `thread.settle` (EXTENSION-POINTS.md,
  Orchestration rule 1).
- Engine: reviewer agent thread plus `loom_ai_code_review_submit` (A2); no native Codex
  review. Works for all six providers without seams.
- Reviewer threads in the sidebar, settled when done, grouped under the source in L02's
  Related threads when present, never auto-archived. Visible but out of the way.
- Reviewer choice: global default, L18 per-project override, preselected and changeable per
  review, with an author-model hint. Plus "Auto (Jev)" over an editable candidate pool, with a
  capped diff excerpt, also picking effort inside the preset bounds. Fast default choice;
  Kyle has a Jev key with early access.
- Reviewer runtime mode always `approval-required`. The shared checkout must not change
  silently.
- Targets: uncommitted, branch, turn, commit, each with extra instructions. Other people's
  PRs out of scope. Covers Kyle's review moments.
- Severity Blocking / Should fix / Nit and confidence low / medium / high; low confidence
  hidden by default. Actionable levels and honest confidence.
- Hand-back only as upstream review comments, plus "Copy as Markdown"; no fix-in-new-thread.
  Fixes look like Kyle's own comments.
- Lenses: correctness (on), simplicity ponytail-style (off), impeccable (off, installed binary
  only, never its install, update or hook commands); project rules from AGENTS.md / CLAUDE.md;
  L26 blast radius when present. Focused lenses, no new rule format.
- Diff panel "Review changes" button through `ext-diff-header`, preselecting the scope. No
  packet seam.
- Triggers: manual, quiet chip, agents when allowed, per-project automatic start. No
  pre-Commit or pre-PR hook (needs an upstream seam).
- History belongs to the source thread and is deleted with it. No separate retention policy.
- Multi-model fan-out (up to three) and merge with "Found by N of M" in v1, Jev merge with a
  deterministic fallback. Agreement is signal.
- Cost guard: estimate always shown, confirmation above 2,000 changed lines, never refuse;
  automatic and agent starts above the limit become suggestions. Kyle decides spending.
- Mobile: nothing fork-specific in v1. No right panel system there.
- Jev everywhere it helps, always optional, with a non-Jev fallback, through `ext-decide`.
  Kyle's testing-period policy.

## Out of scope and follow-ups

- Follow-up: headless quick review (A3, `codex exec --output-schema` / `claude -p
--json-schema`) for fast checks without a thread. Deferred in the session.
- Follow-up: inline finding annotations in the diff panel. Needs a seam into the diff code
  view.
- Follow-up: reviewing other people's pull requests and posting findings as a PR review
  draft. Out of scope for v1 by decision.
- Follow-up: a pre-Commit / pre-PR review hook on upstream git actions. Needs an upstream
  seam.
- Follow-up: an agent tool to read review findings. Not requested; hand-back stays with Kyle.
- Follow-up: a verification pass where one model checks another's findings (G3). Not chosen.
- Follow-up: mobile findings view or "review finished" notification. Not chosen for v1.
- Native provider review (Codex `review/start`): rejected, not deferred.
