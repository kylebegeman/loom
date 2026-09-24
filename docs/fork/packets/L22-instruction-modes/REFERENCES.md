# L22 references

## Old Loom

Not in the original selection; added from the repository review
([selections.md](../../selections.md), "From selection to packet") and confirmed by Kyle on
2026-09-24. Old Loom (`bagelvault/loom` at `a79ec506`) had no rule-pack feature. The
closest prior art is thread goals:

- [.ledger/entries/0011-goals.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/0011-goals.md):
  a goal pinned to a thread, stored app-side for every provider, mirrored best-effort to the
  engine (Codex `thread/goal/set`, Claude `/goal`). Keep: app-side state per thread for every
  provider. Drop: event-sourced goal commands (the fork cannot add orchestration events) and
  per-engine mirroring (this packet uses one delivery path).
- [.ledger/entries/2577-cross-harness-context-compaction.md](https://github.com/bagelvault/loom/blob/a79ec506/.ledger/entries/2577-cross-harness-context-compaction.md):
  compaction on every provider, natively or by sending `/compact` (`/compress` for Cursor and
  Gemini) as an ordinary turn. Relevant twice: such turns start with `/` and must not be
  decorated, and a compacted conversation can lose earlier standing text, which is why this
  packet resends the block on every turn.

## Upstream T3 Code

- `apps/server/src/provider/Layers/ProviderService.ts:1569-1672` (`sendTurn`: citations,
  attachment context, the `input` object), `:1886-1890` (compaction sends `/compact` through
  `sendTurn`).
- `apps/server/src/provider/RuntimeInstructions.ts` (upstream's shared runtime text, used by
  all six adapters at session or turn level).
- `apps/server/src/provider/CodexDeveloperInstructions.ts:200-217` and
  `Layers/CodexSessionRuntime.ts:583-605` (Codex per-turn developer instructions, plan mode).
- `apps/server/src/provider/Layers/ClaudeAdapter.ts:4724-4729` (Claude system prompt append at
  session start).
- `Layers/CursorAdapter.ts:1067`, `Layers/GrokAdapter.ts:1619`, `Layers/OpenCodeAdapter.ts:3223`,
  `Layers/AntigravityAdapter.ts:1088` (where each adapter places upstream's own text).
- `apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts:1-24` (why the block is prepended).
- `packages/contracts/src/orchestration.ts:164` (`PROVIDER_SEND_TURN_MAX_INPUT_CHARS`),
  `:1944,1954` (`project.deleted`, `thread.deleted`).
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217`
  (`getThreadShellById`), `Services/OrchestrationEngine.ts:83` (`streamDomainEvents`),
  `apps/server/src/serverActivation.ts:11-26` (`forkParked`).
- `apps/server/src/environmentTheme.ts:264-283` (a debounced `fs.watch` on a folder that
  re-reads everything on each event: the model for the modes folder watcher),
  `apps/server/src/serverSettings.ts:920` and `apps/server/src/keybindings.ts:569` (the same
  pattern for settings files), `apps/server/src/atomicWrite.ts:5` (atomic writes),
  `apps/server/src/pathExpansion.ts:19` (`expandHomePath`), `apps/server/src/config.ts:117-121`
  (`stateDir`).
- `.repos/effect-smol/packages/effect/src/FileSystem.ts:361` (`FileSystem.watch`).
- EXTENSION-POINTS.md section 11 (composer blocks) and section 12, rule 5 (injected content).

## External

- DietrichGebert/ponytail, https://github.com/DietrichGebert/ponytail, MIT. The inspiration:
  a rule set with intensity levels, injected every turn through each CLI's prompt hook
  (`hooks/ponytail-instructions.js`), plus `ponytail-mcp`, whose README says MCP has no
  portable way to inject rules into every turn and therefore offers a prompt and a read-only
  tool instead. The "Minimal code" built-in follows the idea of its decision ladder in Loom's
  own words; no ponytail text is copied. Its `skills/ponytail/SKILL.md` is a good import test.
- Claude Code skill invocation rules as documented in upstream's `ClaudeSkillDispatch.ts`.
