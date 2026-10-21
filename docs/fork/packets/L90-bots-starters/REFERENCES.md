# L90 references

- `docs/fork/packets/L89-bots-core/`: the definition, store and run lifecycle this packet seeds.
- `apps/server/src/fork/bots/migrations.ts`: the `bots` migration set; L89 uses id 1 for both
  tables, so this packet takes id 2.
- `apps/server/src/serverSettings.ts:172` `ServerSettingsService.getSettings`, and
  `packages/shared/src/serverSettings.ts:96` `fallbackTextGenerationModelSelection`: how the
  environment's default model is chosen.
- `apps/server/src/serverActivation.ts:28` `forkParked`: startup work after activation.
- `AGENTS.md` "Hit every surface": the checklist the surfaces lens follows.
- Prior art: GitHub starter workflows (shipped templates the user owns after adding), VS Code
  "Restore default" on settings, Claude Code's bundled subagent examples.
