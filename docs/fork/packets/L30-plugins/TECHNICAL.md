# L30 technical design

Drafted against Loom `841d91c11d` on 2026-10-09, then refreshed the same day against `main`
at `be3bf78d94` for the registries and extension points that now exist (`ext-settings`,
`ext-mcp`, `ext-cli`) and the features registered in them. Sketches show shape and naming;
the implementing agent settles exact generics against the compiler, keeping the invariants
listed under each layer.

## Overview

A plugin is one feature, identified by its packet slug. It has up to three definitions, one
per runtime layer, because the layers are separate programs that cannot import each other:

```
packages/contracts/src/fork/<slug>.ts       manifest + RPC group + keybinding commands  (shared)
apps/server/src/fork/<slug>/plugin.ts       services, migrations, handlers, scopes, routes, run
apps/web/src/fork/<slug>/plugin.ts(x)       panels, palette, root components, settings section
```

Each layer has one registry file listing its plugins, one line per plugin. Every existing fork
registry becomes a value derived from that list. The contracts list, `LOOM_PLUGINS`, is the
master list: it names every plugin in the build, including client-only ones, and the server
and web lists must match it.

```
LOOM_PLUGINS (contracts) ─┬─> ForkRpcGroup, FORK_KEYBINDING_COMMANDS, stream tag types
                          ├─> FORK_SERVER_PLUGINS (server) ─> ForkServicesLive, ForkServices,
                          │      FORK_MIGRATION_SETS, FORK_RPC_REQUIRED_SCOPES, handlers,
                          │      ForkRoutesLayer, FORK_MCP_TOOLKITS, FORK_CLI_COMMANDS,
                          │      LOOM_SERVER_FEATURES, background work
                          └─> FORK_WEB_PLUGINS (web) ─> FORK_PANELS, palette sources,
                                 FORK_ROOT_COMPONENTS, FORK_SETTINGS_SECTIONS
```

On top of the static lists sits one dynamic piece: per-environment enablement. The server owns
it, persists it, streams it, enforces it on its own methods and background work, and clients
hide the contributions of inactive plugins.

No upstream file changes for any of this. The upstream seams of `ext-core`, `ext-web-root`,
`ext-panels`, `ext-palette`, `ext-keybindings`, `ext-settings`, `ext-mcp` and `ext-cli`
already point at fork-owned registries, and those registries keep their exported names and
types.

## Contracts

### `packages/contracts/src/fork/plugin.ts`

```ts
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

export interface LoomPluginManifest {
  /** The packet slug: the `loomFeatures` entry and the `<slug>` in every wire name. */
  readonly id: string;
  readonly name: string;
  /** One sentence, shown in Settings. */
  readonly description: string;
  /** False for client-only plugins (L05, L27): usable on servers without Loom. */
  readonly server: boolean;
  /** Defaults to true. */
  readonly defaultEnabled?: boolean;
}

export interface LoomContractPlugin<R extends Rpc.Any = never> {
  readonly manifest: LoomPluginManifest;
  readonly rpc?: RpcGroup.RpcGroup<R>;
  /** `loom.<slug>.<action>` commands, joined into STATIC_KEYBINDING_COMMANDS. */
  readonly keybindingCommands?: ReadonlyArray<`loom.${string}`>;
  /** Streaming tags, by kind, for the client's stream unions. */
  readonly subscriptionTags?: ReadonlyArray<string>;
  readonly streamCommandTags?: ReadonlyArray<string>;
}

/** Identity function that keeps literal types; every plugin is declared through it. */
export const defineLoomPlugin = <const P extends LoomContractPlugin<any>>(plugin: P): P => plugin;
```

`loomRpc(tag, options)` in the same file wraps `Rpc.make` and adds
`EnvironmentAuthorizationError` and `LoomPluginDisabledError` to the error union, so every
plugin method can report that its plugin is off. `LoomPluginDisabledError` is a fork tagged
error with the plugin id and a message.

The manifest maps onto upstream's proposed manifest (`id`, `name`, `description`, `version`,
capabilities) as `id: "loom.<slug>"`, with the version taken from the Loom build. Nothing
depends on that mapping yet; it only constrains the field names.

