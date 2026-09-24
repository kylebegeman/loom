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
  tools, composer, desktop IPC, provider drivers, provider turn input, diff panel header). Each
  extension point is specified exactly, so the first packet that needs one creates it and
  every later packet only registers into it.
- [\_template/](./_template/): the files every packet folder contains.

## Packets are independent

No packet depends on another packet. A packet may depend on an extension point, and an
extension point is created by whichever packet needs it first, byte for byte as
EXTENSION-POINTS.md specifies it. Two packets built in parallel therefore create identical
extension point commits, and the second one to land drops its copy.

If a packet seems to need another packet's feature, the design is wrong: either the shared
part belongs in an extension point (propose the change to EXTENSION-POINTS.md first), or the
packet should degrade gracefully when the other feature is absent.

## Picking up a packet

### Kyle

1. Pick a row below. If its folder does not exist yet, copy `_template/` to
   `docs/fork/packets/Lxx-slug/` and fill in `README.md` and `PRODUCT.md` (the product
   intent). Mark packets that need a design session first (L15) and hold them until that
   session is recorded in `PRODUCT.md`.
2. Start one agent per packet, in its own worktree, with a prompt like: "Implement
   `docs/fork/packets/Lxx-slug`. Read AGENTS.md, FORK.md and the packets README,
   CONVENTIONS and EXTENSION-POINTS first."
