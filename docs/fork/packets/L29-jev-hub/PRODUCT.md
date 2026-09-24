# L29 product

## Problem

Kyle decided to use Jev, TypeSafe's fast decision model, in several Loom features for a
testing period: picking a reviewer model (L15), labeling an approval's risk (L07), routing
delegated threads (L08), suggesting a model preset per message (L14), picking a branch type
(L20). Each use is optional and small, which makes it hard to know whether it works. Jev
answers exactly the question it is given, reads negations literally, does not count or
compare dates, and loses accuracy as the state grows with unrelated detail
([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)). A question that
reads fine can be quietly wrong. Kyle needs one place to see what each feature sent and got
back, mark answers right or wrong, try a better wording on real data, check that a new Jev
version still behaves, and set each feature's confidence threshold from evidence rather than
guesswork. He also asked for tools that help produce good input for Jev: context built from
real threads, and question templates checked against the known failure modes.

## What the user can do

Log (Decisions panel, letter J):

- See every request a Loom feature sent to Jev on this environment: when, which feature,
  started by the user, an agent or Loom automatically, the answer and its confidence, the
  fallback reason if Loom did not use it, latency, input tokens and estimated cost.
- Filter by feature, origin, result, rating, period, and "This thread only"; see totals for
  the filter.
- Open a decision to see exactly what was sent (the state after redaction and trimming,
  with a list of what was removed), the questions and the full answers.
- Mark each answer "Right" or "Wrong, should have been X" (an option, a level, or yes/no),
  and clear the mark.
- Add a rated decision to its feature's test set, remove it again, open it in the
  playground, copy it as JSON or curl, or delete it.

Playground:

- Build context from the current thread: recent messages, the last turn, the diff of the
  last turn or the whole thread, a pending approval, a file, or pasted text or JSON. Counts,
  sizes and ages are computed by Loom and sent as named buckets ("200 to 1,000 lines",
  "1 to 7 days"), because Jev does not do math or date comparison reliably.
- See a preview before sending: the exact state, what was redacted and where, what was
  trimmed to fit, and the token count against Jev's limits.
- Pick one or more saved templates or write a question inline, run it, and see answers with
  probability bars, confidence, latency, tokens and cost. Rate the result and add it to a
  feature's test set.

Templates:

- Write a Choice, Score or Noul question in a guided form, with a description for each option
  or level and, for Noul, what yes and no mean.
- See lint warnings as you type: negations and double negatives, options without criteria,
  counting, math or date questions, contradictory yes and no criteria, a request to generate
  text, an oversized state, more than 255 options, or Score levels outside 2 to 10. Errors
  block saving; warnings do not.
- Save named templates, use them in the playground, let agents run them with
  `loom_jev_hub_ask`, and "Use for this feature" to replace a feature's built-in wording
  ("Revert to built-in wording" undoes it).
- Export a question with a sample state as JSON or as a curl command. The key is always the
  placeholder `$TYPESAFE_API_KEY`.

Tuning (per feature):

- See the feature's mode, how often Jev answered or fell back and why, rated accuracy, the
  model that answered, the threshold in use, and the size of its test set.
- Label the test set's items (rated decisions arrive labeled; agent edge cases arrive
  unlabeled with the agent's expected answer shown as a hint).
- Replay the test set with the current wording and model against a candidate (a template,
  another model, or both) and compare accuracy before and after, item by item.
- Read the calibration chart (how often answers at each confidence were right) and a
  threshold table ("at 0.60, Jev answers 78% of cases with 94% accuracy"); set or clear the
  feature's fallback threshold. Thresholds apply to Choice and Score answers; for a Noul
  question the chart still shows how its values relate to correctness, but the cut-off
  lives in the feature's code.
- Pin the versioned model the feature was tuned on (for example `jev-1.13.0`) and unpin it.
  See a notice when the answering model changes.
- "Draft with an agent": the thread's composer is filled with a brief for a coding agent (the
  feature's question, Jev's weak spots, a request for better wording and edge cases, a link
  to TypeSafe's agent skill). Kyle reviews and sends it. The agent submits drafts (they
  appear as templates marked "From agent") and edge cases (unlabeled test items) through
  `loom_jev_hub_submit`.
- Delete all decisions of a feature.

Agents:

- `loom_jev_hub_ask` runs a saved template or an ad hoc question on state the agent provides,
  only when "Let agents use this" is on for "Ask Jev from agents".
