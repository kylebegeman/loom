# Implement-now decisions

This is the entry point for selecting the next Loom packet. It overrides older build waves
and individual packet labels. Kyle completed this selection review on 2026-09-27. Only packets in the selected queue
are designated for implementation; retained proposals remain parked.

## Selected queue

| Order | Packet                                                | Status                                                                | Decision                                                                                        |
| ----- | ----------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1     | [L23 3D preview](./L23-model-preview-3d/)             | Complete; Loom `0.0.46-nightly.20261007.2787`                         | Full L23, redesign and five selected editing additions verified; final audit closed 2026-10-07. |
| 2     | [L24 PCB preview](./L24-pcb-preview/)                 | Complete; Loom `0.0.46-nightly.20261008.2801`                         | Full packet plus eight editor features, 3D, library/reuse and MCP/CLI approved in this thread.  |
| 3     | [L10 Apple build tooling](./L10-apple-build-tooling/) | Implemented on `feat/loom-apple-build-tooling`; manual checks pending | Kyle confirmed the full packet on 2026-09-27.                                                   |
| 4     | [L09 Device QA](./L09-device-qa/)                     | Implement now                                                         | Kyle confirmed the full flow/evidence packet on 2026-09-27.                                     |
| 5     | [L27 Utilities](./L27-utilities/)                     | Implement now                                                         | Kyle included the complete 29-tool packet on 2026-09-27.                                        |
| 6     | [L05 File outline](./L05-file-outline/)               | Implement now                                                         | Kyle included the complete selected language coverage on 2026-09-27.                            |

Order reflects product priority, not dependencies. An agent asked to choose the next item
starts with the first incomplete, unclaimed packet. Closing L23 does not start another project. Each packet can still be implemented independently.

All candidate dispositions are settled for this review. The comparison below retains the
reasons for selection or deferral; only the selected queue is available for implementation. L23 is complete and integrated on main; the other selections remain queued.

## Candidates for the queue

Source review: 2026-09-27, Loom `e73fc8faca2cfbf1e1b0fafa1cd85ce37c508fff`.
This is a suitability review, not a claim that every implementation sketch has been validated.

| Packet                                                | Complete outcome                                                                          | Why consider it now                                                                | Readiness work before selection is final                                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [L27 Utilities](./L27-utilities/)                     | All 29 offline tools, panel, palette, no-thread dialog and configurable shortcut          | Client-only; required dependencies and shared UI extension points already exist    | Selected; worker lifecycle requirements and focused test cases clarified in the packet                                                                             |
| [L05 File outline](./L05-file-outline/)               | Search and navigate symbols in the open file across all selected languages                | Client-only; current file surface exposes loaded text and existing line navigation | Selected; current editor updates the file query on each edit, and existing openFile supports line navigation; language fixtures are required during implementation |
| [L01 Snippets](./L01-snippets/)                       | Saved library, fill-in fields, aliases, revisions, import/export and terminal insertion   | Owns prompt preparation, not agent execution                                       | Parked by Kyle's conditional decision: existing composer skill invocation covers named predefined workflows; see the packet README                                 |
| [L23 3D preview](./L23-model-preview-3d/)             | Mesh/OpenSCAD previews, live reload, parameters, captures and agent render tool           | Owns file rendering; does not replace orchestration or depend on Fabrication       | Complete, including settings/MCP integrations and real CLI/client verification; see L23 TESTING.md for limits                                                      |
| [L24 PCB preview](./L24-pcb-preview/)                 | PCB editor, checks, inspection, comparison, simulation, parameters, 3D and hardware reuse | Owns design-file rendering; does not depend on Electronics                         | Complete; real CAD/simulator execution and local editor checks; see L24 TESTING.md for limits                                                                      |
| [L10 Apple build tooling](./L10-apple-build-tooling/) | Build/test/run, result summaries, history, XcodeGen and readiness checks                  | Owns a build pipeline separate from agent turns                                    | Selected; current workspace/Device services checked; real build, test, cancellation and destination verification required during implementation                    |
| [L09 Device QA](./L09-device-qa/)                     | Recorded flow runs, snapshot diffs, evidence capture/history and agent tools              | Adds repeatable QA to the existing Device surface                                  | Selected; current access gating and deletion event checked; outdated Device toolbar seam refreshed; real flow/capture verification required during implementation  |

These are whole packets with their existing product scope. Do not quietly drop formats,
tools, platforms or entry points to make a candidate appear ready. Web and desktop are the
selected UI surfaces in these packets; remote use remains required and mobile UI remains
outside their scope. A future V2 port of ordinary workspace or panel integration may still
be necessary. Selecting a packet means its complete behavior is useful on current released
code, not that its integration will never change.