3. Review the result: the packet's `SEAMS.md` must match
   `git grep -nE '(//|/\*|<!--|#) fork: <slug>([^a-z0-9-]|$)' -- . ':(exclude)docs/'`, and
   the extension point commits must match EXTENSION-POINTS.md.
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
`desktop`, `providers`, `turn-input`, `diff-header`. `core*` means the packet registers
nothing in server core and needs it only as the prerequisite of `panels` or `palette`. Right
panel launcher letters are assigned in
[EXTENSION-POINTS.md, "Launcher letters"](./EXTENSION-POINTS.md#launcher-letters).

| ID  | Packet                                                    | Summary                                                                                            | Selection                    | Extension points                                                      | Status               |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------- | -------------------- |
| L01 | [`snippets`](./L01-snippets/)                             | Save reusable prompt snippets with fill-in fields, search them, and insert them with `;alias`.     | P1, F1                       | core, root, panels, palette, keys, composer, composer-menu            | Not started          |
| L02 | [`thread-lineage`](./L02-thread-lineage/)                 | Fork a thread from any message, open sidecars, see related threads and two threads side by side.   | P5, F2 (fork), F16 parts 1-2 | core, root, panels, palette, keys                                     | Not started          |
| L03 | [`compaction-and-goals`](./L03-compaction-and-goals/)     | Compact a conversation on demand and pin a standing goal that is sent with every turn.             | F2 (compaction, goals)       | core, root, palette, keys, turn-input                                 | Not started          |
| L04 | [`thread-inspector`](./L04-thread-inspector/)             | One status card for the thread: work, changes, plan, approvals, agents and context.                | P6                           | core\*, root, panels, palette, keys                                   | Not started          |
| L05 | [`file-outline`](./L05-file-outline/)                     | Browse and jump to the symbols of the open file from an outline column or the palette.             | P8, F8 (outline)             | core\*, root, palette, keys                                           | Not started          |
| L06 | [`source-control-cockpit`](./L06-source-control-cockpit/) | The thread's branch, PR and CI status, commit graph, check logs, conflicts and safe switching.     | P7 (F13 deferred)            | core, root, panels, palette, keys                                     | Not started          |
| L07 | [`bottom-dock`](./L07-bottom-dock/)                       | Turn the terminal drawer into a tabbed dock with Tasks, Activity and Approvals tabs.               | P10                          | core\*, root, palette, keys                                           | Not started          |
| L08 | [`multi-thread-runs`](./L08-multi-thread-runs/)           | Send one prompt to several models, let agents delegate to other threads, and track runs.           | P11, F9 (tiny version)       | core, root, panels, settings, palette, keys, mcp                      | Not started          |
| L09 | [`device-qa`](./L09-device-qa/)                           | Run UI flows on simulators and collect screenshots and recordings as thread evidence.              | P12                          | core, root, panels, settings, palette, keys, mcp                      | Not started          |
| L10 | [`apple-build-tooling`](./L10-apple-build-tooling/)       | Build, test and run Xcode and Swift projects with parsed error and test summaries.                 | F21                          | core, root, panels, settings, palette, keys, mcp                      | Not started          |
| L11 | [`browser-dev-tools`](./L11-browser-dev-tools/)           | Dev servers, Docker Compose, local databases, an HTTP lab, and console and network tabs.           | P13                          | core, root, panels, settings, palette, keys, mcp, desktop             | Not started          |
| L12 | [`panel-picker`](./L12-panel-picker/)                     | Open any right panel surface from one compact, searchable, keyboard-driven picker.                 | P14                          | core\*, root, panels, settings, palette, keys                         | Not started          |
| L13 | [`composer-drawers`](./L13-composer-drawers/)             | Send one message with other settings, add a schema, attach shell output, or reuse clipboard items. | P15, F8 (clipboard)          | core, root, settings, palette, keys, composer                         | Not started          |
| L14 | [`chat-conveniences`](./L14-chat-conveniences/)           | Find in thread, Mermaid diagrams, model presets, and agent questions that do not stop the turn.    | F8                           | core, root, settings, palette, keys, mcp, composer                    | Not started          |
| L15 | [`ai-code-review`](./L15-ai-code-review/)                 | A second model reviews changes and chosen findings go back to be fixed.                            | F3                           | decided by the design session (likely core, panels, mcp, diff-header) | Needs design session |
| L16 | [`provider-sign-in`](./L16-provider-sign-in/)             | Sign Codex and Claude accounts in and out inside Loom, add accounts, manage Codex tools.           | F5                           | core, settings, palette, providers                                    | Not started          |
| L17 | [`more-providers`](./L17-more-providers/)                 | DeepSeek, Ollama and LM Studio endpoints, plus Copilot, Gemini and custom ACP agents.              | F6                           | core, settings, palette, providers                                    | Not started          |
| L18 | [`project-profiles`](./L18-project-profiles/)             | Private per-project agent notes, command mappings, token budgets, and `.env.schema` status.        | F11                          | core, panels, settings, palette, mcp                                  | Not started          |
| L19 | [`project-lifecycle`](./L19-project-lifecycle/)           | A Repositories page to clone, adopt, park safely and reopen GitHub checkouts.                      | F12                          | core, root, settings, palette, keys                                   | Not started          |
| L20 | [`small-extras`](./L20-small-extras/)                     | A worktree branch prefix, a containers panel with logs, and installed CLI tool versions.           | F23                          | core, panels, settings                                                | Not started          |
| L21 | [`skill-registry`](./L21-skill-registry/)                 | See, toggle, install and create agent skills across providers and accounts in one panel.           | Skill registry               | core, root, panels, palette, keys                                     | Not started          |
| L22 | [`instruction-modes`](./L22-instruction-modes/)           | Reusable rule packs such as "Minimal code" applied to every turn of a thread, for any provider.    | Repository review            | core, root, settings, palette, keys, composer, turn-input             | Not started          |
| L23 | [`model-preview-3d`](./L23-model-preview-3d/)             | Preview STL, 3MF, OBJ, glTF and OpenSCAD models beside the chat, with live reload.                 | 3D preview                   | core, root, panels, settings, palette, keys, mcp                      | Not started          |
| L24 | [`pcb-preview`](./L24-pcb-preview/)                       | View KiCad and tscircuit schematics and boards beside the chat and run ERC and DRC.                | PCB preview                  | core, root, panels, settings, palette, keys                           | Not started          |
| L25 | [`inbound-triggers`](./L25-inbound-triggers/)             | Start threads from GitHub events (assigned issues, mentions, review requests, CI failures).        | Repository review            | core, root, settings, palette, keys                                   | Not started          |
| L26 | [`code-graph`](./L26-code-graph/)                         | A local code graph to browse symbols, see the blast radius of changes, and let agents query it.    | Repository review            | core, panels, settings, palette, mcp, diff-header                     | Not started          |
| L27 | [`utilities`](./L27-utilities/)                           | Twenty-six offline developer tools (encoders, JWT decode, hashes, converters) in a panel.          | F4                           | core\*, root, panels, palette, keys                                   | Not started          |
| L28 | [`auto-resume`](./L28-auto-resume/)                       | Continue a thread automatically after a provider usage limit resets, or on another account.        | F7                           | core, settings, palette, composer                                     | Not started          |

L22, L25 and L26 came from the review of the reference repositories, not from the original
selection. Confirm each with Kyle before implementation (the first question in its list
below).

## Questions to settle before building

Open questions recorded in each packet, one line each. The packet's `PRODUCT.md` (L15:
`DESIGN-SESSION.md`) has the options and the default each packet assumes if Kyle does not
answer.

