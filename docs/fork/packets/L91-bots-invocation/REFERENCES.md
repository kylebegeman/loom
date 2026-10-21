# L91 references

- `docs/fork/packets/EXTENSION-POINTS.md` §11 (:1776) and §11b (:1982): the composer extension
  points this packet creates.
- `apps/web/src/composer-logic.ts:15,261`: trigger kinds and detection.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx:33`: the item union.
- `apps/web/src/components/chat/ChatComposer.tsx:2618-2700` (menu items), `:3763`
  (selection), `:4147` (keys), `:5051` (footer blocks), `:6610` (stash drawer).
- `apps/web/src/components/chat/composerSlashCommandSearch.ts:20,75`: prompt-position filter
  and ranking.
- `packages/provider-core/src/server/orchestrationInstructions.ts:1,9,40` and
  `packages/provider-core/src/fork/vaultInstructions.ts`: the `ext-vault` section precedent.
- `apps/server/src/orchestration-v2/ThreadManagementService.ts:60,121,376`: send modes, input and
  `sendToThread`.
- `apps/server/src/mcp/OrchestratorMcpService.ts:1530-1550`: how a delegated task wakes its parent.
- Prior art: Slack slash commands with modal forms, Raycast command arguments, Claude Code custom
  slash commands.
