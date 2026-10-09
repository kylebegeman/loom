# L30 testing

Not started. This lists what implementation must prove; results replace it as steps land.

## Automated tests

All fork tests live in `fork/` directories, so `scripts/fork/loom.sh check` picks them up.

| File                                                       | Proves                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/plugins.test.ts`              | Plugin ids are unique kebab-case slugs that do not collide with `core` or `plugins`. Every RPC tag starts with `loom.<id>.`, appears in `ForkRpcGroup`, and every streaming method is declared in exactly one stream tag list. Commands start with `loom.<id>.`.                                                                                                                             |
| `packages/contracts/src/fork/pluginTypes.test.ts`          | A fixture plugin defined in the test, run through the same derivations, yields a group whose tags, payloads and stream kinds type-check as expected (`expectTypeOf`). Guards the one type assertion in the fold.                                                                                                                                                                             |
| `apps/server/src/fork/plugins.test.ts`                     | Server plugins match `LOOM_PLUGINS` one to one for every `server: true` manifest, and none exist for client-only ones. Every RPC tag has exactly one scope and one handler. Migration ids start at 1 and increase.                                                                                                                                                                           |
| `apps/server/src/fork/plugins/LoomPluginRegistry.test.ts`  | Defaults apply without a row; a switch persists across a rebuilt layer; unknown ids are refused; rows for ids missing from the build survive. Turning off interrupts `run` (awaited through a `Deferred` and the fiber's exit, never a sleep); turning on starts it again; a failing `run` yields `failed` with a bounded reason. The stream emits the snapshot first and after each change. |
| `apps/server/src/fork/rpcAuthorization.test.ts` (extended) | A disabled plugin's method fails with `LoomPluginDisabledError`; core and `loom.plugins.*` methods never do; the scope check still runs first.                                                                                                                                                                                                                                               |
| `apps/server/src/fork/mcp/registration.test.ts` (extended) | A disabled plugin's tool call fails with a turned-off tool error and succeeds again once the plugin is on; tools of other plugins are unaffected.                                                                                                                                                                                                                                            |
| `packages/client-runtime/src/fork/plugins.test.ts`         | `isLoomPluginActive` for each case: upstream server with client-only and server plugins, loading, error, on, off, failed, and a server that does not advertise a server plugin's id.                                                                                                                                                                                                         |
| `apps/web/src/fork/plugins.test.ts`                        | Web plugins are a subset of `LOOM_PLUGINS`; panel ids start with their plugin id; palette values start with `action:loom:<id>:`; root component ids are unique. Keeps the launcher-letter checks from `panels/registry.test.ts`.                                                                                                                                                             |

No tests that render components to assert markup.

## Commands

```sh
vp test run packages/contracts/src/fork apps/server/src/fork packages/client-runtime/src/fork apps/web/src/fork
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp lint <changed files>
scripts/fork/loom.sh check
```

## Manual check

With Kyle's permission, one pass in a real web client against a worktree dev server seeded
with a copy of real data (AGENTS.md, "Test data"), using a temporary local plugin that has a
panel, a palette item and background work:

- Turn it off in one tab; a second tab hides the panel and palette item without reloading.
  An open panel tab shows the turned-off message and its link.
- Turn it on; both tabs restore it, and the background work runs again.
- Point the client at an upstream server: the Plugins section shows the unsupported state.

The temporary plugin is not committed.

## Merge safety

Merge preview against the newest nightly during implementation, and
`scripts/fork/loom.sh integrate nightly --dry-run` after Kyle merges to `main`.
