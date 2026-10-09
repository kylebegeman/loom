# Loom implementation packets

Every Loom feature is built as an implementation packet: a folder of documents under
`docs/fork/packets/Lxx-slug/` that one agent can implement from start to finish on its own.
A packet describes one feature, the fork-owned code it adds, and the few marked seams it
needs in upstream files. The fork stays additive, so `scripts/fork/loom.sh` can keep merging
upstream T3 Code releases (see [FORK.md](../../../FORK.md)).

Start with [IMPLEMENT-NOW.md](./IMPLEMENT-NOW.md) for the current selected queue and
pending decisions. Older readiness labels and build waves do not authorize starting a
packet outside that queue.

Read these before touching a packet:

- [CONVENTIONS.md](./CONVENTIONS.md): where fork code lives, naming, seam markers, commits,
  verification, merge safety and the definition of done.
- [EXTENSION-POINTS.md](./EXTENSION-POINTS.md): the shared plumbing (RPC, server layer,
  storage, panels and their launcher letters, settings, command palette, keybindings, MCP
  tools, composer, desktop IPC, provider drivers, provider turn input, diff panel header,
  decisions with Jev). Each
  extension point is specified exactly, so the first packet that needs one creates it and
  every later packet only registers into it.
- [\_template/](./_template/): the files every packet folder contains.

## Planning policy after the upstream review

Kyle confirmed on 2026-09-27 that Loom is an additive extension of T3 Code. These
features are optional improvements, not prerequisites for doing other work. Prioritize
new functionality that is useful on the released upstream version and does not depend on
predicting an unmerged design.

Keep upstream overlap, desired residual behavior and unresolved questions documented.
Defer affected implementation and contract design until Orchestrator V2 ships, then review
the released behavior and contracts. Deferral has no deadline and does not imply that a
feature must eventually be built. Do not build temporary V1 replacements, speculative V2
adapters or partial features merely to keep the old build waves moving.

The 2026-09-27 review identified these items to revisit:

- **L28:** retain automatic switching between eligible subscription accounts. Adopt
  upstream reset-time recovery; reassess the residual scope after release. See its
  [product decision](./L28-auto-resume/PRODUCT.md).
- **L02, L08, L25:** upstream V2 has forks/lineage, delegation/thread tools and recurring
  schedules. Preserve the additional product ideas; do not implement competing lifecycles.
- **L21:** unified skill management and creation retained, deferred by Kyle on 2026-09-27.
  Revisit released provider/account discovery, enablement and test-thread contracts after V2.
- **L12, L26:** included by Kyle on 2026-10-09 now that V2 ships in nightly. L26's
  integration was redesigned against released V2 events; see its TECHNICAL.md.
- **L16, L17:** reassess shared authentication, ACP Registry and provider backports before
  designing extra account/provider infrastructure.
- **L03, L22, L20:** their shared turn-input plan and some packet seams reference V1 code
  removed by V2. Choose new integration points only from released source.
- **L04:** archived by Kyle on 2026-10-07. Its UI is hidden; the implementation remains
  available for reference.
- **L06, L07, L11, L13, L14, L15, L18:** preserve the proposals pending review
  of changed UI, run, request, checkpoint and provider behavior. Review individual parts
  separately when a packet is picked up.
