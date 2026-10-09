# L30 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling and its tests passing, so the
work can stop after any step.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md (sections
1, 2, 5 to 10 and CLI commands) and this folder.

This plan was written on 2026-10-09 and the packet then parked. Follow
[README.md, Revisiting](./README.md#revisiting) first. Step 7 converts every feature
registered on `main` when work starts, which may be more than were listed that day.

Work in a new worktree from committed `main`.

Check the source against the citations in TECHNICAL.md. If upstream has changed RPC
authorization (for example split write permissions), adapt the scope choice and note it in
TECHNICAL.md. If Orchestrator V2 has landed, nothing here depends on it; continue.

## Steps

1. **Check the extension points.** Run `scripts/fork/loom.sh check`. `ext-settings`,
   `ext-mcp` and `ext-cli` already exist; if any extension point this packet derives into
   is missing, stop and reassess instead of creating it here.
2. **Contracts.** Add `fork/plugin.ts` (manifest, `defineLoomPlugin`, `loomRpc`,
   `LoomPluginDisabledError`, `LoomPluginUnknownError`) and `fork/plugins.ts`
   (`LOOM_PLUGINS`, empty). Add the `loom.plugins.subscribe` and `loom.plugins.setEnabled`
   methods and the snapshot schema. Derive `ForkRpcGroup`, the stream tag types and
   `FORK_KEYBINDING_COMMANDS` from `LOOM_PLUGINS`. Export from `fork/index.ts`. Add the
   contracts invariant tests and the typed fixture (TESTING.md).
3. **Server registry.** Add `fork/plugin.ts`, `fork/plugins.ts` (`FORK_SERVER_PLUGINS`,
   empty) and derive `ForkServices`, `ForkServicesLive`, `FORK_MIGRATION_SETS`,
   `FORK_RPC_REQUIRED_SCOPES`, the handler object, `ForkRoutesLayer`, `FORK_MCP_TOOLKITS`,
   `FORK_CLI_COMMANDS` and `LOOM_SERVER_FEATURES` from it, keeping existing entries alongside
   the empty plugin list until step 7. Add the server invariant tests.
4. **Enablement on the server.** Add the `plugins` migration set, `LoomPluginRegistry`
   (switches, snapshot, background work supervision) and the two RPC handlers. Add the
   enabled check to `makeForkRpcAuth` and to the plugin MCP tool handlers. Advertise
   `plugins`. Add the service tests, using a test-only plugin whose `run` signals through a
   `Deferred`.
5. **Client runtime.** Add `fork/plugins.ts` with the per-environment atom family and
   `isLoomPluginActive`, exported from `fork/index.ts`. Test `isLoomPluginActive` over every
   state.
6. **Web registry.** Add `fork/plugin.ts` and `fork/plugins.ts` (`FORK_WEB_PLUGINS`, empty).
   Derive `FORK_PANELS`, the palette sources, `FORK_ROOT_COMPONENTS` and
   `FORK_SETTINGS_SECTIONS` from it. Filter by activity using the environment rules in
   TECHNICAL.md. Update `ForkPanelHost` for the turned-off case. Update the web invariant
   tests.
7. **Convert existing features.** One commit per feature, no behavior change: move each
   feature's entries from the hand-edited lists into its contract, server and web plugin
   definitions, until those lists hold only derived values. On 2026-10-09 that meant
   `model-preview-3d`, `pcb-preview`, `project-lifecycle`, `apple-build-tooling`,
   `device-qa`, `file-outline`, `switchboard` and `codex-login-email`; recheck the lists when
   work starts. The archived thread inspector stays unregistered (PRODUCT.md, open question).
8. **Plugins settings section.** One row per plugin in `LOOM_PLUGINS`: name, description and
   a switch, with the loading, unsupported, error, failed and version-mismatch states from
   PRODUCT.md. Use the existing settings layout primitives and switch component; no
   restyling.
9. **Documentation for later packets.** In EXTENSION-POINTS.md, add a "Plugins" section
   before section 1 that specifies the contract, and replace each existing section's
   "Registering" text (sections 1 to 10 and CLI commands) with the plugin slot it uses.
   Add the rule that every extension point created later defines its plugin slot, and the
   `ext-mcp` and `ext-cli` rules for disabled plugins in their sections. Update
   CONVENTIONS.md ("Where fork code lives" gains the `plugin.ts` files) and the `_template`
   IMPLEMENTATION and TECHNICAL steps. Update landed packets' docs only where they name a registry list; their design
   does not change.
10. **User help.** `docs/fork/user/plugins.md`: what the Plugins section does, that switches
    are per environment, and what turning a plugin off stops.
11. **Status.** Mark L30 done in the packet index, remove it from the parked list in
    IMPLEMENT-NOW.md, and record test results in TESTING.md.

Commits: step 1 makes none; steps 2 to 6 and 8 as `feat(fork-plugins): ...` commits, each
describing what now works; step 7 as one `refactor(fork-<slug>): ...` commit per feature;
steps 9 to 11 as `docs(fork-plugins): ...`. Never commit `pnpm-lock.yaml`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Adding a plugin with a panel, a palette item, a shortcut, a settings section, an RPC method,
  an agent tool, a CLI command, a service, a migration and background work takes one line in
  each layer's `plugins.ts` and no other registry edit. The typed fixture proves the RPC is
  callable with full types.
- Every feature registered on `main` when work started is a plugin and behaves as before.
- Turning a plugin off on one client hides its contributions on every connected client of
  that environment, makes its methods fail with `LoomPluginDisabledError` and interrupts its
  background work. Turning it on reverses all three without a restart.
- A Loom client on an upstream server shows the unsupported state and keeps client-only
  plugins working; an upstream client on a Loom server is unaffected.
- `scripts/fork/loom.sh check` passes and the merge preview conflicts only on marked seams.
