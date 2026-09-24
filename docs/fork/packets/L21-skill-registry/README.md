# L21: Skill registry and creation lab

Status: Not started.

One place to see every agent skill on an environment: which providers and accounts can use
it, where it lives on disk, whether it is shared through a symlink, whether it is on or off,
and where it came from. From the same place, turn skills on or off for a project (where the
provider allows it), install skills from a git repository without running anyone's
installer, update or remove what Loom installed, and create a new skill: scaffold its
`SKILL.md`, edit it, and try it in a new thread.

## Scope

- In:
  - A **Skills** right panel with three tabs: **Skills** (inventory for the thread's project
    and the environment), **Sources** (git repositories Loom installed from, with updates),
    **Lab** (create, edit, validate, test).
  - Inventory from two sources merged by real path: what each provider instance reports
    (`ServerProvider.skills` and the per-project snapshot), and a bounded scan of known skill
    folders with symlink resolution, so shared folders (Kyle's
    `~/.claude_N/skills -> ~/.claude/skills`) show once with every account that sees them.
  - Enable and disable: Claude per project (`<project>/.claude/settings.local.json`
    `skillOverrides`) or per account (`<config dir>/settings.json`); Codex per Codex home
    (`skills/config/write`). Other providers are read-only here.
  - Install from an `https` git URL: shallow clone into Loom's state folder, list the
    `SKILL.md` folders found, copy chosen skills into a chosen target folder, record the
    source and commit. Update (fetch, show what changed, replace) and remove (move into
    Loom's trash folder) only for skills Loom installed.
  - Creation lab: scaffold a skill from a form, edit `SKILL.md` in the panel with validation,
    and "Test in new thread" (refresh the provider, open a new thread in the chosen project
    with `$name` and a sample prompt in the composer).
- Out:
  - Running third-party installers (`npx impeccable install`, plugin marketplaces, setup
    scripts) or anything that rewrites `~/.claude` or `~/.codex` beyond the files named above.
  - Installing plugins or marketplaces (Codex `plugin/*`, Claude `/plugin`).
  - Skill syncing between environments. Each environment has its own inventory.
  - Evaluation harnesses (scored runs, benchmarks) for skills; the lab's test is a normal
    thread.
  - Editing skill files other than `SKILL.md` (scripts, references) inside the panel.
  - Mobile UI.

## Surfaces

- Web and desktop: supported. The panel opens from the right panel launcher, the command
  palette and an optional keybinding.
- Mobile: not supported; skills still work in threads from the upstream app.
- Remote: supported; all file work happens on the environment.
- Upstream T3 server: the panel's launcher entry is disabled with "Needs a Loom server".

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core): RPC group `loom.skill-registry.*`, service, storage, capability
  `skill-registry`.
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels): the Skills panel (launcher letter K).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): "Open skills", "Install skills from git", "Create a skill".
- [`ext-keybindings`](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings): command `loom.skill-registry.toggle`, unbound by default.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L16 is present, its Codex tools page also toggles Codex skills; both call Codex's
  `skills/config/write`, so they agree. Nothing is required from L16.
- If L22 is present, nothing changes: instruction modes are not skills.

## Size estimate

Large: about 3,000 to 3,800 lines including tests. Server inventory and scanner 700, git
source and installs 700, Claude settings and Codex toggles 300, lab file IO and validation
300, RPC and storage 300; web panel 1,200; tests 700.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
folder: PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING, REFERENCES. Work against scratch
skill folders under the worktree's `.t3/`, not Kyle's real `~/.claude*` and `~/.codex*`.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
