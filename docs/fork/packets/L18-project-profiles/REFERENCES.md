# L18 references

## Old Loom

Selection F11 (Project profiles) in [selections.md](../../selections.md). Old Loom is
`bagelvault/loom` at `a79ec506` (0.13.10). The feature was about 3.2k lines in total, 1,921 of
them the settings form; the schema file itself is 486 lines.

| File                                                                                                                                                                                        | Keep / adapt / drop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/contracts/src/projectProfile.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/projectProfile.ts) (`ProjectProfileFields` 372-430)                      | Adapt a small subset. Kept ideas: command intents (`setup dev test typecheck lint format build deploy custom`, 58-84), snippet bindings (111-131), a context budget (153-164). Dropped: `safety`, `workflows` (triggers never executed), `apple`, `remoteRuntime`, `apollo`, `identityRouting` (upstream owns model defaults now), `detectedFacts`/`confirmedFacts`, `retentionCleanup`, `workTarget`, `textGeneration` (upstream has writing style), `tools.environmentVariableRefs` (names only, never read). |
| [apps/server/src/persistence/Migrations/034_ProjectProfiles.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/persistence/Migrations/034_ProjectProfiles.ts)             | Adapt: one JSON document per project in SQLite. Our table is keyed by project id only (the environment is the database).                                                                                                                                                                                                                                                                                                                                                                                        |
| [apps/server/src/projectProfiles/Layers/ProjectProfiles.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/projectProfiles/Layers/ProjectProfiles.ts) (415 lines)         | Adapt the upsert semantics (service owns timestamps, keeps createdAt).                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [apps/server/src/projectProfiles/ScopedDefaults.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/projectProfiles/ScopedDefaults.ts)                                     | Drop: duplicated profile routing; upstream's project overrides now cover it.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [apps/web/src/components/settings/ProjectProfilesSettings.tsx](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/components/settings/ProjectProfilesSettings.tsx) (1,921 lines) | Drop. The new section has four short groups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [.ledger/entries/0044-project-profiles.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0044-project-profiles.md)                                                       | Keep the invariants: profiles store no secrets; list/get need read scope, writes need operate scope.                                                                                                                                                                                                                                                                                                                                                                                                            |
| [apps/web/src/contextSend.ts:249-274](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/contextSend.ts#L249-L274)                                                               | Reference only: the one place old Loom enforced a context budget, on the client when sending context packs. Not carried over.                                                                                                                                                                                                                                                                                                                                                                                   |

## Upstream T3 Code

- `packages/contracts/src/settings.ts:965-1007`: `PROJECT_SCOPED_SERVER_SETTING_KEYS`,
  `ProjectSettingsOverrides` (what the profile must not duplicate).
- `packages/contracts/src/orchestration.ts:391-425` (`ProjectScript`), `:1885-1888`
  (`ThreadActivityAppendedPayload`), `:1492-1498` (`thread.activity.append`), `:596-605`
  (activity schema with free-form `kind`).
- `packages/contracts/src/t3ProjectFile.ts`: `t3.json`.
- `packages/shared/src/projectScripts.ts`: `resolveProjectScripts` (17), `projectScriptRuntimeEnv` (58).
- `packages/contracts/src/providerRuntime.ts:315-333`: `ThreadTokenUsageSnapshot`.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:278-285,842-860`: how
  token usage becomes `context-window.updated` activities.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts:2372-2377`,
  `apps/server/src/provider/Layers/CodexAdapter.ts:430-445,1571`: the only adapters that emit
  token usage.
- `apps/web/src/session-logic.ts:451-515`: unknown activity kinds render as work log rows.
- `apps/web/src/components/ChatView.tsx:4141-4240`: `runProjectScript`, the pattern for
  running a command in the thread's terminal.
- `apps/web/src/terminalUiStateStore.ts:567-683`, `apps/web/src/state/terminal.ts:5`,
  `packages/shared/src/terminalLabels.ts:32`: terminal store, atoms, `nextTerminalId`.
- `apps/web/src/components/settings/SettingsScopeContext.tsx`,
  `apps/web/src/components/settings/useScopedSettings.ts`: scope-aware settings.
- `apps/web/src/hooks/useThreadActionMenu.ts:198-210`: computing a project key for settings
  navigation.
- `apps/server/src/mcp/toolkits/pullRequests/handlers.ts:146-181`: thread and project
  resolution from an MCP call; server command id convention.
- `packages/contracts/src/environment.ts:41-47`: `platform.os` for command quoting.

## External

- varlock and env-spec: <https://github.com/dmno-dev/varlock>, reviewed at
  `1f4ca0e940a7fc2628d06bc2b809fab3ec393df2`, MIT (© DMNO Inc.).
  - `packages/env-spec-parser` (`@env-spec/parser` 0.6.0, MIT, zero runtime dependencies):
    `parseEnvSpecDotEnvFile` in `src/index.ts`; AST classes in `src/classes.ts`
    (`ParsedEnvSpecFile.configItems` 450, `decoratorsObject` 472; item `decoratorsObject` 418,
    `description` 422). The grammar (`grammar.peggy`) is compiled at build time; consume the
    npm package, not the repository source.
  - Format reference: `packages/varlock-website/src/content/docs/reference/item-decorators.mdx`,
    `root-decorators.mdx`, `data-types.mdx`, `functions.mdx`.
  - `packages/varlock/src/cli/commands/run.command.ts` (`varlock run` environment injection),
    `load.command.ts` (`--format json-full --agent`, code generators at 77),
    `src/env-graph/lib/env-graph.ts:89-167` (`SerializedEnvGraph`),
    `src/cli/helpers/telemetry.ts:150-196` (telemetry opt-out).
  - Docs: <https://varlock.dev>.
