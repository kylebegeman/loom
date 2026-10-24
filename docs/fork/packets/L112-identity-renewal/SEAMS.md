# L112 seams

## Extension points created by this packet

None. The client-side hook is a fork `IdentityRenewal` reference in
`packages/client-runtime/src/fork/identity-renewal.ts`, defaulting to `null`, which each
platform provides.

## Packet seams

| File                                                                         | Marker                   | Lines | Why                                                                        |
| ---------------------------------------------------------------------------- | ------------------------ | ----- | -------------------------------------------------------------------------- |
| `apps/server/src/auth/SessionStore.ts`                                       | `fork: identity-renewal` | 17    | Link a renewed session to its predecessor and revoke the whole chain.      |
| `apps/server/src/auth/SessionStore.test.ts`                                  | `fork: identity-renewal` | 5     | Cover succession and chain revocation.                                     |
| `apps/server/src/ws.ts`                                                      | `fork: identity-renewal` | 11    | Move an open socket to the successor session at expiry.                    |
| `packages/client-runtime/src/connection/registry.ts`                         | `fork: identity-renewal` | 13    | Renew Identity credentials under the lease lock; forget grants on removal. |
| `packages/client-runtime/src/connection/registry.test.ts`                    | `fork: identity-renewal` | 5     | Cover renewal and grant forgetting.                                        |
| `packages/client-runtime/src/connection/resolver.ts`                         | `fork: identity-renewal` | 6     | Renew an expired or rejected credential before connecting.                 |
| `packages/client-runtime/src/connection/resolver.test.ts`                    | `fork: identity-renewal` | 4     | Cover expired-only renewal.                                                |
| `packages/client-runtime/src/connection/layer.ts`                            | `fork: identity-renewal` | 2     | Start the renewal worker with the registry.                                |
| `packages/contracts/src/ipc.ts`                                              | `fork: identity-renewal` | 3     | Desktop bridge methods to renew and forget a grant.                        |
| `apps/desktop/src/main.ts`                                                   | `fork: identity-renewal` | 2     | Provide the desktop renewal layer.                                         |
| `apps/desktop/src/preload.ts`                                                | `fork: identity-renewal` | 2     | Expose renew and forget to the renderer.                                   |
| `apps/desktop/src/ipc/channels.ts`                                           | `fork: identity-renewal` | 2     | Channel names for renew and forget.                                        |
| `apps/desktop/src/ipc/DesktopIpcHandlers.ts`                                 | `fork: identity-renewal` | 3     | Handle renew and forget in main.                                           |
| `apps/web/src/connection/platform.ts`                                        | `fork: identity-renewal` | 3     | Provide desktop renewal to the web client.                                 |
| `apps/mobile/src/connection/platform.ts`                                     | `fork: identity-renewal` | 2     | Provide Keychain-backed renewal to the mobile client.                      |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | `fork: identity-renewal` | 1     | Renewal copy in the computer's settings.                                   |
| `packages/shared/package.json`                                               | (no marker)              | -     | Export `./fork/identity-grant`.                                            |
| `docs/internals/environment-auth.md`                                         | `fork: identity-renewal` | 2     | The host-local grant rules now include renewal.                            |

Session succession has to live in `SessionStore` and `ws.ts`, because the socket holds a
session reference that upstream checks at expiry; no extension point reaches that. The
registry and resolver seams sit where upstream already swaps a bearer credential under its
lease lock.

## FORK.md rows

One paragraph under "Packet seams", after the `no-project-first` entry.