- `loom_jev_hub_submit` delivers drafts and edge cases for an open draft request, only when the
  target feature lets agents use Jev. For a feature that no agent tool reaches (it has no
  "Let agents use this"), the switch on "Playground and agent drafts" decides instead.

## Entry points

| Way in                                              | What it does                                                                                           | Way out / state                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Panel launcher and "+" menu: "Decisions" (letter J) | Opens the Decisions panel for the thread, on the last tab used.                                        | Close the tab. The tab title shows the panel is open.                        |
| Command palette: "Open Decisions"                   | Same.                                                                                                  | n/a                                                                          |
| Command palette: "Open Jev playground"              | Opens the panel on the Playground tab with the thread as context.                                      | n/a                                                                          |
| Command palette: "Jev settings"                     | Opens Settings, Loom, at the Jev section (`ext-decide`).                                               | Leave settings.                                                              |
| Keybinding `loom.jev-hub.open`                      | Toggles the panel. Unbound by default; bindable in Keybindings.                                        | Same key again.                                                              |
| Settings, Loom, "Jev" (from `ext-decide`)           | Key, Test key, "Use Jev", per-feature switches, "Jev off for this project", redaction lists.           | Each switch turns back off; Remove deletes the key.                          |
| Another packet's "See in Decisions" link (optional) | Opens a Decisions tab on that decision.                                                                | Back returns to the log; close the tab.                                      |
| Rating controls                                     | "Right" / "Wrong, should have been X" per question.                                                    | "Clear rating".                                                              |
| "Add to test set"                                   | Copies the state, questions and labels into the feature's test set; the decision is kept past 30 days. | "Remove from test set".                                                      |
| "Use for this feature" (template)                   | Replaces the feature's wording for that question.                                                      | "Revert to built-in wording". The feature row shows "Using template <name>". |
| "Set threshold" / "Pin model" (Tuning)              | Stores the feature's threshold or pinned model in `ext-decide`.                                        | "Clear threshold" / "Unpin". Both are visible in Tuning and in Jev settings. |
| "Draft with an agent"                               | Appends a brief to the thread's composer and opens a draft request (24 hours).                         | Edit or clear the composer; "Close draft" stops accepting submissions.       |
| Agents: `loom_jev_hub_ask`, `loom_jev_hub_submit`   | See above.                                                                                             | "Let agents use this" for the feature.                                       |

## States

- **Server lacks the feature** (upstream server, or no `jev-hub` in `loomFeatures`): launcher
  entry disabled with "Needs a Loom server with the Jev hub."; palette items hidden.
- **No key:** the panel opens on a setup card: "Add a TypeSafe API key to use Jev." with
  "Open Jev settings". The Log still shows past decisions; Run and Replay are disabled with
  "Add a key in Jev settings first."
- **"Use Jev" off:** a banner "Jev is turned off in Settings." with a link; Run and Replay
  disabled.
- **Jev off for this project:** banner "Jev is off for this project." with "Turn on"
  (confirmation) in the Playground; decisions from other projects still show in the Log.
- **Empty log:** "No decisions yet. Loom features that use Jev log each request here." with
  "Try the playground".
- **No results for the filter:** "No decisions match these filters." with "Clear filters".
- **Loading:** skeleton rows; the detail view shows a spinner until loaded.
- **Error:** "Couldn't load decisions." with Retry; a failed run shows the fallback reason in
  words ("Jev did not answer within 10 seconds.", "TypeSafe rejected the key (401).").
- **State purged:** "What was sent was deleted on <date> (kept 30 days unless rated or in a
  test set)." Rating still works; "Add to test set" is disabled with "The sent state is no
  longer available."
- **Preview over budget:** trims are listed; when the questions alone exceed the limit, Run
  is disabled with "The questions are too long for Jev (N of 32,000 tokens)."
- **Replay running:** a progress bar ("42 of 120") and Cancel; results replace it when done.
  Partial failures list the items that errored.
- **Too little data to calibrate:** the chart shows with "Only 12 rated answers. Thresholds
  set from fewer than 30 are unreliable."
- **Model changed:** "Recent answers come from jev-1.14.0; the threshold was set on
  jev-1.13.0. Replay the test set to compare." with "Replay".
- **Draft request open:** the draft card shows "Waiting for the agent. Submitted: 2 drafts,
  8 edge cases." and the expiry; "Close draft".
- **Agents not allowed:** the draft card warns "Let agents use this is off for <feature>.
  The agent will not be able to submit." with a switch.