### `packages/contracts/src/fork/plugins.ts`

```ts
/** Every Loom plugin in this build, one line each. Order is the Settings order. */
export const LOOM_PLUGINS = [
  // snippetsPlugin,
] as const;
```

### Derivations in `fork/rpc.ts` and `fork/keybindings.ts`

- `ForkRpcGroup` is the core group (`loom.core.info` plus the two `loom.plugins.*` methods
  below) merged with every plugin's `rpc`. The runtime value is a fold over `LOOM_PLUGINS`;
  its type is spelled from the union of the plugins' RPC types, because a fold cannot infer
  it. That single type assertion is covered by the invariant test that every plugin's tags
  are in `ForkRpcGroup.requests`.
- `ForkSubscriptionRpcTag` and `ForkStreamCommandRpcTag` become the union of the plugins'
  declared tags plus `loom.plugins.subscribe`. An invariant test uses
  `RpcSchema.isStreamSchema` to check that every streaming method in `ForkRpcGroup` is
  declared in exactly one of the two lists, so a missing declaration fails a test instead of
  silently typing a stream as unary.
- `FORK_KEYBINDING_COMMANDS` becomes the plugins' commands, plus any command not owned by a
  plugin (today the archived L04 commands, kept so saved keybindings stay valid).
  `ForkKeybindingCommand` stays a literal union.

### Plugin methods

| Tag                       | Kind                  | Payload                         | Success               | Scope                   |
| ------------------------- | --------------------- | ------------------------------- | --------------------- | ----------------------- |
| `loom.plugins.subscribe`  | stream (subscription) | `{}`                            | `LoomPluginsSnapshot` | `orchestration:read`    |
| `loom.plugins.setEnabled` | unary                 | `{ id: string, enabled: bool }` | `LoomPluginsSnapshot` | `orchestration:operate` |

`LoomPluginsSnapshot` is
`{ plugins: Array<{ id, enabled, state: "on" | "off" | "failed", reason?: string }> }`: one
entry per plugin in the server's build. The stream emits the snapshot first and again after
every change. `setEnabled` for an id the server does not know fails with a typed
`LoomPluginUnknownError`. `orchestration:operate` matches upstream's
`server.updateSettings`; if upstream has split write permissions by the time this is built,
use the one settings writes use.

## Server

### `apps/server/src/fork/plugin.ts`

```ts
export interface ForkServerPlugin<S = never> {
  /** The same object as the contract plugin's manifest. */
  readonly manifest: LoomPluginManifest;
  /** Services. Built at startup whether or not the plugin is on, so construction stays cheap. */
  readonly layer?: Layer.Layer<S, never, ForkHostServices>;
  readonly migrations?: ForkMigrationSet["migrations"];
  /** One scope per RPC tag of the plugin's group. */
  readonly scopes?: Readonly<Record<string, AuthEnvironmentScope>>;
  /** Handlers typed against the plugin's own group. */
  readonly rpcHandlers?: (auth: ForkRpcAuth) => Effect.Effect<object, never, S>;
  /** HTTP routes under /api/loom/<slug>/. */
  readonly routes?: Layer.Layer<never, never, never>;
  /** Agent tools, registered through McpHttpServer like today's FORK_MCP_TOOLKITS entries. */
  readonly mcpToolkits?: ReadonlyArray<ForkMcpToolkit>;
  /** `t3 <command>` subcommands that call this plugin's tools. */
  readonly cliCommands?: ReadonlyArray<ForkCliCommand>;
  /** Background work. Runs only while the plugin is on; interrupted when it is turned off. */
  readonly run?: Effect.Effect<void, unknown, Scope.Scope | S>;
}
```

`ForkHostServices` names the upstream services available at the head of
`RuntimeCoreDependenciesLive`, as listed in EXTENSION-POINTS.md, "What ForkLayer can use".

`apps/server/src/fork/plugins.ts` holds `FORK_SERVER_PLUGINS`, one line per plugin with a
server half. Derived values, all in fork-owned files:

