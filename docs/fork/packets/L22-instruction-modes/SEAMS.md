# L22 seams

## Extension points used or created

| Extension point   | Where it is specified                                                                     | This packet                               |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ext-core`        | [EXTENSION-POINTS.md, section 1](../EXTENSION-POINTS.md#1-server-core-ext-core)           | Creates it if missing, in its own commit. |
| `ext-turn-input`  | [section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input)                | Creates it if missing, in its own commit. |
| `ext-composer`    | [section 11](../EXTENSION-POINTS.md#11-composer-ext-composer)                             | Creates it if missing, in its own commit. |
| `ext-settings`    | [section 7](../EXTENSION-POINTS.md#7-settings-ext-settings)                               | Creates it if missing, in its own commit. |
| `ext-palette`     | [section 8](../EXTENSION-POINTS.md#8-command-palette-ext-palette)                         | Creates it if missing, in its own commit. |
| `ext-web-root`    | [section 5](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (prerequisite of keybindings) | Creates it if missing, in its own commit. |
| `ext-keybindings` | [section 9](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings)                         | Creates it if missing, in its own commit. |

Record here, once implemented, the commit that created each (or "existed").

## Registrations (fork-owned files only)

| Registry                           | File                                                  | Entry                                                                                 |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ForkRpcGroup` merge, fork index   | `packages/contracts/src/fork/rpc.ts`, `index.ts`      | `InstructionModesRpcGroup`, `export * from "./instruction-modes.ts";`                 |
| `FORK_RPC_REQUIRED_SCOPES`         | `apps/server/src/fork/rpcAuthorization.ts`            | one scope per tag (TECHNICAL.md)                                                      |
| `ForkRpcGroup.of` spread           | `apps/server/src/fork/rpc.ts`                         | `...(yield* makeInstructionModesRpcHandlers(auth))`                                   |
| `ForkServicesLive`, `ForkServices` | `apps/server/src/fork/ForkLayer.ts`, `ForkRuntime.ts` | `InstructionModesService`, `InstructionModesCleanupLive`                              |
| Turn input contributors            | `apps/server/src/fork/turnInput/registry.ts`          | registered at runtime by `InstructionModesService` (id `instruction-modes`, order 10) |
| `FORK_MIGRATION_SETS`              | `apps/server/src/fork/persistence/migrations.ts`      | `InstructionModesMigrations`                                                          |
| `LOOM_SERVER_FEATURES`             | `apps/server/src/fork/features.ts`                    | `"instruction-modes"`                                                                 |
| `FORK_COMPOSER_BLOCKS`             | `apps/web/src/fork/composer/registry.tsx`             | `{ id: "instruction-modes", Component: ComposerModesControl }`                        |
| `FORK_SETTINGS_SECTIONS`           | `apps/web/src/fork/settings/registry.ts`              | `instructionModesSettings`                                                            |
| `FORK_COMMAND_PALETTE_SOURCES`     | `apps/web/src/fork/commandPalette/registry.ts`        | `instructionModesPaletteSource`                                                       |
| `FORK_KEYBINDING_COMMANDS`         | `packages/contracts/src/fork/keybindings.ts`          | `"loom.instruction-modes.open"`                                                       |
| client-runtime fork index          | `packages/client-runtime/src/fork/index.ts`           | `export * from "./instruction-modes.ts";`                                             |

## Packet seams

None. Delivery goes through `ext-turn-input`, whose seam in `ProviderService.ts` belongs to
the extension point.

## Merge check

Planned command, from the packet branch:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

`ProviderService.ts` is unchanged between v0.0.42 and `v0.0.43-nightly.20260923.2173`.
`ChatComposer.tsx` changes substantially in that nightly (389 insertions, 200 deletions);
the `ext-composer` seams are that extension point's risk (EXTENSION-POINTS.md, "Risks"), not
this packet's. Record the real result here after implementation.

## FORK.md rows

If this packet creates `ext-turn-input`, add to "Extension point seams":

| File                                                 | Marker           | Why                                                                   |
| ---------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `apps/server/src/provider/Layers/ProviderService.ts` | `ext-turn-input` | Fork contributors prepend standing text to provider-bound turn input. |
