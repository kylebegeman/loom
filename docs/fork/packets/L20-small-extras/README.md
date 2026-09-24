# L20: Small extras

Status: Not started. <!-- Not started | Designing | Ready | In progress | Done | Blocked: reason -->

Three small, independent conveniences, each shippable on its own:

1. **Worktree branch prefix.** New worktree threads end up on branches named
   `<your prefix>/<generated-name>` (for example `kyle/fix-login-redirect`) instead of
   upstream's fixed `t3code/...`. Set per environment in Loom settings.
2. **Containers panel.** A right panel that lists the environment's Docker or Podman
   containers (this project's compose containers first) and follows a container's logs in
   the thread's terminal drawer.
3. **CLI tools.** A Loom settings section that shows which command-line tools are installed
   on the environment, their versions and paths, how each was installed, and the command to
   update it (with an optional "Check for updates").

## Scope

- In:
  - Part A (`worktree-prefix`): a validated per-environment setting; the server's
    first-turn branch rename uses it. Temporary branches keep upstream's `t3code/<hex>` form
    for the few seconds before the rename.
  - Part B (`containers`): container list with state, image, compose project and service,
    ports; "This project" and "All" filters; refresh; "Follow logs" opens a terminal tab
    running `<runtime> logs --follow --tail 200 <id>`; runtime choice (auto, Docker, Podman).
  - Part C (`cli-tools`): a fixed catalog of about twenty tools plus user-added
    executables; version, path, install manager, update command (copy only); "Check for
    updates" through `brew outdated` and `npm outdated -g`.
- Out:
  - Prefixing temporary branches, PR checkout branches (`t3code/pr-<n>/...`), per-project
    prefixes, and renaming existing branches.
  - Starting, stopping, restarting or removing containers; exec into containers; compose
    up/down; Kubernetes; Apple's `container` CLI.
  - Installing or updating tools from Loom; provider CLIs (Codex, Claude, Cursor, Grok,
    OpenCode, Antigravity), which upstream's Providers settings already cover with versions
    and one-click updates.
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: not supported (phone runs upstream's app); part A still
applies to worktree threads started from mobile on a Loom server, because the rename happens
on the server. Remote: everything runs on the thread's or the selected settings scope's
environment, over the fork RPC and upstream's terminal RPC.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (fork RPC group, `ForkLayer` service, persistence, capability `small-extras`).
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings) (one section, `small-extras`, with a block per shipped part).
- [`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels) (part B, panel `small-extras:containers`).

Created as specified in EXTENSION-POINTS.md when missing, one commit each.

## Packet seams

- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` (part A only): one import
  and one wrapped call where the generated branch name is built.

Details in [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L06 (source control cockpit) is present, nothing changes; it reads branch names from
  git and shows whatever prefix they carry.
- If L11 (browser dev tools) ships its own Docker view later, part B's panel can be retired
  in favor of it; they share no code.

## Size estimate

Small to medium overall, about 1.3k lines with tests. Part A ~200, part B ~450, part C ~550,
shared settings plumbing ~150.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then
this folder. Implement the shared plumbing (IMPLEMENTATION.md step 2) with the first part
you build, then each part in any order. A part is done on its own; set the Status to
"In progress (A done)" and so on.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