| Today (hand-edited)                     | After                                                                 |
| --------------------------------------- | --------------------------------------------------------------------- |
| `ForkServices` (`ForkRuntime.ts`)       | union of the plugins' layer outputs, plus `LoomPluginRegistry`        |
| `ForkServicesLive` (`ForkLayer.ts`)     | `LoomPluginRegistry` layer merged with every plugin `layer`           |
| `FORK_MIGRATION_SETS` (`migrations.ts`) | the `plugins` set first, then each plugin's migrations under its id   |
| `FORK_RPC_REQUIRED_SCOPES`              | core scopes merged with every plugin's `scopes`                       |
| handler spread in `makeForkRpcLayer`    | core handlers merged with every plugin's `rpcHandlers(auth)`          |
| `ForkRoutesLayer` (`ForkLayer.ts`)      | every plugin's `routes`                                               |
| `FORK_MCP_TOOLKITS` (`mcp/index.ts`)    | every plugin's `mcpToolkits`, handlers wrapped with the enabled check |
| `FORK_CLI_COMMANDS` (`cli/index.ts`)    | every plugin's `cliCommands`                                          |
| `LOOM_SERVER_FEATURES` (`features.ts`)  | `["core", "plugins", ...ids of server plugins]`                       |

Exhaustiveness the compiler gave for free (`satisfies Record<ForkRpcMethod, ...>`,
`ForkRpcGroup.of({...})`) moves into invariant tests: every tag has exactly one scope and
exactly one handler.

### `LoomPluginRegistry` (`apps/server/src/fork/plugins/LoomPluginRegistry.ts`)

A `Context.Service` built in `ForkLayer`:

- Reads the stored switches from `fork_plugins_state`. A plugin without a row uses its
  manifest default. Rows for ids missing from this build are kept, so a plugin that returns
  in a later build gets its old switch back.
- Holds the current snapshot in a `SubscriptionRef`; `changes` streams it.
- `setEnabled(id, enabled)` writes the row, then starts or stops the plugin's work, then
  publishes. Concurrent calls for one plugin are serialized.
- `isEnabled(id)` is a synchronous read of the current snapshot for the RPC guard.
- Background work: at startup, inside `forkParked`, each enabled plugin's `run` is forked
  into its own closeable scope. Turning a plugin off closes that scope. Turning it on forks a
  new one. If `run` fails, the plugin's state becomes `failed` with a bounded reason (1000
  characters) and is not retried until the user turns it off and on.

### Enforcement

`makeForkRpcAuth` gains one check after the scope check: the tag's owning plugin, looked up
from a tag-to-id map built once from `LOOM_PLUGINS`, must be enabled, otherwise the call fails
with `LoomPluginDisabledError`. Core and `loom.plugins.*` methods are never disabled. Plugin
routes check the same through a helper, answering 404.

`McpHttpServer` builds its toolkits once, as layers, when the server starts, so a disabled
plugin's tools cannot disappear from the tool list live. Instead the derived
`FORK_MCP_TOOLKITS` wraps each plugin handler with the same enabled check, and a call fails
with a tool error naming the plugin as turned off. CLI commands go through those tools
(`callForkTool`), so they fail the same way with no extra check.

## Storage

