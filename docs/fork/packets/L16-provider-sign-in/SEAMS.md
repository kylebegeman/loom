# L16 seams

## Extension points used or created

| Extension point | Where it is specified                                                                       | This packet                               |
| --------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ext-core`      | [EXTENSION-POINTS.md, section 1](../EXTENSION-POINTS.md#1-server-core-ext-core)             | Creates it if missing, in its own commit. |
| `ext-providers` | [EXTENSION-POINTS.md, section 15](../EXTENSION-POINTS.md#15-provider-drivers-ext-providers) | Creates it if missing, in its own commit. |
| `ext-settings`  | [EXTENSION-POINTS.md, section 7](../EXTENSION-POINTS.md#7-settings-ext-settings)            | Creates it if missing, in its own commit. |
| `ext-palette`   | [EXTENSION-POINTS.md, section 8](../EXTENSION-POINTS.md#8-command-palette-ext-palette)      | Creates it if missing, in its own commit. |

Each extension point's seams, markers and FORK.md rows are listed in its own specification;
they are not repeated here. Record in this section, once implemented, the commit that created
each one (or "existed").

## Registrations (fork-owned files only)

| Registry                           | File                                                  | Entry                                             |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `ForkRpcGroup` merge               | `packages/contracts/src/fork/rpc.ts`                  | `ProviderSignInRpcGroup`                          |
| `fork/index.ts` export             | `packages/contracts/src/fork/index.ts`                | `export * from "./provider-sign-in.ts";`          |
| `ForkSubscriptionRpcTag`           | `packages/contracts/src/fork/rpc.ts`                  | `typeof PROVIDER_SIGN_IN_WS_METHODS.subscribe`    |
| `FORK_RPC_REQUIRED_SCOPES`         | `apps/server/src/fork/rpcAuthorization.ts`            | one scope per tag (TECHNICAL.md)                  |
| `ForkRpcGroup.of` spread           | `apps/server/src/fork/rpc.ts`                         | `...(yield* makeProviderSignInRpcHandlers(auth))` |
| `ForkServicesLive`, `ForkServices` | `apps/server/src/fork/ForkLayer.ts`, `ForkRuntime.ts` | `ProviderSignInService`                           |
| `FORK_MIGRATION_SETS`              | `apps/server/src/fork/persistence/migrations.ts`      | `ProviderSignInMigrations`                        |
| `LOOM_SERVER_FEATURES`             | `apps/server/src/fork/features.ts`                    | `"provider-sign-in"`                              |
| `FORK_PROVIDER_DRIVER_DECORATORS`  | `apps/server/src/fork/providers/drivers.ts`           | `providerSignInDecorator`                         |
| `FORK_PROVIDER_SETUP_SECTIONS`     | `apps/web/src/fork/providers/registry.ts`             | `providerSignInSetupSection`                      |
| `FORK_SETTINGS_SECTIONS`           | `apps/web/src/fork/settings/registry.ts`              | `providerSignInSettings` ("Accounts")             |
| `FORK_COMMAND_PALETTE_SOURCES`     | `apps/web/src/fork/commandPalette/registry.ts`        | `providerSignInPaletteSource`                     |
| client-runtime fork index          | `packages/client-runtime/src/fork/index.ts`           | `export * from "./provider-sign-in.ts";`          |

## Packet seams

None.

Why none is needed:

- Attaching sign-in to Codex and Claude instances would otherwise mean editing
  `CodexDriver.ts` and `ClaudeDriver.ts` (old Loom's approach). The `ext-providers` driver
  decorator wraps `create` from outside instead.
- The chat banner and model picker already offer "Open provider setup" for any snapshot with
  `setup.canAuthenticate` (`apps/web/src/components/chat/ProviderStatusBanner.tsx:34-40`); the
  decorator sets that optional upstream field, so no chat seam is needed.
- The provider editor's `setup` slot is part of `ext-providers`.

## Merge check

Planned command, from the packet branch:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

At writing time (`v0.0.43-nightly.20260923.2173`), the upstream files that `ext-providers`
touches were checked: `ProviderInstanceRegistryHydration.ts`, `providerDriverMeta.ts` and
`providerIconUtils.ts` are unchanged; `ProviderSettingsPanel.tsx` changes elsewhere in the
file but not at lines 85 or 917-931. Record the real result here after implementation.

## FORK.md rows

No "Packet seams" rows. If this packet creates `ext-providers`, add to "Extension point
seams":

| File                                                                   | Marker          | Why                                                                         |
| ---------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| `apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts` | `ext-providers` | Driver list from `fork/providers/drivers.ts` (fork drivers and decorators). |
| `apps/web/src/components/settings/providerDriverMeta.ts`               | `ext-providers` | Settings-form definitions for fork drivers.                                 |
| `apps/web/src/components/chat/providerIconUtils.ts`                    | `ext-providers` | Icons for fork drivers.                                                     |
| `apps/web/src/components/settings/ProviderSettingsPanel.tsx`           | `ext-providers` | Fork setup sections in the provider editor.                                 |
