# L20: Small extras

Status: Ready to build. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

Three small, independent conveniences, each shippable on its own. Parts keep their original
letters.

1. **No AI identification (D).** A per-project switch for work repositories: branches are
   named by change type (`feature/`, `fix/`, `hotfix/`, `chore/`, `docs/`, `refactor/`),
   every agent is told to leave AI out of commits, pull requests, comments and authorship,
   Claude's own attribution is turned off for the session, and new commits are checked after
   each turn with a copyable fix command when something slips through. Loom never rewrites
   history itself.
2. **Containers panel (B).** A right panel that lists the environment's Docker or Podman
   containers (this project's compose containers first) and follows a container's logs in
   the thread's terminal drawer.
3. **CLI tools (C).** A Loom settings section that shows which command-line tools are
   installed on the environment, their versions and paths, how each was installed, and the
   command to update it (with an optional "Check for updates").

## Retired parts

Kyle approved on 2026-10-09 retiring **part A, worktree branch prefix** (a per-environment
`loom/` branch prefix), because upstream T3 Code (Orchestrator V2, now in Loom nightly) has
a branch prefix setting per project. Its setting, schema and settings block are removed from
this folder. Part D keeps the branch namer and first-turn rename seam it shared with part A;
in private projects its change-type names replace upstream's project prefix.

## Scope

- In:
  - Part D (`private-mode`): per-project switch in a fork table, reachable from Loom
    settings, the command palette and (when L18 is present) the project profile;
    change-type branch names by keyword rules; an `ext-turn-input` instruction
    (order 5) for every provider; Claude Code `attribution` emptied through the Agent SDK
    `settings` (one packet seam); a post-turn commit check with a timeline row, a web toast
    with a copyable fix command, "Rename branch" for a leftover temporary branch, and an
    on-demand palette check; a Codex verification step.
  - Part B (`containers`): container list with state, image, compose project and service,
    ports; "This project" and "All" filters; refresh; "Follow logs" opens a terminal tab
    running `<runtime> logs --follow --tail 200 <id>`; runtime choice (auto, Docker, Podman).
  - Part C (`cli-tools`): a fixed catalog of about forty tools (including argent,
    xcbeautify, impeccable, blender, openscad, kicad-cli, ollama, lms, swiftlint,
    cloudflared, wrangler, rustc, cargo, go and mas) plus user-added executables; version,
    path, install manager, update command (copy only); "Check for updates" through
    `brew outdated` and `npm outdated -g`.
- Out:
  - A fork worktree branch prefix: retired, see above.
  - Follow-up: a Codex-side attribution switch, only if the verification step shows Codex
    adds its trailer despite the instruction.
  - Follow-up: scanning pull request bodies and code comments for AI markers.
  - Rewriting commits automatically; writing settings files or hooks into work repositories.
  - Starting, stopping, restarting or removing containers; exec into containers; compose
    up/down; Kubernetes; Apple's `container` CLI.
  - Installing or updating tools from Loom; provider CLIs (Codex, Claude, Cursor, Grok,
    OpenCode, Antigravity), which upstream's Providers settings already cover with versions
    and one-click updates.
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: no UI; part D runs on the server, so private branch
naming, the private mode instruction, Claude's attribution setting and the commit check apply
to threads started or messaged from mobile on a Loom server, and mobile sees the warning rows
in the timeline. Remote: everything runs on the thread's or the selected settings scope's
environment, over the fork RPC and upstream's terminal RPC.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group with one subscription, `ForkLayer` service, reactors, persistence, capability `small-extras`).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (one section, `small-extras`, with a block per shipped part).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (part B, panel `small-extras:containers`).
- [`ext-turn-input`](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input) (part D, contributor `small-extras-private-mode`, order 5, block `<loom_private_mode>`).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette) (part D, toggle and check).
- [`ext-web-root`](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (part D, the warning toast host).

Created as specified in EXTENSION-POINTS.md when missing, one commit each.

## Packet seams

- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` (part D): one import and
  one wrapped statement where the generated branch name is built. V2 removed this file; the
  seam's new location comes from released source.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` (part D): one import and one spread at
  the start of the Agent SDK `settings` object.

Details in [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L18 (project profiles) is present, its profile shows part D's switch through
  `PROFILE_SECTION_ROWS`; whichever packet lands second adds the registration line.
- If L22 (instruction modes) is present, its block follows the private mode block (order 10
  after 5); neither depends on the other.
- If L06 (source control cockpit) is present, nothing changes; it reads branch names from
  git.
- L11 (browser dev tools) covers Docker Compose stacks for dev; part B's panel lists every
  container and follows logs. They share no code.

## Size estimate

Medium overall, about 2.5k lines with tests. Part D ~1,300 (server 750, web 250, tests
300, including the branch namer), part B ~450, part C ~600, shared settings plumbing ~150.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder. Implement the shared plumbing (IMPLEMENTATION.md step 2) with the first part
you build, then each part in any order. A part is done on its own; set the Status to
"In progress (D done)" and so on.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
