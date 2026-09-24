# Loom extension points

Many packets need the same plumbing: a server RPC, a server service with storage, a right
panel, a settings section, command palette actions, keybindings, agent-facing MCP tools,
composer hooks, provider drivers, text added to provider turns. If each packet wired these
into upstream files on its own, Loom would carry dozens of overlapping seams. Instead, each
kind of plumbing has one fork-owned extension point with the smallest possible seam into
upstream. Packets register into it and touch no further upstream code.

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## How to use this file

For every extension point a packet needs:

1. Run its **existence check**. If it passes, skip to **Registering a packet**.
2. If it fails, create the extension point **exactly** as written here, in its own commit
   (`feat(fork): add the <name> extension point`), before any packet code. Copy the
   skeletons verbatim and apply the seams with the markers shown. Do not add packet code,
   extra options or "improvements" to that commit: two packets built in parallel must
   produce the same commit so the second can drop its copy.
3. If the skeleton does not compile or a cited line has moved, fix it minimally, and update
   this file in the same commit so every later packet copies the corrected version.
4. Add the extension point's seams to FORK.md ("Extension point seams" table) in the same
   commit (see [CONVENTIONS.md](./CONVENTIONS.md#updating-forkmd)).

A partially present extension point (some files or markers missing) is a bug: stop and
report it rather than guessing.

## Summary

| Extension point                                                            | Marker                      | Upstream files touched                              | Prerequisite           |
| -------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------- | ---------------------- |
| [1. Server core](#1-server-core-ext-core)                                  | `fork: ext-core`            | 8 (2 of them `package.json`, no marker)             | none                   |
| [2. Persistence](#2-persistence)                                           | none                        | 0 (part of server core)                             | ext-core               |
| [3. HTTP routes](#3-http-routes)                                           | none                        | 0 (part of server core)                             | ext-core               |
| [4. Background work and reactors](#4-background-work-and-reactors)         | none                        | 0 (part of server core)                             | ext-core               |
| [5. Web root](#5-web-root-ext-web-root)                                    | `fork: ext-web-root`        | 1                                                   | none                   |
| [6. Right panels](#6-right-panels-ext-panels)                              | `fork: ext-panels`          | 3                                                   | ext-core               |
| [7. Settings](#7-settings-ext-settings)                                    | `fork: ext-settings`        | 2, plus one route file and the generated route tree | none                   |
| [8. Command palette](#8-command-palette-ext-palette)                       | `fork: ext-palette`         | 1                                                   | ext-core               |
| [9. Keybindings](#9-keybindings-ext-keybindings)                           | `fork: ext-keybindings`     | 1                                                   | ext-web-root           |
| [10. MCP tools](#10-agent-facing-mcp-tools-ext-mcp)                        | `fork: ext-mcp`             | 1                                                   | ext-core               |
| [11. Composer](#11-composer-ext-composer)                                  | `fork: ext-composer`        | 1                                                   | none                   |
| [11b. Composer menu trigger](#11b-composer-menu-trigger-ext-composer-menu) | `fork: ext-composer-menu`   | 3                                                   | ext-composer           |
| [12. Orchestration](#12-orchestration-and-thread-behavior)                 | guidance only               | 0 by default                                        | ext-core               |
| [13. Desktop IPC](#13-desktop-ipc-ext-desktop-optional)                    | `fork: ext-desktop`         | 3 (optional)                                        | ext-core               |
| [14. Mobile settings](#14-mobile-ext-mobile-settings-optional)             | `fork: ext-mobile-settings` | 3 (optional)                                        | ext-core               |
| [15. Provider drivers](#15-provider-drivers-ext-providers)                 | `fork: ext-providers`       | 4                                                   | none                   |
| [16. Provider turn input](#16-provider-turn-input-ext-turn-input)          | `fork: ext-turn-input`      | 1                                                   | ext-core               |
| [17. Diff panel header](#17-diff-panel-header-ext-diff-header)             | `fork: ext-diff-header`     | 1                                                   | none                   |
| [18. Decisions with Jev](#18-decisions-with-jev-ext-decide)                | none                        | 0                                                   | ext-core, ext-settings |

`ext-panels` and `ext-palette` need server core only for `loomFeaturesOf` from
`@t3tools/client-runtime/fork`; a client-only packet that uses them runs the `ext-core`
existence check and creates it if missing, but registers nothing in it.

Every fork identifier follows the naming table in CONVENTIONS.md: wire names start with
`loom.`, tables with `fork_`. Spots that were proposed as shared extension points but kept as
packet seams are listed in
[Shared points considered and declined](#shared-points-considered-and-declined).

---

## 1. Server core (`ext-core`)

One creation unit covering the fork RPC group, the fork server layer, fork storage, fork HTTP
routes and the capability flag. They reference each other, so they are created together.

### Purpose

Give packets a server-side home (services with access to every upstream service), typed
WebSocket RPC methods that work on web, desktop and mobile over every connection mode, and a
capability list clients use to hide fork UI on servers that lack it.

### Current upstream mechanism

- **RPC contract.** Method names are plain constants in `WS_METHODS`
  (`packages/contracts/src/rpc.ts:272`). Each method is `Rpc.make(tag, { payload, success,
error, stream? })`, e.g. `WsServerProbeRpc` (`rpc.ts:451-455`); every error union includes
  `EnvironmentAuthorizationError`. All methods form one group,
  `export const WsRpcGroup = RpcGroup.make(...)` (`rpc.ts:1360-1501`), exported through the
  barrel (`packages/contracts/src/index.ts:45`). `packages/contracts/package.json` exports
  only `.`, `./settings` and `./relay`. Nothing merges RPC groups today, but Effect's
  `RpcGroup.merge` exists (`node_modules/.pnpm/effect@4.0.0-rc.112_*/node_modules/effect/src/unstable/rpc/RpcGroup.ts`,
  `merge` at 261-277) and silently overwrites duplicate tags.
- **Server.** `makeWsRpcLayer(currentSession, ...)` builds `WsRpcGroup.toLayer(...)` with one
  exhaustive handler object (`apps/server/src/ws.ts:494-500`, `WsRpcGroup.of({` at 1818).
  Each connection runs `RpcServer.make(WsRpcGroup, { disableTracing: true })` (`ws.ts:3717`)
  and provides `makeWsRpcLayer(session, ...)` (`ws.ts:3725-3730`) inside
  `websocketRpcRouteLayer` (`ws.ts:3661`).
- **Authorization.** `RPC_REQUIRED_SCOPES` is keyed by every tag of `WsRpcGroup` with
  `satisfies Readonly<Record<WsRpcMethod, AuthEnvironmentScope>>`
  (`apps/server/src/auth/RpcAuthorization.ts:16,23,168`), a test asserts its keys equal the
  group (`RpcAuthorization.test.ts:15`), and `requiredScopeForRpcMethod` throws for an unknown
  method (`RpcAuthorization.ts:170-179`). The check itself is a closure inside
  `makeWsRpcLayer` (`ws.ts:667-719`) comparing against `currentSession.scopes`. Scopes are
  `orchestration:read|operate`, `terminal:operate`, `review:write`, `access:read|write`,
  `relay:read|write` (`packages/contracts/src/auth.ts:81-98`). Metrics and tracing helpers
  `observeRpcEffect` / `observeRpcStream` are exported from
  `apps/server/src/observability/RpcInstrumentation.ts:89,107`.
- **Clients.** `makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup)`
  (`packages/client-runtime/src/rpc/protocol.ts:5`) serves web and mobile. Callers use the
  generic `request`, `runStream`, `subscribe*` helpers
  (`packages/client-runtime/src/rpc/client.ts:132-347`), typed by
  `EnvironmentRpcTag = keyof WsRpcProtocolClient & string` (`client.ts:39`). Streaming tags
  must be listed by hand in `EnvironmentSubscriptionRpcTag` (`client.ts:42-61`) or
  `EnvironmentStreamCommandRpcTag` (`client.ts:63-66`); everything else is treated as unary
  (`client.ts:72`). Per-domain atoms come from `createEnvironmentRpcQueryAtomFamily`,
  `createEnvironmentRpcSubscriptionAtomFamily` and `createEnvironmentRpcCommand`
  (`packages/client-runtime/src/state/runtime.ts:612,646,678`), instantiated per app, e.g.
  `apps/web/src/state/device.ts:18`. Mobile uses the same stack
  (`apps/mobile/src/connection/runtime.ts`).
- **Server layers.** `apps/server/src/server.ts` composes everything with `provideMerge`
  chains: in `A.pipe(Layer.provideMerge(B), ...)` each later layer provides everything above
  it. `RuntimeCoreDependenciesLive = ReactorLayerLive.pipe(` starts at `server.ts:482`; its
  first entry is `Layer.provideMerge(AntigravityInstallationRefreshLive)` (`server.ts:483`).
  Routes are merged in `makeRoutesLayer` (`server.ts:565-592`), ending with
  `websocketRpcRouteLayer,` (`server.ts:580`).
- **Capabilities.** `ExecutionEnvironmentCapabilities = Schema.Struct({...})`
  (`packages/contracts/src/environment.ts:78-170`) is served in the descriptor at
  `/.well-known/t3/environment` and in `ServerConfig.environment`. Unknown keys are dropped on
  decode, so old clients tolerate new keys. The server builds the literal in
  `apps/server/src/environment/ServerEnvironment.ts:215-248` (`capabilities: {` at 215).
  Clients check flags like `readEnvironmentSupportsSettlement`
  (`apps/web/src/state/entities.ts:189`). A client calling a method the server lacks gets a
  per-request defect, `Unknown request tag` (effect `unstable/rpc/RpcServer.ts:707-709`).

### Fork design

- A fork RPC group, `ForkRpcGroup`, merged with upstream's into `LoomWsRpcGroup`. The server
  serves `LoomWsRpcGroup`; the client builds its protocol client from it. Upstream's group,
  handler object, scope table and its test are untouched.
- Fork handlers live in a separate handler layer, `makeForkRpcLayer(session)`, merged next
  to `makeWsRpcLayer(...)`. It authorizes with its own exhaustive scope table.
- A fork server layer, `ForkLayer`, is merged at the head of `RuntimeCoreDependenciesLive`,
  so every fork service can use every core upstream service (SQL, orchestration engine,
  providers, Git, terminals, settings, workspace, auth; see "What ForkLayer can use").
- `ForkLayer` publishes its services' context through `ForkRuntime`, a `Context.Reference`
  with a default (the same device upstream uses for `ServerActivation`,
  `apps/server/src/serverActivation.ts:6-9`). Transport code (RPC handlers, HTTP routes, MCP
  tools) reaches fork services with `withForkRuntime(...)` and therefore adds no service
  requirement to the upstream layers hosting it. Upstream's `server.test.ts`, which builds
  `makeRoutesLayer` with mocks, keeps compiling. The rule that follows: **transport code is
  thin; all fork logic lives in fork services built in `ForkLayer`.**
- One capability key, `loomFeatures: string[]`, lists the packet slugs the server supports.

### Seams

All seam lines carry `// fork: ext-core`.

**`packages/contracts/package.json`** (no marker; first entry after `"."` so upstream's
appended exports do not touch it):

```diff
     ".": {
       "types": "./src/index.ts",
       "import": "./src/index.ts"
     },
+    "./fork": {
+      "types": "./src/fork/index.ts",
+      "import": "./src/fork/index.ts"
+    },
     "./settings": {
```

**`packages/client-runtime/package.json`** (no marker; first entry of `exports`):

```diff
   "exports": {
+    "./fork": {
+      "types": "./src/fork/index.ts",
+      "default": "./src/fork/index.ts"
+    },
     "./load-balancing": {
```

**`packages/contracts/src/environment.ts`**, first key of the struct (line 78):

```diff
 export const ExecutionEnvironmentCapabilities = Schema.Struct({
+  // fork: ext-core: Loom packet slugs this server implements. Absent on upstream servers.
+  loomFeatures: Schema.optionalKey(Schema.Array(Schema.String)), // fork: ext-core
   repositoryIdentity: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
```

**`apps/server/src/environment/ServerEnvironment.ts`**, an import after the last `./` import
(line 23) and the first key of `capabilities: {` (line 215):

```diff
 import { detectServerEnvironmentMachineKind } from "./ServerEnvironmentMachine.ts";
+import { LOOM_SERVER_FEATURES } from "../fork/features.ts"; // fork: ext-core
```

```diff
     capabilities: {
+      loomFeatures: LOOM_SERVER_FEATURES, // fork: ext-core
       repositoryIdentity: true,
```

**`apps/server/src/ws.ts`**: two imports after the `RpcAuthorization` import (line 149), the
served group (line 3717), and the fork handler layer as the first entry of the pipe after
`makeWsRpcLayer(...)` (line 3730):

```diff
 import { requiredScopeForRpcMethod } from "./auth/RpcAuthorization.ts";
+import { LoomWsRpcGroup } from "@t3tools/contracts/fork"; // fork: ext-core
+import { makeForkRpcLayer } from "./fork/rpc.ts"; // fork: ext-core
```

```diff
-          yield* RpcServer.make(WsRpcGroup, { disableTracing: true }).pipe(
+          yield* RpcServer.make(LoomWsRpcGroup, { disableTracing: true }).pipe( // fork: ext-core
```

```diff
             ).pipe(
+              Layer.merge(makeForkRpcLayer(session)), // fork: ext-core
               Layer.provideMerge(RpcSerialization.layerJson),
```

**`apps/server/src/server.ts`**: one import after the `./ws.ts` import (line 35), `ForkLayer`
as the first entry of `RuntimeCoreDependenciesLive` (line 483), and `ForkRoutesLayer` after
`websocketRpcRouteLayer,` in `makeRoutesLayer` (line 580):

```diff
 import { websocketRpcRouteLayer } from "./ws.ts";
+import { ForkLayer, ForkRoutesLayer } from "./fork/ForkLayer.ts"; // fork: ext-core
```

```diff
 const RuntimeCoreDependenciesLive = ReactorLayerLive.pipe(
+  Layer.provideMerge(ForkLayer), // fork: ext-core
   Layer.provideMerge(AntigravityInstallationRefreshLive),
```

```diff
     websocketRpcRouteLayer,
+    ForkRoutesLayer, // fork: ext-core
   ),
```

**`packages/client-runtime/src/rpc/protocol.ts`**, two lines replaced (the upstream import
would otherwise be unused):

```diff
-import { WsRpcGroup } from "@t3tools/contracts";
+import { LoomWsRpcGroup } from "@t3tools/contracts/fork"; // fork: ext-core
 import * as Effect from "effect/Effect";
 import { RpcClient } from "effect/unstable/rpc";

-export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);
+export const makeWsRpcProtocolClient = RpcClient.make(LoomWsRpcGroup); // fork: ext-core
```

**`packages/client-runtime/src/rpc/client.ts`**: one import after the contracts import
(line 1) and one leading member in each stream union (lines 41 and 63):

```diff
 import { ORCHESTRATION_WS_METHODS, WS_METHODS } from "@t3tools/contracts";
+import type { ForkStreamCommandRpcTag, ForkSubscriptionRpcTag } from "@t3tools/contracts/fork"; // fork: ext-core
```

```diff
 export type EnvironmentSubscriptionRpcTag =
+  | ForkSubscriptionRpcTag // fork: ext-core
   | typeof WS_METHODS.providerAuthSubscribe
```

```diff
 export type EnvironmentStreamCommandRpcTag =
+  | ForkStreamCommandRpcTag // fork: ext-core
   | typeof WS_METHODS.cloudInstallRelayClient
```

Other users of `WsRpcGroup` (`apps/server/src/server.test.ts:1256`,
`apps/server/integration/NetworkTransferMeasurement.integration.ts:197`) stay as they are:
they call upstream methods only, which `LoomWsRpcGroup` still serves.

### Fork-owned files

**`packages/contracts/src/fork/index.ts`**

```ts
export * from "./rpc.ts";
```

**`packages/contracts/src/fork/rpc.ts`**

```ts
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { WsRpcGroup } from "../rpc.ts";

/** Fork RPC tags. Every tag is `loom.<slug>.<verb>`; packets append theirs. */
export const FORK_WS_METHODS = {
  coreInfo: "loom.core.info",
} as const;

export const LoomCoreInfo = Schema.Struct({
  features: Schema.Array(Schema.String),
  serverVersion: Schema.String,
});
export type LoomCoreInfo = typeof LoomCoreInfo.Type;

const LoomCoreInfoRpc = Rpc.make(FORK_WS_METHODS.coreInfo, {
  payload: Schema.Struct({}),
  success: LoomCoreInfo,
  error: EnvironmentAuthorizationError,
});

/** Every fork RPC. Packets merge their own group here, one line each. */
export const ForkRpcGroup =
  RpcGroup.make(LoomCoreInfoRpc).merge(
    // SnippetsRpcGroup,
  );
export type ForkRpcMethod = RpcGroup.Rpcs<typeof ForkRpcGroup>["_tag"];

/** Served by the server and used by every client in place of WsRpcGroup. */
export const LoomWsRpcGroup = WsRpcGroup.merge(ForkRpcGroup);

/**
 * Fork streaming tags, added to the client's stream unions
 * (packages/client-runtime/src/rpc/client.ts, fork: ext-core). A streaming fork
 * method missing here would be typed as unary. Replace `never` with the first tag.
 */
export type ForkSubscriptionRpcTag = never;
export type ForkStreamCommandRpcTag = never;
```

**`packages/client-runtime/src/fork/index.ts`**

```ts
export * from "./capabilities.ts";
```

**`packages/client-runtime/src/fork/capabilities.ts`**

```ts
import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

const NO_FEATURES: ReadonlyArray<string> = [];

/** Loom packet slugs an environment supports. Empty on upstream T3 servers. */
export const loomFeaturesOf = (
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
): ReadonlyArray<string> => capabilities?.loomFeatures ?? NO_FEATURES;

export const supportsLoomFeature = (
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
  feature: string,
): boolean => loomFeaturesOf(capabilities).includes(feature);
```

**`apps/server/src/fork/features.ts`**

```ts
/** Advertised as `capabilities.loomFeatures`. Packets with server support append their slug. */
export const LOOM_SERVER_FEATURES: ReadonlyArray<string> = ["core"];
```

**`apps/server/src/fork/ForkRuntime.ts`**

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Every service a packet adds to ForkLayer. Packets append `| TheirService`. */
export type ForkServices = never;

/**
 * The fork services' context, published by ForkLayer. A Reference has a default, so
 * reading it adds no requirement to the upstream layers that host fork transport code.
 */
export class ForkRuntime extends Context.Reference<Context.Context<ForkServices> | undefined>(
  "loom/ForkRuntime",
  { defaultValue: () => undefined },
) {}

/** Runs fork logic with the fork services. Dies if ForkLayer is not installed. */
export const withForkRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, ForkServices>> =>
  Effect.flatMap(ForkRuntime, (context) =>
    context === undefined
      ? Effect.die(new Error("The Loom server runtime is not installed."))
      : Effect.provideContext(effect, context),
  );
```

**`apps/server/src/fork/ForkLayer.ts`**

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ForkRuntime, type ForkServices } from "./ForkRuntime.ts";
import { ForkMigrationsLive } from "./persistence/migrations.ts";

/** Packet service layers, one line each. Keep `Layer.empty` first. */
const ForkServicesLive = Layer.mergeAll(
  Layer.empty,
  // SnippetStore.layer,
);

/**
 * Merged at the head of RuntimeCoreDependenciesLive (apps/server/src/server.ts,
 * fork: ext-core). Fork migrations run first, then packet services, then the
 * services' context is published as ForkRuntime.
 */
export const ForkLayer = Layer.effect(ForkRuntime, Effect.context<ForkServices>()).pipe(
  Layer.provideMerge(ForkServicesLive),
  Layer.provideMerge(ForkMigrationsLive),
);

/** Fork HTTP routes, all under /api/loom/. One line per packet. Keep `Layer.empty` first. */
export const ForkRoutesLayer = Layer.mergeAll(
  Layer.empty,
  // SnippetsHttpRoutes,
);
```

**`apps/server/src/fork/rpcAuthorization.ts`**

```ts
import {
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { FORK_WS_METHODS, type ForkRpcMethod } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import { observeRpcEffect, observeRpcStream } from "../observability/RpcInstrumentation.ts";

/** One scope per fork RPC. Exhaustive: a fork method without a scope fails typecheck. */
export const FORK_RPC_REQUIRED_SCOPES = {
  [FORK_WS_METHODS.coreInfo]: AuthOrchestrationReadScope,
} as const satisfies Readonly<Record<ForkRpcMethod, AuthEnvironmentScope>>;

const denied = (scope: AuthEnvironmentScope) =>
  new EnvironmentAuthorizationError({
    message: `The authenticated token is missing required scope: ${scope}.`,
    requiredScope: scope,
  });

/** Authorization and instrumentation for fork handlers, bound to one connection. */
export const makeForkRpcAuth = (session: AuthenticatedSession) => ({
  effect: <A, E, R>(method: ForkRpcMethod, effect: Effect.Effect<A, E, R>) => {
    const scope = FORK_RPC_REQUIRED_SCOPES[method];
    return observeRpcEffect(
      method,
      session.scopes.includes(scope) ? effect : Effect.fail(denied(scope)),
    );
  },
  stream: <A, E, R>(method: ForkRpcMethod, stream: Stream.Stream<A, E, R>) => {
    const scope = FORK_RPC_REQUIRED_SCOPES[method];
    return observeRpcStream(
      method,
      session.scopes.includes(scope) ? stream : Stream.fail(denied(scope)),
    );
  },
});
export type ForkRpcAuth = ReturnType<typeof makeForkRpcAuth>;
```

**`apps/server/src/fork/rpc.ts`**

```ts
import { FORK_WS_METHODS, ForkRpcGroup } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

import packageJson from "../../package.json" with { type: "json" };
import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import { LOOM_SERVER_FEATURES } from "./features.ts";
import { makeForkRpcAuth } from "./rpcAuthorization.ts";

/** Fork RPC handlers for one connection, merged next to makeWsRpcLayer (ws.ts, fork: ext-core). */
export const makeForkRpcLayer = (session: AuthenticatedSession) =>
  ForkRpcGroup.toLayer(
    Effect.gen(function* () {
      const auth = makeForkRpcAuth(session);
      return ForkRpcGroup.of({
        [FORK_WS_METHODS.coreInfo]: () =>
          auth.effect(
            FORK_WS_METHODS.coreInfo,
            Effect.succeed({ features: LOOM_SERVER_FEATURES, serverVersion: packageJson.version }),
          ),
        // ...(yield* makeSnippetsRpcHandlers(auth)),
      });
    }),
  );
```

`apps/server/src/fork/persistence/migrations.ts` is part of this unit; see
[Persistence](#2-persistence).

### Registering a packet

1. Contracts: `packages/contracts/src/fork/<slug>.ts` defines schemas, errors (include
   `EnvironmentAuthorizationError` in every RPC `error`), tags in its own
   `<SLUG>_WS_METHODS = { list: "loom.<slug>.list" } as const`, and
   `export const <Slug>RpcGroup = RpcGroup.make(...)`. Add `export * from "./<slug>.ts";` to
   `fork/index.ts` and `<Slug>RpcGroup,` to the `.merge(` in `fork/rpc.ts`. Streaming tags go
   into `ForkSubscriptionRpcTag` (durable, resubscribed on reconnect) or
   `ForkStreamCommandRpcTag` (one-shot progress streams).
2. Server service: `apps/server/src/fork/<slug>/<Name>.ts` with a `Context.Service` and
   `layer`. Add the layer to `ForkServicesLive` and the service to `ForkServices` in
   `ForkRuntime.ts`. Append the slug to `LOOM_SERVER_FEATURES`.
3. Server handlers: `apps/server/src/fork/<slug>/rpc.ts` exports
   `makeSnippetsRpcHandlers = (auth: ForkRpcAuth) => Effect.succeed(SnippetsRpcGroup.of({...}))`,
   each handler shaped `(input) => auth.effect(TAG, withForkRuntime(Effect.gen(...)))`. Spread
   it into `ForkRpcGroup.of({...})` in `fork/rpc.ts` and add one scope per tag to
   `FORK_RPC_REQUIRED_SCOPES` (reads `orchestration:read`, writes `orchestration:operate`,
   terminal-like power `terminal:operate`).
4. Clients: `packages/client-runtime/src/fork/<slug>.ts` builds atoms with the upstream
   factories, e.g.
   `createEnvironmentRpcQueryAtomFamily(runtime, { label: "loom:snippets:list", tag: SNIPPETS_WS_METHODS.list })`,
   exported from `client-runtime/src/fork/index.ts`. Web instantiates them in
   `apps/web/src/fork/<slug>/state.ts` with `connectionAtomRuntime` (as
   `apps/web/src/state/device.ts:18` does). Imperative calls use
   `request(TAG, input)` from `@t3tools/client-runtime/rpc`.
5. Gate every entry into the feature on `supportsLoomFeature(serverConfig?.environment.capabilities, "<slug>")`.

### Existence check

```sh
test -f packages/contracts/src/fork/rpc.ts && test -f apps/server/src/fork/ForkLayer.ts \
  && test "$(git grep -c 'fork: ext-core' -- apps/server/src/ws.ts | cut -d: -f2)" = 4 \
  && test "$(git grep -c 'fork: ext-core' -- apps/server/src/server.ts | cut -d: -f2)" = 3 \
  && git grep -q '"./fork"' -- packages/contracts/package.json packages/client-runtime/package.json
```

Expected marker counts: `ws.ts` 4, `server.ts` 3, `ServerEnvironment.ts` 2, `environment.ts`
2, `protocol.ts` 2, `client.ts` 3.

### What ForkLayer can use

Everything provided after its position in `RuntimeCoreDependenciesLive` and everything in
`RuntimeDependenciesLive`: `SqlClient`, `ServerConfig`, `ServerSettingsService`, the
orchestration engine and projection queries, `ProviderService` and registries, Git and VCS
services, pull request services, terminal, preview and device services, keybindings,
workspace services, `ServerEnvironment`, `EnvironmentAuth`, `ServerSecretStore`, background
policy, usage, analytics, `ServerLifecycleEvents`, plus platform services. It cannot use
`ServerRuntimeStartup` or the outputs of `ReactorLayerLive`. Never re-provide an upstream
layer inside ForkLayer: layers are memoized by reference, and a fresh copy would build a
second instance (see the comment at `server.ts:197-198`).

### Tests

- `apps/server/src/fork/rpcAuthorization.test.ts`: the keys of `FORK_RPC_REQUIRED_SCOPES`
  equal `ForkRpcGroup.requests.keys()`; no fork tag is also in `WsRpcGroup.requests`
  (`merge` would silently replace an upstream method); every fork tag starts with `loom.`.
- `apps/server/src/fork/features.test.ts`: slugs are unique and match `^[a-z0-9-]+$`.
- Typecheck `t3`, `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/web`,
  `@t3tools/mobile`.

---

## 2. Persistence

No upstream seam; created with server core.

### Current upstream mechanism

Migrations are files `apps/server/src/persistence/Migrations/NNN_Name.ts` exporting an
`Effect` (e.g. `052_ProjectionThreadTitleState.ts`), registered in the static list
`migrationEntries` (`apps/server/src/persistence/Migrations.ts:78-131`, highest id 52) and
run by Effect's `Migrator` (`Migrations.ts:148,164-173`) from the SQLite layer's setup
(`apps/server/src/persistence/Layers/Sqlite.ts:11-20`). The tracking table is
`effect_sql_migrations` (effect `unstable/sql/Migrator.ts:111`). The migrator runs only ids
greater than the highest recorded id (`Migrator.ts:229-253`), so a fork migration numbered
into upstream's sequence would make upstream's later migration with that id be skipped
silently; the repo's own dev script warns about exactly this collision
(`apps/server/scripts/migrate-dev-db.ts:12-19`). The database is
`<stateDir>/state.sqlite`, where `stateDir` is `<T3 home>/userdata` (or `dev`)
(`apps/server/src/config.ts:117-121`), shared on purpose with upstream T3 Code (FORK.md).

### Fork design

- Fork tables live in the same `state.sqlite`. A separate database is not justified: it
  would need its own connection, WAL handling and backup, and `loom.sh` already snapshots
  and restores `state.sqlite` on install and rollback.
- **Never add a file to upstream's `Migrations/` or a row to `migrationEntries`.**
- Each packet has its own migration set with its own tracking table,
  `fork_migrations_<slug_underscored>`, run by a second `Migrator` (`table` option,
  `Migrator.ts:29-33,111`). Ids start at 1 per packet, so parallel packets never collide,
  and the max-id rule only ever sees one packet's ids.
- Fork migrations run inside `ForkLayer`, after upstream's migrations (the SQLite layer only
  outputs `SqlClient` once its setup finished) and before any packet service is built.
- Tables are named `fork_<slug_underscored>_<noun>`, created with `CREATE TABLE IF NOT
EXISTS`. No foreign keys into upstream tables: projections can be rebuilt, and a cascade
  would delete fork data. Clean up orphans in a fork reactor that watches `thread.deleted`
  or `project.deleted` (see [Background work](#4-background-work-and-reactors)).
- Files that are not rows go under `path.join(config.stateDir, "fork", "<slug>")`, the way
  upstream features join onto `stateDir` without new config fields (e.g.
  `apps/server/src/usage/UsageService.ts:152-153`). Write them with
  `writeFileStringAtomically` (`apps/server/src/atomicWrite.ts:5`).
- Settings: never add keys to upstream `ServerSettings`
  (`packages/contracts/src/settings.ts:1010-1195`). Unknown keys are dropped on decode and
  the whole file is rewritten on every update (`apps/server/src/serverSettings.ts:259,975`).
  A packet stores its server-side settings in its own table (or a JSON file in its fork
  directory) and exposes them through its own RPCs.
- A failing fork migration stops the server from starting, like an upstream one. Recovery
  is `scripts/fork/loom.sh rollback`.

### Fork-owned file: `apps/server/src/fork/persistence/migrations.ts`

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/unstable/sql/Migrator";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

type ForkMigration = Effect.Effect<void, unknown, SqlClient.SqlClient>;

/** One packet's migrations. Ids start at 1, only grow, and applied ones are never edited. */
export interface ForkMigrationSet {
  readonly slug: string;
  readonly migrations: ReadonlyArray<readonly [id: number, name: string, migration: ForkMigration]>;
}

/** One entry per packet that owns tables. */
export const FORK_MIGRATION_SETS: ReadonlyArray<ForkMigrationSet> = [
  // SnippetsMigrations,
];

export const forkMigrationsTable = (slug: string) => `fork_migrations_${slug.replaceAll("-", "_")}`;

const run = Migrator.make({});

export const runForkMigrationSet = (set: ForkMigrationSet) =>
  run({
    table: forkMigrationsTable(set.slug),
    loader: Migrator.fromRecord(
      Object.fromEntries(
        set.migrations.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
  });

/** Runs every packet's pending migrations before ForkLayer builds packet services. */
export const ForkMigrationsLive = Layer.effectDiscard(
  Effect.forEach(FORK_MIGRATION_SETS, runForkMigrationSet, { discard: true }).pipe(Effect.orDie),
);
```

### Registering a packet

`apps/server/src/fork/<slug>/migrations.ts`:

```ts
export const SnippetsMigrations: ForkMigrationSet = {
  slug: "snippets",
  migrations: [
    [
      1,
      "Entries",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE IF NOT EXISTS fork_snippets_entries (...)`;
      }),
    ],
  ],
};
```

Add it to `FORK_MIGRATION_SETS`. Repositories follow upstream's pattern
(`apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`:
`SqlClient`, `SqlSchema`, `Layer.effect`).

### Existence check

`test -f apps/server/src/fork/persistence/migrations.ts`

### Tests

- `apps/server/src/fork/persistence/migrations.test.ts`, on `SqlitePersistenceMemory`
  (`apps/server/src/persistence/Layers/Sqlite.ts:41-44`): running every set twice applies
  nothing the second time; every table the fork sets create starts with `fork_` (compare
  `sqlite_master` before and after).
- Each packet tests its repository against `SqlitePersistenceMemory`.

---

## 3. HTTP routes

No upstream seam beyond `ForkRoutesLayer` (server core).

- Upstream raw routes are `HttpRouter.add(method, path, handler)` layers
  (`apps/server/src/http.ts:371,405`) merged in `makeRoutesLayer` (`server.ts:566-581`).
  Global middleware (command readiness, CORS, compression, `server.ts:588-591`) applies to
  fork routes too.
- Fork routes live under `/api/loom/<slug>/...`. `/api` is in `DEV_PROXIED_PATH_PREFIXES`
  (`packages/shared/src/devProxy.ts:11`), so Vite proxies them in dev without setting
  `VITE_HTTP_URL`.
- Upstream's `authenticateRawRouteWithScope` (`http.ts:271`) is not exported. A packet that
  needs environment auth copies its ten lines into `apps/server/src/fork/http.ts` (created by
  the first packet that needs it). Webhook-style routes (L25) authenticate with their own
  per-trigger secret instead.
- Handlers call fork services through `withForkRuntime`, so `makeRoutesLayer` gains no
  requirement. Add the route layer to `ForkRoutesLayer`.
- Prefer RPC. Use HTTP only for inbound webhooks, downloads or uploads.

---

## 4. Background work and reactors

No upstream seam.

- Upstream reactors are services with `start()` called from a hard-coded list
  (`apps/server/src/orchestration/Layers/OrchestrationReactor.ts:17-41`, `ReactorLayerLive`
  at `server.ts:244-255`). Joining that list would be two more seams; the fork does not.
- A fork reactor is a `Layer.effectDiscard` inside `ForkServicesLive` that uses
  `forkParked(...)` (`apps/server/src/serverActivation.ts:11-26`), so it starts only after
  server activation like upstream roots do (`ThreadDeletionReactor.ts:92-105`).
- Subscribe with `orchestrationEngine.streamDomainEvents` (hot, new events only) or the
  scoped `subscribeDomainEvents`, and catch up with `readEvents(fromSequenceExclusive)` and
  `latestSequence` (`apps/server/src/orchestration/Services/OrchestrationEngine.ts`). A fork
  reactor that must not miss events keeps its own cursor in a fork table.
  `AgentAwarenessRelay` is an upstream consumer outside orchestration that does the same
  (`apps/server/src/relay/AgentAwarenessRelay.ts:609-610`).
- Side effects feed results back through existing commands dispatched with
  `OrchestrationEngineService.dispatch`, using server command ids like upstream's
  `server:<tag>:<uuid>` (`ws.ts` `serverCommandId`).
- Tests wait on a `Deferred` or on the reactor's own drain, never on sleeps.

---

## 5. Web root (`ext-web-root`)

### Purpose

One place to mount fork components that live for the whole authenticated session:
keyboard listeners, dialogs, toast coordinators.

### Current upstream mechanism

`RootRouteView` (`apps/web/src/routes/__root.tsx:133`) mounts coordinators inside
`FirstRunGate` (`__root.tsx:219-229`), e.g. `<ProjectCloneToastCoordinator />` at line 229.

### Seam (`apps/web/src/routes/__root.tsx`)

```diff
 import { SlowRpcRequestToastCoordinator } from "../components/SlowRpcRequestToastCoordinator";
+import { ForkRoot } from "../fork/ForkRoot"; // fork: ext-web-root
```

```diff
           <ProjectCloneToastCoordinator />
+          {/* fork: ext-web-root */}
+          <ForkRoot />
           <HostedStaticEnvironmentBootstrap />
```

### Fork-owned file: `apps/web/src/fork/ForkRoot.tsx`

```tsx
import type { ComponentType } from "react";

/** Components mounted once in the authenticated app shell. One line per packet. */
const FORK_ROOT_COMPONENTS: ReadonlyArray<{
  readonly id: string;
  readonly Component: ComponentType;
}> = [
  // { id: "snippets-dialog", Component: SnippetsDialogHost },
];

export function ForkRoot() {
  return (
    <>
      {FORK_ROOT_COMPONENTS.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}
```

### Registering, existence check, tests

Append `{ id, Component }`. Components must render nothing when idle and must not subscribe
to large streams. Check: `git grep -q 'fork: ext-web-root' -- apps/web/src/routes/__root.tsx`.
No test for the root itself.

---

## 6. Right panels (`ext-panels`)

Prerequisite: [Server core](#1-server-core-ext-core) (for `@t3tools/client-runtime/fork`).

### Purpose

Let a packet add a right-side panel (tab, launcher entry, "+" menu entry, content) with no
further upstream edits.

### Current upstream mechanism

- `RIGHT_PANEL_KINDS` (`apps/web/src/rightPanelStore.ts:22-33`) derives `RightPanelKind`; the
  hand-written `RightPanelSurface` union (`rightPanelStore.ts:42-88`) has one member per kind.
  `open` and `toggle` accept `Exclude<RightPanelKind, "file" | "terminal" | "pull-request">`
  (`rightPanelStore.ts:130-133,169-172`), which reaches the `singletonSurface` switch
  (`rightPanelStore.ts:182-197`; a new kind there is TS2366). `upsertSurface` and
  `userAction` are private (`rightPanelStore.ts:269-340`). State persists to
  `t3code:right-panel-state:v2`, version 13 (`rightPanelStore.ts:90-95,860-874`); when the
  version matches, persisted surfaces load unvalidated.
- `RightPanelTabs.tsx`: required `onAddX`/`xAvailable` prop pairs
  (`apps/web/src/components/RightPanelTabs.tsx:77-133`), the "Open a surface" launcher
  (`RightPanelEmptyState`, props 313-333, `actions` 336-411, rendered at 500-601), the "+"
  menu (`addSurfaceActions` 863-928), `surfaceTitle` (608-646, exhaustive, TS2366) and
  `SurfaceIcon` (667-727). Launcher letters in use: B, T, F, D, P, L, A, M.
- `ChatView.tsx` renders content in a ternary chain starting at
  `const rightPanelContent = activeThreadRef ? (` (`apps/web/src/components/ChatView.tsx:9144`)
  and renders `<RightPanelTabs` twice (inline at 9870, sheet at 9922). Add handlers sit at
  4500-4535. `routes/_chat.pull-requests.tsx:1955-2047` also renders `RightPanelTabs`.
- Panels are not URL driven for threads.

### Fork design

One generic surface kind, `"fork"`, carrying a `panelId`. A fork registry maps panel ids to
title, icon, launcher letter, availability and component. The store gains one generic
action, `openSurface`. `RightPanelTabs` gains one optional prop, `forkActions`, spread into
both action lists; being optional, the pull request page needs no edit.

### Seams (all `fork: ext-panels`)

**`apps/web/src/rightPanelStore.ts`** (8 marked lines):

```diff
 import { resolveStorage } from "./lib/storage";
+import type { ForkRightPanelSurface } from "./fork/panels/types"; // fork: ext-panels

 const RIGHT_PANEL_KINDS = [
+  "fork", // fork: ext-panels
   "diff",
```

```diff
 export type RightPanelSurface =
+  | ForkRightPanelSurface // fork: ext-panels
   | { id: `browser:${string}`; kind: "preview"; resourceId: string }
```

The three `Exclude` lists that feed `singletonSurface` gain `"fork"` (lines 132, 171, 183):

```diff
-    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request">,
+    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request" | "fork">, // fork: ext-panels
```

```diff
-  kind: Exclude<RightPanelKind, "file" | "preview" | "terminal" | "pull-request">,
+  kind: Exclude<RightPanelKind, "file" | "preview" | "terminal" | "pull-request" | "fork">, // fork: ext-panels
```

The generic action, declared after `getUserActionRevision` in the interface and implemented
after it in the store:

```diff
   getUserActionRevision: (ref: ScopedThreadRef) => number;
+  openSurface: (ref: ScopedThreadRef, surface: RightPanelSurface) => void; // fork: ext-panels
```

```diff
       getUserActionRevision: (ref) =>
         get().userActionRevisionByThreadKey[scopedThreadKey(ref)] ?? 0,
+      // fork: ext-panels
+      openSurface: (ref, surface) =>
+        set((state) =>
+          userAction(state, scopedThreadKey(ref), (current) => upsertSurface(current, surface)),
+        ),
```

**`apps/web/src/components/RightPanelTabs.tsx`** (8 marked lines):

```diff
 import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
+// fork: ext-panels
+import { ForkSurfaceIcon, forkSurfaceTitle, type ForkSurfaceAction } from "~/fork/panels/surface";
```

```diff
   layoutControls?: ReactNode;
+  forkActions?: ReadonlyArray<ForkSurfaceAction> | undefined; // fork: ext-panels
```

```diff
 function RightPanelEmptyState(props: {
+  forkActions?: ReadonlyArray<ForkSurfaceAction> | undefined; // fork: ext-panels
   onAddBrowser: () => void;
```

```diff
           <RightPanelEmptyState
+            forkActions={props.forkActions} // fork: ext-panels
             onAddBrowser={props.onAddBrowser}
```

Both action arrays (`actions` in `RightPanelEmptyState`, `addSurfaceActions` in the tab bar)
end with the spread, so fork panels are listed after upstream's:

```diff
       onClick: props.onAddDevice,
       badgeCount: 0,
     },
+    ...(props.forkActions ?? []), // fork: ext-panels
   ] as const;
```

(`addSurfaceActions` has no `badgeCount` line; the spread goes in the same place.)

Title and icon, as the first case of each switch:

```diff
 ): string {
   switch (surface.kind) {
+    case "fork": // fork: ext-panels
+      return forkSurfaceTitle(surface);
     case "diff":
```

```diff
 }) {
   switch (surface.kind) {
+    case "fork": // fork: ext-panels
+      return <ForkSurfaceIcon surface={surface} />;
     case "preview": {
```

**`apps/web/src/components/ChatView.tsx`** (6 marked lines):

```diff
+import { ForkPanelHost } from "../fork/panels/ForkPanelHost"; // fork: ext-panels
+import { useForkPanelActions } from "../fork/panels/useForkPanelActions"; // fork: ext-panels
```

After `addDeviceSurface` (line 4535):

```diff
   }, [activeThreadRef, deviceState.onboardingCompleted, deviceState.hostStatus]);
+  const forkPanelActions = useForkPanelActions(activeThreadRef); // fork: ext-panels
```

First branch of the content chain (line 9144):

```diff
   const rightPanelContent = activeThreadRef ? (
-    renderedRightPanelSurface?.kind === "preview" ? (
+    // fork: ext-panels
+    renderedRightPanelSurface?.kind === "fork" ? (
+      <ForkPanelHost
+        surface={renderedRightPanelSurface}
+        threadRef={activeThreadRef}
+        visible={rightPanelOpen}
+      />
+    ) : renderedRightPanelSurface?.kind === "preview" ? (
       <Suspense fallback={null}>
```

At both `<RightPanelTabs` call sites (inline at 9870, sheet at 9922):

```diff
         <RightPanelTabs
+          forkActions={forkPanelActions} // fork: ext-panels
           mode="inline"
```

Line comments between JSX attributes and inside the ternary compile and survive `vp fmt`
unchanged (checked with `tsc --strict` and `oxfmt` on a sample).

### Fork-owned files

**`apps/web/src/fork/panels/types.ts`**

```ts
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";

/** The one right-panel surface kind the fork adds. */
export interface ForkRightPanelSurface {
  id: `fork:${string}`;
  kind: "fork";
  /** A key of FORK_PANELS. */
  panelId: string;
  /** Distinguishes several tabs of one panel. */
  resourceId?: string;
  title?: string;
}

export interface ForkPanelProps {
  readonly surface: ForkRightPanelSurface;
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}

export interface ForkPanelAvailabilityContext {
  readonly threadRef: ScopedThreadRef | null;
  readonly loomFeatures: ReadonlyArray<string>;
}

export interface ForkPanelDefinition {
  /** `<slug>` or `<slug>:<name>`. */
  readonly id: string;
  readonly title: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** The panel's letter from "Launcher letters" in EXTENSION-POINTS.md; "" for none. */
  readonly shortcut: string;
  /** Optional one-sentence description, shown by the panel picker (L12). */
  readonly description?: string;
  readonly unavailableHint: string;
  readonly isAvailable: (context: ForkPanelAvailabilityContext) => boolean;
  readonly Component: ComponentType<ForkPanelProps>;
}
```

**`apps/web/src/fork/panels/registry.ts`**

```ts
import type { ForkPanelDefinition, ForkRightPanelSurface } from "./types";

/** One line per packet panel. Order is launcher order. */
export const FORK_PANELS: ReadonlyArray<ForkPanelDefinition> = [
  // snippetsPanel,
];

export const findForkPanel = (panelId: string): ForkPanelDefinition | null =>
  FORK_PANELS.find((panel) => panel.id === panelId) ?? null;

export const forkPanelSurface = (panelId: string, resourceId?: string): ForkRightPanelSurface => ({
  id: resourceId === undefined ? `fork:${panelId}` : `fork:${panelId}:${resourceId}`,
  kind: "fork",
  panelId,
  ...(resourceId === undefined ? {} : { resourceId }),
});
```

**`apps/web/src/fork/panels/surface.tsx`**

```tsx
import { PuzzleIcon } from "lucide-react";
import type { ComponentType } from "react";

import { findForkPanel } from "./registry";
import type { ForkRightPanelSurface } from "./types";

/** Shape compatible with RightPanelTabs' launcher and "+" menu actions. */
export interface ForkSurfaceAction {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly shortcut: string;
  readonly description?: string;
  readonly available: boolean;
  readonly disabledReason: string;
  readonly onClick: () => void;
  readonly badgeCount: number;
}

export const forkSurfaceTitle = (surface: ForkRightPanelSurface): string =>
  surface.title ?? findForkPanel(surface.panelId)?.title ?? "Unavailable panel";

export function ForkSurfaceIcon({ surface }: { surface: ForkRightPanelSurface }) {
  const Icon = findForkPanel(surface.panelId)?.icon ?? PuzzleIcon;
  return <Icon className="size-3 shrink-0" />;
}
```

**`apps/web/src/fork/panels/useForkPanelActions.ts`**

```ts
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useServerConfigs } from "~/state/entities";
import { FORK_PANELS, forkPanelSurface } from "./registry";
import type { ForkSurfaceAction } from "./surface";

export function useForkPanelActions(
  threadRef: ScopedThreadRef | null,
): ReadonlyArray<ForkSurfaceAction> {
  const serverConfig = useServerConfigs().get(threadRef?.environmentId ?? ("" as EnvironmentId));
  const loomFeatures = loomFeaturesOf(serverConfig?.environment.capabilities);
  return useMemo(
    () =>
      FORK_PANELS.map((panel) => ({
        label: panel.title,
        icon: panel.icon,
        shortcut: panel.shortcut,
        ...(panel.description === undefined ? {} : { description: panel.description }),
        available: panel.isAvailable({ threadRef, loomFeatures }),
        disabledReason: panel.unavailableHint,
        badgeCount: 0,
        onClick: () => {
          if (threadRef)
            useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(panel.id));
        },
      })),
    [threadRef, loomFeatures],
  );
}
```

**`apps/web/src/fork/panels/ForkPanelHost.tsx`**

```tsx
import { findForkPanel } from "./registry";
import type { ForkPanelProps } from "./types";

/** Renders a fork surface; a surface whose panel is gone from this build explains itself. */
export function ForkPanelHost(props: ForkPanelProps) {
  const panel = findForkPanel(props.surface.panelId);
  if (!panel) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        This Loom panel is not available in this build. Close the tab to remove it.
      </div>
    );
  }
  const Component = panel.Component;
  return <Component {...props} />;
}
```

### Launcher letters

This table is the single registry of launcher letters. A fork panel uses exactly the letter
listed here (`shortcut` in its `ForkPanelDefinition`); a new panel adds a row in the same
change as its packet documents. Letters match case-insensitively
(`surfaceShortcutActionForKey`, `apps/web/src/components/RightPanelTabs.tsx:246-257`), and
upstream's launcher and "+" menu reserve A (Agents), B (Browser), D (Diff), F (Files),
L (Linked pull requests), M (Device), P (Pull request) and T (Terminal)
(`RightPanelTabs.tsx:336-411`, `863-928`).

| Letter | Panel title     | Panel id                  | Packet |
| ------ | --------------- | ------------------------- | ------ |
| C      | Containers      | `small-extras:containers` | L20    |
| E      | Env             | `project-profiles:env`    | L18    |
| G      | Source control  | `source-control-cockpit`  | L06    |
| H      | Side by side    | `thread-lineage:thread`   | L02    |
| I      | Inspector       | `thread-inspector`        | L04    |
| J      | Decisions       | `jev-hub`                 | L29    |
| K      | Skills          | `skill-registry`          | L21    |
| N      | Runs            | `multi-thread-runs`       | L08    |
| O      | 3D model        | `model-preview-3d`        | L23    |
| Q      | Device QA       | `device-qa`               | L09    |
| R      | Related threads | `thread-lineage`          | L02    |
| S      | Snippets        | `snippets`                | L01    |
| U      | Utilities       | `utilities`               | L27    |
| V      | Dev environment | `browser-dev-tools`       | L11    |
| W      | Review          | `ai-code-review`          | L15    |
| X      | Apple build     | `apple-build-tooling`     | L10    |
| Y      | Code map        | `code-graph`              | L26    |
| Z      | PCB preview     | `pcb-preview`             | L24    |

Every letter is now taken. A later panel uses `""` and is reached through the "+" menu, the
palette or the panel picker (L12). If upstream adds a surface whose letter is
already assigned here, the fork panel gives it up (reassign it here and in its packet):
upstream's actions come first in both lists, so upstream's surface would win the key anyway.

### Registering a panel

`apps/web/src/fork/<slug>/panel.tsx` exports a `ForkPanelDefinition` whose `isAvailable`
checks `threadRef !== null && loomFeatures.includes("<slug>")` (plus anything else it
needs). Append it to `FORK_PANELS`. Open it programmatically with
`useRightPanelStore.getState().openSurface(ref, forkPanelSurface("<slug>"))`. The panel is
mounted only while active; keep durable state in its own store or atoms, as upstream
surfaces do. A panel that needs a keyboard toggle registers a command
([Keybindings](#9-keybindings-ext-keybindings)) whose handler calls `openSurface`, or
`close` when that surface is already active.

### Existence check

```sh
test -f apps/web/src/fork/panels/registry.ts \
  && test "$(git grep -c 'fork: ext-panels' -- apps/web/src/rightPanelStore.ts | cut -d: -f2)" = 8
```

Expected marker counts: `rightPanelStore.ts` 8, `RightPanelTabs.tsx` 8, `ChatView.tsx` 6.

### Tests

`apps/web/src/fork/panels/registry.test.ts`: panel ids are unique and start with a known
slug form; non-empty shortcuts are single uppercase letters, unique, and not one of upstream's
A B D F L M P T; `forkPanelSurface` ids are stable. Typecheck `@t3tools/web`.

### Known limits

- `activateRightPanelSurface` and the cleanup helpers in ChatView
  (`ChatView.tsx:4916-4972`) have per-kind branches; fork surfaces take their generic path.
- If upstream T3 Code runs on the same desktop profile (it shares the app id and user data
  folder, FORK.md), it loads persisted `"fork"` surfaces as untitled, empty tabs. Closing
  them is harmless.
- Mobile has no right panel system (its tablet inspector has a closed mode union,
  `apps/mobile/src/features/threads/thread-inspector-content-stack.tsx:4`). Mobile panels are
  per-packet decisions.

---

## 7. Settings (`ext-settings`)

### Purpose

Give packets a settings home in the web and desktop app: one "Loom" page in the settings
sidebar, with one section per packet.

### Current upstream mechanism

- Each page is a route file, e.g. `apps/web/src/routes/settings.projects.tsx`
  (`createFileRoute("/settings/projects")({ component })`), under the layout route
  `settings.tsx` (`createFileRoute("/settings")` at 218-234). Routes are compiled into the
  committed, generated `apps/web/src/routeTree.gen.ts` by the TanStack Router Vite plugin
  (`apps/web/vite.config.ts:173`) on `vp dev` and `vp build`; `tsc --noEmit` does not
  regenerate it.
- `SettingsPath` (`apps/web/src/components/settings/settingsSearch.ts:11-21`),
  `SETTINGS_SECTION_LABELS` in sidebar order (`settingsSearch.ts:74-85`),
  `SETTINGS_CATEGORY_SCOPES` (`settingsSearch.ts:733-746`) and `SETTINGS_SECTION_ICONS`
  (`apps/web/src/components/settings/SettingsSidebarNav.tsx:75-88`) are exhaustive records;
  nav items derive from the labels (`SettingsSidebarNav.tsx:90-98`).
- Pages outside `DEVICE_ONLY_PATHS` (`apps/web/src/routes/settings.tsx:51-55`) are gated on
  the selected environment scope.
- Search items (`SETTINGS_SEARCH_ITEMS`, `settingsSearch.ts:92`) are an upstream list; fork
  sections are not searchable in this design.
- Layout primitives: `SettingsPageContainer`, `SettingsSection`, `SettingsRow`
  (`apps/web/src/components/settings/settingsLayout.tsx:518,176,268`).

### Seams (all `fork: ext-settings`)

**`apps/web/src/components/settings/settingsSearch.ts`** (3 marked lines):

```diff
 export type SettingsPath =
+  | "/settings/loom" // fork: ext-settings
   | "/settings/projects"
```

```diff
   "/settings/archived": "Archive",
+  "/settings/loom": "Loom", // fork: ext-settings
 };
```

```diff
   "/settings/archived": "project-defaults",
+  "/settings/loom": null, // fork: ext-settings
 };
```

The label goes last on purpose: the record's key order is the sidebar order.

**`apps/web/src/components/settings/SettingsSidebarNav.tsx`** (2 marked lines):

```diff
 import { validateSettingsScopeSearch } from "./settingsScope";
+import { LoomSettingsIcon } from "../../fork/settings/LoomSettingsIcon"; // fork: ext-settings
```

```diff
   "/settings/archived": ArchiveIcon,
+  "/settings/loom": LoomSettingsIcon, // fork: ext-settings
 };
```

**New route file `apps/web/src/routes/settings.loom.tsx`** (fork-owned, lives in the routes
directory because the router plugin requires it):

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { LoomSettingsPage } from "../fork/settings/LoomSettingsPage";

export const Route = createFileRoute("/settings/loom")({
  component: LoomSettingsPage,
});
```

**`apps/web/src/routeTree.gen.ts`** is regenerated, not hand-edited: run the web dev server or
`vp run --filter @t3tools/web build` once and commit the result. On an upstream merge
conflict in this file, take upstream's version, regenerate the same way, then typecheck.

### Fork-owned files

**`apps/web/src/fork/settings/registry.ts`**

```ts
import type { ComponentType } from "react";

export interface ForkSettingsSection {
  /** The packet slug; also the page anchor. */
  readonly id: string;
  readonly title: string;
  readonly Component: ComponentType;
}

/** One line per packet, in page order. */
export const FORK_SETTINGS_SECTIONS: ReadonlyArray<ForkSettingsSection> = [
  // snippetsSettings,
];
```

**`apps/web/src/fork/settings/LoomSettingsPage.tsx`**

```tsx
import { SettingsPageContainer, SettingsSection } from "~/components/settings/settingsLayout";
import { FORK_SETTINGS_SECTIONS } from "./registry";

export function LoomSettingsPage() {
  return (
    <SettingsPageContainer>
      {FORK_SETTINGS_SECTIONS.length === 0 ? (
        <p className="text-muted-foreground text-sm">No Loom features have settings yet.</p>
      ) : (
        FORK_SETTINGS_SECTIONS.map(({ id, title, Component }) => (
          <SettingsSection key={id} id={`loom-${id}`} title={title}>
            <Component />
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
```

**`apps/web/src/fork/settings/LoomSettingsIcon.tsx`**

```tsx
export { PuzzleIcon as LoomSettingsIcon } from "lucide-react";
```

### Registering a section

A section component reads client-only preferences with `useClientSettings` /
`useUpdateClientSettings` only for upstream keys; fork client preferences use localStorage
keys `loom:<slug>:<name>:v<n>` through `resolveStorage` (`apps/web/src/lib/storage.ts`),
wrapped in try/catch. Server-side values come from the packet's own RPCs
([Persistence](#2-persistence)). The page is scope-gated like General, so a section that
edits environment values reads the selected scope with `useScopedSettings`'s context
(`apps/web/src/components/settings/useScopedSettings.ts:30`) and shows its own unavailable
state when the environment lacks `loomFeatures` for it.

### Existence check

```sh
test -f apps/web/src/routes/settings.loom.tsx \
  && test "$(git grep -c 'fork: ext-settings' -- apps/web/src/components/settings/settingsSearch.ts | cut -d: -f2)" = 3
```

### Tests

`apps/web/src/fork/settings/registry.test.ts`: section ids unique. Typecheck `@t3tools/web`
after regenerating the route tree.

---

## 8. Command palette (`ext-palette`)

Prerequisite: [Server core](#1-server-core-ext-core) (for `@t3tools/client-runtime/fork`).

### Current upstream mechanism

`OpenCommandPaletteDialog` (`apps/web/src/components/CommandPalette.tsx:616`) builds
`const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = []`
during render (`CommandPalette.tsx:1650`), pushes items conditionally (1652-1869), then
calls `buildRootGroups({ actionItems, recentThreadItems })` (1871). Item types are in
`CommandPalette.logic.ts:127-161`. Items in the `actions` group are searchable and appear
for `>` queries (`CommandPalette.logic.ts:369-443`). The bus (`apps/web/src/commandPaletteBus.ts`)
cannot inject items.

### Seams (`apps/web/src/components/CommandPalette.tsx`, all `fork: ext-palette`)

```diff
 import { useAvailableSettingsSearchItems } from "./settings/useAvailableSettingsSearchItems";
+import { useForkCommandPaletteItems } from "../fork/commandPalette/registry"; // fork: ext-palette
```

After `const availableSettingsSearchItems = useAvailableSettingsSearchItems();` (line 652):

```diff
   const availableSettingsSearchItems = useAvailableSettingsSearchItems();
+  const forkPaletteItems = useForkCommandPaletteItems(); // fork: ext-palette
```

Before `const rootGroups = buildRootGroups(...)` (line 1871):

```diff
+  actionItems.push(...forkPaletteItems); // fork: ext-palette
   const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
```

### Fork-owned file: `apps/web/src/fork/commandPalette/registry.ts`

```ts
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import type {
  CommandPaletteActionItem,
  CommandPaletteSubmenuItem,
} from "~/components/CommandPalette.logic";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useServerConfigs } from "~/state/entities";

export interface ForkCommandPaletteContext {
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly loomFeatures: ReadonlyArray<string>;
}

export interface ForkCommandPaletteSource {
  readonly id: string;
  /** Pure: no hooks. Item values are `action:loom:<slug>:<name>`. */
  readonly items: (
    context: ForkCommandPaletteContext,
  ) => ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

/** One line per packet. */
export const FORK_COMMAND_PALETTE_SOURCES: ReadonlyArray<ForkCommandPaletteSource> = [
  // snippetsPaletteSource,
];

/** Rebuilt on every render, like the palette's own action items. */
export function useForkCommandPaletteItems(): ReadonlyArray<
  CommandPaletteActionItem | CommandPaletteSubmenuItem
> {
  const { activeThread } = useHandleNewThread();
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;
  const serverConfig = useServerConfigs().get(
    activeThreadRef?.environmentId ?? ("" as EnvironmentId),
  );
  const loomFeatures = loomFeaturesOf(serverConfig?.environment.capabilities);
  return FORK_COMMAND_PALETTE_SOURCES.flatMap((source) =>
    source.items({ activeThreadRef, loomFeatures }),
  );
}
```

`useHandleNewThread` is the hook the palette itself uses for the active thread
(`CommandPalette.tsx:653`); the fork hook reads it independently so the seam stays one line.

### Registering, existence check, tests

A packet adds `apps/web/src/fork/<slug>/palette.tsx` exporting a source (items with
`kind: "action"`, `searchTerms`, `title`, `icon`, `run`; set `shortcutCommand` to its
`loom.*` command to show the binding) and appends it. Items return `[]` when the feature is
not in `loomFeatures`. Check:
`git grep -c 'fork: ext-palette' -- apps/web/src/components/CommandPalette.tsx` prints 3.
Test: item values across sources are unique and start with `action:loom:`.

---

## 9. Keybindings (`ext-keybindings`)

Prerequisite: [Web root](#5-web-root-ext-web-root).

### Current upstream mechanism

- `KeybindingCommand` is `Schema.Union([Schema.Literals(STATIC_KEYBINDING_COMMANDS),
SCRIPT_RUN_COMMAND_PATTERN])` (`packages/contracts/src/keybindings.ts:57-105`), a closed
  list plus `script.<id>.run`. The server decodes each `keybindings.json` entry and skips
  unknown commands with an issue (`apps/server/src/keybindings.ts:169,370-397`); the client
  drops undecodable rules. So a fork command must be in the list.
- Defaults: `DEFAULT_KEYBINDINGS` (`packages/shared/src/keybindings.ts:21-62`); the server
  backfills missing defaults into the user's file on startup
  (`apps/server/src/keybindings.ts:451-546`).
- Dispatch has no central switch: each area runs a `keydown` listener calling
  `resolveShortcutCommand` (`apps/web/src/keybindings.ts:227`) with its own `when` context,
  e.g. `apps/web/src/routes/_chat.tsx:25-175`.
- The Keybindings settings page lists every static command and derives labels from the id
  (`apps/web/src/components/settings/KeybindingsSettings.logic.ts:266-285`), so
  `loom.snippets.open` shows as "Loom: Snippets: Open" with no extra work.

### Seams (`packages/contracts/src/keybindings.ts`, `fork: ext-keybindings`)

```diff
 import { ForwardCompatibleArray, TrimmedString } from "./baseSchemas.ts";
+import { FORK_KEYBINDING_COMMANDS } from "./fork/keybindings.ts"; // fork: ext-keybindings
```

```diff
 export const STATIC_KEYBINDING_COMMANDS = [
+  ...FORK_KEYBINDING_COMMANDS, // fork: ext-keybindings
   "sidebar.toggle",
```

Default bindings are never written into `keybindings.json`: the server backfills defaults
into the user's file, and upstream T3 Code (or a rollback) then reports fork commands as
invalid entries. A packet that wants a default key adds a fork `keydown` listener in a
`ForkRoot` component, guarded by a client setting (on by default) that turns it off. The
listener returns without `preventDefault` when the event is already handled, when the command
palette is open, or when `resolveShortcutCommand` resolves any user binding for the event, so
user bindings always win. The fork command stays unbound and bindable. L12 (`mod+shift+'`) and
L14 (`mod+F`) follow this pattern.

### Fork-owned files

**`packages/contracts/src/fork/keybindings.ts`** (plain data; must not import
`../keybindings.ts`, which imports it). Also add `export * from "./keybindings.ts";` to
`packages/contracts/src/fork/index.ts`.

```ts
/** Loom keybinding commands (`loom.<slug>.<action>`). Spread into STATIC_KEYBINDING_COMMANDS. */
export const FORK_KEYBINDING_COMMANDS = [
  // "loom.snippets.open",
] as const;
export type ForkKeybindingCommand = (typeof FORK_KEYBINDING_COMMANDS)[number];

export const isForkKeybindingCommand = (command: string): command is ForkKeybindingCommand =>
  (FORK_KEYBINDING_COMMANDS as ReadonlyArray<string>).includes(command);
```

**`apps/web/src/fork/keybindings/forkCommandBus.ts`**

```ts
import type { ForkKeybindingCommand } from "@t3tools/contracts/fork";

const listeners = new Map<ForkKeybindingCommand, Set<() => void>>();

/** Subscribe to a fork command from a shortcut or palette item. Returns the unsubscribe. */
export function onForkCommand(command: ForkKeybindingCommand, listener: () => void): () => void {
  const set = listeners.get(command) ?? new Set();
  set.add(listener);
  listeners.set(command, set);
  return () => set.delete(listener);
}

/** Runs every listener; false when nothing handles the command (the key then falls through). */
export function dispatchForkCommand(command: ForkKeybindingCommand): boolean {
  const set = listeners.get(command);
  if (!set || set.size === 0) return false;
  for (const listener of set) listener();
  return true;
}
```

**`apps/web/src/fork/keybindings/ForkGlobalShortcuts.tsx`**, registered in `ForkRoot` as
`{ id: "shortcuts", Component: ForkGlobalShortcuts }`:

```tsx
import { isForkKeybindingCommand } from "@t3tools/contracts/fork";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { resolveShortcutCommand } from "~/keybindings";
import { isPreviewFocused } from "~/lib/previewFocus";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { dispatchForkCommand } from "./forkCommandBus";

export function ForkGlobalShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused(), previewFocus: isPreviewFocused() },
      });
      if (!command || !isForkKeybindingCommand(command)) return;
      if (dispatchForkCommand(command)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings]);
  return null;
}
```

### Registering, existence check, tests

Append `"loom.<slug>.<action>"` to `FORK_KEYBINDING_COMMANDS`; subscribe with
`onForkCommand` where the action lives (a panel, a dialog host in `ForkRoot`). Palette items
can call `dispatchForkCommand` too. Check:
`test -f packages/contracts/src/fork/keybindings.ts && git grep -q 'fork: ext-keybindings' -- packages/contracts/src/keybindings.ts`.
Test (`packages/contracts/src/fork/keybindings.test.ts`): every fork command starts with
`loom.`, decodes with `KeybindingCommand`, and is not an upstream static command.

---

## 10. Agent-facing MCP tools (`ext-mcp`)

Prerequisite: server core.

### Current upstream mechanism

- One MCP server, `McpServer.layerHttp({ name: "T3 Code", path: "/mcp", ... })`
  (`apps/server/src/mcp/McpHttpServer.ts:624-629`). Toolkits register as layers, e.g.
  `McpServer.toolkit(PullRequestsToolkit).pipe(Layer.provide(PullRequestsToolkitHandlersLive))`
  (`McpHttpServer.ts:607-609`), merged in
  `export const layer = Layer.mergeAll(PreviewToolkitRegistrationLive, PullRequestsToolkitRegistrationLive, DeviceToolkitRegistrationLive).pipe(Layer.provideMerge(McpTransportLive))`
  (`McpHttpServer.ts:631-635`), mounted in `makeRoutesLayer` (`server.ts:582`).
- A tool is `Tool.make("name", { description, parameters, success, failure, dependencies })`
  with annotations; a toolkit is `Toolkit.make(...)`, handlers `Toolkit.toLayer(...)`
  (`apps/server/src/mcp/toolkits/device/tools.ts:28-46,92`, `handlers.ts:256`).
- Every provider adapter wires the same server name, `t3-code`, with a per-thread bearer
  credential (Claude, Codex, Cursor, Grok, OpenCode, Antigravity adapters). New tools on this
  server need no adapter change; a second server would need six.
- `tools/list` is not filtered per credential. Access is checked per call with
  `requireMcpCapability` against the closed union
  `McpCapability = "preview" | "device" | "pull-requests"`
  (`apps/server/src/mcp/McpInvocationContext.ts:11,47-55`), computed per thread in
  `ProviderService.ts:869-914`.

### Seam (`apps/server/src/mcp/McpHttpServer.ts`, `fork: ext-mcp`)

```diff
 import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
+import { ForkMcpToolkitsLive } from "../fork/mcp/index.ts"; // fork: ext-mcp
```

```diff
 export const layer = Layer.mergeAll(
+  ForkMcpToolkitsLive, // fork: ext-mcp
   PreviewToolkitRegistrationLive,
```

### Fork-owned file: `apps/server/src/fork/mcp/index.ts`

```ts
import * as Layer from "effect/Layer";

/** Packet toolkit registrations, one line each. Keep `Layer.empty` first. */
export const ForkMcpToolkitsLive = Layer.mergeAll(
  Layer.empty,
  // SnippetsToolkitRegistrationLive,
);
```

### Registering a toolkit

`apps/server/src/fork/<slug>/mcp.ts` follows the upstream toolkit pattern:

```ts
const SearchSnippetsTool = Tool.make("loom_snippets_search", {
  description: "...",
  parameters: SnippetSearchInput,
  success: SnippetSearchResult,
  failure: SnippetToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Search snippets")
  .annotate(Tool.Readonly, true);

export const SnippetsToolkit = Toolkit.make(SearchSnippetsTool);

export const SnippetsToolkitRegistrationLive = McpServer.toolkit(SnippetsToolkit).pipe(
  Layer.provide(
    SnippetsToolkit.toLayer({
      loom_snippets_search: (input) => withForkRuntime(/* call the packet service */),
    }),
  ),
);
```

- Do not extend `McpCapability`. Gate inside the handler: read `McpInvocationContext`
  (`threadId`, `providerInstanceId`) and check the packet's own setting, failing with the
  packet's typed error.
- Every tool is listed to every agent session and costs prompt tokens on every turn. Keep a
  packet to a few tools with short descriptions, and prefer one tool with a `mode` parameter
  over many near-duplicates.
- Parameters must be a non-empty struct (see the comment at `device/tools.ts:31-33`: an
  empty struct makes some providers drop every tool on the server).

### Existence check, tests

`test -f apps/server/src/fork/mcp/index.ts && git grep -q 'fork: ext-mcp' -- apps/server/src/mcp/McpHttpServer.ts`.
Test: every fork tool name starts with `loom_` and is unique across fork toolkits; handler
tests run the service through `withForkRuntime` with a test `ForkRuntime` context.

---

## 11. Composer (`ext-composer`)

### Purpose

Three hooks packets need: a key handler (Tab expansion such as snippet `;alias`), footer
controls, and a drawer anchored above the composer (clipboard history, per-turn tool
overrides).

### Current upstream mechanism (`apps/web/src/components/chat/ChatComposer.tsx`)

- `onComposerCommandKey` (3921-3964) receives ArrowUp, ArrowDown, Enter and Tab from the
  editor plugin (`ComposerPromptEditor.tsx:957-1017`). Shift+Tab toggles plan mode
  (3925-3929); with a trigger menu open, Tab or Enter selects (3943-3945).
- `applyPromptReplacement(rangeStart, rangeEnd, replacement, { expectedText })` (3410) edits
  the prompt safely; `resolveActiveComposerTrigger()` (3501) returns
  `{ snapshot: { value, cursor, expandedCursor }, trigger }`. Trigger ranges are in
  expanded-cursor coordinates (`detectComposerTrigger(snapshot.value, snapshot.expandedCursor)`).
- Footer controls are `restingBlockDefs`, an array of `{ id, content }` (4846-4874); blocks
  are hidden from the end of the array when space runs out, and `CompactComposerControlsMenu`
  re-exposes only `mode` and `traits` (4950-5001), so an appended fork block simply hides
  on narrow layouts.
- The stash drawer renders in `ComposerCommandMenuLayer` (a private component, 843) at
  6235-6251: `{isStashMenuOpen && !composerMenuOpen && !isComposerApprovalState && (...)}`.
- The component has no early return before its JSX (5900), so hooks can be added anywhere
  above it.

### Seams (`ChatComposer.tsx`, all `fork: ext-composer`)

```diff
 import { type ComposerCommandItem, ComposerCommandMenu } from "./ComposerCommandMenu";
+// fork: ext-composer
+import { forkComposerBlockDefs, handleForkComposerKey, useForkComposerDrawer } from "../../fork/composer/registry";
```

(Place the import after whichever upstream import sits there; the leading marker line keeps
the marker attached when the formatter wraps the import.)

In `onComposerCommandKey`, directly after the Shift+Tab block (line 3929):

```diff
       toggleInteractionMode();
       return true;
     }
+    // fork: ext-composer
+    if (
+      handleForkComposerKey({
+        key,
+        event,
+        ...resolveActiveComposerTrigger(),
+        replace: applyPromptReplacement,
+        environmentId,
+      })
+    ) {
+      return true;
+    }
     const { trigger } = resolveActiveComposerTrigger();
```

After `onComposerCommandKey` is declared (after line 3964):

```diff
     return false;
   };
+  // fork: ext-composer
+  const forkDrawer = useForkComposerDrawer({
+    environmentId,
+    threadRef: routeThreadRef,
+    replace: applyPromptReplacement,
+  });
```

At the end of `restingBlockDefs` (line 4874):

```diff
       ),
     },
+    // fork: ext-composer
+    ...forkComposerBlockDefs({
+      environmentId,
+      threadRef: routeThreadRef,
+      size: composerControlsInStrip ? "xs" : "sm",
+    }),
   ];
```

After the stash drawer block (line 6251):

```diff
                 </ComposerCommandMenuLayer>
               )}
+              {/* fork: ext-composer */}
+              {forkDrawer !== null &&
+                !isStashMenuOpen &&
+                !composerMenuOpen &&
+                !isComposerApprovalState && (
+                  <ComposerCommandMenuLayer anchor={composerMenuAnchor}>{forkDrawer}</ComposerCommandMenuLayer>
+                )}
```

Run `vp fmt` on the file afterwards. Every multi-line seam starts with its own marker line,
so wrapping by the formatter never separates a seam from its marker.

### Fork-owned file: `apps/web/src/fork/composer/registry.ts(x)`

```tsx
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ReactElement, ReactNode } from "react";

import type { ComposerTrigger } from "~/composer-logic";

export type ForkPromptReplace = (
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
  options?: { expectedText?: string },
) => boolean;

export interface ForkComposerKeyContext {
  readonly key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab";
  readonly event: KeyboardEvent;
  readonly snapshot: {
    readonly value: string;
    readonly cursor: number;
    readonly expandedCursor: number;
  };
  readonly trigger: ComposerTrigger | null;
  readonly replace: ForkPromptReplace;
  readonly environmentId: EnvironmentId;
}

export interface ForkComposerKeyHandler {
  readonly id: string;
  /** Return true only when the key was consumed. Must be synchronous and cheap. */
  readonly handle: (context: ForkComposerKeyContext) => boolean;
}

export interface ForkComposerBlockProps {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly size: "xs" | "sm";
}

export interface ForkComposerDrawer {
  readonly id: string;
  /** A hook: returns the drawer content while open, otherwise null. */
  readonly useDrawer: (props: {
    readonly environmentId: EnvironmentId;
    readonly threadRef: ScopedThreadRef;
    readonly replace: ForkPromptReplace;
  }) => ReactNode | null;
}

/** One line per packet each. */
export const FORK_COMPOSER_KEY_HANDLERS: ReadonlyArray<ForkComposerKeyHandler> = [];
export const FORK_COMPOSER_BLOCKS: ReadonlyArray<{
  readonly id: string;
  readonly Component: (props: ForkComposerBlockProps) => ReactElement | null;
}> = [];
export const FORK_COMPOSER_DRAWERS: ReadonlyArray<ForkComposerDrawer> = [];

/** Never runs while an upstream trigger menu (`@`, `$`, `/`, `#`) is active. */
export function handleForkComposerKey(context: ForkComposerKeyContext): boolean {
  if (context.trigger !== null) return false;
  return FORK_COMPOSER_KEY_HANDLERS.some((handler) => handler.handle(context));
}

export function forkComposerBlockDefs(props: ForkComposerBlockProps) {
  return FORK_COMPOSER_BLOCKS.map(({ id, Component }) => ({
    id: `loom:${id}`,
    content: <Component {...props} />,
  }));
}

/** Calls every drawer hook in a fixed order; the first open drawer wins. */
export function useForkComposerDrawer(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly replace: ForkPromptReplace;
}): ReactNode | null {
  let open: ReactNode | null = null;
  for (const drawer of FORK_COMPOSER_DRAWERS) {
    const content = drawer.useDrawer(props);
    if (open === null && content !== null) open = content;
  }
  return open;
}
```

The file is `.tsx` because `forkComposerBlockDefs` returns JSX. The drawer loop calls hooks
over a static array, so hook order is stable; if the React lint rules object, replace the loop
with a fixed composition written when the first drawer lands, and update this file.

### Registering, existence check, tests

- Key handlers find the token before `snapshot.expandedCursor` the way
  `detectComposerTrigger` does (`apps/web/src/composer-logic.ts:209-256`) and replace it with
  `replace(start, end, text, { expectedText })`. Data they need (snippet aliases) is read
  synchronously from an atom registry or store, never fetched on the keystroke.
- Blocks render compact controls sized by `size`.
- Drawers open from a fork command, a block button or a palette item, and close on Escape.
- Check: `git grep -c 'fork: ext-composer' -- apps/web/src/components/chat/ChatComposer.tsx`
  prints 5.
- Test the pure parts (token detection, expansion) in the packet; ids unique across the three
  lists.

## 11b. Composer menu trigger (`ext-composer-menu`)

Optional; create only when a packet needs a new `@`-style menu (for example a snippet picker
that opens on a prefix). Tab expansion alone does not need it. Fork trigger prefixes in
use: `;` (L01 snippets), `%` (L18 project notes). A new packet picks an unused prefix and adds
it here.

### Current upstream mechanism

`ComposerTriggerKind = "path" | "pull-request" | "slash-command" | "skill"`
(`apps/web/src/composer-logic.ts:11`) and `detectComposerTrigger` (209-256) decide the
trigger; `ComposerCommandItem` (`apps/web/src/components/chat/ComposerCommandMenu.tsx:31-69`)
is the item union; `composerMenuItems` (`ChatComposer.tsx:2281-2421`) and
`onSelectComposerItem` (3513-3639) are if-chains with no exhaustiveness check. Mobile has its
own trigger copy (`packages/shared/src/composerTrigger.ts`).

### Seams (all `fork: ext-composer-menu`)

- `composer-logic.ts`: the kind union gains `` | `loom:${string}` `` and
  `detectComposerTrigger` starts with
  `const forkTrigger = detectForkComposerTrigger(text, cursor); if (forkTrigger) return forkTrigger;`
  (import from `./fork/composer/menu`).
- `ComposerCommandMenu.tsx`: the item union gains `| ForkComposerCommandItem`
  (`{ id; type: "loom"; triggerId; label; description; value: unknown }`); generic rendering
  already shows `label` and `description`.
- `ChatComposer.tsx`: before `composerMenuItems`, a hook call
  `const forkMenuItems = useForkComposerMenuItems(composerTrigger);`; the memo starts with
  `if (composerTrigger?.kind.startsWith("loom:")) return [...forkMenuItems];` (and lists
  `forkMenuItems` in its dependencies); `onSelectComposerItem` starts its item branches with
  `if (item.type === "loom") { selectForkComposerItem(item, { snapshot, trigger, replace: applyPromptReplacement }); return; }`.

Fork triggers must use prefixes no upstream trigger uses (`/` at line start, `#`, `$`, `@`).
Registry: `apps/web/src/fork/composer/menu.ts` with `FORK_COMPOSER_TRIGGERS`
(`{ id, detect(text, cursor), useItems(query), select(item, context) }`). Check:
`test -f apps/web/src/fork/composer/menu.ts`.

---

## 12. Orchestration and thread behavior

Guidance, not a pre-built extension point. Default: **fork side tables plus existing
commands. No new commands or events.**

### Current upstream mechanism

- Commands and events are `Schema.Struct`s discriminated by `type`, in unions:
  `DispatchableClientOrchestrationCommand` (`packages/contracts/src/orchestration.ts:1346`),
  `OrchestrationCommand` (1580), `OrchestrationEventType` (1586), `OrchestrationEvent` (1931).
- The decider switch is exhaustive (`apps/server/src/orchestration/decider.ts:222`,
  `command satisfies never` at 2167); the projector is not (`projector.ts:334`, default at
  1067); persisted projections are a closed list (`Layers/ProjectionPipeline.ts:1925-1962`).
- Events, projections and the command receipt commit in one transaction; reactors do side
  effects afterwards (`docs/internals/overview.md`, "Durable intent and side effects").
- The event store validates `type` against the closed `OrchestrationEventType` on append
  and on read (`apps/server/src/persistence/Layers/OrchestrationEventStore.ts:40,53`).
- Threads have no generic metadata field. Activities carry `payload: Schema.Unknown`
  (`orchestration.ts:596-605`) via the internal `thread.activity.append` command
  (1492-1498), capped to the latest 500 per thread (`projector.ts:63-66`).

### Rules

1. **Never add an orchestration event type.** Persisted events are replayed forever. A fork
   event in `state.sqlite` makes upstream T3 Code (a rollback, or the upstream app on the same
   `~/.t3`) fail to read the event log. This is a one-way door.
2. Store fork thread data in `fork_` tables keyed by `thread_id` / `project_id`, served by
   fork RPCs, cleaned up by a fork reactor on `thread.deleted` / `project.deleted`.
3. Change threads only through existing commands, dispatched server-side from a fork service
   (`OrchestrationEngineService.dispatch`) or client-side through
   `ORCHESTRATION_WS_METHODS.dispatchCommand`. Useful ones:
   - `thread.create` (`orchestration.ts:1047-1062`): new thread with `projectId`,
     `modelSelection`, `runtimeMode`, `interactionMode`, `branch`, `worktreePath`.
   - `thread.history.import` (1438-1450): seeds a new thread with prior user/assistant
     messages; the basis for forking a thread (L02) without new events.
   - `thread.turn.start` with `bootstrap.createThread` / `prepareWorktree` and
     `sourceProposedPlan` (the only existing cross-thread link, used by "Implement plan in new
     thread", `apps/web/src/components/ChatView.tsx:8660-8750`).
   - `thread.meta.update` (1161) for title and upstream-owned metadata only.
   - `thread.activity.append` (internal; server-side only) for timeline markers such as
     "Forked from ...", with `kind: "loom.<slug>.<name>"`. Never as durable storage.
4. Provider behavior stays behind adapters. Manual compaction already exists for every
   adapter (`ProviderCompaction`, `apps/server/src/provider/Services/ProviderAdapter.ts:30-43`;
   `ProviderService.compactThread`, `Services/ProviderService.ts:57`) and runs when a user
   message is exactly `/compact` (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:91-94`).
   A packet can reuse that path before adding anything.
5. Content injected into agent turns (a pinned goal, instruction modes) goes through
   [Provider turn input](#16-provider-turn-input-ext-turn-input), which covers every provider
   from one seam in `ProviderService.sendTurn`. An MCP tool the agent calls
   ([MCP](#10-agent-facing-mcp-tools-ext-mcp)) remains the choice for content the agent
   should fetch on demand rather than receive every turn. Do not add another seam in the
   provider command path.

### When a new command is unavoidable

Only commands that produce **existing** event types are acceptable. The minimal pattern: a
`Schema.Struct` with `type: Schema.Literal("loom.<slug>.<verb>")` added to
`DispatchableClientOrchestrationCommand`, and one `case` in the decider emitting existing
events. That is two seams in two of upstream's busiest files, plus an environment capability
so clients only send it to Loom servers. Prefer a fork RPC whose service dispatches existing
commands; it needs no orchestration seam at all.

---

## 13. Desktop IPC (`ext-desktop`, optional)

Prerequisite: [Server core](#1-server-core-ext-core) (for `packages/contracts/src/fork/` and
the `@t3tools/contracts/fork` export). Used by L11 (console and network collector).

### Purpose

Give packets Electron-only APIs on the client machine (native dialogs, windows, OS
integration, collectors attached to Electron web contents) as `window.desktopBridge.fork`.
Prefer server RPC: it works on web, desktop, mobile and remote. Use desktop IPC only for work
that must run in the desktop app's own process.

### Current upstream mechanism

- Main-process methods are `DesktopIpc.makeIpcMethod({ channel, payload, result, handler })`
  (`apps/desktop/src/ipc/DesktopIpc.ts:189`, e.g. `ipc/methods/window.ts:175`), installed in
  `installDesktopIpcHandlers` (`apps/desktop/src/ipc/DesktopIpcHandlers.ts:74-148`), which
  `DesktopApp.ts:180` runs once at startup.
- The preload exposes one object with
  `contextBridge.exposeInMainWorld("desktopBridge", {...})` (`apps/desktop/src/preload.ts:64`).
  The preload is bundled from `src/preload.ts` on its own (`apps/desktop/vite.config.ts:95`),
  so relative fork imports are bundled with it and must stay self-contained (Electron and
  type-only imports only).
- The bridge is typed by `DesktopBridge` (`packages/contracts/src/ipc.ts:1214`); web code
  reads `window.desktopBridge`, which is absent in browsers.

### Seams (all `fork: ext-desktop`)

**`packages/contracts/src/ipc.ts`**: a type import after the last import
(`} from "./desktopAppActivation.ts";`, line 114) and one optional member as the first line
of `DesktopBridge` (line 1214):

```diff
 } from "./desktopAppActivation.ts";
+import type { ForkDesktopBridge } from "./fork/desktop.ts"; // fork: ext-desktop
```

```diff
 export interface DesktopBridge {
+  fork?: ForkDesktopBridge; // fork: ext-desktop
   getAppBranding: () => DesktopAppBranding | null;
```

**`apps/desktop/src/ipc/DesktopIpcHandlers.ts`**: an import after the `DesktopIpc` import
(line 3) and the first statement of `installDesktopIpcHandlers` (line 74):

```diff
 import * as DesktopIpc from "./DesktopIpc.ts";
+import { installForkDesktopIpcHandlers } from "../fork/ipc.ts"; // fork: ext-desktop
```

```diff
 export const installDesktopIpcHandlers = Effect.fn("desktop.ipc.installHandlers")(function* () {
+  yield* installForkDesktopIpcHandlers(); // fork: ext-desktop
   const ipc = yield* DesktopIpc.DesktopIpc;
```

**`apps/desktop/src/preload.ts`**: an import after the `IpcChannels` import (line 11) and the
first key of the object passed to `exposeInMainWorld` (line 64):

```diff
 import * as IpcChannels from "./ipc/channels.ts";
+import { makeForkDesktopBridge } from "./fork/preload.ts"; // fork: ext-desktop
```

```diff
 contextBridge.exposeInMainWorld("desktopBridge", {
+  fork: makeForkDesktopBridge(ipcRenderer), // fork: ext-desktop
   getAppBranding: () => {
```

### Fork-owned files

**`packages/contracts/src/fork/desktop.ts`** (also add `export * from "./desktop.ts";` to
`packages/contracts/src/fork/index.ts`):

```ts
/**
 * Electron-only fork APIs exposed as `window.desktopBridge.fork`. One optional member per
 * packet, typed in the packet's contracts file. Absent in browsers and in upstream builds.
 */
export interface ForkDesktopBridge {
  // browserDevTools?: BrowserDevToolsDesktopBridge;
}
```

If lint rejects the empty interface before the first packet adds a member, use
`export type ForkDesktopBridge = { readonly [packet: string]: unknown };` in the extension
point commit, switch to the interface with the first member, and record the form that landed
here.

**`apps/desktop/src/fork/ipc.ts`**

```ts
import * as Effect from "effect/Effect";

/** Main-process installers, one line per packet. Runs first in installDesktopIpcHandlers. */
export const installForkDesktopIpcHandlers = Effect.fn("desktop.fork.installHandlers")(
  function* () {
    // yield* installBrowserDevToolsCollector();
  },
);
```

**`apps/desktop/src/fork/preload.ts`**

```ts
import type { ForkDesktopBridge } from "@t3tools/contracts/fork";
import type { IpcRenderer } from "electron";

/** Builds window.desktopBridge.fork in the preload. One line per packet. */
export const makeForkDesktopBridge = (_ipcRenderer: IpcRenderer): ForkDesktopBridge => ({
  // browserDevTools: makeBrowserDevToolsBridge(_ipcRenderer),
});
```

### Registering a packet

- Contracts: the packet's bridge type (for example `BrowserDevToolsDesktopBridge`) lives in
  `packages/contracts/src/fork/<slug>.ts`; add one optional member to `ForkDesktopBridge`.
- Main process: `apps/desktop/src/fork/<slug>/` exports an installer; add one
  `yield* install...()` line to `installForkDesktopIpcHandlers`. Use
  `DesktopIpc.makeIpcMethod` for schema-checked request and response, or plain
  `ipcMain.handle` / `webContents.send` for pushed events. Channels are
  `loom:<slug>:<name>` (CONVENTIONS.md).
- Preload: `apps/desktop/src/fork/<slug>/preload.ts` exports a bridge builder using only
  `ipcRenderer`; add one key to `makeForkDesktopBridge`.
- Web: read `window.desktopBridge?.fork?.<member>` and render "Available in the desktop app"
  (or nothing) when it is absent, so web and upstream desktop builds are unaffected.

### Existence check

```sh
test -f apps/desktop/src/fork/ipc.ts && test -f apps/desktop/src/fork/preload.ts \
  && test "$(git grep -c 'fork: ext-desktop' -- apps/desktop/src/preload.ts | cut -d: -f2)" = 2 \
  && test "$(git grep -c 'fork: ext-desktop' -- apps/desktop/src/ipc/DesktopIpcHandlers.ts | cut -d: -f2)" = 2 \
  && test "$(git grep -c 'fork: ext-desktop' -- packages/contracts/src/ipc.ts | cut -d: -f2)" = 2
```

### Tests

- `apps/desktop/src/fork/ipc.test.ts`: every channel a fork installer registers starts with
  `loom:` and is not one of upstream's channel constants (`apps/desktop/src/ipc/channels.ts`).
- Typecheck `@t3tools/desktop`, `@t3tools/contracts` and `@t3tools/web`. Run the root
  `build:desktop` script once (`vp run build:desktop`) to prove the preload still bundles.

---

## 14. Mobile (`ext-mobile-settings`, optional)

Mobile is optional by default. Fork RPCs, atoms and capability helpers already work there
through `@t3tools/client-runtime/fork`. UI needs its own seams, created only by a packet that
ships mobile UI:

- Settings screens are listed in `SettingsContentStack` (`apps/mobile/src/Stack.tsx:148-246`),
  the `SettingsSheetTarget` union
  (`apps/mobile/src/features/settings/components/settings-sheet-targets.ts:1-10`) and rows in
  `AppSettingsSection` (`apps/mobile/src/features/settings/SettingsRouteScreen.tsx:764`, used by
  both layouts at 151 and 591). Seams (`fork: ext-mobile-settings`): one `SettingsLoom` screen
  (`linking: "loom"`), one `| "SettingsLoom"` member, one
  `<SettingsRow icon="puzzlepiece" label="Loom" target="SettingsLoom" />` row. Fork files under
  `apps/mobile/src/fork/settings/`, with a section registry like the web one.
- Mobile ships through its own build; Kyle's installed mobile app may be upstream's, which
  never shows fork UI. That is a supported state.

---

## 15. Provider drivers (`ext-providers`)

Prerequisite: none (packets using it usually also use `ext-core` and `ext-settings`). Used by
L16 (provider sign-in) and L17 (more providers).

### Purpose

Let a packet (a) add a whole provider driver (L17: Gemini CLI, Copilot CLI, custom ACP
agents) and (b) decorate an upstream driver's instances (L16: attach in-app sign-in to Codex
and Claude instances), plus show the matching settings form, icon and a setup section in
**Settings > Providers**, without further upstream edits.

### Current upstream mechanism

- Drivers are plain values (`ProviderDriver<Config, R>`,
  `apps/server/src/provider/ProviderDriver.ts:134-172`). `create` returns a
  `ProviderInstance` record (`ProviderDriver.ts:67-89`) with `snapshot`, `adapter`,
  `textGeneration` and optional `snapshotForCwd`, `refreshModels`, `consumeResetCredit`,
  `auth`.
- The static list is `BUILT_IN_DRIVERS` (`apps/server/src/provider/builtInDrivers.ts:49-56`),
  typed `ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>>`. Its only consumer is
  `ProviderInstanceRegistryHydration.ts`: the import at line 55, the legacy-mirror loop at
  line 78 (a fork driver has no `settings.providers.<kind>` entry, so the loop skips it at
  lines 91-95) and `drivers: BUILT_IN_DRIVERS` at line 169.
- `ProviderDriverKind` is an open slug (`packages/contracts/src/providerInstance.ts:70`), and
  an instance's `config` is `Schema.Unknown` (`providerInstance.ts:130`), so settings entries
  for a fork driver round-trip through upstream builds, which show them as unavailable
  (`ServerProviderAvailability`, `packages/contracts/src/server.ts:143`).
- `ProviderRegistry` aggregates snapshots through `instance.snapshot.getSnapshot`, `.refresh`
  and `.streamChanges` (`apps/server/src/provider/Layers/ProviderRegistry.ts:272-274`), so a
  decorator that wraps those and `snapshotForCwd` controls what clients see.
- Web: `PROVIDER_CLIENT_DEFINITIONS`
  (`apps/web/src/components/settings/providerDriverMeta.ts:46-85`) drives the Add provider
  dialog (`AddProviderInstanceDialog.tsx:65` takes the first entry as the default driver) and
  the generic settings form, which renders any Effect Schema with `providerSettingsForm`
  annotations. Icons come from `PROVIDER_ICON_BY_PROVIDER`
  (`apps/web/src/components/chat/providerIconUtils.ts:12-19`). The provider editor renders a
  `setup` slot only for Antigravity
  (`apps/web/src/components/settings/ProviderSettingsPanel.tsx:917-931`).

### Seams (all `fork: ext-providers`)

**`apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts`**, the import at
line 55. The list name stays `BUILT_IN_DRIVERS`, so lines 78 and 169 are untouched:

```diff
-import { BUILT_IN_DRIVERS, type BuiltInDriversEnv } from "../builtInDrivers.ts";
+import type { BuiltInDriversEnv } from "../builtInDrivers.ts"; // fork: ext-providers
+import { BUILT_IN_DRIVERS } from "../../fork/providers/drivers.ts"; // fork: ext-providers
```

**`apps/web/src/components/settings/providerDriverMeta.ts`**, an import after the `../Icons`
import (line 19) and a spread as the **last** entry of `PROVIDER_CLIENT_DEFINITIONS` (before
`];` at line 85). It goes last on purpose: `DRIVER_OPTIONS[0]` is the Add dialog's default
driver.

```diff
 } from "../Icons";
+// fork: ext-providers
+import { FORK_PROVIDER_CLIENT_DEFINITIONS } from "../../fork/providers/registry";
```

```diff
     settingsSchema: AntigravitySettings,
   },
+  ...FORK_PROVIDER_CLIENT_DEFINITIONS, // fork: ext-providers
 ];
```

**`apps/web/src/components/chat/providerIconUtils.ts`**, an import after the `../Icons`
import (line 10) and a spread as the first key (line 12):

```diff
 } from "../Icons";
+// fork: ext-providers
+import { FORK_PROVIDER_ICONS } from "../../fork/providers/registry";
```

```diff
 export const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
+  ...FORK_PROVIDER_ICONS, // fork: ext-providers
   [ProviderDriverKind.make("codex")]: OpenAI,
```

**`apps/web/src/components/settings/ProviderSettingsPanel.tsx`**, an import after the
`ProviderSetupSection` import (line 85) and the `setup` slot's `null` branch (line 930):

```diff
 import { ProviderSetupSection, readAntigravityAuthMethod } from "./ProviderSetupSection";
+// fork: ext-providers
+import { ForkProviderSetupSlot } from "../../fork/providers/ForkProviderSetupSlot";
```

```diff
               onEnable={() => updateProviderInstance(row, { ...row.instance, enabled: true })}
             />
-          ) : null
+          ) : (
+            // fork: ext-providers
+            <ForkProviderSetupSlot
+              mode={mode}
+              driver={row.driver}
+              instanceId={row.instanceId}
+              instanceConfig={row.instance.config}
+              environmentId={environmentId}
+              environmentLabel={environmentLabel}
+              provider={liveProvider}
+              readOnly={readOnly}
+            />
+          )
         }
```

Run `vp fmt` on the four files. Expected marker counts: `ProviderInstanceRegistryHydration.ts`
2, `providerDriverMeta.ts` 2, `providerIconUtils.ts` 2, `ProviderSettingsPanel.tsx` 2.

### Fork-owned files

**`apps/server/src/fork/providers/drivers.ts`**

```ts
import {
  BUILT_IN_DRIVERS as UPSTREAM_BUILT_IN_DRIVERS,
  type BuiltInDriversEnv,
} from "../../provider/builtInDrivers.ts";
import type { AnyProviderDriver } from "../../provider/ProviderDriver.ts";

/**
 * A fork driver may only require services upstream drivers already require
 * (BuiltInDriversEnv); the registry layer's R is not widened.
 */
export type ForkProviderDriver = AnyProviderDriver<BuiltInDriversEnv>;

export interface ForkProviderDriverDecorator {
  /** The packet slug. */
  readonly id: string;
  /** Returns the driver unchanged when it does not apply. Must keep `driverKind`. */
  readonly decorate: (driver: ForkProviderDriver) => ForkProviderDriver;
}

/** Whole fork drivers, one line per packet. Driver kinds start with `loom`. */
export const FORK_PROVIDER_DRIVERS: ReadonlyArray<ForkProviderDriver> = [
  // ...MoreProvidersDrivers,
];

/** Applied to every upstream driver in order, one line per packet. */
export const FORK_PROVIDER_DRIVER_DECORATORS: ReadonlyArray<ForkProviderDriverDecorator> = [
  // providerSignInDecorator,
];

/** Consumed by ProviderInstanceRegistryHydration.ts (fork: ext-providers) in place of upstream's list. */
export const BUILT_IN_DRIVERS: ReadonlyArray<ForkProviderDriver> = [
  ...UPSTREAM_BUILT_IN_DRIVERS.map((driver) =>
    FORK_PROVIDER_DRIVER_DECORATORS.reduce(
      (current, decorator) => decorator.decorate(current),
      driver,
    ),
  ),
  ...FORK_PROVIDER_DRIVERS,
];
```

**`apps/web/src/fork/providers/registry.ts`**

```ts
import type { ProviderDriverKind } from "@t3tools/contracts";

import type { Icon } from "~/components/Icons";
import type { ProviderClientDefinition } from "~/components/settings/providerDriverMeta";
import type { ForkProviderSetupSection } from "./types";

/** Settings-form definitions for fork drivers. Appended after upstream's. One line per packet. */
export const FORK_PROVIDER_CLIENT_DEFINITIONS: ReadonlyArray<ProviderClientDefinition> = [
  // ...moreProvidersClientDefinitions,
];

/** Icons for fork driver kinds. */
export const FORK_PROVIDER_ICONS: Partial<Record<ProviderDriverKind, Icon>> = {
  // ...moreProvidersIcons,
};

/** Extra sections in a provider instance's editor. One line per packet. */
export const FORK_PROVIDER_SETUP_SECTIONS: ReadonlyArray<ForkProviderSetupSection> = [
  // providerSignInSetupSection,
];
```

`providerDriverMeta.ts` imports this file and this file imports a type from
`providerDriverMeta.ts`. The cycle is type-only on this side, so it erases at build time.

**`apps/web/src/fork/providers/types.ts`**

```ts
import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import type { ComponentType } from "react";

export interface ForkProviderSetupProps {
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  /** The instance's raw `config` envelope from settings. */
  readonly instanceConfig: unknown;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly provider: ServerProvider | undefined;
  readonly readOnly: boolean;
}

export interface ForkProviderSetupSection {
  /** The packet slug. */
  readonly id: string;
  readonly appliesTo: (props: ForkProviderSetupProps) => boolean;
  /** Renders its own unavailable state when the environment lacks its loomFeatures entry. */
  readonly Component: ComponentType<ForkProviderSetupProps>;
}
```

**`apps/web/src/fork/providers/ForkProviderSetupSlot.tsx`**

```tsx
import type { ForkProviderSetupProps } from "./types";
import { FORK_PROVIDER_SETUP_SECTIONS } from "./registry";

/** Rendered in the provider editor's `setup` slot when upstream renders nothing there. */
export function ForkProviderSetupSlot(
  props: ForkProviderSetupProps & { readonly mode: "list" | "editor" },
) {
  if (props.mode !== "editor") return null;
  const sections = FORK_PROVIDER_SETUP_SECTIONS.filter((section) => section.appliesTo(props));
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map(({ id, Component }) => (
        <Component key={id} {...props} />
      ))}
    </>
  );
}
```

### Registering a packet

- A driver: `apps/server/src/fork/<slug>/drivers/<Name>Driver.ts` exports a
  `ForkProviderDriver` whose `driverKind` starts with `loom` (`loomGemini`). Append it to
  `FORK_PROVIDER_DRIVERS`. Its settings schema lives in
  `packages/contracts/src/fork/<slug>.ts`; append a `ProviderClientDefinition` to
  `FORK_PROVIDER_CLIENT_DEFINITIONS` and an icon to `FORK_PROVIDER_ICONS`.
- A decorator: `apps/server/src/fork/<slug>/decorator.ts` exports a
  `ForkProviderDriverDecorator` that wraps `create` for the driver kinds it handles. Append it
  to `FORK_PROVIDER_DRIVER_DECORATORS`. A decorator never changes `driverKind`,
  `configSchema` or `defaultConfig`, and never changes what an upstream client can decode:
  it may only fill optional `ServerProvider` fields upstream already defines.
- A setup section: `apps/web/src/fork/<slug>/providerSetup.tsx` exports a
  `ForkProviderSetupSection`; append it to `FORK_PROVIDER_SETUP_SECTIONS`.

### Existence check

```sh
test -f apps/server/src/fork/providers/drivers.ts && test -f apps/web/src/fork/providers/registry.ts \
  && test "$(git grep -c 'fork: ext-providers' -- apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts | cut -d: -f2)" = 2 \
  && test "$(git grep -c 'fork: ext-providers' -- apps/web/src/components/settings/ProviderSettingsPanel.tsx | cut -d: -f2)" = 2
```

### Tests

- `apps/server/src/fork/providers/drivers.test.ts`: `BUILT_IN_DRIVERS` driver kinds are
  unique; every fork driver kind starts with `loom` and is not an upstream kind; applying the
  decorators keeps every upstream `driverKind`, `configSchema` and `defaultConfig` identical
  (reference equality).
- `apps/web/src/fork/providers/registry.test.ts`: fork client definition values are unique,
  start with `loom`, and are not upstream values; every fork definition has an icon; setup
  section ids are unique.
- Typecheck `t3` and `@t3tools/web`.

### Known limits

- The upstream Add provider dialog also lists "coming soon" entries for `githubCopilot`,
  `gemini`, `acpRegistry` and `piAgent` (`AddProviderInstanceDialog.tsx:73-94`). Fork drivers
  deliberately use different kinds (`loomGemini`, ...) so that a future upstream driver with
  the same name cannot decode a fork instance's config. Both entries can be visible at once.
- Mobile keeps its own provider icon map (`apps/mobile/src/components/ProviderIcon.tsx`);
  unknown drivers fall back to the Codex logo there (line 75), so fork drivers show that logo
  in the mobile app.
- If upstream appends a driver to `PROVIDER_CLIENT_DEFINITIONS`, the merge conflicts on the
  spread line. Keep both lines, with the spread last.

---

## 16. Provider turn input (`ext-turn-input`)

Prerequisite: server core (contributors are registered by fork services in `ForkLayer`).
Used by L03 (pinned goals), L20 (private mode) and L22 (instruction modes).

### Purpose

Let fork services add standing text (a pinned goal, instruction modes) to the text a
provider receives for a user turn, for every provider and every client, without changing
what T3's timeline shows. This replaces the "packet seam in the provider command path" that
[Orchestration](#12-orchestration-and-thread-behavior), rule 5, lists as the last resort.

### Current upstream mechanism

- Every turn for every adapter (Codex, Claude, Cursor, Grok, OpenCode, Antigravity, and
  fork drivers from `ext-providers`) passes through `ProviderService.sendTurn`
  (`apps/server/src/provider/Layers/ProviderService.ts:1569`). It decodes
  `ProviderSendTurnInput` (`packages/contracts/src/provider.ts:69-82`, input at most
  `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`, 120,000), expands assistant citations (1584-1592),
  appends attachment paths and captured-window context to the `let`
  `inputTextWithAttachmentContext` (1601-1670), and builds `const input = {` (1672). The
  persisted user message is not affected, so the transcript keeps what the user typed.
- Upstream's own compaction turn sends `/compact`-style commands through the same `sendTurn`
  (`compactThread`, `ProviderService.ts:1886-1890`).
- Native instruction channels differ per adapter (Codex per-turn `developer_instructions`,
  `CodexSessionRuntime.ts:583-605`; Claude `systemPrompt.append` fixed at session start,
  `ClaudeAdapter.ts:4724-4729`; the others their own way). Using them would take six seams in
  six of upstream's largest files. MCP cannot inject text into every turn, and client-side
  prefixing would store the text in the transcript and miss turns sent by upstream clients.
- Claude runs a skill only when `/name` is the last text block; upstream's dispatcher turns a
  `$name` mention into that block, with the text after the mention as its arguments
  (`apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts:1-24`). Text added after the
  user's message would become skill arguments, so fork text goes before it.
- Upstream already keeps per-thread provider data in a module-level registry
  (`apps/server/src/mcp/McpProviderSession.ts:37-47`).

### Design

- **Contributors, not transformers.** Each packet registers a contributor that returns one
  block of text (or nothing) for a turn. Contributors never see or edit each other's output,
  so several packets can contribute without depending on one another.
- **Deterministic order.** Blocks are prepended to the user's text sorted by `order`, then
  `id`, regardless of which packet registered first. Assigned orders:

  | Order | Contributor id              | Packet | Block                      |
  | ----- | --------------------------- | ------ | -------------------------- |
  | 5     | `small-extras-private-mode` | L20    | `<loom_private_mode>`      |
  | 10    | `instruction-modes`         | L22    | `<loom_instruction_modes>` |
  | 20    | `compaction-and-goals`      | L03    | `<loom_goal>`              |

  A new contributor adds a row here with an unused order.

- **Central passthrough rules.** The registry leaves the text unchanged when it is
  `undefined` (continuations), when it starts with `/` after leading whitespace (slash
  commands, including upstream's compaction turn), or when no contributor is registered.
  Contributors do not repeat these checks.
- **Never fails, never blocks long.** Each contributor gets 2 seconds; a failure or timeout
  is logged and skipped. A block that would push the text over
  `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` is skipped, so a nearly full message goes out without
  it rather than failing.
- **Registered at runtime.** A module-level map, not `ForkRuntime`: `sendTurn` runs on fibers
  whose context need not carry fork services. A fork service registers its contributor in its
  layer's scope, closing over whatever it needs, and the registration ends with that scope.
  Upstream's `ProviderService.test.ts` builds no `ForkLayer`, so nothing is registered and
  every turn passes through unchanged.
- The seam sits after upstream's attachment block, as an inserted statement. No upstream
  line is edited.

### Seam (`apps/server/src/provider/Layers/ProviderService.ts`, `fork: ext-turn-input`)

An import after the `../userInputAttachments.ts` import (line 56):

```diff
 import { appendUserInputAttachmentPaths } from "../userInputAttachments.ts";
+// fork: ext-turn-input
+import { applyForkTurnInput } from "../../fork/turnInput/registry.ts";
```

One statement before `const input = {` in `sendTurn` (line 1672):

```diff
       );
     }

+    // fork: ext-turn-input
+    inputTextWithAttachmentContext = yield* applyForkTurnInput(parsed.threadId, inputTextWithAttachmentContext);
     const input = {
       ...parsed,
```

Run `vp fmt`; the marker line keeps the statement attached when it wraps. Expected marker
count in `ProviderService.ts`: 2.

### Fork-owned file: `apps/server/src/fork/turnInput/registry.ts`

```ts
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

export interface ForkTurnInputContext {
  readonly threadId: ThreadId;
  /** The provider-bound text: the user's text plus upstream's citation and attachment additions. */
  readonly input: string;
}

export interface ForkTurnInputContributor {
  /** The packet slug. */
  readonly id: string;
  /** Lower goes first; ties by id. Assigned in EXTENSION-POINTS.md, Provider turn input. */
  readonly order: number;
  /** One block of text to send before the user's text, or undefined for none. */
  readonly contribute: (context: ForkTurnInputContext) => Effect.Effect<string | undefined>;
}

const contributors = new Map<string, ForkTurnInputContributor>();

/** Registered by a fork service for as long as its layer's scope lives. */
export const registerForkTurnInputContributor = (
  contributor: ForkTurnInputContributor,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => void contributors.set(contributor.id, contributor)),
    () => Effect.sync(() => void contributors.delete(contributor.id)),
  );

const CONTRIBUTOR_TIMEOUT = "2 seconds";
const BLOCK_SEPARATOR = "\n\n";

/** Called from ProviderService.sendTurn (fork: ext-turn-input). Never fails. */
export const applyForkTurnInput = (
  threadId: ThreadId,
  input: string | undefined,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    if (input === undefined || contributors.size === 0 || input.trimStart().startsWith("/")) {
      return input;
    }
    const ordered = [...contributors.values()].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
    const blocks: Array<string> = [];
    let length = input.length;
    for (const contributor of ordered) {
      const block = yield* contributor.contribute({ threadId, input }).pipe(
        Effect.timeoutOption(CONTRIBUTOR_TIMEOUT),
        Effect.map(Option.getOrUndefined),
        Effect.catchCause((cause) =>
          Effect.logWarning("Loom turn input contributor failed; skipped.", {
            id: contributor.id,
            cause,
          }).pipe(Effect.as(undefined)),
        ),
      );
      const text = block?.trim();
      if (!text) continue;
      const added = text.length + BLOCK_SEPARATOR.length;
      if (length + added > PROVIDER_SEND_TURN_MAX_INPUT_CHARS) continue;
      blocks.push(text);
      length += added;
    }
    return blocks.length === 0 ? input : [...blocks, input].join(BLOCK_SEPARATOR);
  });
```

If an Effect name differs in the installed version (`timeoutOption`, `catchCause`,
`acquireRelease`), use the equivalent and update this section in the same commit.

### Registering a packet

In the packet's service layer (inside `ForkServicesLive`):

```ts
yield *
  registerForkTurnInputContributor({
    id: "compaction-and-goals",
    order: 20,
    contribute: ({ threadId }) => goalBlockFor(threadId), // reads the packet's own state
  });
```

A contributor:

- returns a self-contained, tagged block (`<loom_<name>>...</loom_<name>>`), escaping its own
  closing tag inside user-provided text;
- reads only in-memory or indexed SQLite state it owns; never calls a provider or the
  network;
- may keep its own per-thread state (for example "last delivered") but must tolerate being
  skipped (timeout, size limit) without corrupting it.

### Existence check

```sh
test -f apps/server/src/fork/turnInput/registry.ts \
  && test "$(git grep -c 'fork: ext-turn-input' -- apps/server/src/provider/Layers/ProviderService.ts | cut -d: -f2)" = 2
```

### Tests

`apps/server/src/fork/turnInput/registry.test.ts`: with no contributor the input is returned
unchanged; `undefined` and slash-command input pass through; blocks are prepended in
`order`, then `id`, independent of registration order; a failing contributor and a slow one
(`TestClock`) are skipped while the others still apply; a block that would exceed the input
limit is skipped; closing the registering scope removes the contributor. Typecheck `t3`.
Upstream's `ProviderService.test.ts` keeps passing unchanged.

### Known limits

- The added text becomes part of the provider's own conversation history (Codex rollout,
  Claude session), though not of T3's transcript.
- `ProviderService.ts` is large and busy. The seam is one import and one statement after the
  attachment block, which has been stable; expect to reapply it by hand after a
  restructuring.

---

## 17. Diff panel header (`ext-diff-header`)

Prerequisite: none (entries usually open a fork panel, so they also use `ext-panels`). Used by
L26 (the "Impact" button) and L15 (the "Review changes" button, which starts a review).

### Purpose

Let packets add a button to the diff panel header that acts on the diff the user is looking
at. Only `DiffPanel` knows the selected scope (working tree, branch range or one turn) and
its file list. Two packets want a button at the same spot; as packet seams they would insert
at the same line and conflict with each other on every merge of either packet.

### Current upstream mechanism

`DiffPanel` (`apps/web/src/components/DiffPanel.tsx`) reads the thread from the route
(`routeThreadRef`, line 133), the selection from `useDiffPanelStore` (`diffSelection`, line
168, a `DiffPanelSelection` from `apps/web/src/diffPanelStore.ts:8-11`), derives
`selectedScopeLabel` (line 216) and the rendered files `codeViewFiles` (line 435, items carry
`filePath`). The header's right-hand action group starts at line 756 with upstream's
conditional `DiffStatLabel` and refresh buttons.

### Seams (`apps/web/src/components/DiffPanel.tsx`, all `fork: ext-diff-header`)

An import after the last import (line 87):

```diff
 import { createGitDiffFileContentsLoader } from "../lib/diffFileContents";
+// fork: ext-diff-header
+import { ForkDiffHeaderActions } from "../fork/diffHeader/ForkDiffHeaderActions";
```

The first child of the right-hand header group (line 756), clear of upstream's conditional
buttons:

```diff
       <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
+        {/* fork: ext-diff-header */}
+        <ForkDiffHeaderActions threadRef={routeThreadRef} files={codeViewFiles} scopeLabel={selectedScopeLabel} selection={diffSelection} />
         {codeViewFiles.length > 0 && (
```

Run `vp fmt`; the marker line keeps the element attached when it wraps. Expected marker
count: 2.

### Fork-owned files

**`apps/web/src/fork/diffHeader/registry.ts`**

```ts
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";

import type { DiffPanelSelection } from "~/diffPanelStore";

export interface ForkDiffHeaderActionProps {
  readonly threadRef: ScopedThreadRef | null | undefined;
  readonly files: ReadonlyArray<{ readonly filePath: string }>;
  readonly scopeLabel: string;
  readonly selection: DiffPanelSelection;
}

export interface ForkDiffHeaderAction {
  /** The packet slug. */
  readonly id: string;
  /** Renders null when it does not apply (no thread, no files, feature missing). */
  readonly Component: ComponentType<ForkDiffHeaderActionProps>;
}

/** One line per packet. Order is left-to-right order in the header. */
export const FORK_DIFF_HEADER_ACTIONS: ReadonlyArray<ForkDiffHeaderAction> = [
  // codeGraphDiffHeaderAction,
];
```

**`apps/web/src/fork/diffHeader/ForkDiffHeaderActions.tsx`**

```tsx
import { FORK_DIFF_HEADER_ACTIONS, type ForkDiffHeaderActionProps } from "./registry";

/** Fork buttons at the start of the diff panel header's action group (fork: ext-diff-header). */
export function ForkDiffHeaderActions(props: ForkDiffHeaderActionProps) {
  return (
    <>
      {FORK_DIFF_HEADER_ACTIONS.map(({ id, Component }) => (
        <Component key={id} {...props} />
      ))}
    </>
  );
}
```

### Registering a packet

`apps/web/src/fork/<slug>/diffHeaderAction.tsx` exports a `ForkDiffHeaderAction` whose
component renders an icon button styled like its neighbors (`Button size="icon-sm"
variant="ghost"` with a tooltip), gated on the thread's `loomFeatures`, and makes no request
until clicked. Append it to `FORK_DIFF_HEADER_ACTIONS`.

### Existence check

```sh
test -f apps/web/src/fork/diffHeader/registry.ts \
  && test "$(git grep -c 'fork: ext-diff-header' -- apps/web/src/components/DiffPanel.tsx | cut -d: -f2)" = 2
```

### Tests

`apps/web/src/fork/diffHeader/registry.test.ts`: action ids are unique. Typecheck
`@t3tools/web`.

---

## 18. Decisions with Jev (`ext-decide`)

Prerequisites: [Server core](#1-server-core-ext-core) (RPC group, `ForkLayer`, persistence,
capability) and [Settings](#7-settings-ext-settings) (the "Jev" section). Used by:

| Packet | Feature ids                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------- |
| L07    | `bottom-dock.approval-risk`                                                                    |
| L08    | `multi-thread-runs.delegate-routing`, `multi-thread-runs.compare-rank`                         |
| L14    | `chat-conveniences.auto-preset`                                                                |
| L15    | `ai-code-review.reviewer-pick`, `ai-code-review.turn-suggest`, `ai-code-review.finding-merge`  |
| L20    | `small-extras.branch-type`                                                                     |
| L29    | `jev-hub.playground`, `jev-hub.ask` (the Jev hub, which also reads the log and tunes features) |

### Purpose

Give packets one way to ask Jev, TypeSafe's decision model, a small typed question (Choice,
Score or Noul) and get a calibrated answer, with the parts every consumer needs in one place:
the HTTP client, the API key kept on the server, a per-feature switch (off, manual, manual plus
agents), a per-project "Jev off", secret redaction and the token budget applied to every
request, a decision log, 30-day retention of what was sent, and a guaranteed fallback. Without
it, each of six packets would carry its own client, key setting, log and redaction, and the
user would have six places to turn Jev off.

Every use of Jev is optional. A caller always has a non-Jev fallback, and `decide` resolves
within its timeout (1 second by default) and never fails, so no Loom behavior waits on or
breaks because of Jev.

### Current upstream mechanism

Nothing in upstream calls TypeSafe; this extension point adds no upstream seam. It builds on:

- **Secrets.** `ServerSecretStore` (`apps/server/src/auth/ServerSecretStore.ts:138-150`,
  `get`, `set`, `remove`) writes each secret to `<stateDir>/secrets/<name>.bin` with mode
  `0600` in a `0700` directory (`ServerSecretStore.ts:159-170,188-221`; `secretsDir` is
  `join(stateDir, "secrets")`, `apps/server/src/config.ts:145`). Upstream uses it for
  sensitive provider environment variables and usage-limit hub keys: the settings file keeps a
  redaction marker, the value lives in the store under a derived name
  (`providerEnvironmentSecretName` and `usageLimitSourceSecretName`,
  `apps/server/src/serverSettings.ts:135-151`; writes at 782 and 862-863), and clients only
  learn that a value is set (`redactProviderEnvironmentVariable` and
  `redactServerSettingsForClient`, `serverSettings.ts:153-190`). The layer is merged into
  `RuntimeCoreDependenciesLive` after `ForkLayer` (`apps/server/src/server.ts:532`), so fork
  services can use it (see "What ForkLayer can use").
- **Settings scope.** Upstream settings updates, including secret values, need
  `orchestration:operate` (`WS_METHODS.serverUpdateSettings`,
  `apps/server/src/auth/RpcAuthorization.ts:52`); reads need `orchestration:read` (51).
- **Thread to project.** `ProjectionSnapshotQuery.getThreadShellById`
  (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217-219`) resolves a
  thread's project for the per-project switch.
- **Background work.** `forkParked` (`apps/server/src/serverActivation.ts:11-26`) starts the
  retention job after server activation ([Background work](#4-background-work-and-reactors)).
- **Outbound HTTP.** Global `fetch` (Node 24, `package.json` engines). The server also has
  Effect's `FetchHttpClient` at the outermost layer (`server.ts:801`); a plain `fetch` with an
  injectable implementation keeps the client dependency-free and trivially testable.
- **Jev API** (TypeSafe docs, 2026-09-24): `POST https://api.typesafe.ai/v1/systemone` with
  `Authorization: Bearer <key>` and `{ state, model, questions }`; answers per question id plus
  `usage.input_tokens` and `output_tokens`; errors `401`, `422`, `429` (back off, honor
  `retry-after`), `529`; `GET /v1/models` lists the aliases the account can use
  (<https://docs.typesafe.ai/api>, <https://docs.typesafe.ai/models>). Limits: 64k tokens per
  request, 32k for `state` plus the longest question, at most 255 Choice options, Score levels
  2 to 10. `jev-latest` and `jev-preview` currently resolve to `jev-1.13.0`; pin the versioned
  id once a feature's threshold is tuned. Choice and Score answers carry `confidence`; Noul
  answers do not (<https://docs.typesafe.ai/confidence>). Price: $0.042 per million input
  tokens, output free (subject to change).

### Design

- **One service, `LoomDecide`,** in `ForkLayer`. Consumers call
  `decide(featureId, { state, questions, threshold? }, { origin, threadId?, projectId? })` and
  get `{ status: "answered", answers, model, latencyMs, decisionId }` or
  `{ status: "fallback", reason }`, with `reason` one of `disabled`, `no-key`, `project-off`,
  `agent-not-allowed`, `timeout`, `error`, `low-confidence`. Fallbacks for requests that were
  sent (`timeout`, `error`, `low-confidence`) also carry the `decisionId`; `low-confidence`
  carries the `answers` too, so a caller can say "Jev suggested X, not sure enough".
- **A static feature registry,** like the other registries: each consumer adds one
  `DecideFeature` (`{ id, packet, label, description, defaultMode, defaultThreshold?,
agentTool? }`) with id `<packet-slug>.<name>` and `packet` the packet id (`"L15"`). The Jev
  settings section lists every registered feature, grouped by packet.
- **Modes per feature**, stored only when the user changes them: `off`; `manual` (uses the user
  starts, and automatic Loom uses such as a suggestion after a turn); `manual-agents` (also
  agents, through the feature's MCP tool). The UI shows two switches: "Use Jev" (off or
  manual) and "Let agents use this" (manual plus agents), off by default. A feature
  registered with `agentTool: false` (no MCP tool reaches it, for example
  `chat-conveniences.auto-preset`, `bottom-dock.approval-risk`,
  `multi-thread-runs.compare-rank`) has only `off` and `manual`: the settings UI hides "Let
  agents use this", `updateFeature` rejects `manual-agents` for it, and a stored
  `manual-agents` row is read as `manual`. `agentTool` defaults to true.
- **Order of checks** in `decide`, each returning a fallback without contacting TypeSafe:
  global "Use Jev" off or feature `off` (`disabled`); `origin: "agent"` without
  `manual-agents` (`agent-not-allowed`); the project, given or derived from `threadId`, has
  "Jev off for this project" (`project-off`); no key (`no-key`). Then the request is built:
  question overrides applied, questions validated, state redacted, budget fitted. A request
  that cannot be made valid (over 255 options, Score levels outside 2 to 10, questions alone
  over budget) is `error` and is not sent.
- **Redaction and budget cannot be skipped.** `decide` always runs `redactState` and
  `fitBudget` on the state it sends, even when the caller already did. Both are exported so
  consumers can preview exactly what will be sent.
- **Log every request that was sent** in `fork_decide_decisions`: feature, origin, thread and
  project, requested and answering model, the state exactly as sent, the questions (deduped by
  hash), the answers, status and fallback reason, threshold, latency, tokens, redaction
  counts, and a rating column that L29 fills. Requests that were never sent are not logged.
- **Threshold, applied by `decide` itself.** The effective threshold is the call's
  `threshold`, else the feature's configured threshold (the user's value from L29 Tuning,
  else the registry's `defaultThreshold`), else none. It applies to every Choice and Score
  answer in the request: when any of their `confidence` values is below it, `decide` returns
  `{ status: "fallback", reason: "low-confidence", answers, lowConfidenceKeys, decisionId }`,
  where `lowConfidenceKeys` lists the question ids that fell below the threshold. Callers never
  re-check confidence against the threshold; a caller that can still use part of a
  low-confidence result (one confident question of two) reads `answers` for the keys not in
  `lowConfidenceKeys`.
  Noul answers carry no confidence and are never gated; the caller applies its own cut-off
  to the `noul` value. So that L29's tuning takes effect, consumers put their threshold in
  `defaultThreshold` and pass `threshold` only when a call genuinely needs a different one.
- **Question overrides.** A feature's stored settings may carry per-question overrides of the
  wording (written by L29's "Use for this feature"; empty otherwise). Overrides never add or
  remove Choice options or change a Score's level count, so the caller's code paths stay
  valid.
- **Timeouts and retries.** Default timeout 1,000 ms, per call `timeoutMs` for user-started
  work (L29's playground uses 10 seconds). `decide` never retries; a `429` or `529` is an
  `error` fallback. `evaluate` (unlogged, for L29's replays) retries `429` and `529` with
  exponential backoff that honors `retry-after`. At most 8 requests are in flight per server.
- **The key** lives in `ServerSecretStore` under `loom-decide-jev-api-key`. It is never
  returned by any RPC, never logged, and never sent to clients; clients see only whether a key
  is set, when, and the last test result.
- **Retention.** A job nulls `state_json` on decisions older than 30 days unless they are
  rated or kept (in an L29 test set). Answers, ratings and metadata stay until the user deletes
  them (L29). It runs once after activation and then every 24 hours.
- **Capability** `decide` in `LOOM_SERVER_FEATURES`. Clients hide every Jev control when it
  is absent, which covers upstream servers and Loom servers built without this extension
  point.

### Seams

None. Every registration goes into fork-owned registry files of `ext-core` and
`ext-settings`.

### Fork-owned files

**`packages/contracts/src/fork/decide.ts`** (add `export * from "./decide.ts";` to
`packages/contracts/src/fork/index.ts` and `DecideRpcGroup,` to the `.merge(` in
`packages/contracts/src/fork/rpc.ts`):

```ts
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const DECIDE_WS_METHODS = {
  getSettings: "loom.decide.getSettings",
  updateSettings: "loom.decide.updateSettings",
  updateFeature: "loom.decide.updateFeature",
  setProjectOff: "loom.decide.setProjectOff",
  setKey: "loom.decide.setKey",
  removeKey: "loom.decide.removeKey",
  testKey: "loom.decide.testKey",
} as const;

/** Jev 1.13 limits and Loom defaults (https://docs.typesafe.ai/models, /api). */
export const JEV_LIMITS = {
  stateAndLongestQuestionTokens: 32_000,
  requestTokens: 64_000,
  choiceOptionsMax: 255,
  scoreLevelsMin: 2,
  scoreLevelsMax: 10,
  defaultTimeoutMs: 1_000,
  stateRetentionDays: 30,
} as const;

export const JEV_DEFAULT_MODEL = "jev-latest";

/** String, object, array or null, as the API accepts for instructions and criteria entries. */
export const JevEntry = Schema.Json;

export const JevNoulQuestion = Schema.Struct({
  type: Schema.Literal("noul"),
  instructions: JevEntry,
  criteria: Schema.optionalKey(
    Schema.Struct({ true: Schema.optionalKey(JevEntry), false: Schema.optionalKey(JevEntry) }),
  ),
});
export const JevChoiceQuestion = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: JevEntry,
  criteria: Schema.Record(Schema.String, JevEntry),
});
export const JevScoreQuestion = Schema.Struct({
  type: Schema.Literal("score"),
  instructions: JevEntry,
  criteria: Schema.Array(JevEntry),
});
export const JevQuestion = Schema.Union([JevNoulQuestion, JevChoiceQuestion, JevScoreQuestion]);
export type JevQuestion = typeof JevQuestion.Type;
export const JevQuestions = Schema.Record(Schema.String, JevQuestion);
export type JevQuestions = typeof JevQuestions.Type;

export const JevAnswer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    probabilities: Schema.Record(Schema.String, Schema.Number),
    confidence: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Number,
    legend: Schema.Record(Schema.String, Schema.String),
    probabilities: Schema.Record(Schema.String, Schema.Number),
    confidence: Schema.Number,
  }),
]);
export type JevAnswer = typeof JevAnswer.Type;
export const JevAnswers = Schema.Record(Schema.String, JevAnswer);

/**
 * Choice and Score: the API's confidence (the value `decide` gates on). Noul has none; for
 * display and calibration only, its distance from 0.5. `decide` never gates Noul answers.
 */
export const answerConfidence = (answer: JevAnswer): number =>
  answer.type === "noul" ? Math.abs(2 * answer.noul - 1) : answer.confidence;

export const DecideMode = Schema.Literals(["off", "manual", "manual-agents"]);
export type DecideMode = typeof DecideMode.Type;
export const DecideOrigin = Schema.Literals(["user", "agent", "auto"]);
export type DecideOrigin = typeof DecideOrigin.Type;
export const DecideFallbackReason = Schema.Literals([
  "disabled",
  "no-key",
  "project-off",
  "agent-not-allowed",
  "timeout",
  "error",
  "low-confidence",
]);
export type DecideFallbackReason = typeof DecideFallbackReason.Type;

/** What `LoomDecide.decide` returns; also served by L29's playground RPC. */
export const DecideResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("answered"),
    answers: JevAnswers,
    /** The versioned id that answered, e.g. "jev-1.13.0". */
    model: Schema.String,
    latencyMs: Schema.Number,
    decisionId: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("fallback"),
    reason: DecideFallbackReason,
    /** Present when the request was sent and logged (timeout, error, low-confidence). */
    decisionId: Schema.optionalKey(Schema.String),
    /** Present for low-confidence. */
    answers: Schema.optionalKey(JevAnswers),
    /** Present for low-confidence: the question ids whose confidence fell below the threshold. */
    lowConfidenceKeys: Schema.optionalKey(Schema.Array(Schema.String)),
    /** Short and safe to show, e.g. "over-budget" or "TypeSafe returned 529". */
    detail: Schema.optionalKey(Schema.String),
  }),
]);
export type DecideResult = typeof DecideResult.Type;

/** `evaluate` (unlogged) could not send the request. */
export class DecideUnavailableError extends Schema.TaggedError<DecideUnavailableError>()(
  "DecideUnavailableError",
  {
    reason: Schema.Literals(["disabled", "no-key", "over-budget", "invalid-question"]),
    message: Schema.String,
  },
) {}

/** Replaces wording only. Choice criteria merge by existing option key; Score only at equal length. */
export const DecideQuestionOverride = Schema.Struct({
  instructions: Schema.optionalKey(JevEntry),
  criteria: Schema.optionalKey(Schema.Json),
  /** Display only: the L29 template it came from. */
  templateName: Schema.optionalKey(Schema.String),
});

export const DecideFeatureView = Schema.Struct({
  id: Schema.String,
  packet: Schema.String,
  label: Schema.String,
  description: Schema.String,
  defaultMode: DecideMode,
  mode: DecideMode,
  /** False: no MCP tool reaches this feature; only "off" and "manual" apply. */
  agentTool: Schema.Boolean,
  defaultThreshold: Schema.NullOr(Schema.Number),
  /** The user's value (L29 calibration); null uses the call's or the default. */
  threshold: Schema.NullOr(Schema.Number),
  /** A pinned versioned id such as "jev-1.13.0"; null means JEV_DEFAULT_MODEL. */
  model: Schema.NullOr(Schema.String),
  overrides: Schema.Record(Schema.String, DecideQuestionOverride),
});
export type DecideFeatureView = typeof DecideFeatureView.Type;

export const DecideKeyStatus = Schema.Struct({
  set: Schema.Boolean,
  updatedAt: Schema.NullOr(IsoDateTime),
  lastTest: Schema.NullOr(
    Schema.Struct({ at: IsoDateTime, ok: Schema.Boolean, message: Schema.String }),
  ),
});

export const DecideRedaction = Schema.Struct({
  /** Globs relative to a checkout root, e.g. "config/secrets/**". `.env*` is always excluded. */
  paths: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(200))).check(
    Schema.isMaxLength(100),
  ),
  /** Literal strings replaced wherever they appear. */
  literals: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(200))).check(
    Schema.isMaxLength(100),
  ),
});

export const DecideSettingsView = Schema.Struct({
  enabled: Schema.Boolean,
  key: DecideKeyStatus,
  features: Schema.Array(DecideFeatureView),
  projectsOff: Schema.Array(ProjectId),
  redaction: DecideRedaction,
});
export type DecideSettingsView = typeof DecideSettingsView.Type;

export const JevModelInfo = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  releaseDate: Schema.String,
});

export class DecideSettingsError extends Schema.TaggedError<DecideSettingsError>()(
  "DecideSettingsError",
  {
    reason: Schema.Literals([
      "unknown-feature",
      "invalid-mode", // manual-agents for a feature registered with agentTool: false
      "invalid-threshold",
      "invalid-model",
      "invalid-override",
      "storage",
    ]),
    message: Schema.String,
  },
) {}

const DecideError = Schema.Union([DecideSettingsError, EnvironmentAuthorizationError]);

const GetSettingsRpc = Rpc.make(DECIDE_WS_METHODS.getSettings, {
  payload: Schema.Struct({}),
  success: DecideSettingsView,
  error: DecideError,
});
// updateSettings { enabled?, redaction? } -> DecideSettingsView
// updateFeature { featureId, mode?, threshold?: number | null, model?: string | null,
//   overrides?: Record<string, DecideQuestionOverride> } -> DecideSettingsView
// setProjectOff { projectId, off: boolean } -> DecideSettingsView
//   (an explicit choice: setProjectOverride(projectId, off ? "off" : "on"))
// setKey { key: string (8 to 512 chars, trimmed) } -> DecideSettingsView (never echoes the key)
// removeKey {} -> DecideSettingsView
// testKey {} -> { ok: boolean, status: number | null, message: string, models: JevModelInfo[] }
//   (calls GET /v1/models; a rejected key is ok: false, not an RPC error)
// Every error: DecideError.

export const DecideRpcGroup = RpcGroup.make(
  GetSettingsRpc,
  // ...the rest
);
```

**`apps/server/src/fork/decide/registry.ts`**

```ts
import type { DecideMode } from "@t3tools/contracts/fork";

export interface DecideFeature {
  /** `<packet-slug>.<name>`, e.g. "ai-code-review.reviewer-pick". */
  readonly id: string;
  /** The owning packet's id, e.g. "L15". */
  readonly packet: string;
  /** Short, user-facing, e.g. "Pick the reviewer model". */
  readonly label: string;
  /** One sentence: what Jev decides and what happens without it. */
  readonly description: string;
  readonly defaultMode: DecideMode;
  /** 0 to 1. Answers below it fall back with "low-confidence". */
  readonly defaultThreshold?: number;
  /** False when no MCP tool reaches the feature: modes are only off and manual. Default true. */
  readonly agentTool?: boolean;
}

/** One line per consumer. Order is the order in the Jev settings section. */
export const FORK_DECIDE_FEATURES: ReadonlyArray<DecideFeature> = [
  // ...aiCodeReviewDecideFeatures,
];

export const findDecideFeature = (id: string): DecideFeature | null =>
  FORK_DECIDE_FEATURES.find((feature) => feature.id === id) ?? null;
```

**`apps/server/src/fork/decide/JevClient.ts`**

```ts
import type { JevAnswers, JevQuestions } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const JEV_API_BASE_URL = "https://api.typesafe.ai";

export interface JevRequest {
  readonly state: Schema.Json;
  readonly model: string;
  readonly questions: JevQuestions;
}
export interface JevResponse {
  readonly model: string;
  readonly answers: typeof JevAnswers.Type;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export class JevCallError extends Schema.TaggedError<JevCallError>()("JevCallError", {
  reason: Schema.Literals([
    "timeout",
    "unauthorized", // 401
    "invalid-request", // 422
    "rate-limited", // 429
    "overloaded", // 529
    "http",
    "network",
    "decode",
  ]),
  status: Schema.optionalKey(Schema.Number),
  retryAfterMs: Schema.optionalKey(Schema.Number),
  /** Never contains the key or the request body. */
  message: Schema.String,
}) {}

export interface JevClientOptions {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch; // injected in tests
  readonly baseUrl?: string;
}

/** Direct HTTP client for POST /v1/systemone and GET /v1/models. No SDK, no retries. */
export const makeJevClient = (options: JevClientOptions) => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? JEV_API_BASE_URL;
  const headers = {
    authorization: `Bearer ${options.apiKey}`,
    "content-type": "application/json",
  };
  const call = (path: string, init: RequestInit, timeoutMs: number) =>
    Effect.tryPromise({
      // Interrupting the effect (the timeout below) aborts the signal and the request.
      try: (signal) => fetchImpl(`${baseUrl}${path}`, { ...init, headers, signal }),
      catch: (cause) => new JevCallError({ reason: "network", message: networkMessage(cause) }),
    }).pipe(
      Effect.flatMap((response) => (response.ok ? readJson(response) : httpError(response))),
      Effect.timeoutFail({
        duration: timeoutMs,
        onTimeout: () =>
          new JevCallError({ reason: "timeout", message: `No answer in ${timeoutMs} ms.` }),
      }),
    );
  return {
    systemOne: (request: JevRequest, timeoutMs: number): Effect.Effect<JevResponse, JevCallError> =>
      call("/v1/systemone", { method: "POST", body: JSON.stringify(request) }, timeoutMs).pipe(
        Effect.flatMap(decodeSystemOneResponse), // maps usage.input_tokens -> inputTokens
      ),
    listModels: (timeoutMs: number) =>
      call("/v1/models", { method: "GET" }, timeoutMs).pipe(Effect.flatMap(decodeModelsResponse)),
  };
};
export type JevClient = ReturnType<typeof makeJevClient>;
```

`httpError` maps 401, 422, 429 and 529 to their reasons, reads `retry-after` (seconds or an
HTTP date) into `retryAfterMs`, and keeps at most 300 characters of the response body's
message. If an Effect name differs in the installed version (`tryPromise` with a signal,
`timeoutFail`), use the equivalent and update this section in the same commit.

**`apps/server/src/fork/decide/redact.ts`**

```ts
import type * as Schema from "effect/Schema";

export interface Redaction {
  /** JSON pointer into the state, e.g. "/turn/diff" or "/files/2". */
  readonly path: string;
  readonly kind: string; // "env-file", "excluded-path", "private-key", "github-token", "literal", ...
  readonly count: number;
}

export interface RedactOptions {
  /** User globs from settings; `.env` and `.env.*` are always excluded. */
  readonly excludedPaths?: ReadonlyArray<string>;
  /** User literal strings from settings. */
  readonly literals?: ReadonlyArray<string>;
}

/** Pure. Removes secrets from any JSON state. Idempotent. */
export function redactState(
  state: Schema.Json,
  options?: RedactOptions,
): { readonly state: Schema.Json; readonly redactions: ReadonlyArray<Redaction> };
```

Rules, applied to every string leaf and object while walking the value:

1. **Excluded files.** An object with a string `path` or `file` field whose basename is `.env`
   or starts with `.env.`, or that matches a user glob, keeps that field and has every other
   string field replaced with `[redacted: excluded file]` (kind `env-file` or
   `excluded-path`). An object key that is itself such a path has its value replaced the same
   way. A string containing unified diff sections (`diff --git a/...`) loses the sections of
   excluded files, keeping one line `[redacted: diff of <path>]`.
2. **Key-like strings**, replaced with `[redacted: <kind>]`: PEM private key blocks
   (`-----BEGIN ... PRIVATE KEY-----` to its `END` line), AWS access key ids
   (`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`), GitHub tokens (`gh[pousr]_[A-Za-z0-9]{36,}`,
   `github_pat_[A-Za-z0-9_]{50,}`), `sk-` style API keys (`\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}`,
   which covers OpenAI, Anthropic and TypeSafe style keys), Slack tokens
   (`xox[abprs]-[A-Za-z0-9-]{10,}`), Google API keys (`AIza[0-9A-Za-z_-]{35}`), Stripe keys
   (`(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}`), JWTs (three base64url parts, the first two
   starting `eyJ`), the token after `Bearer `, credentials in URLs
   (`scheme://user:<secret>@`), and the value in assignments such as
   `API_KEY=...`, `"password": "..."` or `client_secret: ...` (names matching
   `api[_-]?key|secret|token|passw(or)?d|pwd|access[_-]?key|private[_-]?key`, values of 8 or
   more non-space characters).
3. **User literals** from settings, replaced with `[redacted: literal]`.

Globs support `*`, `**` and `?` through a 20-line converter in the same file (no dependency;
Node's `path.matchesGlob` is avoided because older supported Node versions flag it as
experimental). The result lists each redaction with its JSON pointer and count, never the
removed text.

**`apps/server/src/fork/decide/budget.ts`**

```ts
import { JEV_LIMITS, type JevQuestions } from "@t3tools/contracts/fork";
import type * as Schema from "effect/Schema";

/** Conservative estimate: UTF-8 bytes / 3, rounded up. Jev's tokenizer is not public. */
export const estimateTokens = (value: Schema.Json): number =>
  Math.ceil(Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value)) / 3);

export interface BudgetReport {
  readonly stateTokens: number;
  readonly longestQuestionTokens: number;
  readonly questionsTokens: number;
  /** stateTokens + longestQuestionTokens, compared with 32k. */
  readonly primaryTokens: number;
  /** stateTokens + questionsTokens, compared with 64k. */
  readonly totalTokens: number;
}

export interface Trim {
  readonly path: string; // JSON pointer
  readonly removedChars?: number;
  readonly removedItems?: number;
}

/** Pure. Trims the state until both limits hold, or reports that it cannot. */
export function fitBudget(
  state: Schema.Json,
  questions: JevQuestions,
  limits?: { readonly primary?: number; readonly total?: number },
): {
  readonly state: Schema.Json;
  readonly before: BudgetReport;
  readonly after: BudgetReport;
  readonly trimmed: ReadonlyArray<Trim>;
  /** False when the questions alone exceed the limits; the request must not be sent. */
  readonly fits: boolean;
};
```

Trimming, repeated until the limits hold: drop elements from the start of the longest array
(oldest first; context builders put the oldest items first), then shorten the longest string
leaf from its middle to half its length with a `[... N characters trimmed ...]` marker. A
string state is shortened the same way. Limits default to `JEV_LIMITS`. The estimate is
deliberately high (about 3 bytes per token for code and JSON, where English prose runs near
4), so a fitted request is under the real limit; the log records the real `input_tokens`
next to the estimate.

**`apps/server/src/fork/decide/diffExcerpt.ts`**

```ts
export interface DiffExcerptFile {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
  readonly included: "full" | "partial" | "header-only" | "redacted";
}

/** Pure. A capped excerpt of a unified diff, with per-file line counts computed in code. */
export function diffExcerpt(
  diff: string,
  options: { readonly maxTokens: number; readonly excludedPaths?: ReadonlyArray<string> },
): {
  readonly text: string;
  readonly files: ReadonlyArray<DiffExcerptFile>;
  readonly totals: { readonly files: number; readonly added: number; readonly removed: number };
  readonly truncated: boolean;
};
```

Parses `diff --git` sections and their hunks. `.env*` files and user-excluded paths become
`redacted` (header line only). Binary files are `header-only`. Every other file keeps its
`diff --git` and `@@` headers; hunks are added in file order, one hunk per file per round, until
`maxTokens` (by `estimateTokens`) is reached; files cut short end with
`[N more hunks omitted]`. Counts come from `+` and `-` lines, excluding `+++` and `---`.

**`apps/server/src/fork/decide/overrides.ts`**

```ts
/** Pure. Applies stored wording overrides without changing option keys or level counts. */
export function applyQuestionOverrides(
  questions: JevQuestions,
  overrides: Readonly<Record<string, DecideQuestionOverride>>,
): JevQuestions;
```

For each question key with an override: `instructions` replaces the question's instructions,
except when the original is an object with a `question` field, where only that field is
replaced (callers put data next to it). Choice `criteria` (an object) replaces the
descriptions of option keys present in both; options are never added or removed. Score
`criteria` (an array) applies only when its length equals the call's. Noul `criteria` (an
object with `true` and `false`) replaces the call's. An override that does not apply is
ignored and logged at debug level.

**`apps/server/src/fork/decide/migrations.ts`** (slug `decide`, tracking table
`fork_migrations_decide`, added to `FORK_MIGRATION_SETS`), migration 1 `"Decisions"`:

```sql
CREATE TABLE IF NOT EXISTS fork_decide_decisions (
  decision_id       TEXT PRIMARY KEY,              -- 'dcs_<uuid>'
  feature_id        TEXT NOT NULL,
  origin            TEXT NOT NULL,                 -- user | agent | auto
  thread_id         TEXT,
  project_id        TEXT,
  model_requested   TEXT NOT NULL,                 -- 'jev-latest' or a pinned id
  model             TEXT,                          -- versioned id that answered; NULL without an answer
  state_json        TEXT,                          -- exactly what was sent; NULL after the 30-day purge
  state_purged_at   TEXT,
  questions_hash    TEXT NOT NULL,                 -- fork_decide_question_sets
  answers_json      TEXT,                          -- NULL for timeout and error
  status            TEXT NOT NULL,                 -- answered | fallback
  fallback_reason   TEXT,                          -- timeout | error | low-confidence
  error_detail      TEXT,                          -- short; never the key or the state
  threshold         REAL,
  latency_ms        INTEGER NOT NULL,
  estimated_tokens  INTEGER NOT NULL,
  input_tokens      INTEGER,                       -- from usage; NULL without an answer
  output_tokens     INTEGER,
  redactions_json   TEXT NOT NULL DEFAULT '[]',    -- Redaction[] (kinds, paths, counts)
  rating_json       TEXT,                          -- per question key, written by L29
  rated_at          TEXT,
  kept              INTEGER NOT NULL DEFAULT 0,    -- 1 while in an L29 test set
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_decide_decisions_feature ON fork_decide_decisions (feature_id, created_at);
CREATE INDEX IF NOT EXISTS fork_decide_decisions_created ON fork_decide_decisions (created_at);
CREATE INDEX IF NOT EXISTS fork_decide_decisions_thread ON fork_decide_decisions (thread_id);

CREATE TABLE IF NOT EXISTS fork_decide_question_sets (
  questions_hash  TEXT PRIMARY KEY,                -- sha256 of the canonical JSON
  questions_json  TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_decide_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json  TEXT NOT NULL,                    -- enabled, redaction, key metadata (never the key)
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_decide_features (
  feature_id      TEXT PRIMARY KEY,
  mode            TEXT NOT NULL,
  threshold       REAL,
  model           TEXT,
  overrides_json  TEXT NOT NULL DEFAULT '{}',
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_decide_projects (
  project_id  TEXT PRIMARY KEY,
  jev_off     INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);
```

All tables follow `fork_<slug>_<noun>` with the slug `decide`. A `fork_decide_projects` row
records an explicit choice (`jev_off` 1 or 0); no row means the user never chose, which
packets such as L20 use to apply their own default without overriding the user. No foreign keys into upstream
tables. A feature row exists only after the user changes something; otherwise the registry
defaults apply. Rows of features no longer registered are kept and shown in L29 as "Removed
feature".

**`apps/server/src/fork/decide/LoomDecide.ts`**

```ts
import type { ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  DecideOrigin,
  DecideResult,
  DecideSettingsError,
  DecideSettingsView,
  DecideUnavailableError,
  DecisionPage,
  DecisionQuery,
  DecisionRating,
  DecisionRecord,
  JevQuestions,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

import type { JevCallError, JevResponse } from "./JevClient.ts";

export interface DecideRequest {
  readonly state: Schema.Json;
  readonly questions: JevQuestions;
  /** Overrides the feature's configured threshold for this call; gates Choice and Score answers. */
  readonly threshold?: number;
}

export interface DecideCallContext {
  readonly origin: DecideOrigin;
  readonly threadId?: ThreadId;
  readonly projectId?: ProjectId;
  /** Default JEV_LIMITS.defaultTimeoutMs. */
  readonly timeoutMs?: number;
}

export class LoomDecide extends Context.Service<
  LoomDecide,
  {
    /** Never fails. Resolves within timeoutMs plus local work. */
    readonly decide: (
      featureId: string,
      request: DecideRequest,
      context: DecideCallContext,
    ) => Effect.Effect<DecideResult>;
    /** Unlogged call for L29 replays: same key, enabled check, redaction and budget; retries 429/529. */
    readonly evaluate: (
      request: DecideRequest & { readonly model: string },
      options: { readonly timeoutMs: number; readonly retries: number },
    ) => Effect.Effect<JevResponse, JevCallError | DecideUnavailableError>;
    readonly settings: Effect.Effect<DecideSettingsView, DecideSettingsError>;
    /** The project's explicit Jev choice: "off", "on", or null when the user never chose. */
    readonly getProjectOverride: (
      projectId: ProjectId,
    ) => Effect.Effect<"on" | "off" | null, DecideSettingsError>;
    /** Writes the fork_decide_projects row ("on" / "off"), or deletes it for null. */
    readonly setProjectOverride: (
      projectId: ProjectId,
      value: "on" | "off" | null,
    ) => Effect.Effect<void, DecideSettingsError>;
    // updateSettings, updateFeature, setProjectOff, setKey, removeKey, testKey (the RPCs)
    readonly log: DecisionLog;
  }
>()("loom/decide/LoomDecide") {}

/** Read and maintain fork_decide_decisions. Used by L29; consumers never need it. */
export interface DecisionLog {
  readonly list: (query: DecisionQuery) => Effect.Effect<DecisionPage, DecideSettingsError>;
  readonly get: (decisionId: string) => Effect.Effect<DecisionRecord | null, DecideSettingsError>;
  /** null clears the rating. */
  readonly rate: (
    decisionId: string,
    rating: DecisionRating | null,
  ) => Effect.Effect<void, DecideSettingsError>;
  readonly setKept: (decisionId: string, kept: boolean) => Effect.Effect<void, DecideSettingsError>;
  readonly remove: (
    target: { readonly decisionIds: ReadonlyArray<string> } | { readonly featureId: string },
  ) => Effect.Effect<number, DecideSettingsError>;
  /** Ids of decisions as they are logged or changed. Small; never carries state. */
  readonly changes: Stream.Stream<{ readonly decisionId: string; readonly featureId: string }>;
  /** Nulls state older than the retention window unless rated or kept. Returns rows purged. */
  readonly purgeExpiredState: (now: Date) => Effect.Effect<number, DecideSettingsError>;
}
```

`DecisionQuery`, `DecisionPage`, `DecisionRecord` and `DecisionRating` are schemas in
`packages/contracts/src/fork/decide.ts` next to the others, so L29 serves them without
redefining them:

- `DecisionRating`: `Record<questionKey, { verdict: "right" } | { verdict: "wrong", expected: string | number | boolean }>`
  (a Choice option key, a Score level index, or a Noul yes/no).
- `DecisionQuery`: optional `featureId`, `origin`, `status`, `reason`, `rated`
  (`"any" | "unrated" | "right" | "wrong"`), `model`, `threadId`, `projectId`, `since`,
  `until`; `cursor` (opaque, `created_at` plus id) and `limit` (at most 100).
- `DecisionPage`: `items` (summary rows without state or questions), `nextCursor`, and
  `totals` for the whole filter (`count`, `answered`, `fallbacks`, `inputTokens`,
  `averageLatencyMs`).
- `DecisionRecord`: every column, with `state` null after the purge and `questions` resolved
  from the question set.
- `Redaction`, `Trim` and `BudgetReport`: schema versions of the interfaces `redactState` and
  `fitBudget` return (below), so previews can cross the wire.

The layer, in outline:

```ts
export const layer = Layer.effect(
  LoomDecide,
  Effect.gen(function* () {
    const store = yield* DecideStore; // repository over SqlClient, below
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const projections = yield* ProjectionSnapshotQuery;
    const inFlight = yield* Semaphore.make(8);
    const changes = yield* PubSub.unbounded<{ decisionId: string; featureId: string }>();
    const key = yield* Ref.make<Option.Option<string>>(yield* readKey(secrets)); // refreshed by setKey/removeKey

    // Retention: once after activation, then every 24 hours.
    yield* forkParked(
      purgeExpiredState(new Date()).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Loom decide: retention purge failed.", { cause }),
        ),
        Effect.repeat(Schedule.spaced("24 hours")),
      ),
    );

    const decide = (featureId, request, context) =>
      Effect.gen(function* () {
        // 1. registry lookup (unknown id: error fallback and a warning), settings, feature row
        // 2. disabled / agent-not-allowed / project-off / no-key, in that order, not logged
        // 3. applyQuestionOverrides, validate limits (error, not sent)
        // 4. redactState, then fitBudget (fits false: error "over-budget", not sent)
        // 5. inFlight.withPermits(1)(client.systemOne({ state, model, questions }, timeoutMs))
        // 6. threshold (call, else configured, else default) over Choice and Score
        //    confidences -> answered, or low-confidence with the answers and lowConfidenceKeys
        // 7. store.insertDecision(...) then PubSub.publish(changes, ...)
      }).pipe(
        Effect.catchCause(/* log a warning, return { status: "fallback", reason: "error" } */),
      );
    // ...
  }),
).pipe(Layer.provide(DecideStore.layer));
```

The key is read with `secrets.get("loom-decide-jev-api-key")` and decoded as UTF-8;
`setKey` trims it and writes it with `secrets.set`, updating `key.updatedAt` in the settings
row; `removeKey` calls `secrets.remove`. A failed secret read is treated as "no key" and
logged without the value. `testKey` calls `listModels` with a 5-second timeout and records
`lastTest`. Names of Effect modules (`Semaphore`, `PubSub`, `Schedule`, `Ref`) follow the
installed version; use the equivalents if they differ.

**`apps/server/src/fork/decide/DecideStore.ts`**: the repository (upstream pattern
`apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`). Pure SQL: read
and write settings, feature rows, project rows, question sets (insert or ignore by hash),
decisions (insert, page with totals, get, rate, keep, delete, purge). Every JSON column is
decoded with its schema; a row that fails to decode is skipped with a warning.

**`apps/server/src/fork/decide/rpc.ts`**: `makeDecideRpcHandlers(auth)`, one thin handler per
tag, spread into `ForkRpcGroup.of({...})`. Scopes in `FORK_RPC_REQUIRED_SCOPES`:
`getSettings` `orchestration:read`; every other tag `orchestration:operate` (the same scope
upstream requires to update settings and sensitive provider variables).

**`packages/client-runtime/src/fork/decide.ts`**, exported from
`client-runtime/src/fork/index.ts`: `createDecideEnvironmentAtoms(runtime)` with a query atom
family for `getSettings` (label `loom:decide:settings`) and one command per mutation, which
refresh the settings atom on success; plus the pure client settings helper every consumer
uses (web and, later, mobile):

```ts
export interface DecideFeatureState {
  /** `decide` is in the environment's loomFeatures. */
  readonly supported: boolean;
  /** The feature's current mode; "off" when unsupported, unknown or not loaded. */
  readonly mode: DecideMode;
  /** Jev can run for this feature now: supported, "Use Jev" on, key set, mode not off. */
  readonly usable: boolean;
  /** mode is manual-agents (always false for agentTool: false features). */
  readonly agentsAllowed: boolean;
  readonly feature: DecideFeatureView | null;
}

export function decideFeatureState(
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
  settings: DecideSettingsView | null,
  featureId: string,
): DecideFeatureState;
```

**`apps/web/src/fork/decide/state.ts`**

```ts
export const decideEnvironment = createDecideEnvironmentAtoms(connectionAtomRuntime);

/**
 * For consumer UIs: a feature's current mode and whether to offer a Jev control ("Auto (Jev)",
 * "Rank with Jev"). `decideFeatureState` over the environment's capabilities and settings.
 */
export function useDecideFeature(
  environmentId: EnvironmentId | null,
  featureId: string,
): DecideFeatureState;
```

It checks `supportsLoomFeature(capabilities, "decide")` first and mounts the settings atom
only when supported, so an upstream server never receives a `loom.decide.*` request.

**`apps/web/src/fork/decide/JevSettingsSection.tsx`**, registered as
`{ id: "decide", title: "Jev", Component: JevSettingsSection }` in `FORK_SETTINGS_SECTIONS`.
It edits the environment of the selected settings scope (`useSettingsScope()`,
`apps/web/src/components/settings/SettingsScopeContext.tsx:61`):

- An intro line: "Jev is TypeSafe's decision model. Loom can use it for small optional
  decisions; every use has a non-Jev fallback. What is sent is shown in the Decisions panel."
- "Use Jev" switch (global `enabled`).
- API key: "No key" or "Key saved on <date>"; a password field with "Save", then "Replace"
  and "Remove" (Remove asks for confirmation); "Test key" shows "Key works. Models:
  jev-latest, jev-preview" or the failure ("TypeSafe rejected this key (401)", "Could not
  reach api.typesafe.ai"). A link to `https://console.typesafe.ai/keys`.
- Features: one row per registered feature, grouped by packet: label, description, a "Use
  Jev" switch (off or manual) and, unless the feature has `agentTool: false`, a "Let agents
  use this" switch (manual-agents; disabled while "Use Jev" is off). Pinned model and threshold are shown read-only ("jev-1.13.0,
  threshold 0.62"); L29 edits them. Empty state: "No Loom feature on this server uses Jev
  yet."
- With a project scope: "Jev off for this project" for each target in the scope
  (`targets`, one `setProjectOff` per environment and project), "Mixed" when they differ.
- Redaction: "Never send files matching" (globs, one per line) and "Never send this text"
  (literals, one per line), with the fixed rules summarized: ".env files, private keys,
  tokens and password assignments are always removed."
- Unsupported environment: "This environment does not run Loom's Jev support."

### Registering a packet

1. **Feature.** `apps/server/src/fork/<slug>/decide.ts` exports one `DecideFeature` per use,
   id `<slug>.<name>`, `packet` the packet id, a label and a one-sentence description that
   says what happens without Jev. Set `agentTool: false` when no MCP tool reaches the
   feature. Put the feature's confidence threshold in `defaultThreshold`. Append them to
   `FORK_DECIDE_FEATURES`. Choose `defaultMode: "manual"` unless the packet's PRODUCT.md
   decided otherwise; agent use is always opt-in.
2. **Call.** In the packet's service, `yield* LoomDecide` and call
   `decide(featureId, { state, questions }, { origin, threadId?, projectId? })`.
   Build `state` with named, pre-computed fields (counts, sizes and dates as buckets computed
   in code, per the Jev 1.13 jaggedness notes), keep it to what the question needs, and use
   `diffExcerpt` for diffs. Treat `answered` as confident (the threshold was already applied
   to every Choice and Score answer) and handle every `fallback` with the non-Jev behavior;
   never retry in a loop and never block a user action on the result.
3. **Agents.** An MCP tool that runs a Jev decision passes `origin: "agent"`; `decide` returns
   `agent-not-allowed` unless the user turned on "Let agents use this", and the tool reports
   that in one line. Do not add a second gate.
4. **Client.** Offer Jev controls only when `useDecideFeature(environmentId, id).usable`
   (mode, key and switches), and hide them when `supported` is false. Show what Jev chose
   and its confidence where the decision is visible, and say when the fallback was used.
5. **Tests.** Test the packet's state builder and fallback handling with a test layer for
   `LoomDecide` that returns scripted results; do not call TypeSafe in tests.

Also add the feature to the catalog in L29's PRODUCT.md when the packet documents change.

### Capability

`"decide"` appended to `LOOM_SERVER_FEATURES` by the creating commit. Consumers check it,
not their own slug, before offering Jev controls.

### Existence check

```sh
test -f packages/contracts/src/fork/decide.ts \
  && test -f apps/server/src/fork/decide/LoomDecide.ts \
  && test -f apps/web/src/fork/decide/JevSettingsSection.tsx \
  && git grep -q '"decide"' -- apps/server/src/fork/features.ts
```

Create it, if missing, in its own commit (`feat(fork): add the decide extension point`) after
`ext-core` and `ext-settings` exist, with empty `FORK_DECIDE_FEATURES`.

### Tests

- `apps/server/src/fork/decide/registry.test.ts`: feature ids are unique, match
  `^[a-z0-9-]+\.[a-z0-9-]+$`; `packet` matches `^L\d{2}$`; `defaultThreshold` is between
  0 and 1; labels and descriptions are non-empty.
- `apps/server/src/fork/decide/JevClient.test.ts` (injected `fetch`): request URL, method,
  bearer header and body; response decode including `usage`; 401, 422, 429 with
  `retry-after`, 529 and other statuses map to their reasons; a hanging fetch times out under
  `TestClock` and its signal is aborted; no error message contains the key.
- `apps/server/src/fork/decide/redact.test.ts`: each built-in kind is removed; `.env`,
  `.env.local` and user globs are excluded in objects, keys and diff strings, while
  `environment.ts` is not; user literals; JSON pointers and counts; idempotence; nothing
  outside a match changes.
- `apps/server/src/fork/decide/budget.test.ts`: estimates; no trim when within limits; arrays
  trimmed from the start before strings; a string state trimmed from the middle; the 64k
  total; `fits: false` when the questions alone are too large.
- `apps/server/src/fork/decide/diffExcerpt.test.ts`: counts per file; excluded and binary
  files; round-robin hunks under a small budget; omitted-hunk markers; empty diff.
- `apps/server/src/fork/decide/overrides.test.ts`: instructions and `question` field
  replacement; Choice keys never added or removed; Score only at equal length; Noul criteria.
- `apps/server/src/fork/decide/LoomDecide.test.ts` (on `SqlitePersistenceMemory` with the
  fork migrations, a test `ServerSecretStore`, a scripted fetch): each fallback reason in the
  check order, and nothing sent or logged for the first four; `manual` rejects `agent` and
  allows `auto`; project derived from `threadId`; threshold precedence (call, user value,
  default) over every Choice and Score answer, Noul never gated; `agentTool: false` features
  reject `manual-agents` in `updateFeature` and read a stored `manual-agents` as `manual`; low-confidence logs answers and returns them; timeout and 529 log a
  fallback with the decision id; the logged state is the redacted, trimmed state; question
  sets dedupe; `changes` emits after the insert; `setKey` then `getSettings` never contains
  the key (search the JSON); `removeKey` yields `no-key`.
- `apps/server/src/fork/decide/retention.test.ts`: with `TestClock`, unrated, unkept rows
  older than 30 days lose `state_json` and gain `state_purged_at`; rated, kept and newer rows
  keep it; answers and ratings stay; the job repeats after 24 hours.
- The ext-core tests (`rpcAuthorization.test.ts`, `features.test.ts`,
  `persistence/migrations.test.ts`) and `apps/web/src/fork/settings/registry.test.ts` cover
  the registrations.
- Typecheck `@t3tools/contracts`, `t3`, `@t3tools/client-runtime`, `@t3tools/web`,
  `@t3tools/mobile`.

### Known limits

- Everything sent to Jev leaves the machine for `api.typesafe.ai`. Redaction removes common
  secret shapes and excluded files; it cannot recognize every secret. The Jev hub (L29) shows
  exactly what each request sent.
- The token estimate is conservative; very dense text can still differ from Jev's count. A
  `422` for size is logged as an `error` fallback.
- `jev-latest` moves when TypeSafe ships a release. Thresholds tuned on one version may not
  hold on the next; L29 flags a model change and offers a replay.
- Rate limits are account-wide (1,200 requests per minute on 2026-09-24) and can change
  without notice; `decide` treats `429` as a fallback rather than waiting.

---

## Shared points considered and declined

These were proposed while writing the packets. Each has one consumer, so a shared extension
point would add a registry without removing a seam. Promote one when a second packet needs
the same spot.

- **Chat header actions** (`ChatHeader.tsx`, the `data-chat-header-actions` group). Only L04
  (the Inspector eye button) adds a button there; its packet seam is two marked lines.
- **Chat banner overlay** (`ChatView.tsx`, the overlay that hosts `ProviderStatusBanner`).
  Only L03 (the goal chip) mounts there.
- **Other `ChatView.tsx` spots.** L07 mounts the bottom dock above the terminal drawer list
  and L14 calls a timeline hook next to the live-follow effect. With L03's chip these are
  three different positions in the file, so one extension point would still need a seam at
  each; the packet seams stay, each two marked lines. L14 notes when to promote its hook to
  an `ext-timeline` point.

---

## Surfaces and version skew

| Situation                                                     | Result                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Loom client, Loom server                                      | Full feature where `loomFeatures` includes the packet slug.                                                                                |
| Loom client, upstream T3 server                               | `loomFeatures` absent: fork UI hidden or shown disabled with "Needs a Loom server". Any stray call fails alone with `Unknown request tag`. |
| Upstream client (app.t3.codes, App Store mobile), Loom server | Works as upstream; fork methods and capability keys are ignored. Fork servers must not change upstream wire schemas or emit fork events.   |
| Remote (Tailscale, T3 Connect)                                | Fork RPCs share the WebSocket; fork HTTP routes live under `/api/loom/`.                                                                   |
| Desktop                                                       | Same web bundle; Electron-only parts via `ext-desktop`.                                                                                    |

Check capabilities per environment, not globally: a thread's environment decides. On web,
read `useServerConfigs().get(environmentId)?.environment.capabilities` and pass it to
`supportsLoomFeature`.

## Risks and hard spots

- **Provider code.** `ProviderService.ts` (`ext-turn-input`) and the provider settings files
  (`ext-providers`) are busy upstream. Their seams are inserted lines at stable spots, but
  expect to reapply them by hand after an upstream restructuring.
- **`ChatView.tsx` (10,023 lines) and `ChatComposer.tsx`** change in almost every upstream
  release. The panel and composer seams are the likeliest to conflict. They are placed at the
  start of lists and chains to reduce that, but expect to reapply them by hand sometimes.
- **The generated route tree.** `routeTree.gen.ts` is committed and regenerated only by the
  Vite plugin. `loom.sh integrate` typechecks before it builds, so after a conflict in that
  file the tree must be regenerated by hand before `--continue`.
- **Upstream tests.** `RpcAuthorization.test.ts` and `server.test.ts` stay green only because
  the fork keeps its own group, scope table and `ForkRuntime` reference. Do not "simplify" by
  adding fork methods to `WsRpcGroup` or fork requirements to transport layers.
- **Silent tag overwrite.** `RpcGroup.merge` replaces duplicate tags without error; the
  `loom.` prefix and the collision test are the only guard.
- **Migrations.** A fork migration in upstream's sequence silently skips upstream schema
  changes. Per-packet tracking tables avoid it; never bypass them.
- **Keybinding defaults** leak into the user's `keybindings.json`, which upstream T3 Code then
  flags. Prefer unbound commands.
- **MCP tools** are visible to every session and cost tokens every turn.
- **Settings search** does not include fork sections (the search list is upstream-owned).
- **Knip.** `knip:check` checks unused exports in apps and packages. If CI runs on the fork,
  empty registries are fine but exported helpers with no consumer yet (for example
  `supportsLoomFeature` before any packet uses it) may be reported. Use them in the first
  packet or accept the finding until then.
- **`loom.sh` coverage.** Until the follow-up in CONVENTIONS.md lands, `integrate` does not
  check fork seams other than branding and does not typecheck `apps/server`,
  `packages/contracts` or `packages/client-runtime`.