## L01 decision: use existing skills

On 2026-09-27 Kyle said to park Snippets if existing functionality provides equally quick
composer access to a predefined set of detailed instructions; otherwise include it, with
maintenance cost accepted. The current composer provides searchable `$` skill selection
(and skills in the `/` menu when enabled). A saved skill can contain the work definition,
formatting rules and do/don't guidance; selecting it inserts the invocation, and Kyle can
add task-specific text before sending.

Verified against the reviewed source: `ChatComposer.tsx` searches provider skills and inserts
`$name`; `ClaudeSkillDispatch.ts` translates a discovered skill mention into Claude's native
invocation; Codex receives its native skill mention. See upstream's
[composer guide](../../user/composer.md#commands-and-skills).

**Disposition: L01 parked, existing skills cover the stated need.** This is not a claim that
skills replace every snippet feature. Skills require one-time authoring and availability in
the selected provider/environment; they do not expand an editable prompt body or provide
L01's fill-in drawer and library UI. Reopen L01 if those differences matter in actual use.
Porting cost alone is not a reason to decline a feature Kyle finds valuable. No skills or
provider settings were created or changed during this decision.

## Additional proposals to keep parked

The previous review retained these product ideas, but that did not establish immediate
implementation readiness. Confirmed deferrals:

- **L21 Skill registry: confirmed deferred by Kyle on 2026-09-27.** Retain its full
  management/creation scope and revisit after V2 ships. Review released provider/account
  reports, enablement and test-thread behavior before choosing contracts. The existing `$`
  picker covers invocation, not this management UI. Do not build a partial file browser in
  the meantime; there is no deadline.
- **L26 Code graph: confirmed deferred by Kyle on 2026-09-27.** Preserve the full
  code map, change-impact, agent-query and automatic-update scope. Revisit released turn
  completion, project deletion, checkpoint/diff and MCP contracts after V2 ships. Do not
  build a temporary manual-only graph or speculative V2 integration. There is no deadline.
- **L29 Jev hub: confirmed deferred by Kyle on 2026-09-27.** Retain the full log,
  playground, templates, ratings and tuning scope. Revisit released thread/turn/diff/approval
  contracts and the deferred consumers after V2 ships; no partial playground substitute.
  The [jevgrep review](./L29-jev-hub/REFERENCES.md#jevgrep-review-2026-09-27) identifies an
  independent code-retrieval experiment and SDK options for later evaluation. Neither is
  selected for installation or implementation by this review.

All packets already marked `Deferred: V2` in the [index](./README.md#packet-index) stay
deferred. L04 is archived following Kyle’s 2026-10-07 decision to hide its UI and
retain the implementation for reference.

## What qualifies as implement now

Before moving a packet into the selected queue, record Kyle's inclusion decision and settle
any product choices required to complete it. Refresh its technical, seam and testing notes
against current released source. The packet must define its complete outcome, supported
surfaces, dependencies/tool prerequisites, focused validation and any remaining constraints.
Record the reviewed commit and approved scope in its README. An unresolved contract or
product decision means `Needs planning`, not `Implement now`.

Reuse existing fork extension points. Add only the missing integration needed by the
selected feature; do not build infrastructure for parked features or unmerged upstream
proposals. A routine source adjustment is implementation work; a material scope change or
new upstream dependency returns the packet to planning with the reason recorded.

## Agent handoff

When asked to pick up an implement-now item:

1. Read AGENTS.md, FORK.md, this page, the packet index, conventions, relevant extension
   points and every file in the chosen packet.
2. Pick only from the selected queue. Check the working tree, branches and active work
   before starting; do not duplicate a packet already in progress. Record the owning branch
   and change its status to `In progress` in the existing packet index and README.
3. Check the relevant current source and package manifests against the recorded review.
   If V2 has landed or required contracts have materially changed, reassess before coding.
   Routine line movement does not require another product decision.
4. Implement the whole recorded scope, keeping other people's work intact. Run focused
   tests, relevant consumer typechecks, lint and the packet's applicable verification.
   Existing rules for browser/device verification, dependencies and external actions still
   apply; selection alone is not deployment, publishing or live-data authorization.
5. Record what passed and what remains in the packet's testing notes. Do not call a partial
   implementation done. Update the index and README with the actual status and handoff.

The queue is an implementation scope decision, not a guarantee that old source snippets
remain correct forever. An agent should be able to start without replaying this conversation.
