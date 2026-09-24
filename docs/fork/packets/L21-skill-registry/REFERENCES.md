# L21 references

## Old Loom

"Skill registry, manager and creation lab" is under consideration in
[selections.md](../../selections.md). `bagelvault/loom` at `a79ec506` had a much heavier
design: skills as governed objects with lifecycle receipts, a metadata-only "Skill Source
Registry" with review and promotion, and a generator-based authoring studio.

| File                                                                                                                                                                                                                                                                                                                                                                         | LOC   | Keep / adapt / drop                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/contracts/src/skills.ts](https://github.com/bagelvault/loom/blob/a79ec506/packages/contracts/src/skills.ts)                                                                                                                                                                                                                                                        | 248   | Drop the lifecycle model (draft/active/archived, receipts). Keep the idea of recording provenance (provider, intake, authored).                     |
| [apps/server/src/skills/Layers/Skills.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/skills/Layers/Skills.ts)                                                                                                                                                                                                                                          | 1,104 | Drop.                                                                                                                                               |
| [apps/server/src/skillSources/Layers/SkillSources.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/server/src/skillSources/Layers/SkillSources.ts)                                                                                                                                                                                                                  | 1,531 | Keep one principle: never clone and execute untrusted skill repositories as a shortcut. Drop review queues and promotion.                           |
| [.ledger/entries/0973-complete-p73-skill-source-registry.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0973-complete-p73-skill-source-registry.md)                                                                                                                                                                                                    |       | "The registry is the safety boundary for external skill repositories" (metadata only, reviewed). This packet copies skill folders but runs nothing. |
| [.ledger/entries/0969-complete-p72-skill-library-mcp-authoring-process-packs.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0969-complete-p72-skill-library-mcp-authoring-process-packs.md), [0315-ph18-skill-mcp-authoring-scaffolds.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0315-ph18-skill-mcp-authoring-scaffolds.md) |       | Keep: SKILL.md skeletons and read-only validation. Drop: generator plan/apply machinery.                                                            |
| [apps/web/src/providerSkillPresentation.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/providerSkillPresentation.ts), [providerSkillSearch.ts](https://github.com/bagelvault/loom/blob/a79ec506/apps/web/src/providerSkillSearch.ts)                                                                                                                      |       | Look at for display and search ideas only.                                                                                                          |

## Upstream T3 Code

- `apps/server/src/provider/Drivers/ClaudeSkills.ts` (discovery `:308-384`, overrides
  `:122-155` and `:183-296`, folder-name rule `:346-351`, YAML booleans `:50-70`).
- `apps/server/src/provider/Layers/CodexProvider.ts:362` (`withCodexAppServerClient`),
  `:438`, `:477-490` (`skills/list`).
- `apps/server/src/provider/Drivers/CursorSkills.ts:218-252`, `GrokSkills.ts`,
  `AntigravitySkills.ts`, `apps/server/src/provider/opencodeRuntime.ts:913`.
- `apps/server/src/provider/Drivers/CodexHomeLayout.ts` (`skills` is a shared directory in
  shadow homes), `ClaudeHome.ts:12-18`.
- `packages/contracts/src/server.ts` (`ServerProviderSkill`, `ServerProviderWorkspaceSnapshot`).
- `apps/server/src/provider/Layers/ProviderRegistry.ts:820-829` (`snapshotForCwd` use),
  `packages/contracts/src/rpc.ts:463-475` (`server.refreshProviders` with `cwd`).
- `packages/effect-codex-app-server/src/_generated/schema.gen.ts:6477` (skill scopes),
  `:23090` (skill metadata), `:39928` (`skills/config/write`), `:39961` (`skills/list` params).
- `apps/server/src/atomicWrite.ts:5`, `apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts`
  (how `$name` becomes a Claude `/name` invocation, relevant to "Test in new thread").
- `docs/user/providers-claude.md` ("Skills"), `docs/user/composer.md` ("Commands and skills").

## External

- DietrichGebert/ponytail, https://github.com/DietrichGebert/ponytail, MIT. Skills under
  `skills/<name>/SKILL.md` with frontmatter `name`, `description`, `argument-hint`,
  `license`. Its installers go through each tool's plugin system and hooks; the registry
  would copy only `skills/*`.
- pbakaus/impeccable, https://github.com/pbakaus/impeccable, Apache-2.0 (with a NOTICE file).
  Its recommended `npx impeccable install` detects `~/.claude`, `~/.codex`, `~/.grok` and
  others, installs into them and adds provider hook manifests (README "Installation"); skill
  copies ship a launcher that downloads a binary on first run. Exactly the kind of installer
  this packet never runs; a copied impeccable skill gets the "contains scripts" warning.
- typesafe-ai/skills, https://github.com/typesafe-ai/skills, MIT. One skill at
  `skills/typesafe-ai/SKILL.md` (with its own `LICENSE`) plus a Claude plugin manifest in
  `.claude-plugin/`; the registry copies only the skill folder. The L29 drafting brief links
  to it.
- Suggested source layouts and licenses checked with `gh api repos/<owner>/<repo>` and the
  git tree on 2026-09-24: ponytail skills at `skills/ponytail*` (also mirrored under
  `.openclaw/skills/`), impeccable per-tool copies at `.claude/skills/impeccable`,
  `.agents/skills/impeccable`, `plugin/skills/impeccable` and others.
- Claude Code skills and settings (`skillOverrides`, `disable-model-invocation`,
  `user-invocable`): as encoded and verified in upstream's `ClaudeSkills.ts` comments.
