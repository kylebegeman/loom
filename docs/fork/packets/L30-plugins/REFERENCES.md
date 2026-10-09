# L30 references

## Old Loom

None. Old Loom had no plugin system; this packet comes from Kyle's 2026-10-09 request to make
the packet structure a reusable plugin feature.

## Loom

- [EXTENSION-POINTS.md](../EXTENSION-POINTS.md): the registries this packet derives from one
  plugin list. Sections 1 to 10 and CLI commands exist in code.
- Current fork registries: `apps/server/src/fork/ForkLayer.ts`, `ForkRuntime.ts`, `rpc.ts`,
  `rpcAuthorization.ts`, `features.ts`, `persistence/migrations.ts`;
  `mcp/index.ts`, `cli/index.ts`; `packages/contracts/src/fork/rpc.ts`, `keybindings.ts`;
  `apps/web/src/fork/ForkRoot.tsx`, `panels/registry.ts`, `commandPalette/registry.ts`,
  `settings/registry.ts`.

## Upstream T3 Code

Checked on 2026-10-09. None of these is merged or agreed by maintainers.

- [#13819](https://github.com/pingdotgg/t3code/pull/13819), extension SDK and runtime
  packages: closed on 2026-10-02 by its author as too large to review and not replacing any
  native panel.
- [Discussion #14938](https://github.com/pingdotgg/t3code/discussions/14938): the proposed
  smaller direction, an internal panel registry piloted by moving Diff. If upstream adopts it,
  Loom's `ext-panels` seams may shrink; the plugin contract is unaffected.
- [#16047](https://github.com/pingdotgg/t3code/pull/16047), trusted local plugins in
  supervised child processes, and its stack: settings and secrets
  ([#16050](https://github.com/pingdotgg/t3code/pull/16050)), run events
  ([#16048](https://github.com/pingdotgg/t3code/pull/16048)), Settings management
  ([#16055](https://github.com/pingdotgg/t3code/pull/16055)), thread statuses
  ([#16061](https://github.com/pingdotgg/t3code/pull/16061)), approval answers
  ([#16064](https://github.com/pingdotgg/t3code/pull/16064)) and examples
  ([#16065](https://github.com/pingdotgg/t3code/pull/16065)). Changes requested or unreviewed.
  Its manifest (`packages/contracts/src/plugin.ts` in that PR) has `id` (owner-qualified,
  such as `acme.notifier`), `name`, `version`, `description`, `apiVersion`, `entry`,
  `capabilities` and `proposedApi`. Its server code lives in `apps/server/src/plugins/`, its
  RPCs are `plugins.*` and its table is `plugin_installations`. Loom's names
  (`apps/server/src/fork/plugins/`, `loom.plugins.*`, `fork_plugins_state`) do not collide.
- Ideas [#6714](https://github.com/pingdotgg/t3code/discussions/6714) and
  [#6837](https://github.com/pingdotgg/t3code/discussions/6837): the user requests behind
  that stack.

## External

- Effect RPC: `RpcGroup.merge` (variadic, overwrites duplicate tags silently, hence the
  invariant test) and `RpcSchema.isStreamSchema`, in
  `node_modules/.pnpm/effect@4.0.0-rc.115*/node_modules/effect/src/unstable/rpc/`.
