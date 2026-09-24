# L22 technical design

Citations are to this fork at upstream v0.0.42, checked against
`v0.0.43-nightly.20260923.2173`.

## Overview

```
composer Modes control (ext-composer) ─┐
Settings > Loom > Instruction modes     ├─ loom.instruction-modes.* RPC ─> InstructionModesService (ForkLayer)
palette / keybinding                   ─┘                                   │ fork_instruction_modes_* tables
                                                                            │ registers a turn input contributor
ProviderService.sendTurn ── applyForkTurnInput (ext-turn-input) ────────────┘
   (every provider, every client)         prepends <loom_instruction_modes> when modes are on
```

The server decides and delivers. Clients only edit state. A turn's delivered text is never
stored in orchestration events; the transcript keeps the user's own words.

## Resolution

For a thread, `effectiveModes(threadId)`:

1. The thread's row in `fork_instruction_modes_threads`: when `pack_ids` is not null, use it
   (an empty array is an explicit "No modes").
2. Otherwise the thread's project default from `fork_instruction_modes_project_defaults`,
   found through `ProjectionSnapshotQuery.getThreadShellById`
   (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217`).
3. Otherwise none.

Unknown or archived pack ids are dropped silently. The result is cached in memory per thread
and invalidated on any write to the three tables (the service is the only writer).

## Delivery (the turn input contributor)

Registered by `InstructionModesService` through `registerForkTurnInputContributor`
([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input)) with id `instruction-modes` and order 10, so the modes block comes before any
other fork block (L03's goal is order 20). The registry already skips continuations and slash
commands and does the prepending.

```ts
const contribute = ({ threadId }: ForkTurnInputContext) =>
  Effect.gen(function* () {
    const modes = yield* effectiveModes(threadId);
    const state = yield* threadState(threadId); // last_delivered_hash
    if (modes.length === 0) {
      if (state.lastDeliveredHash === null) return undefined;
      yield* setLastDelivered(threadId, null);
      return CLEARED_NOTICE;
    }
    const block = renderBlock(modes); // pure, capped
    yield* setLastDelivered(threadId, hash(block));
    return block;
  }).pipe(Effect.orElseSucceed(() => undefined));
```

`renderBlock` (pure, in `packages/contracts/src/fork/instruction-modes.ts` so the preview uses
the same code):

```text
<loom_instruction_modes>
The user turned on these standing instructions for this conversation in Loom. Follow them for
this message and later ones until a newer block replaces them. They do not override safety
rules or anything the user asks for explicitly in a message.

## Minimal code
<rules>

## Extra careful
<rules>
</loom_instruction_modes>
```

`CLEARED_NOTICE` is
`<loom_instruction_modes>The earlier standing instructions no longer apply.</loom_instruction_modes>`.

Limits: each pack body at most 4,000 characters (schema), the whole block at most 10,000
(`renderBlock` drops packs from the end and appends "(n more modes omitted: too long)").
The registry skips a block that would push the text over `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`
(120,000, `packages/contracts/src/orchestration.ts:164`), so an almost-full user message goes
out without it rather than failing.

Why prepend: Claude runs a skill only when `/name` is the last text block, and upstream's
dispatcher turns a `$name` mention into that block with the text after it as arguments
(`apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts:1-24`). Appending would turn the
rules into skill arguments; prepending keeps them in the leading text.

### Per-provider behavior

| Provider           | What the agent sees                                                                                                                    | Notes                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Codex              | The block at the start of the user message, alongside upstream's per-turn `developer_instructions` (`CodexSessionRuntime.ts:583-605`). | `$skill` input items unaffected.                                                    |
| Claude             | The block in the leading text; the system prompt append from `ClaudeAdapter.ts:4724-4729` unchanged.                                   | Skill dispatch preserved (above). Plan mode unaffected.                             |
| Cursor, Grok       | The block in the ACP prompt text; upstream's runtime instructions block (`CursorAdapter.ts:1067`, `GrokAdapter.ts:1619`) unchanged.    |                                                                                     |
| OpenCode           | The block in the user part; upstream's `system` field (`OpenCodeAdapter.ts:3223`) unchanged.                                           |                                                                                     |
| Antigravity        | The block in the prompt text (`AntigravityAdapter.ts:1088` shows upstream's own text block).                                           |                                                                                     |
| Fork drivers (L17) | Same, through `sendTurn`.                                                                                                              |                                                                                     |
| Slash commands     | Nothing: `/compact`, `/feedback`, typed `/skill` commands pass unchanged.                                                              | A mode turned on right before `/compact` is delivered with the next normal message. |
| Continuations      | Nothing: `input` is `undefined`.                                                                                                       |                                                                                     |

## Contracts (`packages/contracts/src/fork/instruction-modes.ts`)

```ts
export const INSTRUCTION_MODES_WS_METHODS = {
  listPacks: "loom.instruction-modes.listPacks",
  savePack: "loom.instruction-modes.savePack",
  archivePack: "loom.instruction-modes.archivePack",
  restorePack: "loom.instruction-modes.restorePack",
  importPack: "loom.instruction-modes.importPack",
  getThread: "loom.instruction-modes.getThread",
  setThread: "loom.instruction-modes.setThread",
  getProjectDefault: "loom.instruction-modes.getProjectDefault",
  setProjectDefault: "loom.instruction-modes.setProjectDefault",
  preview: "loom.instruction-modes.preview",
} as const;

export const PackId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(builtin|user):[a-z0-9-]{1,64}$/),
);
export const Pack = Schema.Struct({
  packId: PackId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(60)),
  description: Schema.String.check(Schema.isMaxLength(200)),
  body: Schema.String.check(Schema.isMaxLength(4_000)),
  source: Schema.Literals(["builtin", "user", "imported"]),
  archived: Schema.Boolean,
  updatedAt: Schema.NullOr(IsoDateTime),
});
export const ThreadModes = Schema.Struct({
  threadId: ThreadId,
  /** null: follows the project default. */
  explicit: Schema.NullOr(Schema.Array(PackId)),
  effective: Schema.Array(PackId),
  source: Schema.Literals(["thread", "project", "none"]),
});
// listPacks {} -> { packs: Pack[] }                                   orchestration:read
// savePack { packId?: PackId (user only), name, description, body } -> Pack   orchestration:operate
// archivePack / restorePack { packId } -> Pack                         orchestration:operate
// importPack { markdown: string (<= 20,000) } -> Pack                  orchestration:operate
// getThread { threadId } -> ThreadModes                               orchestration:read
// setThread { threadId, packIds: PackId[] | null } -> ThreadModes     orchestration:operate
// getProjectDefault { projectId } -> { projectId, packIds: PackId[] } orchestration:read
// setProjectDefault { projectId, packIds: PackId[] } -> same          orchestration:operate
// preview { threadId } -> { text: string | null, characters: number } orchestration:read

