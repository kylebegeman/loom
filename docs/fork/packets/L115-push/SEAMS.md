# L115 seams

## Extension points created by this packet

None.

## Packet seams

| File                                                                     | Marker               | Lines | Why                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/app.config.ts`                                              | `fork: library-push` | 2     | Keep `aps-environment` for Library push builds and expose `extra.loomLibraryPush`, leaving relay and widget push off. |
| `apps/mobile/src/App.tsx`                                                | `fork: library-push` | 2     | Mount the Library push registration coordinator next to `SubscriptionUsageCoordinator`.                               |
| `apps/mobile/src/features/settings/SettingsNotificationsRouteScreen.tsx` | `fork: library-push` | 3     | Return the Library notifications screen in a build without Connect, and append its section to the Connect variant.    |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`              | `fork: library-push` | 2     | Add a Notifications row to the Local settings variant, which has none of its own.                                     |
| `apps/mobile/src/state/use-remote-environment-registry.ts`               | `fork: library-push` | 2     | Ask the Library to forget this iPhone, briefly and best effort, before removing its connection revokes the session.   |

The Library's push service, RPC methods and MCP tools register through the fork layer, RPC group
and MCP index, and the web and desktop section lives in fork-owned Connections code. None of them
needs an upstream line.

## FORK.md rows

One paragraph under "Packet seams", after the L114 `reach` entry and before the L116
`telemetry-off` entry.