- **L01 snippets**
  - Use `[[name]]` for fill-in fields instead of old Loom's `{{name}}`?
  - Should a bare `;` open the menu to browse all snippets?
  - Keep the search and panel commands unbound, rather than suggest `mod+shift+;`?
- **L02 thread lineage**
  - Should forks default to the source thread's workspace or a new worktree?
  - Should the roughly 90,000-character transcript budget for replayed forks be configurable?
- **L03 compaction and goals**
  - Add a "Set goal" composer footer button later, through `ext-composer`?
  - Mirror goals to Codex's native goal API later (needs a Codex adapter seam)?
- **L04 thread inspector**
  - Keep light dismissal only, or add a "keep open" pin on the card?
- **L05 file outline**
  - Approve `web-tree-sitter` and grammar WASM files as a later phase if needed?
  - Add more languages in v1, such as Kotlin, Java, C# or Ruby?
- **L06 source control cockpit**
  - Should "Ask the agent to fix" fill the composer or send immediately?
  - Add Continue and Abort buttons for merges and rebases later, behind confirmation?
  - Keep including untracked files by default in "Stash and switch"?
- **L07 bottom dock**
  - Should Tasks sessions also appear in the Terminal tab's session list?
  - Should the tab strip show when only the Terminal tab exists?
  - In Activity, show each message's first line, or leave messages out by default?
- **L08 multi-thread runs**
  - Should compare also offer "same prompt, same model, N times" sampling?
  - Should delegated threads default to a new worktree or the caller's workspace?
- **L09 device QA**
  - Which argent version should the install command pin?
  - Keep evidence until the thread is deleted, or also expire it after N days?
  - Allow flow runs on physical iPhones over USB, not only simulators and emulators?
- **L10 Apple build tooling**
  - Include "Build and run" on a physical device in v1?
  - Keep 20 runs of history per project, or make it time-based?
  - Support `swift build` and `swift test` for plain packages now, or later?
- **L11 browser dev tools**
  - Default the Redis database to Valkey instead of `redis:7-alpine`?
  - Should a dev server started in one thread be stoppable from any thread of the project?
- **L12 panel picker**
  - Add an optional `description` field to `ForkPanelDefinition` in EXTENSION-POINTS.md?
  - Leave `loom.panel-picker.open` unbound, or bind it to `mod+shift+'`?
- **L13 composer drawers**
  - Is capturing only the latest clipboard item when Loom regains focus enough for now?
  - Is a prompt-level JSON schema enough, or should a later packet add native `outputSchema`?
  - Are a 30-second shell timeout and a 64 KB output cap the right defaults?
- **L14 chat conveniences**
  - Approve `mermaid` as a new lazy-loaded `apps/web` dependency?
  - Should `mod+F` find be on by default?
  - Should the ask tool be offered to Codex threads, or refused there?
