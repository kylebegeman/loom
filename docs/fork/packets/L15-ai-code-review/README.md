# L15: AI code review

Status: Ready to build. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

AI review of the agent's changes before Kyle commits or opens a pull request. One to three
reviewers (other models, or the same one with a review brief) each run as an ordinary
"Review: <title>" thread, read the diff, and submit severity-ranked findings with file and
line through a Loom MCP tool. Loom merges findings across reviewers ("Found by 2 of 3"),
shows them in a Review panel, and hands chosen ones back to the working thread's composer as
review comments, never sent automatically. Jev (TypeSafe) optionally picks the reviewer model
and effort, suggests reviews after large turns, and decides which findings are the same
issue; every Jev use has a non-Jev fallback.

The design session was held on 2026-09-24; its decisions are in
[DESIGN-SESSION.md, section 7](./DESIGN-SESSION.md#7-decision-record).

## Scope

- In: targets uncommitted changes, branch against base, a single turn (checkpoint refs), a
  single commit, each with extra instructions; reviewer threads (`approval-required`,
  settled when done) with the `loom_ai_code_review_submit` tool, a fenced-JSON fallback on
  reviewer threads only, and "Ask again"; up to three reviewers in parallel with merge; Auto
  (Jev) reviewer and effort pick bounded by Quick / Balanced / Thorough presets; findings with
  severity Blocking / Should fix / Nit and confidence low / medium / high; the Review panel
  (letter W); hand-back as upstream review comments and "Copy as Markdown"; lenses
  correctness, simplicity (ponytail-style) and impeccable UI checks; cost estimate with
  confirmation above 2,000 changed lines; the "Review this turn?" chip; per-project
  automatic start of suggested reviews; the agent tool `loom_ai_code_review_start` behind "Let
  agents use this".
- Out (follow-ups, see [PRODUCT.md](./PRODUCT.md#out-of-scope-and-follow-ups)): headless quick
  review (A3); inline diff annotations; other people's pull requests and PR review drafts;
  pre-Commit / pre-PR hooks; an agent tool to read findings; verification passes (G3);
  anything mobile-specific. Native Codex review is rejected.

## Surfaces

Web and desktop: full feature. Mobile: nothing fork-specific; reviewer threads are ordinary
threads there. Remote: everything server-side over the environment WebSocket. Upstream
servers: entry points hidden, a restored panel shows "Needs a Loom server".

## Extension points used

[`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC, ForkLayer, persistence,
reactor), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp) (submit and
start tools), [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (Review panel,
letter W), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette),
[`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings),
[`ext-diff-header`](../EXTENSION-POINTS.md#17-diff-panel-header-ext-diff-header) ("Review
changes", shared with L26), [`ext-composer`](../EXTENSION-POINTS.md#11-composer-ext-composer)
(suggestion chip), [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (start
dialog host), [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings)
(`loom.ai-code-review.start`, unbound), and `ext-decide` (EXTENSION-POINTS.md, section 18;
features `ai-code-review.reviewer-pick`, `ai-code-review.turn-suggest`,
`ai-code-review.finding-merge`).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- L02 thread lineage present: reviewer threads are recorded as `review` children of the
  source thread and appear under it in Related threads (needs L02 to accept the `review`
  kind; otherwise skipped silently).
- L18 project profiles present: per-project default reviewer through a "Reviewer" profile
  binding.
- L26 code graph present: the blast radius of the changed files goes into the reviewer's
  brief (read server-side regardless of L26's agent switch).
- L29 Jev hub present: L15's Jev decisions appear in the Decisions panel for rating. L15 needs
  only `ext-decide`, not L29.

## Size

Large: about 6,000 to 7,500 lines with tests (server about half, web about a third, contracts
and tests the rest). Phases 1 to 5 (single reviewer, no Jev) are about 3,500 of that.

## Documents

- [PRODUCT.md](./PRODUCT.md): outcome, flows, entry points, states, copy, settings,
  decisions and follow-ups.
- [TECHNICAL.md](./TECHNICAL.md): research findings and the design (contracts, RPCs,
  lifecycle, brief, validation, merge, Jev features, storage, web).
- [SEAMS.md](./SEAMS.md): extension points and registrations; no packet seams.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): phases and pitfalls.
- [TESTING.md](./TESTING.md): automated tests, manual checks, acceptance criteria.
- [DESIGN-SESSION.md](./DESIGN-SESSION.md): the options brief (history) and the decision
  record.
- [REFERENCES.md](./REFERENCES.md): old Loom files, upstream files, other packets, reference
  repositories, TypeSafe docs.