## Copy

- Panel title "Decisions". Launcher description (L12): "Everything Loom asked Jev, with
  ratings and tuning."
- Tabs "Log", "Playground", "Templates", "Tuning".
- Origins "You", "Agent", "Automatic". Results "Answered", "Low confidence", "Timed out",
  "Error".
- Rating buttons "Right", "Wrong", then "Should have been" with the options.
- Cost line: "About $0.0021. Estimated at $0.042 per million input tokens (TypeSafe price on
  2026-09-24, subject to change)."
- Preview headings "Sent to Jev", "Removed before sending", "Trimmed to fit", "Tokens: 4,120
  of 32,000 (estimate)".
- First run notice (once per environment): "Runs send the state shown in the preview to
  TypeSafe (api.typesafe.ai). Keys, .env files and your excluded paths are removed first."
- Draft toast: "Brief added to the composer. Review it and send it when ready."

## Surfaces and connection modes

- Web and desktop: full feature.
- Mobile: nothing new. Agents in threads started from mobile can use the MCP tools.
- Remote: all building, redaction and calls happen on the environment's server. The pasted
  text travels from the client to that server; nothing else leaves the server except the
  request to TypeSafe. The log is per environment.
- Upstream T3 server: hidden or disabled as above.

## Jev across Loom

The features that use Jev through `ext-decide`, as decided in the packet answers
(2026-09-24) and designed in the owning packets. The owning packet's documents are
authoritative for question shapes and states; `small-extras.branch-type` is the expected id
until L20 is finalized. "Agents" says whether an MCP tool can reach the feature (registry
`agentTool`); where it cannot, the feature has only "Use Jev" and no "Let agents use this".

