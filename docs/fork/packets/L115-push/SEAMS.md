# L115 seams

## Extension points created by this packet

None.

## Packet seams

| File                                                                     | Marker               | Lines | Why                                                                                                                   |
| ------------------------------------------------------------------------ | -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/app.config.ts`                                              | `fork: library-push` | 2     | Keep `aps-environment` for Library push builds and expose `extra.loomLibraryPush`, leaving relay and widget push off. |
| `apps/mobile/src/App.tsx`                                                | `fork: library-push` | 2     | Mount the Library push registration coordinator next to `SubscriptionUsageCoordinator`.                               |
| `apps/mobile/src/features/agent-awareness/notificationPayload.ts`        | `fork: library-push` | 2     | Accept a computer settings link on tap, which a Vault approval alert carries; thread links are unchanged.             |
| `apps/mobile/src/features/settings/SettingsNotificationsRouteScreen.tsx` | `fork: library-push` | 3     | Return the Library notifications screen in a build without Connect, and append its section to the Connect variant.    |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`              | `fork: library-push` | 2     | Add a Notifications row to the Local settings variant, which has none of its own.                                     |
| `apps/mobile/src/state/use-remote-environment-registry.ts`               | `fork: library-push` | 2     | Ask the Library to forget this iPhone, briefly and best effort, before removing its connection revokes the session.   |
| `docs/user/mobile-notifications.md`                                      | `fork: library-push` | 1     | Point Loom readers of the Connect-only notifications page to agent alerts from their Library.                         |

The Library's push service, activity route, agent alert watcher, RPC methods and MCP tools
register through the fork layer, fork routes, RPC group and MCP index, and the web and desktop
section lives in fork-owned Connections code. None of them needs an upstream line. Tapping an
agent alert uses upstream's notification handler, which the payload seam lets open a computer's
settings too.

## FORK.md rows

One paragraph under "Packet seams", after the L114 `reach` entry and before the L116
`telemetry-off` entry.
