# L17 seams

## Extension points used or created

| Extension point | Where it is specified                                                                  | This packet                               |
| --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ext-core`      | [EXTENSION-POINTS.md, section 1](../EXTENSION-POINTS.md#1-server-core-ext-core)        | Creates it if missing, in its own commit. |
| `ext-settings`  | [EXTENSION-POINTS.md, section 7](../EXTENSION-POINTS.md#7-settings-ext-settings)       | Creates it if missing, in its own commit. |
| `ext-palette`   | [EXTENSION-POINTS.md, section 8](../EXTENSION-POINTS.md#8-command-palette-ext-palette) | Creates it if missing, in its own commit. |

Record here, once implemented, the commit that created each (or "existed").

## Registrations (fork-owned files only)

| Registry                           | File                                                  | Entry                                                           |
| ---------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `ForkRpcGroup` merge, fork index   | `packages/contracts/src/fork/rpc.ts`, `index.ts`      | `MoreProvidersRpcGroup`, `export * from "./more-providers.ts";` |
| `FORK_RPC_REQUIRED_SCOPES`         | `apps/server/src/fork/rpcAuthorization.ts`            | one scope per tag (TECHNICAL.md)                                |
| `ForkRpcGroup.of` spread           | `apps/server/src/fork/rpc.ts`                         | `...(yield* makeMoreProvidersRpcHandlers(auth))`                |
| `ForkServicesLive`, `ForkServices` | `apps/server/src/fork/ForkLayer.ts`, `ForkRuntime.ts` | `MoreProvidersEndpoints`                                        |
| `FORK_MIGRATION_SETS`              | `apps/server/src/fork/persistence/migrations.ts`      | `MoreProvidersMigrations`                                       |
| `LOOM_SERVER_FEATURES`             | `apps/server/src/fork/features.ts`                    | `"more-providers"`                                              |
| `FORK_SETTINGS_SECTIONS`           | `apps/web/src/fork/settings/registry.ts`              | `moreProvidersSettings` ("Model endpoints")                     |
| `FORK_COMMAND_PALETTE_SOURCES`     | `apps/web/src/fork/commandPalette/registry.ts`        | `moreProvidersPaletteSource`                                    |
| client-runtime fork index          | `packages/client-runtime/src/fork/index.ts`           | `export * from "./more-providers.ts";`                          |

## Packet seams

None. The seams considered for the retired ACP and Copilot drivers (filtering and gating
upstream's Add provider dialog) are no longer needed.

## Merge check

Planned command, from the packet branch:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

This packet imports, without editing, upstream's `HttpClient`, `ServerSettingsService` and
the provider instance helpers named in TECHNICAL.md. A merge that changes their exported
signatures breaks the fork build, not the merge; the integrate dry run's typecheck catches
it. Record the real result here after implementation.

## FORK.md rows

No "Packet seams" rows.
