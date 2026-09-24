# L21 seams

## Extension points used or created

| Extension point   | Where it is specified                                                                     | This packet                               |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ext-core`        | [EXTENSION-POINTS.md, section 1](../EXTENSION-POINTS.md#1-server-core-ext-core)           | Creates it if missing, in its own commit. |
| `ext-panels`      | [section 6](../EXTENSION-POINTS.md#6-right-panels-ext-panels)                             | Creates it if missing, in its own commit. |
| `ext-palette`     | [section 8](../EXTENSION-POINTS.md#8-command-palette-ext-palette)                         | Creates it if missing, in its own commit. |
| `ext-web-root`    | [section 5](../EXTENSION-POINTS.md#5-web-root-ext-web-root) (prerequisite of keybindings) | Creates it if missing, in its own commit. |
| `ext-keybindings` | [section 9](../EXTENSION-POINTS.md#9-keybindings-ext-keybindings)                         | Creates it if missing, in its own commit. |

Record here, once implemented, the commit that created each (or "existed").

## Registrations (fork-owned files only)

| Registry                           | File                                                  | Entry                                                                                                   |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ForkRpcGroup` merge, fork index   | `packages/contracts/src/fork/rpc.ts`, `index.ts`      | `SkillRegistryRpcGroup`, `export * from "./skill-registry.ts";`                                         |
| `ForkStreamCommandRpcTag`          | `packages/contracts/src/fork/rpc.ts`                  | `typeof SKILL_REGISTRY_WS_METHODS.fetchSource`                                                          |
| `FORK_RPC_REQUIRED_SCOPES`         | `apps/server/src/fork/rpcAuthorization.ts`            | one scope per tag (TECHNICAL.md)                                                                        |
| `ForkRpcGroup.of` spread           | `apps/server/src/fork/rpc.ts`                         | `...(yield* makeSkillRegistryRpcHandlers(auth))`                                                        |
| `ForkServicesLive`, `ForkServices` | `apps/server/src/fork/ForkLayer.ts`, `ForkRuntime.ts` | `SkillRegistryService`                                                                                  |
| `FORK_MIGRATION_SETS`              | `apps/server/src/fork/persistence/migrations.ts`      | `SkillRegistryMigrations`                                                                               |
| `LOOM_SERVER_FEATURES`             | `apps/server/src/fork/features.ts`                    | `"skill-registry"`                                                                                      |
| `FORK_PANELS`                      | `apps/web/src/fork/panels/registry.ts`                | `skillRegistryPanel` (id `skill-registry`, letter K)                                                    |
| `FORK_COMMAND_PALETTE_SOURCES`     | `apps/web/src/fork/commandPalette/registry.ts`        | `skillRegistryPaletteSource`                                                                            |
| `FORK_KEYBINDING_COMMANDS`         | `packages/contracts/src/fork/keybindings.ts`          | `"loom.skill-registry.toggle"`                                                                          |
| `FORK_ROOT_COMPONENTS`             | `apps/web/src/fork/ForkRoot.tsx`                      | `{ id: "skill-registry-shortcuts", Component: SkillRegistryShortcuts }` (subscribes the toggle command) |
| client-runtime fork index          | `packages/client-runtime/src/fork/index.ts`           | `export * from "./skill-registry.ts";`                                                                  |

## Packet seams

None. Toggling, installing and scaffolding write provider files (`settings.json`,
`settings.local.json`, skill folders, Codex `config.toml` through Codex), not upstream source
files. Reading uses upstream's exported helpers and `ProviderInstance.snapshotForCwd`
without editing them.

## Merge check

Planned command, from the packet branch:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Only extension point seams can conflict. The packet depends on the signatures of
`withCodexAppServerClient`, `resolveCodexHomeLayout`, `ProviderInstance.snapshotForCwd`,
`ServerProvider.skills` and `writeFileStringAtomically`; a merge that changes them fails the
typecheck in `loom.sh integrate`, not the merge. Record the real result here.

## FORK.md rows

None beyond the extension points' own rows.