```sql
CREATE TABLE fork_plugins_state (
  plugin_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

Migration set `plugins`, id 1, tracked in `fork_migrations_plugins`. No files under
`<stateDir>/fork/plugins/`. Nothing to clean up: the table holds at most one row per plugin
ever built.

## Clients

### `packages/client-runtime/src/fork/plugins.ts`

- `loomPluginsAtomFamily`: per environment, subscribes to `loom.plugins.subscribe` when the
  environment advertises `plugins`, built with `createEnvironmentRpcSubscriptionAtomFamily`.
  Value: `loading | unsupported | ready(snapshot) | error`.
- `isLoomPluginActive(manifest, capabilities, state)`, pure:
  - Environment without `plugins`: active only if `manifest.server` is false.
  - `ready`: the snapshot entry is on (not off and not failed), and for a server plugin the
    environment also advertises its id.
  - `loading` or `error`: inactive. This avoids showing something that disappears a moment
    later; the snapshot is small and arrives with the connection.
- Mobile can reuse both when it gets fork UI.

### Web: `apps/web/src/fork/plugin.ts` and `plugins.ts`

```ts
export interface ForkWebPlugin {
  readonly manifest: LoomPluginManifest;
  readonly panels?: ReadonlyArray<ForkPanelDefinition>;
  readonly palette?: ForkCommandPaletteSource["items"];
  readonly rootComponents?: ReadonlyArray<{
    readonly id: string;
    readonly Component: ComponentType;
  }>;
  /** Section on the Loom settings page, titled with the manifest name. */
  readonly settings?: ComponentType;
}
```

`FORK_WEB_PLUGINS` lists one entry per plugin with a web half. Derived:

- `FORK_PANELS`, `findForkPanel`, `forkPanelSurface` keep their names. Each panel records its
  plugin id. The launcher and "+" menu hide panels of inactive plugins.
  `ForkPanelHost` shows "Turned off for this environment" with a link to the Plugins
  section for an inactive plugin, and keeps its current message for a panel missing from the
  build.
- `FORK_COMMAND_PALETTE_SOURCES` derives from the plugins' `palette`, with each source's id
  taken from the manifest, and drops sources of inactive plugins.
- `FORK_ROOT_COMPONENTS` keeps `shortcuts` (core) and mounts each active plugin's root
  components. Unmounting removes their command listeners, so a disabled plugin's shortcuts
  fall through to upstream handling instead of doing nothing.
- `LoomSettingsPage` renders the Plugins section first, then each active plugin's
  `settings`.

Which environment decides activity:

- Thread-scoped contributions (panels, palette items about the active thread) use that
  thread's environment.
- Global contributions (root components, settings sections, palette items with no thread) use
  the primary environment.
- The Plugins section uses the settings scope selector, like other environment settings
  (`useScopedSettings` context).

`supportsLoomFeature` stays for code that needs a single feature check, but packets no longer
gate their own entry points on their slug: the host does it.

## Agent-facing tools

None of its own. Plugin tools are covered by the enabled check above. Hiding a disabled
plugin's tools from listings would need per-session toolkit registration upstream; that is
not worth a seam.

## Performance

- One subscription per environment, opened only on environments that advertise `plugins`.
  The snapshot is one small entry per plugin and is sent only on change.
- Registries are derived once at module load. Per-render work is a filter over a list of a few
  dozen entries, and the active set is memoized per environment.
- No timers, polling or animation.

## Alternatives considered

- **A workspace package per plugin (`plugins/<slug>/`).** This was the first recommendation.
  It fails on module resolution, verified on 2026-10-09:
  - Vite resolves `~` imports with `resolve.tsconfigPaths` (`apps/web/vite.config.ts:221`),
    which uses the tsconfig that owns the importing file. A file under `plugins/` has no such
    tsconfig, because there is no root `tsconfig.json`, only `tsconfig.base.json`. So plugin
    web code cannot import the web app's components and stores.
  - Server services are internal modules of `apps/server` (package `t3`, no `exports`).
    Reaching them means relative paths across packages or an upstream `package.json` seam.
  - pnpm resolves third-party imports from the importing file's location, so a plugin's
    dependencies would have to live in its own `package.json`, and each host app would need
    an upstream `package.json` seam to depend on it. A host app depending on plugins that
    import the host's own files is also a circular dependency.

  Portability therefore needs a deliberate host API first (PRODUCT.md, later phase 1).

- **Keep the hand-edited registries and only add a settings switch.** This gives the switch
  but not the unit: each feature would still be spread over a dozen lists, and every new
  extension point would add another.
- **Enablement stored on the client.** Disabling would then not stop server work, agent tools
  or other clients, so it would not be a real off switch.
- **Apply switches after a server restart.** Simpler, but a toggle that silently waits for a
  restart is a stale state the user cannot see. Live start and stop of `run` is a small, local
  piece of code.
- **Adopt upstream's plugin host now.** It runs plugin code in child processes with no UI
  contributions, and is not accepted upstream (REFERENCES.md). Building Loom features on an
  unmerged design is what the planning policy rules out.
