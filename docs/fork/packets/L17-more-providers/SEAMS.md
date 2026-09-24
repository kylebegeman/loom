# L17 seams

## Extension points used or created

| Extension point | Where it is specified                                                                       | This packet                               |
| --------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ext-core`      | [EXTENSION-POINTS.md, section 1](../EXTENSION-POINTS.md#1-server-core-ext-core)             | Creates it if missing, in its own commit. |
| `ext-providers` | [EXTENSION-POINTS.md, section 15](../EXTENSION-POINTS.md#15-provider-drivers-ext-providers) | Creates it if missing, in its own commit. |
| `ext-settings`  | [EXTENSION-POINTS.md, section 7](../EXTENSION-POINTS.md#7-settings-ext-settings)            | Creates it if missing, in its own commit. |
| `ext-palette`   | [EXTENSION-POINTS.md, section 8](../EXTENSION-POINTS.md#8-command-palette-ext-palette)      | Creates it if missing, in its own commit. |

Record here, once implemented, the commit that created each (or "existed").

## Registrations (fork-owned files only)

| Registry                           | File                                                  | Entry                                                              |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `ForkRpcGroup` merge, fork index   | `packages/contracts/src/fork/rpc.ts`, `index.ts`      | `MoreProvidersRpcGroup`, `export * from "./more-providers.ts";`    |
| `FORK_RPC_REQUIRED_SCOPES`         | `apps/server/src/fork/rpcAuthorization.ts`            | one scope per tag (TECHNICAL.md)                                   |
| `ForkRpcGroup.of` spread           | `apps/server/src/fork/rpc.ts`                         | `...(yield* makeMoreProvidersRpcHandlers(auth))`                   |
| `ForkServicesLive`, `ForkServices` | `apps/server/src/fork/ForkLayer.ts`, `ForkRuntime.ts` | `MoreProvidersEndpoints`                                           |
| `FORK_MIGRATION_SETS`              | `apps/server/src/fork/persistence/migrations.ts`      | `MoreProvidersMigrations`                                          |
| `LOOM_SERVER_FEATURES`             | `apps/server/src/fork/features.ts`                    | `"more-providers"`                                                 |
| `FORK_PROVIDER_DRIVERS`            | `apps/server/src/fork/providers/drivers.ts`           | `...MoreProvidersDrivers` (`loomCopilot`, `loomGemini`, `loomAcp`) |
| `FORK_PROVIDER_CLIENT_DEFINITIONS` | `apps/web/src/fork/providers/registry.ts`             | `...moreProvidersClientDefinitions`                                |
| `FORK_PROVIDER_ICONS`              | `apps/web/src/fork/providers/registry.ts`             | `...moreProvidersIcons`                                            |
| `FORK_SETTINGS_SECTIONS`           | `apps/web/src/fork/settings/registry.ts`              | `moreProvidersSettings` ("Model endpoints")                        |
| `FORK_COMMAND_PALETTE_SOURCES`     | `apps/web/src/fork/commandPalette/registry.ts`        | `moreProvidersPaletteSource`                                       |
| client-runtime fork index          | `packages/client-runtime/src/fork/index.ts`           | `export * from "./more-providers.ts";`                             |

## Packet seams

None.

Considered and rejected:

- Filtering upstream's "coming soon" entries (`AddProviderInstanceDialog.tsx:73-94`) so
  "Github Copilot (coming soon)" does not sit next to the working "GitHub Copilot CLI". It
  would need a seam in a file upstream reshapes often (it changed in #10832). The fork label
  and badge make the difference clear enough.
- Gating the fork drivers in the Add provider dialog by `loomFeatures` (would need a seam in
  the same dialog). Known limit: a Loom client on an upstream server lists them; an instance
  added there shows as unavailable and is removable.

## Merge check

Planned command, from the packet branch:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Against `v0.0.43-nightly.20260923.2173`, the `ext-providers` target lines are unchanged (see
EXTENSION-POINTS.md, section 15). This packet also imports, without editing,
`CursorAdapter.ts` patterns (copied), `AcpSessionRuntime.ts`, `AcpCoreRuntimeEvents.ts`,
`AcpAdapterSupport.ts`, `AcpRuntimeModel.ts`, `McpProviderSession.ts`,
`makeManagedServerProvider.ts`, `providerSnapshot.ts`, `ProviderInstanceEnvironment.ts` and
`instanceIdentity.ts`. A merge that changes their exported signatures breaks the fork build,
not the merge; the integrate dry run's typecheck catches it. Record the real result here
after implementation.

## FORK.md rows

No "Packet seams" rows. If this packet creates `ext-providers`, add the four rows listed at
the end of L16's SEAMS.md (identical).
