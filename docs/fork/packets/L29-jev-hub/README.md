# L29: Jev hub

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

The place to see, trial and tune Loom's use of Jev, TypeSafe's decision model. Several Loom
features can ask Jev a small typed question (L15 picks a reviewer model, L07 labels an
approval's risk, L20 picks a branch type); each is optional and falls back to plain Loom
behavior. The **Decisions** panel (launcher letter J) shows every request Jev answered, per
feature, with what was sent, the answer, latency, tokens and cost, and lets you mark each one
right or wrong. A **playground** runs any question against context built from the current
thread (a turn, its diff, a pending approval, a file, or pasted text) with numbers and dates
computed in code, secrets removed, the token budget checked and a preview of exactly what is
sent. A **question builder** lints wording against Jev 1.13's known weak spots and saves
named templates that features, the playground and agents can use. **Tuning** turns rated
decisions into per-feature test sets, replays them after a rewording or on a new Jev
version, shows how confidence relates to correctness so each feature's fallback threshold
can be set, and pins a model version once tuned. "Draft with an agent" hands the question to
a coding agent, which submits better wording and edge cases back. Agents can also ask Jev
through `loom_jev_hub_ask` once allowed.

Selection item: L29 (Jev hub), see [selections.md](../../selections.md), "From selection to
packet".

## Scope

- In:
  - Decisions panel (`jev-hub`, letter J) with four tabs: Log, Playground, Templates,
    Tuning.
  - Decision log per feature: filters (feature, origin, result, rating, period, this thread),
    totals, detail view with the sent state (or its purge notice), redactions, questions,
    answers, latency, tokens and estimated cost; "Right" and "Wrong, should have been X"
    ratings per question; "Add to test set"; delete.
  - Playground: run one or more questions (templates or inline) against a built context;
    rate and add results to a test set.
  - Context builders on the server: thread, turn, diff, pending approval, file, pasted text
    or JSON, with counts, sizes and ages passed as named buckets, redaction, budget check and
    trimming, and a preview (state, redactions, trims, token counts).
  - Question builder: guided Choice, Score and Noul forms with per-option criteria, lint rules
    from the Jev 1.13 jaggedness page, saved named templates, "Use for this feature" wording
    overrides and their revert, export as JSON or curl with a key placeholder.
  - Tuning: one test set per feature (labeled from ratings, unlabeled from agents), replay
    with before and after accuracy, calibration chart and threshold sweep, set or clear the
    feature's threshold, pin or unpin a versioned model, model list from `GET /v1/models`.
  - Agent drafting: "Draft with an agent" fills the thread's composer with a brief (never
    sends); the agent submits drafts and edge cases with `loom_jev_hub_submit`, gated by the
    feature's "Let agents use this".
  - `loom_jev_hub_ask`: agents run a saved template or an ad hoc question through Jev (feature
    `jev-hub.ask`, off for agents until allowed).
  - Retention as set by `ext-decide`: sent state kept 30 days unless rated or in a test set;
    answers and ratings kept until deleted.
  - A catalog of every packet's Jev feature and of the ideas not selected (PRODUCT.md).
- Out:
  - Installing the TypeSafe agent skill. Loom never installs it; the drafting brief links to
    it, and L21 can install it as an explicit step if present.
  - Mobile UI.
  - Follow-up: several named test sets per feature (one per feature covers the need until
    features ask more than one kind of question each).
  - Follow-up: automatic replays when `jev-latest` moves (v1 shows a notice and a Replay
    button; running unasked spends tokens).
  - Follow-up: editing the token price in settings (v1 uses the documented $0.042 per
    million input tokens as a constant marked "subject to change").
  - The Jev features themselves (L07, L08, L14, L15, L20 own them) and the ideas not selected
    (catalog in PRODUCT.md).

## Surfaces

- Web and desktop: supported (same bundle). No Electron-only parts.
- Mobile: not supported. Nothing is shown; the upstream mobile app is unaffected. Agents in
  threads started from mobile can still call the MCP tools, which run on the server.
- Remote: everything runs on the environment's server over the WebSocket RPC; the API key
  and thread data never leave it except for the request to `api.typesafe.ai`. Works locally,
  over Tailscale and through T3 Connect.
- Upstream T3 server, or a Loom server without `jev-hub`: the launcher entry is disabled
  with "Needs a Loom server with the Jev hub."; palette items are hidden. Without the
  `decide` capability every Jev control is hidden.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC group, `ForkLayer`,
  persistence, capability `jev-hub`).
- [`ext-decide`](../EXTENSION-POINTS.md#18-decisions-with-jev-ext-decide) (`LoomDecide`,
  the decision log, redaction, budget, diff excerpts, the Jev settings section). This packet
  creates it if missing, exactly as EXTENSION-POINTS.md section 18 specifies, like any
  consumer.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (prerequisite of
  `ext-decide`; L29 adds no section of its own).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (the Decisions panel,
  letter J).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (host of the keybinding
  listener, prerequisite of `ext-keybindings`).
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings)
  (`loom.jev-hub.open`, unbound by default).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (palette items).
- [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp) (`loom_jev_hub_ask`,
  `loom_jev_hub_submit`).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- Every packet that registers a decide feature (L07, L08, L14, L15, L20) appears in the log,
  Tuning and the settings list automatically; nothing is imported from them. Such a packet
  may open a decision in this panel with `forkPanelSurface("jev-hub", "decision:<id>")` when
  `jev-hub` is in `loomFeatures` (TECHNICAL.md, "Deep link").
- If L21 (skill registry) is present, the drafting card offers "Install the TypeSafe skill
  in Skills", which opens L21's panel on its Sources tab
  (`forkPanelSurface("skill-registry", "sources")`), where TypeSafe is a suggested source;
  L21 does the install as an explicit user step.
- If L20's "No AI identification" is on for a project, L20 turns Jev off for that project
  through `ext-decide` unless the user already chose; this panel then shows "Jev is off for
  this project" and runs nothing for it.

## Dependencies needing approval

None. No new packages: the Jev client is a plain `fetch`, the calibration chart is inline
SVG, and lists use `@legendapp/list`, already an `apps/web` dependency.

## Size estimate

Large: about 5,000 to 6,000 lines including tests, plus about 1,800 for `ext-decide` if this
packet creates it. Contracts about 500, server (builders, store, replay, calibration,
drafting, RPC, MCP) about 1,900, client-runtime lint and cost helpers about 400 with tests,
web UI about 2,400. Four phases (IMPLEMENTATION.md); each ships.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md
(sections 1 to 10 and 18), then every file here in this order: PRODUCT.md, TECHNICAL.md,
SEAMS.md, IMPLEMENTATION.md, TESTING.md, REFERENCES.md. Start with IMPLEMENTATION.md step 1.
Kyle has a TypeSafe API key; ask him to paste it into Settings, Loom, Jev for the manual
pass. Never put it in a file, a test or a log.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle, including the Jev catalog.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
