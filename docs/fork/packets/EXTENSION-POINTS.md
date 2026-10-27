# Loom extension points

Many packets need the same plumbing: a server RPC, a server service with storage, a right
panel, a settings section, command palette actions, keybindings, agent-facing MCP tools,
composer hooks, provider drivers, text added to provider turns. If each packet wired these
into upstream files on its own, Loom would carry dozens of overlapping seams. Instead, each
kind of plumbing has one fork-owned extension point with the smallest possible seam into
upstream. Packets register into it and touch no further upstream code.

All citations are to this fork at upstream v0.0.42 (commit `a931bd85f3`). Line numbers drift;
search for the quoted code when they do.

## Plugins (parked proposal)

[L30](./L30-plugins/), parked on 2026-10-09, would replace the hand-edited registration lists
below with one plugin definition per feature per layer, plus per-environment enable and
disable. It is not selected: the "Registering" steps in each section are authoritative. If L30
is picked up, it rewrites those steps to name the plugin slot each extension point fills.

## How to use this file

These are V1 integration designs. The [packet planning policy](./README.md#planning-policy-after-the-upstream-review)
defers upstream-dependent work until V2 ships. Do not port these skeletons to provisional
V2 APIs or create them for deferred packets. Reassess the relevant extension points against
released source when a feature is selected; existing extension points remain in use.

For every extension point a packet needs:

1. Run its **existence check**. If it passes, skip to **Registering a packet**.
2. If it fails, create the extension point **exactly** as written here, in its own commit
   (`feat(fork): add the <name> extension point`), before any packet code. Copy the
   skeletons verbatim and apply the seams with the markers shown. Do not add packet code,
   extra options or "improvements" to that commit: two packets built in parallel must
   produce the same commit so the second can drop its copy.
3. If the skeleton does not compile or a cited line has moved, fix it minimally, and update
   this file in the same commit so every later packet copies the corrected version.
4. Add the extension point's seams to FORK.md ("Extension point seams" table) and to
   `docs/fork/seams.tsv` in the same commit (see
   [CONVENTIONS.md](./CONVENTIONS.md#updating-forkmd)).

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
| [7. Settings](#7-settings-ext-settings)                                    | `fork: ext-settings`        | Settings shell, host pages, fork routes, route tree | none                   |
| [8. Command palette](#8-command-palette-ext-palette)                       | `fork: ext-palette`         | 1                                                   | ext-core               |
| [9. Keybindings](#9-keybindings-ext-keybindings)                           | `fork: ext-keybindings`     | 1                                                   | ext-core, ext-web-root |
| [CLI commands](#cli-commands-ext-cli)                                      | `fork: ext-cli`             | 1                                                   | ext-core               |
| [10. MCP tools](#10-agent-facing-mcp-tools-ext-mcp)                        | `fork: ext-mcp`             | 1                                                   | ext-core               |
| [11. Composer](#11-composer-ext-composer)                                  | `fork: ext-composer`        | 1                                                   | none                   |
| [11b. Composer menu trigger](#11b-composer-menu-trigger-ext-composer-menu) | `fork: ext-composer-menu`   | 2 (3 once a fork trigger adds `composer-logic.ts`)  | ext-composer           |
| [12. Orchestration](#12-orchestration-and-thread-behavior)                 | guidance only               | 0 by default                                        | ext-core               |
| [13. Desktop IPC](#13-desktop-ipc-ext-desktop-optional)                    | `fork: ext-desktop`         | 3 (optional)                                        | ext-core               |
| [14. Mobile settings](#14-mobile-ext-mobile-settings-optional)             | `fork: ext-mobile-settings` | 3 (optional)                                        | ext-core               |
| [15. Provider drivers](#15-provider-drivers-ext-providers)                 | `fork: ext-providers`       | 4                                                   | none                   |
| [16. Provider turn input](#16-provider-turn-input-ext-turn-input)          | `fork: ext-turn-input`      | 1                                                   | ext-core               |
| [17. Diff panel header](#17-diff-panel-header-ext-diff-header)             | `fork: ext-diff-header`     | 1                                                   | none                   |

`ext-panels` and `ext-palette` need server core only for `loomFeaturesOf` from
`@t3tools/client-runtime/fork`, and `ext-keybindings` only for `packages/contracts/src/fork/`
and the `@t3tools/contracts/fork` export; a client-only packet that uses them runs the
`ext-core` existence check and creates it if missing, but registers nothing in it.

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
  HTTP and MCP registration capture only required dependencies. Bind the `ForkRuntime`
  reference during registration-layer construction and explicitly provide that value to the
  later handler; reading the reference only inside a request silently sees its default.
  L23 transport tests exercise this boundary.
- One capability key, `loomFeatures: string[]`, lists the packet slugs the server supports,
  plus the extension point name `core`.

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

**`packages/client-runtime/package.json`** (no marker; directly after the `"./errors"` entry
and before `"./rpc"`, because upstream prepends new exports at the top of this object, and an
entry in the middle changes no upstream line):

```diff
     "./errors": {
       "types": "./src/errors/index.ts",
       "default": "./src/errors/index.ts"
     },
+    "./fork": {
+      "types": "./src/fork/index.ts",
+      "default": "./src/fork/index.ts"
+    },
     "./rpc": {
```

**`packages/contracts/src/environment.ts`**, first key of the struct (line 78):

```diff
 export const ExecutionEnvironmentCapabilities = Schema.Struct({
+  // fork: ext-core: Loom features this server implements. Absent on upstream servers.
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
 import { requiredScopeForRpcMethod, requiredScopeForDeviceList } from "./auth/RpcAuthorization.ts";
+import { LoomWsRpcGroup } from "@t3tools/contracts/fork"; // fork: ext-core
+import { makeForkRpcLayer } from "./fork/rpc.ts"; // fork: ext-core
```

```diff
-          yield* RpcServer.make(WsRpcGroup, { disableTracing: true }).pipe(
+          // fork: ext-core
+          yield* RpcServer.make(LoomWsRpcGroup, { disableTracing: true }).pipe(
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
(line 1) and one leading member in each stream union (lines 42 and 63):

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
export const ForkRpcGroup = RpcGroup.make(LoomCoreInfoRpc).merge(
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

/**
 * Loom features (packet slugs and `core`) an environment supports. Empty on upstream
 * T3 servers.
 */
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
 * The context ForkLayer was built with, which holds the fork services. A Reference has a
 * default, so reading it adds no requirement to the upstream layers that host fork
 * transport code.
 */
export class ForkRuntime extends Context.Reference<Context.Context<ForkServices> | undefined>(
  "loom/ForkRuntime",
  { defaultValue: () => undefined },
) {}

/**
 * Runs fork logic with the fork services. The caller's context wins, so a request keeps its
 * own Scope rather than ForkLayer's server-lifetime one. Dies if ForkLayer is not installed.
 */
export const withForkRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, ForkServices>> =>
  Effect.flatMap(ForkRuntime, (context) =>
    context === undefined
      ? Effect.die(new Error("The Loom server runtime is not installed."))
      : Effect.updateContext(effect, (current) => Context.merge(context, current)),
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
    return observeRpcEffect<A, E | EnvironmentAuthorizationError, R>(
      method,
      session.scopes.includes(scope) ? effect : Effect.fail(denied(scope)),
    );
  },
  stream: <A, E, R>(method: ForkRpcMethod, stream: Stream.Stream<A, E, R>) => {
    const scope = FORK_RPC_REQUIRED_SCOPES[method];
    return observeRpcStream<A, E | EnvironmentAuthorizationError, R>(
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
   `layer`. Add the layer to `ForkServicesLive` in `ForkLayer.ts` and the service to
   `ForkServices` in `ForkRuntime.ts`. Append the slug to `LOOM_SERVER_FEATURES`.
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
- `apps/server/src/fork/ForkRuntime.test.ts`: `withForkRuntime` keeps the caller's `Scope`,
  so resources a request acquires close with the request, not with the server.
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
import type { SqlError } from "effect/unstable/sql/SqlError";

type ForkMigration = Effect.Effect<void, SqlError, SqlClient.SqlClient>;

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
  the first packet that needs it). A webhook route (for example L25's follow-up) would
  authenticate with its own secret instead. L23's signed file route is the first user.
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
  `AgentAwarenessRelay` is an upstream consumer outside orchestration that subscribes to the
  live event stream under `forkParked`; it keeps no cursor
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
to large streams: for the thread on screen, use `useRouteThread()` (Keybindings, below), not
`useHandleNewThread`, which subscribes to the thread's detail. Check:
`git grep -q 'fork: ext-web-root' -- apps/web/src/routes/__root.tsx`. No test for the root
itself.

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

Focusable canvases own their input: ChatView excludes `canvas[tabindex]` and
`[data-loom-canvas][tabindex]` from its type-to-focus-composer redirect so panel keyboard controls can receive ordinary keys.

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

**`apps/web/src/components/ChatView.tsx`** (6 marked lines), the imports after the
`RightPanelTabs` import:

```diff
 import { RightPanelTabs } from "./RightPanelTabs";
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

`ForkPanelDefinition.TabIcon` optionally decorates one tab surface while keeping the panel
icon for its launcher entry; `ForkSurfaceIcon` falls back to `icon`. L41 uses it for the
static changed-model dot.

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
  /** Optional tab icon for one surface; defaults to `icon`. */
  readonly TabIcon?: ComponentType<{ surface: ForkRightPanelSurface; className?: string }>;
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
  const panel = findForkPanel(surface.panelId);
  if (panel?.TabIcon) return <panel.TabIcon surface={surface} className="size-3 shrink-0" />;
  const Icon = panel?.icon ?? PuzzleIcon;
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
| K      | Skills          | `skill-registry`          | L21    |
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

Only J and N are free; their panels (L29 and L08) were retired on 2026-10-09. After those, a
later panel uses `""` and is reached through the "+" menu, the palette or the panel picker
(L12). If upstream adds a surface whose letter is
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

Give each packet's settings a home beside the subject it belongs to, in the web and desktop
settings modal. There is no catch-all Loom page: a topic for lanes sits on Worktrees, a topic for
command workers on Computers, and topics with no upstream home go on the fork's own **Vault** and
**Tools** pages.

### Current upstream mechanism

- Settings is a modal over the chat. The layout route is `apps/web/src/routes/_chat.settings.tsx`
  and each page is a `_chat.settings.<page>.tsx` route. The TanStack Router plugin regenerates the
  committed `apps/web/src/routeTree.gen.ts` on `vp dev` and `vp build`; typecheck does not.
- `SettingsPath`, `SETTINGS_SECTION_LABELS`, `SETTINGS_NAV_GROUPS` and the category scopes in
  `apps/web/src/components/settings/settingsSearch.ts`, and the icons in `SettingsSidebarNav.tsx`,
  are exhaustive records. `SETTINGS_SEARCH_ITEMS` is the searchable list.
- Pages are scope-gated unless device-only; `_chat.settings.tsx` decides which pages edit one
  computer at a time, such as Providers.

### Fork design

- [`apps/web/src/fork/settings/registry.ts`](../../../apps/web/src/fork/settings/registry.ts)
  lists every topic in `FORK_SETTINGS_SECTIONS`. Each entry carries a `home`
  (`ForkSettingsHome`, the settings page it appears on) and, on the Vault page, an optional
  `advanced` flag for the collapsed **Advanced** disclosure. Array order is display order within a
  page. Ids never change, and each topic keeps the anchor `loom-<id>`.
- `apps/web/src/fork/settings/pages.tsx` holds `VaultSettingsPage` and `ToolsSettingsPage`
  (`/settings/vault`, `/settings/tools`) and `ForkSettingsTopics({ page })`, which upstream pages
  render after their own sections. Upstream pages can target several computers, so
  `ForkSettingsTopics` wraps each computer-scoped topic in a nested single-environment
  `SettingsScopeProvider` and, when the page covers more than one computer, names the computer
  the topic applies to. Device-scoped topics render without the wrapper.
- `apps/web/src/fork/settings/navigation.ts` owns `forkSettingsTarget(id)` for in-app links,
  `forkSettingsSearchItems()` (one settings search item per topic), the legacy resolver and the
  set of single-environment fork pages.
- `/settings/loom` is a permanent redirect. `?section=<id>` and `#loom-<id>` go to the topic's
  home with hash `loom-<id>`, keeping the other search params; bare `/settings/loom` goes to
  Lanes. Agent-facing text in `packages/contracts/src/fork/vault-*.ts` and
  `apps/server/src/fork/vault/VaultGitHub.ts` still links to `/settings/loom`, because changing
  model-facing text needs an eval run, so never remove the route.

### Seams (all `fork: ext-settings`)

- `settingsSearch.ts`: the Vault and Tools paths, labels, nav placement and scopes, plus the fork
  search items.
- `SettingsSidebarNav.tsx`: icons for the Vault and Tools pages.
- `_chat.settings.tsx`: Vault and Tools are single-environment pages.
- Each upstream page component that hosts topics imports `ForkSettingsTopics` and renders it
  for its page.
- Fork-owned route files `_chat.settings.vault.tsx`, `_chat.settings.tools.tsx` and
  `_chat.settings.loom.tsx` live in the routes directory because the router plugin requires it.
  On an upstream conflict in `routeTree.gen.ts`, take upstream's version, regenerate with
  `vp run --filter @t3tools/web build`, then typecheck.

`docs/fork/seams.tsv` has the exact marker counts.

### Registering a section

Add an entry to `FORK_SETTINGS_SECTIONS` whose `home` is the page a user would look on first; use
`/settings/tools` only when no upstream page fits. A new upstream home needs `ForkSettingsTopics`
on that page and a `ForkSettingsHome` member. Link to a topic with `forkSettingsTarget(id)`, never
a hand-built URL.

A section reads its computer from `useSettingsScope().environment` and shows its own unavailable
state when that computer lacks the `loomFeatures` entry it needs. Server values come from the
packet's own RPCs ([Persistence](#2-persistence)). Fork client preferences use localStorage keys
`loom:<slug>:<name>:v<n>` through `resolveStorage` (`apps/web/src/lib/storage.ts`), wrapped in
try/catch; `useClientSettings` is for upstream keys only.

### Existence check

```sh
test -f apps/web/src/fork/settings/registry.ts \
  && test -f apps/web/src/routes/_chat.settings.loom.tsx \
  && git grep -q 'fork: ext-settings' -- apps/web/src/components/settings/settingsSearch.ts
```

### Tests

`apps/web/src/fork/settings/registry.test.ts` and `navigation.test.ts` cover unique ids, homes
and the legacy redirect. Typecheck `@t3tools/web` after regenerating the route tree.

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

Prerequisite: [Server core](#1-server-core-ext-core) (for `packages/contracts/src/fork/`
and the `@t3tools/contracts/fork` export) and [Web root](#5-web-root-ext-web-root).

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
  (`commandLabel` in `apps/web/src/components/settings/KeybindingsSettings.logic.ts`), so
  `loom.snippets.open` shows as "Loom: Snippets: Open" with no extra work. A slug with an
  acronym or digit (`device-qa`, `pcb-preview`) needs an entry in
  `FORK_KEYBINDING_FEATURE_NAMES` (`packages/contracts/src/fork/keybindings.ts`), or it
  shows as "Loom: Device Qa".

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
user bindings always win. The fork command stays unbound and bindable. L12 (`mod+shift+'`)
follows this pattern.

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

**`apps/web/src/fork/routeThread.ts`**, the thread the chat route shows, for `ForkRoot`
components:

```ts
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "~/threadRoutes";

export interface RouteThread {
  readonly threadRef: ScopedThreadRef;
  /** Not sent yet: the chat view shows it, but the server has no such thread. */
  readonly isDraft: boolean;
}

/**
 * The thread the chat route shows, drafts included, read from the route and the draft store
 * only. ForkRoot components use it rather than useHandleNewThread, which subscribes to the
 * thread's detail and re-renders on every streamed event.
 */
export function useRouteThread(): RouteThread | null {
  const target = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  const serverRef = resolveActiveThreadRouteRef(target, draft);
  const environmentId = serverRef?.environmentId ?? draft?.environmentId ?? null;
  const threadId = serverRef?.threadId ?? draft?.threadId ?? null;
  const isDraft = serverRef === null;
  return useMemo(
    () =>
      environmentId !== null && threadId !== null
        ? { threadRef: scopeThreadRef(environmentId, threadId), isDraft }
        : null,
    [environmentId, isDraft, threadId],
  );
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
import { isEditableFocused } from "~/lib/editableFocus";
import { isPreviewFocused } from "~/lib/previewFocus";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isModelPickerOpen } from "~/modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "~/rightPanelStore";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "~/terminalUiStateStore";
import { useRouteThread } from "../routeThread";
import { dispatchForkCommand } from "./forkCommandBus";

/**
 * Resolves fork commands with the same `when` context as upstream's chat shortcuts
 * (routes/_chat.tsx). Listens in the capture phase, like ChatView's shortcuts, because the
 * terminal stops every key it turns into input.
 */
export function ForkGlobalShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const threadRef = useRouteThread()?.threadRef ?? null;
  const terminalOpen = useTerminalUiStateStore((state) =>
    threadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef).terminalOpen
      : false,
  );
  const previewOpen = useRightPanelStore((state) =>
    threadRef ? selectActiveRightPanel(state.byThreadKey, threadRef) === "preview" : false,
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (!command || !isForkKeybindingCommand(command)) return;
      if (dispatchForkCommand(command)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, previewOpen, terminalOpen]);
  return null;
}
```

### Registering, existence check, tests

Append `"loom.<slug>.<action>"` to `FORK_KEYBINDING_COMMANDS`; subscribe with
`onForkCommand` where the action lives (a panel, a dialog host in `ForkRoot`). Palette items
can call `dispatchForkCommand` too, or the action itself where "toggle" is wrong for an item
named "Show". Check:
`test -f packages/contracts/src/fork/keybindings.ts && git grep -q 'fork: ext-keybindings' -- packages/contracts/src/keybindings.ts`.
Test (`packages/contracts/src/fork/keybindings.test.ts`): every fork command starts with
`loom.`, decodes with `KeybindingCommand`, and is not an upstream static command.

---

## 10. Agent-facing MCP tools (`ext-mcp`)

Prerequisite: server core.

### Registration and access

Every provider adapter uses the same authenticated `t3-code` MCP server. Fork tools
register through [`McpHttpServer.ts`](../../../apps/server/src/mcp/McpHttpServer.ts),
using its `toolkitRegistration` helper. Never register a fork toolkit directly with
`McpServer.toolkit`: that bypasses the shared access declarations.

[`apps/server/src/fork/mcp/index.ts`](../../../apps/server/src/fork/mcp/index.ts)
exports `FORK_MCP_TOOLKITS`, a readonly array of typed registration entries retaining each toolkit and its handlers. The two
`fork: ext-mcp` lines import it and call each entry's `register(toolkitRegistration)` in the shared
layer, preserving heterogeneous toolkit dependencies.

A packet defines its toolkit with `Tool.make` and `Toolkit.make`, then builds
handlers with `McpToolAccess.toLayer`. Each handler declares its access with the
appropriate helper from [`McpToolAccess.ts`](../../../apps/server/src/mcp/McpToolAccess.ts):
`readsAsCaller` for a read belonging to the current thread, or `actsAsCaller` for
changing that thread's workspace. Caller checks run before the feature service.
Other helpers cover environment writes and operations targeting other threads.

Include `OrchestratorMcpFailure` in the tool's failure schema. Tools that write
as a caller also declare `ThreadManagementService` in their dependencies. Retain
`McpInvocationContext` for thread scoping. Bind `ForkRuntime` during layer
construction, then call the packet service through `withForkRuntime`.
[L23's toolkit](../../../apps/server/src/fork/model-preview-3d/mcp.ts) is a working example.

Do not extend `McpCapability` for a packet. Use shared caller access checks and
the packet's own setting to gate its tools. All tools remain listed to agent
sessions, so keep their descriptions short and avoid redundant tools. Tool
parameters use `Tool.EmptyParams` for tools without arguments. An empty `Schema.Struct({})`
can block shared registration; exercise actual toolkit registration in a focused test.

### Verification

Check that every fork tool name starts with `loom_` and is unique. Exercise the
registered handlers with an authenticated thread caller, including access
refusals and packet-disabled errors. Provide a test `ForkRuntime` context and
any dependencies declared by the toolkit. Lint rejects raw MCP registration.

---

## CLI commands (`ext-cli`)

The fork-owned `apps/server/src/fork/cli/index.ts` exports `FORK_CLI_COMMANDS`. Two marked
lines in `apps/server/src/binCli.ts` import it and spread commands into the upstream
subcommand list. Packet commands stay in fork paths and invoke service-backed transports.
L24's `t3 pcb` and `t3 model` use the existing authenticated MCP protocol helper, with
explicit Loom credentials or inherited ACP credentials. They preserve tool failures as a
nonzero command result. Do not add unauthenticated local mutations or duplicate CLI logic
inside upstream handlers.

The panel presentation hook is mounted by `ChatView` through `ext-panels`. It acknowledges
maximize/restore for the matching scoped thread and reports unavailable narrow layouts.
Editors must preserve `[data-loom-canvas][tabindex]` keyboard ownership and clean event
listeners when the thread unmounts.

## 11. Composer (`ext-composer`)

### Purpose

Footer controls and a drawer anchored above the composer, for any fork feature that acts on the
thread being written in. Created by L91 (bot runs: a footer chip and the bot run form). A key
handler seam is not part of it yet: no packet needs one, and L01's `;alias` goes through
[ext-composer-menu](#11b-composer-menu-trigger-ext-composer-menu). The first packet that needs
one adds it to `onComposerCommandKey`, after the Shift+Tab block, and records it here.

### Current upstream mechanism (`apps/web/src/components/chat/ChatComposer.tsx`)

- `applyPromptReplacement(rangeStart, rangeEnd, replacement, { expectedText,
  focusEditorAfterReplace })` edits the prompt safely; `resolveActiveComposerTrigger()` returns
  `{ snapshot: { value, cursor, expandedCursor }, trigger }`. Trigger ranges are in
  expanded-cursor coordinates.
- Footer controls are `restingBlockDefs` (:5088), an array of `{ id, content }`. Blocks are
  hidden from the end of the array, by position, when space runs out, and
  `CompactComposerControlsMenu` re-exposes only `mode` and `traits`. Each block brings its own
  leading `ComposerControlSeparator`.
- The stash drawer renders in `ComposerCommandMenuLayer` (a private component, :985) at :6649:
  `{isStashMenuOpen && !composerMenuOpen && !isComposerApprovalState && (...)}`.
- The component has no early return before its JSX, so hooks can be added anywhere above it.

### Seams (`ChatComposer.tsx`, all `fork: ext-composer`)

```diff
 import { type ComposerCommandItem, ComposerCommandMenu } from "./ComposerCommandMenu";
+// fork: ext-composer
+import { useForkComposer } from "../../fork/composer/registry";
```

Directly before `const composerMenuItems` (:2637), so the menu seams of
[§11b](#11b-composer-menu-trigger-ext-composer-menu) can read its context:

```diff
+  // fork: ext-composer
+  const forkComposer = useForkComposer({
+    environmentId,
+    threadRef: routeKind === "server" ? routeThreadRef : null,
+    projectId: activeProjectId,
+  });
   const composerMenuItems = ((): ComposerCommandItem[] => {
```

At the start of `restingBlockDefs`. Fork blocks go first: upstream hides blocks from the end, so
an appended block would be the first to vanish and would push `mode` and `traits` into the
compact menu sooner.

```diff
   const restingBlockDefs = [
+    // fork: ext-composer
+    ...forkComposer.blockDefs(composerControlsCollapsed ? "xs" : "sm"),
     ...(providerTraitsPicker
```

After the stash drawer block:

```diff
                 </ComposerCommandMenuLayer>
               )}
+              {/* fork: ext-composer */}
+              {forkComposer.drawer !== null &&
+                !isStashMenuOpen &&
+                !composerMenuOpen &&
+                !isComposerApprovalState && (
+                  <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
+                    {forkComposer.drawer}
+                  </ComposerCommandMenuLayer>
+                )}
```

Run `vp fmt` on the file afterwards. Every multi-line seam starts with its own marker line,
so wrapping by the formatter never separates a seam from its marker.

### Fork-owned file: `apps/web/src/fork/composer/registry.tsx`

```tsx
import type { ReactNode } from "react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import type { ComposerControlSize } from "~/components/chat/ComposerControl";
import { useAttachedBotRunsBlock } from "../bots/composer/AttachedRunsChip";
import { useBotRunDrawer } from "../bots/composer/BotRunDrawer";

/** What a fork composer feature knows about the composer it sits in. */
export interface ForkComposerContext {
  readonly environmentId: EnvironmentId;
  /** Null for a draft, which has no thread on the server yet. */
  readonly threadRef: ScopedThreadRef | null;
  readonly projectId: ProjectId | null;
}

export type ForkPromptReplace = (
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
  options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
) => boolean;

/** A footer control. Null when it has nothing to show, so it takes no room in the footer. */
export interface ForkComposerBlock {
  readonly id: string;
  readonly render: (size: ComposerControlSize) => ReactNode;
}

/**
 * The fork's composer features, called in a fixed order so hook order never changes. A packet
 * adds one hook call here. The first open drawer wins.
 */
export function useForkComposer(context: ForkComposerContext) {
  const blocks = [useAttachedBotRunsBlock(context)].filter(
    (block): block is ForkComposerBlock => block !== null,
  );
  const drawer = useBotRunDrawer(context);
  return {
    context,
    drawer,
    /** Prepended to the footer blocks: upstream hides blocks from the end, by position. */
    blockDefs: (size: ComposerControlSize) =>
      blocks.map((block) => ({ id: `loom:${block.id}`, content: block.render(size) })),
  };
}
```

A second drawer joins as `const drawer = useBotRunDrawer(context) ?? useOtherDrawer(context);`
written as two calls first and combined after, so both hooks always run.

### Registering, existence check, tests

- A block hook returns null when it has nothing to show and renders its own leading
  `ComposerControlSeparator`, sized by `size`.
- A drawer hook returns its content while open, otherwise null, and closes on Escape. Open state
  lives in a store keyed by `scopedThreadKey`, so a drawer opened in one thread does not follow
  the user to another.
- Drafts get `threadRef: null`. Features that report back to a thread stay hidden there.
- Check: `git grep -cE 'fork: ext-composer([^a-z0-9-]|$)' -- apps/web/src/components/chat/ChatComposer.tsx`
  prints 4. The strict pattern keeps `fork: ext-composer-menu` markers out of the count.
- Test the pure parts in the packet: item building, filtering, and the store a drawer opens.

## 11b. Composer menu trigger (`ext-composer-menu`)

Prerequisite: [Composer](#11-composer-ext-composer).

Fork items in the composer's suggestion menu. Created by L91, which uses one part of it: fork
items that join the upstream `/` list (`/bot:<id>`). A fork item does not detect `/`; upstream
already does, and the fork list is appended to upstream's ranked result. A packet that needs its
own prefix (for example `;` for L01 snippets or `%` for L18 project notes) adds the trigger
seams below in the same commit as its first trigger. Fork trigger prefixes must not collide with
upstream's (`/` at a word start, `#`, `$`, `@`).

### Current upstream mechanism

`ComposerTriggerKind = "path" | "pull-request" | "slash-command" | "skill"`
(`apps/web/src/composer-logic.ts`) and `detectComposerTrigger` decide the trigger; any
`/token` is a slash-command trigger, so `/bot:reviewer` needs no detection of its own.
`ComposerCommandItem` (`apps/web/src/components/chat/ComposerCommandMenu.tsx`) is the item
union and the menu renders `label` and `description` generically. `composerMenuItems`
(`ChatComposer.tsx:2637`) and `onSelectComposerItem` (:3786) are if-chains with no
exhaustiveness check. Mobile has its own trigger copy (`packages/shared/src/composerTrigger.ts`).

### Seams (all `fork: ext-composer-menu`)

`ComposerCommandMenu.tsx` (2 lines):

```diff
+import type { ForkComposerCommandItem } from "../../fork/composer/menu"; // fork: ext-composer-menu
 ...
-  | { id: string; type: "skill"; ... };
+  | { id: string; type: "skill"; ... }
+  | ForkComposerCommandItem; // fork: ext-composer-menu
```

`ChatComposer.tsx` (4 seams). The import, after the `ext-composer` import:

```diff
+// fork: ext-composer-menu
+import {
+  searchForkSlashItems,
+  selectForkComposerItem,
+  useForkSlashMenuItems,
+} from "../../fork/composer/menu";
```

After the `useForkComposer` call, before `composerMenuItems`. Sources fetch only while a `/`
menu is open:

```diff
+  // fork: ext-composer-menu
+  const forkSlashItems = useForkSlashMenuItems(
+    forkComposer.context,
+    composerTrigger?.kind === "slash-command",
+  );
```

The return of the `slash-command` branch of `composerMenuItems`:

```diff
-      return searchSlashCommandItems(slashCommandItems, query);
+      // fork: ext-composer-menu
+      return [
+        ...searchSlashCommandItems(slashCommandItems, query),
+        ...searchForkSlashItems(forkSlashItems, query),
+      ];
```

In `onSelectComposerItem`, after `if (!trigger) return;`:

```diff
+    // fork: ext-composer-menu
+    if (item.type === "loom") {
+      const context = forkComposer.context;
+      if (
+        selectForkComposerItem(item, {
+          snapshot,
+          trigger,
+          replace: applyPromptReplacement,
+          context,
+        })
+      )
+        setComposerHighlightedItemId(null);
+      return;
+    }
```

When a packet adds its own trigger, it also adds to `composer-logic.ts`: the kind union gains
`` | `loom:${string}` ``, and `detectComposerTrigger` starts with
`const forkTrigger = detectForkComposerTrigger(text, cursor); if (forkTrigger) return forkTrigger;`.
`composerMenuItems` then starts with
`if (composerTrigger.kind.startsWith("loom:")) return [...forkTriggerItems];`. Those seams carry
the same marker and raise the counts below.

### Fork-owned file: `apps/web/src/fork/composer/menu.ts`

```ts
/** A fork entry in the composer's suggestion menu. */
export interface ForkComposerCommandItem {
  readonly id: string;
  readonly type: "loom";
  /** The source that offered the item and handles choosing it. */
  readonly source: string;
  readonly label: string;
  readonly description: string;
  readonly value: string;
}

/** Acts on a chosen slash item. The `/` token has already been removed from the prompt. */
export interface ForkSlashSource {
  readonly id: string;
  readonly select: (item: ForkComposerCommandItem, context: ForkComposerContext) => void;
}

const FORK_SLASH_SOURCES: ReadonlyArray<ForkSlashSource> = [BOT_SLASH_SOURCE];

/** Items fork sources offer under `/`, in a fixed hook order. One call per source. */
export function useForkSlashMenuItems(
  context: ForkComposerContext,
  active: boolean,
): ReadonlyArray<ForkComposerCommandItem> {
  const bots = useBotSlashItems(context, active);
  return bots;
}
```

`searchForkSlashItems(items, query)` ranks with `scoreQueryMatch` from
`@t3tools/shared/searchRanking`: the label without its `/` (boundaries `:`, `-`, `_`, `/`), then
the description at a lower rank. Fork items are listed after upstream's. An empty query lists
every item. `selectForkComposerItem(item, { snapshot, trigger, replace, context })` removes the
`/` token with `expectedText`, then calls the item's source, and returns false when the prompt
changed under the menu.

### Registering, existence check, tests

- A slash source adds one hook call to `useForkSlashMenuItems` and one entry to
  `FORK_SLASH_SOURCES`. Prefix labels with a namespace (`/bot:`) so they never shadow an
  upstream command or skill.
- Check: `git grep -c 'fork: ext-composer-menu' -- apps/web/src/components/chat/ChatComposer.tsx`
  prints 4 and the same for `ComposerCommandMenu.tsx` prints 2.
- Tests: `apps/web/src/fork/composer/menu.test.ts` covers ranking and selection.

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
5. Content injected into agent turns (private mode, instruction modes) goes through
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
L16 (provider sign-in). L17's ACP and Copilot drivers, the first whole-driver users, were
retired on 2026-10-09 (Kyle approved) in favor of upstream's ACP Registry; the driver path
below is kept for a future packet, and `loomAcp` and `loomCopilot` are examples only.

### Purpose

Let a packet (a) add a whole provider driver and (b) decorate an upstream driver's instances
(L16: attach in-app sign-in to Codex and Claude instances), plus show the matching settings
form, icon and a setup section in **Settings > Providers**, without further upstream edits.

### Current upstream mechanism

- Drivers are plain values (`ProviderDriver<Config, R>`,
  `packages/provider-core/src/server/driver.ts:175-210`). `create` returns a
  `ProviderInstance` record (`driver.ts:81-130`) with `snapshot`, `adapter`,
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
import type { AnyProviderDriver } from "@t3tools/provider-core/server/driver";

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
  `ForkProviderDriver` whose `driverKind` starts with `loom` (`loomAcp`). Append it to
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
  deliberately use different kinds (`loomAcp`, `loomCopilot`) so that a future upstream
  driver with the same name cannot decode a fork instance's config. Both entries can be
  visible at once.
- Mobile keeps its own provider icon map (`apps/mobile/src/components/ProviderIcon.tsx`);
  unknown drivers fall back to the Codex logo there (line 75), so fork drivers show that logo
  in the mobile app.
- If upstream appends a driver to `PROVIDER_CLIENT_DEFINITIONS`, the merge conflicts on the
  spread line. Keep both lines, with the spread last.

---

## 16. Provider turn input (`ext-turn-input`)

Prerequisite: server core (contributors are registered by fork services in `ForkLayer`).
Used by L20 (private mode) and L22 (instruction modes). L03's pinned goals, its first
proposed user, were retired on 2026-10-09 (Kyle approved) in favor of upstream's native `/goal`.

### Purpose

Let fork services add standing text (private mode, instruction modes) to the text a
provider receives for a user turn, for every provider and every client, without changing
what T3's timeline shows. This is the one path for such text;
[Orchestration](#12-orchestration-and-thread-behavior), rule 5, forbids other seams in the
provider command path.

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
  /**
   * Unique id from the order table: the packet slug, or `<slug>-<name>`
   * (e.g. `small-extras-private-mode`).
   */
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
    id: "instruction-modes",
    order: 10,
    contribute: ({ threadId }) => modesBlockFor(threadId), // reads the packet's own state
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

## Shared points considered and declined

These were proposed while writing the packets. Each has one consumer, so a shared extension
point would add a registry without removing a seam. Promote one when a second packet needs
the same spot.

- **Chat header actions** (`ChatHeader.tsx`, the `data-chat-header-actions` group). Only L04
  (the Inspector eye button) adds a button there; its packet seam is two marked lines.
- **Chat banner overlay** (`ChatView.tsx`, the overlay that hosts `ProviderStatusBanner`).
  No packet mounts there since L03's goal chip was retired on 2026-10-09.
- **Other `ChatView.tsx` spots.** L07 mounts the bottom dock above the terminal drawer list.
  L14's timeline hook and L03's chip were retired on 2026-10-09, so this is the only packet
  position left in the file and stays a packet seam of two marked lines.

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
- **Keybinding defaults.** Fork default shortcuts are `keydown` listeners with an off switch,
  never `keybindings.json` entries, which upstream T3 Code would flag (section 9).
- **MCP tools** are visible to every session and cost tokens every turn.
- **Settings search** lists each fork topic through `forkSettingsSearchItems()`. Controls
  inside a topic are not indexed unless they get their own search item.
- **Knip.** `knip:check` checks unused exports in apps and packages. If CI runs on the fork,
  empty registries are fine but exported helpers with no consumer yet (for example
  `supportsLoomFeature` before any packet uses it) may be reported. Use them in the first
  packet or accept the finding until then.
- **`loom.sh` coverage.** `loom.sh check` verifies seams against `docs/fork/seams.tsv` but
  does not yet regenerate the route tree or typecheck `apps/mobile` (CONVENTIONS.md, "What
  `loom.sh` does not do yet").

## 18. Changed files card header (`ext-changed-files`)

L41 and L59 share the header of `ChangedFilesCard`. The upstream card imports and renders
`ForkChangedFilesActions` in two marked lines; the registry in `apps/web/src/fork/changedFiles/registry.ts`
provides components with the route's saved `threadRef`, the card's `runId` and its file list.
Components gate their own feature, candidate files and user setting. The wrapper returns null
without router context so upstream static card tests keep working. Register a packet once in
`FORK_CHANGED_FILES_ACTIONS`; no additional card seam is needed.

Existence check: `test -f apps/web/src/fork/changedFiles/registry.ts` and
`git grep -c 'fork: ext-changed-files' -- apps/web/src/components/chat/ChangedFilesTree.tsx`
prints 2. Run the existing ChangedFilesTree tests when altering the seam.

## Loom Vault foundation (`ext-vault`)

Status: **Encrypted records, online workload policy, inspection and reviewed host enrollment implemented; broader foundation in progress.** Kyle
selected all sixteen packets for implementation and OpenBao as the backend on 2026-10-17.
The active shared boundary lives outside the feature packet folders:

- Contracts: `packages/contracts/src/fork/vault-core.ts`, exported through the fork group.
  `VaultItemSummary` contains no value; `VaultItemSave.value` is redacted and optional for
  metadata-only updates. Mutations carry stable item/operation IDs and expected versions.
  `VaultPrivateSave` takes a one-use secretRef. Explicit `VaultItemReveal` is separate.
- Storage: `apps/server/src/fork/vault/OpenBaoStore.ts` implements status, read, CAS write
  and bounded key listing for the selected KV v2 mount. It owns backend token access.
- Domain: `VaultCore` implements environment-owned records and atomic mutation receipts;
  `VaultPrivateInput` binds private ingress to authenticated thread/project/environment/backend
  context. Other packets consume these shared services, not L79 UI internals.
- Private handoff seam: `SecretRequests.transfer(input, callback)` durably claims a ref for
  one destination operation before the callback. A callback must be idempotent. Failure retains
  the claim for that operation only; success removes the source. Source deletion failures
  retain the claim, and Vault receipts recover already-committed saves.
- Registries: ForkLayer/ForkRuntime publish the services; fork RPC, MCP and CLI registries
  provide thin authenticated adapters. Client-runtime exposes protected commands shared by
  web/desktop and mobile. No global replacement of ServerSecretStore/provider auth occurs.

Shared `vault-access.ts` contracts and `VaultAccess`/`VaultPolicy` provide explicit personal
owner-trusted inspect/brokered use and restricted thread/project grants, ancestry attenuation,
permanent revocation, bounded audited decisions, previews and 60-second server-context
readiness. These services share the same environment namespace and OpenBao adapter as records.
Policy uses a separate CAS document; revisions change on grant or owner-mode edits. Grant state,
receipts and decision history persist across restart and restore. No new upstream seams are
needed; services and transports register through existing fork-owned extension points.

Human management uses environment access:read for inspection and access:write for changes and
explicit reveal. Active full-access/default runs can inspect/use under personal owner trust;
restricted mode requires matching grants. Private input and lifecycle mutations retain manage
grants. Plan/runtime permissions, current run and protected credential checks are unchanged.
MCP threads cannot administer root grants or reveal raw values. Direct-child delegation is
attested through ThreadManagement and never increases the existing T3 permission ceiling.
The durable owner binding is an explicit personal environment declaration, not verified
platform multi-owner identity. Shared environments remain restricted. Only authenticated human
owner administration may change the mode. A version-5 policy envelope preserves legacy/protected
policy and receipts; older evaluators reject it even after disabling personal access. These checks
do not isolate same-user full-access processes from host credential files. See
[L81](./L81-vault-grants/TECHNICAL.md#durable-owner-policy-and-compatibility).

`vault-owner-trusted` advertises the human-only personal environment setup; agent MCP/CLI can
read its state through `loom_vault_owner_policy` / `loom vault owner-policy`, but cannot set it.
`vault-connection-resolution` exposes shared metadata-only `VaultConnections` selection across
SSH, Git-over-SSH and GitHub. `loom_vault_connections_resolve` / `loom vault connections-resolve`
accept a kind and named-resource or explicit item/version selector. Direct execution accepts
both selectors while retaining the legacy item/version inputs. The selected identity/version
and destination are pinned for the operation and current authorization is rechecked at use.
Profiles remain optional. A missing visible match may be inspect-hidden; a `ready` selection
is not a broker or upstream-authentication probe.

Limits: 128 grants, 32 item IDs per grant, 256 operational history events, 32 mutation receipts,
50 history entries in the management snapshot and 10 recent decisions in an item explanation.
Shared `vault-brokers.ts` contracts and `VaultBrokers` provide a separate encrypted CAS
registry, reviewed public-key invitation/claim/approval, cancellation and permanent disable.
`BrokerIdentity` and `BrokerRunner` own private host identity files and signed online heartbeat
HTTP; the macOS/Linux foreground or managed-user-service CLI uses no administrator/backend token. Web/mobile management
is gated by `vault-brokers`, with access:read/access:write scopes. MCP administrator clients
manage hosts, while calling threads cannot enroll or approve themselves. Snapshots omit nonce
material and cap machines/invitations/activity. Presence renews every minute for two minutes;
it is not a workload credential lease. Fork-owned `BrokerService` and `BrokerDaemon` add explicit
host-local user-service lifecycle and bounded safe diagnostics. macOS requires a GUI login;
Linux/Pi continuity depends on operator-configured linger. No live service installation or
offline decrypted cache is included. See [L80](./L80-vault-brokers/TECHNICAL.md).

Shared `vault-workloads.ts` and `VaultWorkloads` now provide active-run/item/destination-bound
check sessions. Machine and workload Ed25519 proofs are both required; current host state,
run/mode and persisted use-policy decisions are rechecked. Process-local sessions expire after
five minutes or control-plane restart. `WorkloadRunner` and the common `BrokerHttpClient` expose
signed check/release routes under `/api/loom/vault-brokers/workloads/`, while MCP opens/lists/
closes only the authenticated thread's sessions. `vault-workload-checks` advertises this limited
capability. No raw values or reusable use tokens are returned. Actual delivery must authenticate
its own operation payload and current policy, rather than trusting a prior check result.

Shared `vault-ssh.ts`, `VaultSsh`, `SshCrypto` and `SshTransport` add the `vault-ssh-mediated`
capability. Full-access administrator clients manage generated Ed25519 keys and independent host
pins using MCP; existing Vault core actions archive/restore/delete items. Agent public
inspection requires current inspect authorization under the selected access mode. Signed
`ssh-exec` HTTP/runner requests bind exact argv, key version and timeout to a fresh single-use
workload challenge. Current policy, host/run state and item version are rechecked before spawn
and agent signing. The server mediates the connection using a scoped POSIX socket, verified
OpenSSH session-bind and host-bound user authentication; generic signing and forwarding are
unsupported. Private key bytes never leave the server/OpenBao through this operation. Only
public temporary files are written. The target must be reachable from the Loom server. Commands
are bounded to four concurrent executions, eight seconds and 2 KiB stdout. Cancellation/timeout
closes local resources but cannot promise remote rollback. Already-issued signatures cannot be
recalled. The explicit terminal agent below extends this operation boundary. Windows, persistent
shell attachment and other runner-side transports remain unfinished.

`vault-ssh-agent` advertises fork-owned activation and ordered frame/list/close MCP tools.
`VaultLaunch` proves and retains a five-minute workload check; `VaultSsh` keeps current-run,
host, access-policy and item-version authority on every frame. A command-scoped POSIX relay
forwards only host-bound agent requests and never receives a private key. The terminal wrapper
validates its destination, isolates SSH/Git configuration and preserves child streams/exit
status. Host SSH authorization is required because authentication signatures cannot enforce
repository paths. In restricted mode this requires a host grant; repository-only grants use
mediated Git. Pi/ACP terminal connections are recognized; remaining native-harness setup is
explicit. No new upstream seam or client RPC is added. See
[L82](./L82-vault-ssh/TECHNICAL.md#explicit-terminal-ssh-agent).

`vault-ssh-management` separately advertises public-info and key/trust/probe RPCs, protected by
environment access:read/access:write. Web/desktop and mobile use the shared client-runtime
commands and item-change signal so core lifecycle and SSH edits refresh one another. A fixed
administrator probe runs only `/usr/bin/true`, rechecking current authority and item version
before, during and after transport. It returns safe evidence without stdout. MCP allows this
probe only for human full-access administrators; arbitrary agent commands keep the signed
workload/current-use-policy boundary. Older servers without this capability hide management
entry points. The server registers the SSH handler layer separately to bound TypeScript
RPC-union inference.

`VaultLaunch` now uses the provider's existing authenticated MCP connection to create a
memory-only workload identity and fresh signed operation, then closes the session on every
exit. `vault-run-access` advertises hosted SSH and Git ref-list/fetch tools; CLI dispatch uses
the same handlers. The operator enrolls the Loom server broker and configures its private
`LOOM_VAULT_EXECUTION_BROKER_DIR`; no thread can enroll/approve itself. Current online presence,
run/mode, item version and use grants remain required. Git signs its own `git-exec` payload,
uses the thread checkout, and requires its exact repository destination. Workloads are not
OS-isolated and unprefixed terminal commands receive no secret environment or socket.

Shared `vault-references.ts`/`VaultReferences` add environment-scoped metadata search and
stable reference text. Agent search/describe require inspect grants; unknown/forbidden IDs
both describe as null. Search scans at most four 25-record pages and preserves sparse cursors.
Client-runtime queries share the item-change signal; web/native pickers are reusable consumers.

Shared `vault-profiles.ts`/`VaultProfiles` add project-local CAS registries, named required
SSH/Git/GitHub bindings, active defaults and archive/restore. Profiles contain references only.
The first active-run resolution persists a CAS-created profile/key-version pin in OpenBao;
later edits/default switches apply to later runs. Every use rechecks current authority and
key versions, and profile archive is checked at transport/signing. Management requires
access:write; agents list only their own project and cannot change bindings. `VaultLaunch.profile`
uses existing signed workload cleanup. Registry/pin paths live under the environment's
`profiles/<project-hash>/` namespace and need explicit operator policy rights. Pins have no
automatic retention cleanup yet. Administrator inspection/terminal-run retirement replaces
current pins with durable no-reselection tombstones; older OpenBao versions remain. Clients gate
on vault-profile-history. Web/desktop/mobile, palette, MCP and CLI reuse existing registries.
Composer/task launch selection is implemented below; other credential kinds remain open.
The vault-profile-github capability adds dedicated connection/repository selection and pinned
GH execution through the shared profile boundary. Preview/preflight checks saved configuration
and exact use grants, never live provider health. GitHub profile execution passes a guard to
VaultGitHub so profile archive and originating run identity remain live through token acquisition
and CLI spawn. Portable GitHub declarations use version 2 with no local bindings; legacy SSH/Git
exports remain version 1. Older servers cannot decode stored GitHub profile kinds.

Shared vault-github contracts and VaultGitHub expose dedicated github.com connections, not
ambient terminal credentials. App/token material uses encrypted service-connection records;
metadata, administrator management and exact repository use grants remain separate rights.
GitHubTransport and GitHubCli own provider/API and isolated subprocess adaptation. The
vault-github capability gates clients. App tokens are repository-limited and released best
effort; local disconnection never claims provider revocation. Existing upstream GitHub credential
precedence is untouched. New credential kinds should extend shared profiles/delivery contracts
rather than import packet UI or bypass current run authority.

The `vault-github-terminal` capability adds explicit supported gh/Git HTTPS argv and cancellable
readiness through the same connection service. Terminal execution is agent-thread only; live
readiness requires access:write for client callers and an agent's own authenticated thread for
MCP. Neither can authorize from cached readiness. CLI output/exit codes preserve command
semantics. A private exact-repository Git helper and current run checks govern scoped children;
ordinary shells and independent runners receive no persistent credentials. MCP-native providers
can call the tool directly; terminal fallback requires its authenticated MCP environment, which
ACP supplies. The interface does not claim that every native harness propagates that environment.
No new upstream seam or shared runtime is needed.

`packages/provider-core/src/fork/vaultInstructions.ts` supplies static, capability-aware
instructions to the existing common provider prompt channel. The two marked `ext-vault` lines
in `packages/provider-core/src/server/orchestrationInstructions.ts` import/prepend that string.
Pi uses its native system-prompt hook; other adapters retain their existing common instruction
paths. No per-provider seam or additional MCP process is added. FORK.md and the seam manifest
record the file. This extension does not alter upstream wire/events or provider permissions.

`ext-vault-preflight` is a blocking launch guard, distinct from optional text contributors.
`ProviderTurnStartService` calls the fork-owned guard after reading the current run/message
and before provider session open or workspace preparation. Ordinary prompts perform no Vault
lookup. Only standalone `[Vault profile: label](loom-vault-profile:<encoded-environment>:<id>:<version>)`
and `[Vault reference: label](loom-vault:<encoded-environment>:<id>)` links declare requirements;
fenced/quoted/inline examples do not. Links contain references only and remain visible in the
transcript. Current environment identity selects a scoped registered guard; absent guard or
backend denies explicit requirements. Registration belongs to ForkLayer and is removed with its
scope, avoiding a dependency cycle with the earlier-constructed orchestration workers.

A profile attachment checks its reviewed version, pins the complete configuration to the
specific run, and checks all current use grants, keys and host trust. Item attachments require
current inspect access and active metadata; they grant no credential use. Failure settles the
run through the existing failed-run event path with a safe repair message. Full-access/default
requirements remain in the shared profile service. Scheduled agent runs, queued messages,
MCP/CLI launches and every provider pass through the same guard. No upstream scheduler wire/storage
change or automatic personal-credential fallback is introduced. Provider steering reuses the same guard and cannot change a pinned profile mid-run.
Command-only jobs and upstream servers do not gain this preflight guarantee.

The dedicated Vault attachment buttons and their `vault-launch-ui` seams have been removed
from web/native composers and scheduled-task prompt editors. Existing standalone links still
use normal prompt persistence and the server preflight guard. Unlike `ext-turn-input`, this
guard must never time out and silently skip a required check.

`vault-scheduled-outcomes` owns the scheduler integration for explicit Vault-attached runs.
The marked scheduler construction initializes the fork service and its idempotent SQLite
migration before ForkLayer. The same migration set is registered in the normal fork ledger.
Track the exact generated message before dispatch, including rendered webhook prompts; bind
ownership to task creation/firing timestamps and project identity. Project the matching V2 run
into the existing task list/manual result, keeping queued runs running and terminal failures
failed. Use the scheduler's existing source/notification path to publish changes. Raw task
rows, run counts, cadence and webhook delivery logs retain dispatch semantics. Upstream event
and task schemas are unchanged. Web/native recovery reuses task editing and explicit retry;
webhook repair requires a new request. Keep one metadata-only ownership row per task and delete
stale ownership. Earlier untracked firings retain dispatch status; no automatic replay occurs.

Portable requirements use the versioned contracts in `vault-profiles.ts`. They export only
user-reviewed labels and requirement names/kinds; never bindings, grants, environment identity,
repositories or pins. Import into an unbound local profile through existing preview/save, or
use the create-only administrator import mutation. Agents cannot change bindings or expand
their project scope. Library publication and project-file distribution remain separate design.

No immutable audit ledger, platform membership, workload delivery lease or provider
probe exists. General readiness with credential-use requirements reports an unsupported execution probe.
Mediated SSH is a separate operation with its own proof; it is not run by readiness. Do not infer unattended SSH readiness from a policy decision.

Existence checks:

```sh
test -f packages/contracts/src/fork/vault-core.ts
test -f apps/server/src/fork/vault/OpenBaoStore.ts
test -f apps/server/src/fork/vault/VaultCore.ts
test -f apps/server/src/fork/vault/VaultPrivateInput.ts
test -f packages/contracts/src/fork/vault-access.ts
test -f apps/server/src/fork/vault/VaultAccess.ts
rg 'transfer|claimedBy' apps/server/src/secrets/SecretRequests.ts
rg 'VaultCoreRpcGroup' packages/contracts/src/fork/rpc.ts
```

[LOOM-VAULT-FOUNDATION.md](./LOOM-VAULT-FOUNDATION.md) records the larger target model.
Promote additional shared contracts independently as their consumers arrive. Do not fabricate
workload, credential lease, platform identity, remote approval or delivery capabilities because
records or enrolled hosts already exist.

## Vault native terminal sessions (`ext-vault-terminal`)

The provider MCP session owns an optional private connection descriptor. `McpProviderSessions`
creates it under a scoped private temporary directory when filesystem support is available,
replaces it with a new descriptor on credential rotation, and removes it on clear/shutdown.
Existing session-registry revocation still rejects a stale token, including files left by a
crash. The descriptor is plaintext and readable by the same operating-system user.

Native Codex applies its path through thread-local `shell_environment_policy.set` on
start/resume; Claude applies it to the query environment. Changed MCP identity already
invalidates Claude's query policy key. Both clear inherited alternate connection variables
when installing this managed connection. Pi and ACP retain their existing environment paths;
other native adapters retain hosted tools and explicit terminal configuration.

All Vault terminal paths use the same validated connection-family resolver. A specified broken
file cannot fall back to another identity. Terminal readiness is a service-backed authenticated
context check; it is not permission to use an arbitrary item or proof of an upstream login.

## Personal Vault client boundary (proposed)

Kyle requested a personal password-manager expansion on 2026-10-21. The proposed shared boundary
in [Loom Personal Vault](./LOOM-PERSONAL-VAULT.md#shared-design-constraints) separates human-owned
personal custody from environment-owned OpenBao credentials. It is not an implemented extension
point or a verbatim API specification. Engine choice, key hierarchy, trusted-client/OS isolation,
encrypted metadata, offline recovery and synchronization semantics need evidence before contracts
are promoted here. Feature packets consume verified shared primitives or report unavailable;
they must not use a development environment's grant/token as personal decryption authority.

L101 needs no new boundary: its pure client-runtime generator, local web/native controls and
existing fork registries have no server operation, persistent value or agent-facing raw output.