export const BUILTIN_PACKS: ReadonlyArray<Pack> = [
  /* minimal-code, extra-careful, explain-as-you-go */
];
export const renderInstructionModesBlock = (packs: ReadonlyArray<Pack>): string => {
  /* above */
};
export const parsePackMarkdown = (markdown: string) => {
  /* frontmatter name/description, body */
};
```

Errors: `LoomInstructionModesError { operation, detail }` plus
`EnvironmentAuthorizationError`. Unary only; no streams.

`parsePackMarkdown` accepts a leading `---` YAML block with `name` and `description` (the
`SKILL.md` convention) and keeps the rest as the body. A ponytail-style `SKILL.md` imports as
a pack; its mode-specific tables stay in the body and the user trims them.

## Server (`apps/server/src/fork/instruction-modes/`)

- `InstructionModesService.ts` (`Context.Service`, in `ForkServicesLive`): repositories over
  the three tables, resolution with the cache, the contributor registration (in its layer
  scope), and the RPC operations. Depends on `SqlClient` and `ProjectionSnapshotQuery`.
- `cleanupReactor.ts`: a `Layer.effectDiscard` in `ForkServicesLive` using `forkParked`
  (`apps/server/src/serverActivation.ts:11-26`) that consumes
  `OrchestrationEngineService.streamDomainEvents`
  (`apps/server/src/orchestration/Services/OrchestrationEngine.ts:83`) and deletes the rows of
  `thread.deleted` and `project.deleted` events (`packages/contracts/src/orchestration.ts:1944,1954`).
  Missing an event only leaves a harmless row; at server start the service also prunes thread
  rows older than 30 days whose thread no longer exists.
- `migrations.ts`, `rpc.ts`.

## Storage

Migration set `instruction-modes`, tracking table `fork_migrations_instruction_modes`:

```sql
-- 1_Packs
CREATE TABLE IF NOT EXISTS fork_instruction_modes_packs (
  pack_id TEXT PRIMARY KEY,          -- 'user:<slug>'
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  source TEXT NOT NULL,              -- 'user' | 'imported'
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- 1_Packs (same migration)
CREATE TABLE IF NOT EXISTS fork_instruction_modes_project_defaults (
  project_id TEXT PRIMARY KEY,
  pack_ids TEXT NOT NULL,            -- JSON array of pack ids
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fork_instruction_modes_threads (
  thread_id TEXT PRIMARY KEY,
  pack_ids TEXT,                     -- JSON array, or NULL to follow the project default
  last_delivered_hash TEXT,          -- NULL: nothing delivered since the last clear
  updated_at TEXT NOT NULL
);
```

No foreign keys into upstream tables (EXTENSION-POINTS.md, section 2). Draft threads: the
composer sends `setThread` with the draft's thread id; the row simply waits for the thread
to exist (verify that the draft's `threadRef.threadId` is the id `thread.create` uses; if
not, keep the draft's choice in client state and send `setThread` right after creation).

## Clients

- `packages/client-runtime/src/fork/instruction-modes.ts`: query families `listPacks`,
  `getThread` (keyed by environment and thread), `getProjectDefault`, `preview`; commands for
  the writes that refresh the matching queries.
- `apps/web/src/fork/instruction-modes/`:
  - `ComposerModesControl.tsx`: an `ext-composer` block (`FORK_COMPOSER_BLOCKS`, id
    `instruction-modes`), sized by `size`, rendering a menu button built from upstream's
    menu primitives. It renders nothing when
    `supportsLoomFeature(caps, "instruction-modes")` is false. Label logic lives in a pure
    `modesLabel.ts`.
  - `settings.tsx`: the "Instruction modes" `ForkSettingsSection` with `PackList`,
    `PackEditor` (name, description, rules textarea with a character count and the 2,000
    character warning), import (file input, read client-side, sent as text) and export
    (download a `.md` built from the pack), and `ProjectDefaults` (project picker from the
    environment's projects, checkboxes).
  - `palette.ts`: items `action:loom:instruction-modes:toggle:<packId>` for the active thread
    and `action:loom:instruction-modes:edit`.
  - `keybindings.ts`: `onForkCommand("loom.instruction-modes.open", ...)` opens the control's
    menu through a tiny store the control subscribes to.
  - `PreviewDialog.tsx`.
- State freshness: queries refetch on window focus and after writes. Another client's change
  shows up on focus; there is no subscription (modes change rarely).

## Agent-facing tools

None. An MCP tool that returns the active modes would only help if the agent chose to call
it; delivery already puts them in front of the agent.

## Performance

- The contributor reads a cached resolution: no SQL on the hot path after the first turn of a
  thread, and at most one small write per turn (`last_delivered_hash`), skipped when unchanged.
- Token cost is the block size on every turn while modes are on; the editor warns above 2,000
  characters and the block is capped at 10,000.
- The composer control fetches once per thread and on focus; no polling.

## Alternatives considered

- **Native instruction channels per provider** (Codex developer instructions, Claude system
  prompt append, ACP prompt blocks, OpenCode `system`): six seams in six busy adapters, and
  Claude's append is fixed per session, so every change would need a session restart.
  Rejected for one seam in `sendTurn`.
- **Client-side prefix** in the composer: visible and persisted in the transcript, skipped by
  upstream clients, and duplicated when messages are edited or retried. Rejected.
- **MCP prompt or tool** (ponytail-mcp's approach): user-invoked or agent-invoked, not
  standing. Rejected as the delivery path.
- **Writing AGENTS.md / CLAUDE.md**: project-wide, committed, and provider-specific.
  Rejected.
- **Send only on change**: cheaper but lost after compaction or a provider restart without a
  reliable signal to resend. Kept as an open question (PRODUCT.md).
- **Orchestration events for modes**: forbidden (EXTENSION-POINTS.md, section 12, rule 1);
  fork tables instead.