| Packet | Feature id                           | What Jev decides                                                                                                                                              | Question                                                                                                                                                                        | Agents | Without Jev                                                                      |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| L07    | `bottom-dock.approval-risk`          | Risk badge on each pending approval in the Approvals tab (automatic, threshold 0.6).                                                                          | Choice: read-only, reversible, irreversible                                                                                                                                     | No     | No badge.                                                                        |
| L08    | `multi-thread-runs.delegate-routing` | Model and reasoning effort for a thread an agent delegates without naming a model.                                                                            | Choice `route` over routing candidates (one option per candidate and allowed effort; opaque keys, the user's candidate descriptions as criteria)                                | Yes    | The caller's model and effort.                                                   |
| L08    | `multi-thread-runs.compare-rank`     | Which Compare member best meets a rubric; the order is shown as a hint only (user-started "Rank with Jev").                                                   | Choice `best`: "Which result in `results` best meets `rubric` for the task in `prompt`?" over members labeled A to F (no provider or model names); order from the probabilities | No     | No ranking hint (a previous hint stays).                                         |
| L14    | `chat-conveniences.auto-preset`      | "Auto" preset: a model and effort for the message being typed, from the preset's choices; suggested, never switched silently.                                 | Choice over the Auto preset's choices                                                                                                                                           | No     | The current selection.                                                           |
| L15    | `ai-code-review.reviewer-pick`       | "Auto (Jev)" reviewer model and effort from the editable candidate pool, using diff stats, files, languages, the author model and a capped diff excerpt.      | Choice `reviewer` over candidates; Score `effort` over the preset's levels when the range has two or more                                                                       | Yes    | The default reviewer model and the preset's default effort; the dialog says why. |
| L15    | `ai-code-review.turn-suggest`        | Whether to show a quiet "Review this turn?" after a turn (automatic).                                                                                         | Score `worth_review`, 3 levels (not useful, somewhat useful, clearly useful)                                                                                                    | No     | A changed-line threshold.                                                        |
| L15    | `ai-code-review.finding-merge`       | Whether findings from different reviewers describe the same problem, for "Found by 2 of 3" (automatic).                                                       | One Noul per candidate pair, `same_<a>_<b>`, up to 120 pairs in one request                                                                                                     | No     | The rule: same file, overlapping lines and similar titles.                       |
| L20    | `small-extras.branch-type`           | Branch type prefix (`feature/`, `fix/`, `hotfix/`, `chore/`, `docs/`, `refactor/`) in "No AI identification" projects, only where Jev is on (off by default). | Choice, 6 options                                                                                                                                                               | No     | Keyword rules, default `feature/`.                                               |
| L29    | `jev-hub.playground`                 | Playground runs; its "Let agents use this" also allows agent drafts for features that have no agent switch.                                                   | Any                                                                                                                                                                             | Yes    | Nothing runs.                                                                    |
| L29    | `jev-hub.ask`                        | `loom_jev_hub_ask` from agents.                                                                                                                               | Any                                                                                                                                                                             | Yes    | The tool says Jev is not allowed.                                                |

Ideas considered and not selected for now (revisit after the testing period):

- **L03 goal drift check:** a Noul after each turn, "Does this turn still work toward the
  pinned goal?", to show a quiet warning. Not now: goals are new and the signal is untested.
- **L06 CI failure classification:** a Choice over failure kinds (test, build, lint, flaky,
  infrastructure) for a failing check, to order the cockpit. Not now: log excerpts are large
  and noisy, the weak spot Jev 1.13 documents.
- **L21 skill suggestion:** suggest installed skills for a message with a Choice over the
  skills and a Noul per shortlisted skill, TypeSafe's
  [skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion) pattern.
  Not now: providers already choose skills themselves.

Rejected:

- **L13 clipboard secret detection:** deciding whether clipboard contents are a secret by
  sending them to a third party defeats the purpose. Local pattern checks (the same rules
  `ext-decide` uses for redaction) cover it without the clipboard leaving the machine.

## Decisions

- **Shared plumbing in `ext-decide`, tools in L29.** The client, key, modes, log, redaction,
  budget and diff excerpts live in the extension point so L15 and the others work without
  L29; L29 adds the tools for seeing and tuning. (Kyle, Jev answers.)
- **Launcher letter J, panel "Decisions", id `jev-hub`:** the last free letter.
- **The log records what was actually sent**, after redaction and trimming, so the preview
  and the log never disagree.
- **Ratings are per question:** "Right" or "Wrong, should have been X", where X is one of the
  question's own options, levels or yes/no, so every rating is a usable label.
- **Cost uses $0.042 per million input tokens** (output is free) from TypeSafe's models page
  on 2026-09-24, as a constant marked "subject to change".
- **Numbers and dates are computed in code and sent as named buckets**; Jev decides
  judgments, not arithmetic (jaggedness rules 2 and 3).
- **Lint rules come from the Jev 1.13 jaggedness page**; API limits (255 options, Score
  levels 2 to 10, the token budget) are errors, heuristics are warnings.
- **Templates are named and stored on the server** (a fork table) so features, the
  playground and agents share them. "Use for this feature" only changes wording: it never
  adds or removes options or levels, so the feature's code paths stay valid.
- **Export never includes the key**; the curl uses `$TYPESAFE_API_KEY`. Clients never have the
  key in the first place.
- **One test set per feature**, labeled from ratings; agent edge cases arrive unlabeled.
- **Replays compare the current configuration with a candidate on the same items** and do
  not appear in the decision log.
- **Thresholds and pinned models are set from Tuning**, stored per feature in `ext-decide`,
  and reversible (clear, unpin). Pin a versioned id such as `jev-1.13.0` once a threshold is
  tuned (TypeSafe's models page recommends it).
- **The model list comes from `GET /v1/models`** plus the versioned ids seen in the log (the
  endpoint lists aliases; versioned ids are accepted anyway).
- **Agent drafting fills the composer and never sends.** The agent's submissions go through
  `loom_jev_hub_submit` as template drafts and unlabeled test items, only for an open draft
  request from that thread and only when the feature lets agents use Jev. (Kyle.) Features
  registered without an agent tool have no agent switch, so their drafts are gated by the
  switch on `jev-hub.playground` ("Playground and agent drafts").
- **Thresholds are applied by `ext-decide`, not by callers**, to every Choice and Score
  answer; Tuning sets the feature's configured value, which applies whenever a call passes
  none. Noul cut-offs stay in each feature's code.
- **`loom_jev_hub_ask` is off for agents until allowed** ("Let agents use this" on "Ask Jev from
  agents"). (Kyle.)
- **Retention:** the sent state is kept 30 days, except for rated decisions and test-set
  items, which keep it until deleted; answers and ratings are kept until deleted. (Kyle.)
- **The TypeSafe agent skill is never installed automatically**: its installer writes to
  `~/.claude` and agent configurations. The brief links to
  <https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md>; L21 can
  install it as an explicit step. (Kyle.)
- **Web and desktop only**; mobile shows nothing new.
- **Without `decide` or `jev-hub`, nothing Jev-related shows**, so upstream servers and
  clients are unaffected.