- **L15 AI code review** (the design session, `DESIGN-SESSION.md` section 4)
  - Engine: reviewer thread with MCP submit, headless structured run, both, or native Codex review?
  - Reviewer threads: shown in the sidebar, grouped under the source thread, or auto-archived?
  - Reviewer model: per-project default, global default, or always asked?
  - Reviewer permissions: approval-required only, or read-only commands such as tests?
  - Which review targets are in v1, and is reviewing other people's PRs in scope?
  - Finding scale: P0 to P3 or blocking, should-fix, nit; hide low-confidence findings?
  - Hand-back: composer review comments only, or also "fix all selected in a new thread"?
  - Lenses in v1: correctness only, plus simplicity, plus impeccable UI checks?
  - Is a "Review changes" button in the diff panel header wanted (via `ext-diff-header`)?
  - Any automatic review triggers in v1, or strictly on demand?
  - Keep review history forever, per thread, or prune it?
  - Include the multi-model merge UI in v1, or only its data model?
  - Show a cost estimate and require confirmation above a diff size limit?
  - Anything on mobile in v1, such as notifications or read-only findings?
- **L16 provider sign-in**
  - Should "Add account" also offer a separate `CODEX_HOME`, not only a shadow home?
  - Store Claude API keys as instance environment variables, or keep them out of settings?
  - May Loom write `cli_auth_credentials_store = "file"` to `~/.codex/config.toml` after confirmation?
- **L17 more providers**
  - Is a Claude-based DeepSeek instance enough, or also add an OpenCode preset?
  - Should endpoint instances share the main Claude skills folder, or start with none?
  - Does Kyle use Copilot CLI's own login or a `GH_TOKEN`?
  - Keep Gemini CLI support at all, given the move to Antigravity?
- **L18 project profiles**
  - Approve `@env-spec/parser` as a server dependency?
  - Should "Share profile with agents" default to on, given the prompt-token cost?
  - Offer agent notes as a one-click composer insert when MCP tools are off?
  - Should the budget day end at server-local midnight or UTC midnight?
- **L19 project lifecycle**
  - Default the clone location to upstream's `addProjectBaseDirectory` when it is set?
  - Add a Repositories icon to the sidebar footer (needs a packet seam)?
  - Offer Park in the project context menu (a seam in a busy upstream file)?
  - Should ignored files classified Keep only need acknowledgement, or block parking?
- **L20 small extras**
  - Branch prefix default: empty (`t3code`), `kyle` or `loom`?
  - Should PR checkout branches use the prefix too (two more seams)?
  - Which tools belong in the CLI catalog beyond the proposed list?
- **L21 skill registry**
  - Install Claude skills to the shared `~/.claude/skills` or the selected account's folder?
  - Should the Lab offer `~/.agents/skills` as a cross-provider target?
  - Should impeccable and ponytail be the first suggested sources?
- **L22 instruction modes**
  - Confirm L22 is wanted (it came from the repository review)?
  - Send the mode block every turn, or only when the set changes?
  - Should built-in packs be editable, or fixed with "Duplicate to edit"?
  - Keep a per-environment pack library, or store packs in files Kyle syncs himself?
- **L23 3D model preview**
  - Approve `three` and `@types/three` as new web dependencies?
  - Approve `occt-import-js` for STEP in phase 4, or leave STEP to the Fabrication app?
  - Default the build plate grid to 256 by 256 mm, or match Kyle's printer?
- **L24 PCB preview**
  - Is automatic tool detection enough, or allow custom tool paths per environment?
  - Should the Electronics app spec add an open-by-path page for deep links?
  - Add a "Send summary to chat" button (needs `ext-composer`)?
- **L25 inbound triggers**
  - Confirm L25 is wanted, and whether to design phase 3 webhooks further now?
  - Should triggered worktree threads run the project's setup script?
  - Keep the default poll interval at 5 minutes, or go faster?
  - Count mentions in repositories that are not Loom projects, or only the project's own?
  - Add an OS notification for background events, or is the in-app toast enough?
- **L26 code graph**
  - Confirm L26 is wanted (it came from the repository review)?
  - Should the agent code-graph tool default to on or off?
  - Pin Graphify to exactly 0.9.67, or accept newer versions?
  - Should auto-update also run on project open when the graph is stale?
- **L27 utilities**
  - Add any tools beyond the 26, such as a BIP39 mnemonic generator?
- **L28 auto-resume**
  - Should auto-resume default to on or off?
  - When switching accounts, pick the one with the most headroom, or a fixed order?
  - Skip Codex workspace credit or spend-limit stops unless a window with a reset time is exhausted?
