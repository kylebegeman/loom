# L114 seams

## Extension points created by this packet

- `CloudflaredExtraPorts` (`apps/server/src/fork/cloudflared/connector.ts`), a
  `Context.Reference` listing loopback ports held by cloudflared connectors that preview links
  do not run. Preview links never share them, so reach's metrics listener can never be shared as
  a preview. Another connector adds its ports here.
- `ReachPublicRoute` (`apps/server/src/fork/reach/publicRoute.ts`), the one public address
  `DirectEndpoints` appends. It is provided beneath `DirectEndpoints.layer`, because that layer
  sits below ForkLayer.

The cloudflared runner itself (`makeCloudflaredRunner`) is shared with preview links. Each
caller passes its own `Effect.fn` builders so span names stay literal.

## Packet seams

| File                                                                         | Marker        | Lines | Why                                                                                    |
| ---------------------------------------------------------------------------- | ------------- | ----- | -------------------------------------------------------------------------------------- |
| `packages/contracts/src/server.ts`                                           | `fork: reach` | 1     | `ServerDirectEndpointKind` gains `public`; older clients drop it.                      |
| `apps/server/src/environment/DirectEndpoints.ts`                             | `fork: reach` | 3     | Read `ReachPublicRoute` if present and append the reach address to the endpoints.      |
| `apps/server/src/server.ts`                                                  | `fork: reach` | 2     | Provide `ReachPublicRoute` right after `DirectEndpoints.layer`.                        |
| `apps/web/src/components/settings/ConnectionsSettings.tsx`                   | `fork: reach` | 2     | Mount `ComputerReachDetails` in a saved computer's details, after Routes.              |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `fork: reach` | 2     | Mount `ComputerReachSection` after the connect section on the iPhone computer details. |
| `packages/shared/package.json`                                               | `-`           |       | `"./fork/reach"` subpath export (no marker).                                           |

The request guard (`apps/server/src/fork/reach/guard.ts`) is a global `HttpRouter.middleware`
merged into `ForkRoutesLayer`, and the Library's routes, RPC and MCP tools register through the
fork layer, RPC group and MCP index. The sign-in refusal of another computer's resource
(`identityResourceRefusal` in `packages/shared/src/fork/identityGrant.ts`) runs in each
client's fork-owned Identity sign-in and stores nothing on saved connections. None of them needs
an upstream line.

## FORK.md rows

One paragraph under "Packet seams", after the L113 `directory-computers` entry.
