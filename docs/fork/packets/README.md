# Loom implementation packets

Every Loom feature is built as an implementation packet: a folder of documents under
`docs/fork/packets/Lxx-slug/` that one agent can implement from start to finish on its own.
A packet describes one feature, the fork-owned code it adds, and the few marked seams it
needs in upstream files. The fork stays additive, so `scripts/fork/loom.sh` can keep merging
upstream T3 Code releases (see [FORK.md](../../../FORK.md)).

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

| ID  | Packet                                                    | Summary                                                                                                                    | Selection                    | Extension points                                                                | Status         |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- | -------------- |
| L01 | [`snippets`](./L01-snippets/)                             | Save reusable prompt snippets with fill-in fields, search them, and insert them with `;alias`.                             | P1, F1                       | core, root, panels, palette, keys, composer, composer-menu                      | Ready to build |
| L02 | [`thread-lineage`](./L02-thread-lineage/)                 | Fork a thread from any message, open sidecars, see related threads and two threads side by side.                           | P5, F2 (fork), F16 parts 1-2 | core, root, panels, palette, keys                                               | Ready to build |
| L03 | [`compaction-and-goals`](./L03-compaction-and-goals/)     | Compact a conversation on demand and pin a standing goal that is sent with every turn.                                     | F2 (compaction, goals)       | core, root, palette, keys, composer, turn-input                                 | Ready to build |
| L04 | [`thread-inspector`](./L04-thread-inspector/)             | One status card for the thread: work, changes, plan, approvals, agents and context.                                        | P6                           | core\*, root, panels, palette, keys                                             | Ready to build |
| L05 | [`file-outline`](./L05-file-outline/)                     | Browse and jump to the symbols of the open file from an outline column or the palette.                                     | P8, F8 (outline)             | core\*, root, palette, keys                                                     | Ready to build |
| L06 | [`source-control-cockpit`](./L06-source-control-cockpit/) | The thread's branch, PR and CI status, commit graph, check logs, conflicts and safe switching.                             | P7 (F13 deferred)            | core, root, panels, palette, keys                                               | Ready to build |
| L07 | [`bottom-dock`](./L07-bottom-dock/)                       | Turn the terminal drawer into a tabbed dock with Tasks, Activity and Approvals tabs, with optional Jev risk badges.        | P10                          | core, root, settings, palette, keys, decide                                     | Ready to build |
| L08 | [`multi-thread-runs`](./L08-multi-thread-runs/)           | Send one prompt to several models, let agents delegate to other threads, and track runs.                                   | P11, F9 (tiny version)       | core, root, panels, settings, palette, keys, mcp, decide                        | Ready to build |
| L09 | [`device-qa`](./L09-device-qa/)                           | Run UI flows on simulators and collect screenshots and recordings as thread evidence.                                      | P12                          | core, root, panels, settings, palette, keys, mcp                                | Ready to build |
| L10 | [`apple-build-tooling`](./L10-apple-build-tooling/)       | Build, test and run Xcode and Swift projects with parsed error and test summaries.                                         | F21                          | core, root, panels, settings, palette, keys, mcp                                | Ready to build |
| L11 | [`browser-dev-tools`](./L11-browser-dev-tools/)           | Dev servers, Docker Compose, local databases, an HTTP lab, and console and network tabs.                                   | P13                          | core, root, panels, settings, palette, keys, mcp, desktop                       | Ready to build |
| L12 | [`panel-picker`](./L12-panel-picker/)                     | Open any right panel surface from one compact, searchable, keyboard-driven picker.                                         | P14                          | core\*, root, panels, settings, palette, keys                                   | Ready to build |
| L13 | [`composer-drawers`](./L13-composer-drawers/)             | Send one message with other settings, add a schema, attach shell output, or reuse clipboard items.                         | P15, F8 (clipboard history)  | core, root, settings, palette, keys, composer                                   | Ready to build |
| L14 | [`chat-conveniences`](./L14-chat-conveniences/)           | Find in thread, Mermaid diagrams, model presets with an optional Jev Auto preset, and questions that do not stop the turn. | F8 (the rest)                | core, root, settings, palette, keys, mcp, composer, decide                      | Ready to build |
| L15 | [`ai-code-review`](./L15-ai-code-review/)                 | A second model reviews changes and chosen findings go back to be fixed.                                                    | F3                           | core, root, panels, settings, palette, keys, mcp, composer, diff-header, decide | Ready to build |
| L16 | [`provider-sign-in`](./L16-provider-sign-in/)             | Sign Codex and Claude accounts in and out inside Loom, add accounts, manage Codex tools.                                   | F5                           | core, settings, palette, providers                                              | Ready to build |
| L17 | [`more-providers`](./L17-more-providers/)                 | DeepSeek, Ollama and LM Studio endpoints, custom ACP agents (Gemini CLI among them), and Copilot.                          | F6                           | core, settings, palette, providers                                              | Ready to build |
| L18 | [`project-profiles`](./L18-project-profiles/)             | Private per-project agent notes, command mappings, token budgets, and `.env.schema` status.                                | F11                          | core, root, panels, settings, palette, mcp, composer, composer-menu             | Ready to build |
| L19 | [`project-lifecycle`](./L19-project-lifecycle/)           | A Repositories page to clone, adopt, park safely and reopen GitHub checkouts.                                              | F12                          | core, root, settings, palette, keys                                             | Ready to build |
| L20 | [`small-extras`](./L20-small-extras/)                     | A worktree branch prefix, a per-project No AI identification mode, a containers panel, and CLI tool versions.              | F23                          | core, root, panels, settings, palette, turn-input, decide                       | Ready to build |
| L21 | [`skill-registry`](./L21-skill-registry/)                 | See, toggle, install and create agent skills across providers and accounts in one panel.                                   | Skill registry               | core, root, panels, palette, keys                                               | Ready to build |
| L22 | [`instruction-modes`](./L22-instruction-modes/)           | Reusable rule packs such as "Minimal code" applied to every turn of a thread, for any provider.                            | Repository review            | core, root, settings, palette, keys, composer, turn-input                       | Ready to build |
| L23 | [`model-preview-3d`](./L23-model-preview-3d/)             | Preview STL, 3MF, OBJ, glTF and OpenSCAD models beside the chat, with live reload.                                         | 3D preview                   | core, root, panels, settings, palette, keys, mcp                                | Ready to build |
| L24 | [`pcb-preview`](./L24-pcb-preview/)                       | View KiCad and tscircuit schematics and boards beside the chat and run ERC and DRC.                                        | PCB preview                  | core, root, panels, settings, palette, keys                                     | Ready to build |
| L25 | [`inbound-triggers`](./L25-inbound-triggers/)             | Start threads from assigned or labeled GitHub issues, mentions and review requests; send CI failures to the owning thread. | Repository review            | core, root, settings, palette, keys                                             | Ready to build |
| L26 | [`code-graph`](./L26-code-graph/)                         | A local code graph to browse symbols, see the blast radius of changes, and let agents query it.                            | Repository review            | core, root, panels, settings, palette, mcp, diff-header                         | Ready to build |
| L27 | [`utilities`](./L27-utilities/)                           | Twenty-nine offline developer tools (encoders, JWT decode, hashes, regex, subnet and chmod calculators) in a panel.        | F4                           | core\*, root, panels, palette, keys                                             | Ready to build |
| L28 | [`auto-resume`](./L28-auto-resume/)                       | Continue a thread automatically after a provider usage limit resets, or on another account.                                | F7                           | core, settings, palette, composer                                               | Ready to build |
| L29 | [`jev-hub`](./L29-jev-hub/)                               | Trial and tune Jev decisions: a decision log with ratings, a playground, question templates, test sets and replay.         | Jev hub                      | core, root, panels, settings, palette, keys, mcp, decide                        | Ready to build |

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