- **L09:** on `main` (PR #14). A real remote Mac over SSH is still to check; see
  [TESTING.md](./L09-device-qa/TESTING.md#results).
- **L10:** on `main` (PR #13). Builds run through the thread's L19 lane when it has one. The
  checks still open are listed in [TESTING.md](./L10-apple-build-tooling/TESTING.md#results).
- **L19:** lanes are on `main`: capped per-thread space for disposable output, pressure
  handling and agent self-cleanup (phase 1) and leases (phase 2). Deferred: the agreed
  persistent machine pool with on-demand checkouts, publication and safe parking
  ([phase 3](./L19-project-lifecycle/PRODUCT.md#phase-3-persistent-machine-pool)).
- **L29:** full Jev hub retained, deferred by Kyle on 2026-09-27. Reassess released context
  contracts and SDK choices; jevgrep is a separate retrieval candidate, not a hub replacement.
- **Shared surfaces and App Kit:** the extension SDK/server/dock stack is a separate draft
  proposal. Record the overlap without assuming acceptance, APIs or a delivery date.
  Its author closed it on 2026-10-02; a smaller upstream plugin stack (#16047 and up) is
  open but not agreed. Loom's own plugin contract, [L30](./L30-plugins/), builds plugins
  into the app and depends on neither proposal; Kyle parked it on 2026-10-09.
- **V2 cutover:** recheck the database-generation-aware backup/rollback path, protocol
  compatibility across clients and legacy-history limitations before installing V2.

Evidence snapshot: [V2 #2829](https://github.com/pingdotgg/t3code/pull/2829), inspected at
`0dcb029dafc93401bd115f62a0c934b20e6bf850`;
[provider backport #13784](https://github.com/pingdotgg/t3code/pull/13784);
[draft extension stack #13819](https://github.com/pingdotgg/t3code/pull/13819).
These establish planning concerns, not a promised merge date.

The index marks affected proposals as deferred. Individual packet files retain earlier
designs for reference; any "Ready to build" labels inside those files predate this review
and do not override these deferrals. Resolve affected packets one at a time when their
upstream behavior is available; leave their contracts open until then. Unaffected feature candidates still need a focused source check before
implementation, not a speculative rewrite of the shared framework.

## Packets are independent

No packet depends on another packet. A packet may depend on an extension point, and an
extension point is created by whichever packet needs it first, byte for byte as
EXTENSION-POINTS.md specifies it (except where a section says it is not yet verbatim). Two
packets built in parallel therefore create identical extension point commits, and the second
one to land drops its copy.

If a packet seems to need another packet's feature, the design is wrong: either the shared
part belongs in an extension point (propose the change to EXTENSION-POINTS.md first), or the
packet should degrade gracefully when the other feature is absent.

## Picking up a packet

### Kyle

1. Pick a row below. If its folder does not exist yet, copy `_template/` to
   `docs/fork/packets/Lxx-slug/` and fill in `README.md` and `PRODUCT.md` (the product
   intent). A packet that needs a design session first holds until that session is recorded
   in its `PRODUCT.md`.
2. Start one agent per packet, in its own worktree, with a prompt like: "Implement
   `docs/fork/packets/Lxx-slug`. Read AGENTS.md, FORK.md and the packets README,
   CONVENTIONS and EXTENSION-POINTS first."
3. Review the result: the packet's `SEAMS.md` must match
   `git grep -nE '(//|/\*|<!--|#) fork: <slug>([^a-z0-9-]|$)' -- . ':(exclude)docs/'`, and
   the extension point commits must match EXTENSION-POINTS.md, and
   `scripts/fork/loom.sh check` must pass on the branch (it holds every marker to
   `docs/fork/seams.tsv`).
4. Merge, then run `scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced
   `main` to prove the next upstream merge still works. Update the Status column.

### An agent

1. Read `AGENTS.md`, `FORK.md`, this file, [CONVENTIONS.md](./CONVENTIONS.md),
   [EXTENSION-POINTS.md](./EXTENSION-POINTS.md), then every file in the packet folder.
2. If `TECHNICAL.md`, `SEAMS.md`, `IMPLEMENTATION.md` or `TESTING.md` are still template
   stubs, write them first from `PRODUCT.md` and the current source, then stop for review
   if the packet says design review is required.
3. For every extension point the packet uses, run its existence check. Create missing ones
   exactly as specified, in their own commit, before any packet code.
4. Implement the packet in fork-owned paths. Add only the seams listed in its `SEAMS.md`.
5. Meet the definition of done in CONVENTIONS.md and set the Status column to "Done" (or
   "Blocked: reason").

## Packet index

"Selection" points at the item in [selections.md](../selections.md), which also maps every
selection to its packet. "Extension points" lists what the packet's README says it uses, in
short codes: `core` server core (RPC, server layer, storage, capabilities), `root` web root,
`panels`, `settings`, `palette`, `keys` keybindings, `mcp`, `composer`, `composer-menu`,
`desktop`, `providers`, `turn-input`, `diff-header`, `decide` (decisions with Jev). `core*`
means the packet registers nothing in server core and needs it only as the prerequisite of
`panels`, `palette` or `keys`. Right panel launcher letters are assigned in
[EXTENSION-POINTS.md, "Launcher letters"](./EXTENSION-POINTS.md#launcher-letters).

| ID  | Packet                                                    | Summary                                                                                                                    | Selection                    | Extension points                                                                | Status                                        |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| L01 | [`snippets`](./L01-snippets/)                             | Save reusable prompt snippets with fill-in fields, search them, and insert them with `;alias`.                             | P1, F1                       | core, root, panels, palette, keys, composer, composer-menu                      | Parked: skills                                |
| L02 | [`thread-lineage`](./L02-thread-lineage/)                 | Fork a thread from any message, open sidecars, see related threads and two threads side by side.                           | P5, F2 (fork), F16 parts 1-2 | core, root, panels, palette, keys                                               | Deferred: V2                                  |
| L03 | [`compaction-and-goals`](./L03-compaction-and-goals/)     | Compact a conversation on demand and pin a standing goal that is sent with every turn.                                     | F2 (compaction, goals)       | core, root, palette, keys, composer, turn-input                                 | Deferred: V2                                  |
| L04 | [`thread-inspector`](./L04-thread-inspector/)             | A glance card from the chat header and a panel for the thread's status, changes, plan, approvals, agents and context.      | P6                           | core\*, root, panels, palette, keys                                             | Archived                                      |
| L05 | [`file-outline`](./L05-file-outline/)                     | Browse and jump to the symbols of the open file from an outline column or the palette.                                     | P8, F8 (outline)             | core\*, root, palette, keys                                                     | Complete (on main)                            |
| L06 | [`source-control-cockpit`](./L06-source-control-cockpit/) | The thread's branch, PR and CI status, commit graph, check logs, conflicts and safe switching.                             | P7 (F13 deferred)            | core, root, panels, palette, keys                                               | Deferred: V2                                  |
| L07 | [`bottom-dock`](./L07-bottom-dock/)                       | Turn the terminal drawer into a tabbed dock with Tasks, Activity and Approvals tabs, with optional Jev risk badges.        | P10                          | core, root, settings, palette, keys, decide                                     | Deferred: V2                                  |
| L08 | [`multi-thread-runs`](./L08-multi-thread-runs/)           | Send one prompt to several models, let agents delegate to other threads, and track runs.                                   | P11, F9 (tiny version)       | core, root, panels, settings, palette, keys, mcp, decide                        | Deferred: V2                                  |
| L09 | [`device-qa`](./L09-device-qa/)                           | Run UI flows on simulators and collect screenshots and recordings as thread evidence.                                      | P12                          | core, root, panels, settings, palette, keys, mcp                                | Complete (PR #14)                             |
| L10 | [`apple-build-tooling`](./L10-apple-build-tooling/)       | Build, test and run Xcode and Swift projects with parsed error and test summaries.                                         | F21                          | core, root, panels, settings, palette, keys, mcp                                | Complete (PR #13)                             |
| L11 | [`browser-dev-tools`](./L11-browser-dev-tools/)           | Dev servers, Docker Compose, local databases, an HTTP lab, and console and network tabs.                                   | P13                          | core, root, panels, settings, palette, keys, mcp, desktop                       | Deferred: V2                                  |
| L12 | [`panel-picker`](./L12-panel-picker/)                     | Open any right panel surface from one compact, searchable, keyboard-driven picker.                                         | P14                          | core\*, root, panels, settings, palette, keys                                   | Done (`feat/loom-panel-picker`)               |
| L13 | [`composer-drawers`](./L13-composer-drawers/)             | Send one message with other settings, add a schema, attach shell output, or reuse clipboard items.                         | P15, F8 (clipboard history)  | core, root, settings, palette, keys, composer                                   | Deferred: V2                                  |
| L14 | [`chat-conveniences`](./L14-chat-conveniences/)           | Find in thread, Mermaid diagrams, model presets with an optional Jev Auto preset, and questions that do not stop the turn. | F8 (the rest)                | core, root, settings, palette, keys, mcp, composer, decide                      | Deferred: V2                                  |
| L15 | [`ai-code-review`](./L15-ai-code-review/)                 | A second model reviews changes and chosen findings go back to be fixed.                                                    | F3                           | core, root, panels, settings, palette, keys, mcp, composer, diff-header, decide | Deferred: V2                                  |
| L16 | [`provider-sign-in`](./L16-provider-sign-in/)             | Sign Codex and Claude accounts in and out inside Loom, add accounts, manage Codex tools.                                   | F5                           | core, settings, palette, providers                                              | Deferred: V2                                  |
| L17 | [`more-providers`](./L17-more-providers/)                 | DeepSeek, Ollama and LM Studio endpoints, custom ACP agents (Gemini CLI among them), and Copilot.                          | F6                           | core, settings, palette, providers                                              | Deferred: V2                                  |
| L18 | [`project-profiles`](./L18-project-profiles/)             | Private per-project agent notes, command mappings, token budgets, and `.env.schema` status.                                | F11                          | core, root, panels, settings, palette, mcp, composer, composer-menu             | Deferred: V2                                  |
| L19 | [`project-lifecycle`](./L19-project-lifecycle/)           | Capped lanes for every thread's disposable output, storage pressure handling, then the machine pool and safe parking.      | F12                          | core, root, settings, palette, mcp                                              | Phases 1, 2 implemented; phase 3 deferred     |
| L20 | [`small-extras`](./L20-small-extras/)                     | A worktree branch prefix, a per-project No AI identification mode, a containers panel, and CLI tool versions.              | F23                          | core, root, panels, settings, palette, turn-input, decide                       | Deferred: V2                                  |
| L21 | [`skill-registry`](./L21-skill-registry/)                 | See, toggle, install and create agent skills across providers and accounts in one panel.                                   | Skill registry               | core, root, panels, palette, keys                                               | Deferred: V2                                  |
| L22 | [`instruction-modes`](./L22-instruction-modes/)           | Reusable rule packs such as "Minimal code" applied to every turn of a thread, for any provider.                            | Repository review            | core, root, settings, palette, keys, composer, turn-input                       | Deferred: V2                                  |
| L23 | [`model-preview-3d`](./L23-model-preview-3d/)             | Design and preview mesh/OpenSCAD parts with parameters, variants, measurements, captures and review.                       | 3D preview                   | core, root, panels, settings, palette, keys, mcp                                | Complete; Loom `0.0.46-nightly.20261007.2787` |
| L24 | [`pcb-preview`](./L24-pcb-preview/)                       | PCB editor with checks, inspection, comparison, simulation, parameters, 3D and hardware reuse.                             | PCB preview                  | core, root, panels, settings, palette, keys                                     | Complete; Loom `0.0.46-nightly.20261008.2801` |
| L25 | [`inbound-triggers`](./L25-inbound-triggers/)             | Start threads from assigned or labeled GitHub issues, mentions and review requests; send CI failures to the owning thread. | Repository review            | core, root, settings, palette, keys                                             | Deferred: V2                                  |
| L26 | [`code-graph`](./L26-code-graph/)                         | A local code graph to browse symbols, see the blast radius of changes, and let agents query it.                            | Repository review            | core, root, panels, settings, palette, mcp, diff-header                         | Done (`feat/loom-code-graph`)                 |
| L27 | [`utilities`](./L27-utilities/)                           | Twenty-nine offline developer tools (encoders, JWT decode, hashes, regex, subnet and chmod calculators) in a panel.        | F4                           | core\*, root, panels, palette, keys                                             | Implement now                                 |
| L28 | [`auto-resume`](./L28-auto-resume/)                       | Retain automatic switching between eligible subscription accounts; reuse upstream reset-time recovery after V2 ships.      | F7                           | Reassess after V2                                                               | Deferred: V2                                  |
| L29 | [`jev-hub`](./L29-jev-hub/)                               | Trial and tune Jev decisions: a decision log with ratings, a playground, question templates, test sets and replay.         | Jev hub                      | core, root, panels, settings, palette, keys, mcp, decide                        | Deferred: V2                                  |
| L30 | [`plugins`](./L30-plugins/)                               | Every Loom feature becomes a plugin with one definition per layer, switched on or off per environment in Settings.         | Kyle, 2026-10-09             | core, root, panels, settings, palette, keys                                     | Parked                                        |

L22, L25 and L26 came from the review of the reference repositories, and L29 from settling
the packet questions; Kyle confirmed all four on 2026-09-24.

## Settled decisions

Every open question was settled with Kyle on 2026-09-24. Each packet records its answers in
the "Decisions" list of its `PRODUCT.md` (L15 also in `DESIGN-SESSION.md`, section 7), and
features deferred by an answer appear in its README as "Follow-up: ...". Decisions that span
packets:

- **Jev.** Optional typed decisions from TypeSafe's Jev model go through the shared
  [`ext-decide`](./EXTENSION-POINTS.md#18-decisions-with-jev-ext-decide) extension point.
  L07, L08, L14, L15 and L20 use it; L29 adds the tools to trial and tune it. Every use has a
  non-Jev fallback, never blocks, and agent use is off until allowed per feature.
- **No AI identification.** L20 adds a per-project mode that keeps AI mentions out of branch
  names, commits, PR text and code comments, for work projects.
- **Default shortcuts.** Fork shortcuts on by default (L12 `mod+shift+'`, L14 `mod+F`) are
  key listeners with an off switch, never entries in `keybindings.json`
  ([EXTENSION-POINTS.md, section 9](./EXTENSION-POINTS.md#9-keybindings-ext-keybindings)).
- **Turn input order.** L20 private mode (5), L22 instruction modes (10), L03 goal (20).
