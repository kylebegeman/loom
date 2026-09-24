# L22 technical design

Citations are to this fork at upstream v0.0.42, checked against
`v0.0.43-nightly.20260923.2173` and rechecked on 2026-09-24 at `137e432394`.

## Overview

```
composer Modes control (ext-composer) ─┐
Settings > Loom > Instruction modes     ├─ loom.instruction-modes.* RPC ─> InstructionModesService (ForkLayer)
palette / keybinding                   ─┘                                   │ PackLibrary: <modes folder>/*.md (watched)
                                                                            │ fork_instruction_modes_* tables (selections only)
                                                                            │ registers a turn input contributor
ProviderService.sendTurn ── applyForkTurnInput (ext-turn-input) ────────────┘
   (every provider, every client)         prepends <loom_instruction_modes> when modes are on
```

The server decides and delivers. Clients only edit state. A turn's delivered text is never
stored in orchestration events; the transcript keeps the user's own words.

Two stores, each with one job:

- **Files** hold what a mode says: one Markdown file per mode in the modes folder.
- **SQLite** holds who uses which mode: per-thread selections, per-project defaults, the
  per-thread delivery marker, and the folder setting.

## The modes folder

### Location

`settings.folder` (a fork setting per environment, below). `null` means the default,
`path.join(config.stateDir, "fork", "instruction-modes")`, which is
`~/.t3/userdata/fork/instruction-modes/` on Kyle's install (`stateDir` is
`<T3 home>/userdata`, `apps/server/src/config.ts:117-121`; dev servers in a worktree use the
worktree's `.t3/userdata`). A user value may start with `~`, expanded with `expandHomePath`
(`apps/server/src/pathExpansion.ts:19`), and must then be absolute. The folder is on the
environment's machine.

The folder is created only when Loom writes into it (save, import, archive), with
`makeDirectory(..., { recursive: true })` as `writeFileStringAtomically` already does
(`apps/server/src/atomicWrite.ts:5-15`). A missing folder is a normal state (built-ins only).

### File format

```md
---
name: Minimal code
description: Least code that works, without cutting safety.
---

Understand the code first. Then prefer, in order: ...
```

- A mode file is `<folder>/<slug>.md` where `<slug>` matches `^[a-z0-9][a-z0-9-]{0,63}$`.
  Its pack id is `user:<slug>`. Archived modes are `<folder>/archived/<slug>.md` (same id,
  `archived: true`). Other subfolders and non-`.md` files are ignored silently. `.md` files
  whose name is not a valid slug (for example `README.md`) are listed as ignored with the
  reason, so a dotfiles repository can keep a README in the folder.
- Frontmatter is YAML between `---` lines at the top, parsed with the `yaml` package the
  server already uses (`apps/server/src/provider/Drivers/ClaudeSkills.ts:25`). `name` is
  required (1 to 60 characters after trimming); `description` optional (at most 200); other
  keys are kept on disk and ignored (so a `SKILL.md` with `license` or `argument-hint`
  imports cleanly).
- The body after the frontmatter, trimmed, is the rules text: at most 4,000 characters.
- File size limit 20 KB; at most 200 mode files per folder (the rest are listed as ignored,
  "Too many files").

`parsePackFile({ fileName, content })` is pure and lives in the contracts package (below),
returning either a `Pack` or a `PackFileProblem { file, reason }`. Every rule above is one of
its branches and has a test.

### Library snapshot, watching and reload

`PackLibrary` (server, in the service) keeps one in-memory snapshot:

```ts
interface LibrarySnapshot {
  readonly folder: string; // resolved absolute path
  readonly folderState: "ok" | "missing" | { readonly unreadable: string };
  readonly packs: ReadonlyMap<PackId, Pack & { readonly hash: string; readonly file: string }>;
  readonly problems: ReadonlyArray<PackFileProblem>;
  readonly loadedAt: number;
  readonly seq: number;
}
```

- **Load**: list `<folder>` and `<folder>/archived`, read each candidate file (size-checked
  first), parse, hash (sha256 of the raw content). Built-ins are added from code.
- **Watch**: after the first load, `fs.watch(folder)` (and `archived/` when it exists),
  debounced 150 ms, triggers a reload, the pattern upstream uses for environment themes
  (`apps/server/src/environmentTheme.ts:264-283`: a debounced `fs.watch` whose every event
  causes a full re-read). The watch is started in the service's layer scope and restarted
  after the folder setting changes or the folder is created. Watch failures (the folder is
  missing, a network file system without events) are logged once and do not fail anything.
- **Stale check**: `listPacks`, `preview` and the composer's `getThread` call reload when the
  snapshot is older than 5 seconds and the watch is not running. The turn contributor never
  touches the disk: it reads the snapshot, and when the snapshot is older than 10 seconds and
  the watch is not running it forks a background reload for the next turn
  (stale-while-revalidate). A reload is single-flight (one in progress at a time).
- **Reload RPC**: `reload` forces a load and returns the library (the "Reload" button).
- **Own writes** (save, import, archive, restore) update the snapshot directly after the
  write, so the writer's next read never waits for the watcher.

### Writes and multi-client edits

- Every write goes through the server and `writeFileStringAtomically`
  (`apps/server/src/atomicWrite.ts:5`), so a reader never sees half a file.
- **Compare-and-swap**: `savePack` for an existing mode carries `expectedHash` (from the
  `Pack` the client edited). The server rereads the file; a different hash fails with
  `conflict` ("This mode changed on disk since you opened it"), whether another client or
  an outside editor changed it. The client offers "Reload" (refetch, reopen the editor with
  the new text) or "Overwrite" (resend with the current disk hash, returned in the error).
- **Create**: `savePack` without `packId` derives the slug from the name (lowercase, spaces
  and punctuation to `-`, trimmed to 64) or uses the optional `slug`; when `<slug>.md` or
  `archived/<slug>.md` exists it appends `-2`, `-3`, ... up to `-99`, then fails with
  `exists`.
- **Archive and restore**: rename between `<folder>/<slug>.md` and
  `<folder>/archived/<slug>.md`; fail with `exists` when the destination exists. Nothing is
  ever deleted by Loom (there is no delete RPC; a user deletes files by hand).
- **Import**: `importPack({ markdown, fileName? })` parses the text as a mode file (the
  `SKILL.md` convention: frontmatter `name` and `description`, body as rules); a missing
  `name` falls back to the file name without extension; the slug comes from the name; the
  file is written normalized (frontmatter with `name` and `description` only).
- **Export** is client-side: the client downloads the pack as `<slug>.md` rendered with
  `renderPackFile(pack)` (pure, contracts), the same text the server writes.
- Clients refetch `listPacks` on window focus, when the Modes menu opens and after every
  write. There is no subscription (see PRODUCT.md, Out of scope).

### Folder setting

`setSettings({ folder })`: validates the path (absolute after `~` expansion, not inside
`config.attachmentsDir`, not the state directory itself), stores it, stops the old watch,
loads the new folder, starts a new watch. It never moves or copies files between folders.
Selections keep their pack ids; ids that the new folder lacks resolve as missing. This RPC
needs `terminal:operate` (it lets the client choose where the server writes files); the
mode writes themselves need `orchestration:operate`.

## Resolution

For a thread, `effectiveModes(threadId)`:

1. The thread's row in `fork_instruction_modes_threads`: when `pack_ids` is not null, use it
   (an empty array is an explicit "No modes").
2. Otherwise the thread's project default from `fork_instruction_modes_project_defaults`,
   found through `ProjectionSnapshotQuery.getThreadShellById`
   (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217`).
3. Otherwise none.

Pack ids are looked up in the current snapshot. Archived, unknown and problem files are
dropped from `effective` and reported in `missing`, so the composer can show them. The
resolution is cached in memory per thread and invalidated on any selection write, and the
whole cache is cleared when the library snapshot's `seq` changes.

## Delivery (the turn input contributor)

Registered by `InstructionModesService` through `registerForkTurnInputContributor`
([EXTENSION-POINTS.md, section 16](../EXTENSION-POINTS.md#16-provider-turn-input-ext-turn-input))
with id `instruction-modes` and order 10. Assigned orders: L20 private mode 5, this packet 10,
L03 goal 20. The registry already skips continuations and slash commands and does the
prepending.

```ts
const contribute = ({ threadId }: ForkTurnInputContext) =>
  Effect.gen(function* () {
    const modes = yield* effectiveModes(threadId); // snapshot only, no disk IO
    const state = yield* threadState(threadId); // last_delivered_hash, cached
    if (modes.length === 0) {
      if (state.lastDeliveredHash === null) return undefined;
      yield* setLastDelivered(threadId, null);
      return CLEARED_NOTICE;
    }
    const block = renderInstructionModesBlock(modes); // pure, capped
    const blockHash = hash(block);
    if (blockHash !== state.lastDeliveredHash) yield* setLastDelivered(threadId, blockHash);
    return block;
  }).pipe(Effect.orElseSucceed(() => undefined));
```

The block is sent on every turn while modes are on (Decisions, PRODUCT.md);
`last_delivered_hash` exists only to send the cleared notice once after modes are turned
off.

`renderInstructionModesBlock` (pure, in `packages/contracts/src/fork/instruction-modes.ts` so
the preview uses the same code):

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
Rules text that contains `</loom_instruction_modes>` has that closing tag escaped
(`&lt;/loom_instruction_modes>`), per the contributor rules in section 16.

Limits: each pack body at most 4,000 characters (parser), the whole block at most 10,000
(`renderInstructionModesBlock` drops packs from the end and appends "(n more modes omitted:
too long)"). The registry skips a block that would push the text over
`PROVIDER_SEND_TURN_MAX_INPUT_CHARS` (120,000, `packages/contracts/src/orchestration.ts:164`),
so an almost-full user message goes out without it rather than failing.

Token estimate for the preview: `estimateTokens(text) = Math.ceil(text.length / 4)`, pure in
the contracts file, shown as "about N tokens". It is an estimate for a human, not a budget
check; no tokenizer dependency.

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

If L20's private mode is on for the project, its `<loom_private_mode>` block (order 5) comes
first; the two never interact.

## Contracts (`packages/contracts/src/fork/instruction-modes.ts`)

```ts
export const INSTRUCTION_MODES_WS_METHODS = {
  listPacks: "loom.instruction-modes.listPacks",
  reload: "loom.instruction-modes.reload",
  savePack: "loom.instruction-modes.savePack",
  archivePack: "loom.instruction-modes.archivePack",
  restorePack: "loom.instruction-modes.restorePack",
  importPack: "loom.instruction-modes.importPack",
  getSettings: "loom.instruction-modes.getSettings",
  setSettings: "loom.instruction-modes.setSettings",
  getThread: "loom.instruction-modes.getThread",
  setThread: "loom.instruction-modes.setThread",
  getProjectDefault: "loom.instruction-modes.getProjectDefault",
  setProjectDefault: "loom.instruction-modes.setProjectDefault",
  preview: "loom.instruction-modes.preview",
} as const;

export const PackSlug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
export const PackId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(builtin|user):[a-z0-9][a-z0-9-]{0,63}$/),
);
export const Pack = Schema.Struct({
  packId: PackId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(60)),
  description: Schema.String.check(Schema.isMaxLength(200)),
  body: Schema.String.check(Schema.isMaxLength(4_000)),
  source: Schema.Literals(["builtin", "file"]),
  archived: Schema.Boolean,
  /** sha256 of the file content; null for built-ins. The compare-and-swap token. */
  hash: Schema.NullOr(Schema.String),
  /** Absolute file path on the environment; null for built-ins. */
  file: Schema.NullOr(Schema.String),
  modifiedAt: Schema.NullOr(IsoDateTime),
});
export const PackFileProblem = Schema.Struct({
  file: Schema.String, // path relative to the folder
  reason: Schema.Literals([
    "bad-file-name",
    "no-frontmatter-name",
    "invalid-yaml",
    "rules-too-long",
    "name-too-long",
    "description-too-long",
    "file-too-large",
    "too-many-files",
    "unreadable",
  ]),
  message: Schema.String, // PRODUCT.md copy
});
export const PackLibrary = Schema.Struct({
  folder: Schema.String, // resolved absolute path on the environment
  folderIsDefault: Schema.Boolean,
  folderState: Schema.Union([
    Schema.TaggedStruct("ok", {}),
    Schema.TaggedStruct("missing", {}),
    Schema.TaggedStruct("unreadable", { reason: Schema.String }),
  ]),
  watching: Schema.Boolean,
  packs: Schema.Array(Pack), // built-ins first, then files by name; archived included
  problems: Schema.Array(PackFileProblem),
});
export const InstructionModesSettings = Schema.Struct({
  /** null: <stateDir>/fork/instruction-modes. `~` allowed. */
  folder: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(1_024))),
});
export const ThreadModes = Schema.Struct({
  threadId: ThreadId,
  /** null: follows the project default. */
  explicit: Schema.NullOr(Schema.Array(PackId)),
  effective: Schema.Array(PackId),
  /** Selected (explicitly or by the project default) but archived, invalid or not found. */
  missing: Schema.Array(PackId),
  source: Schema.Literals(["thread", "project", "none"]),
});
export const ModesPreview = Schema.Struct({
  text: Schema.NullOr(Schema.String),
  characters: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
});

export class LoomInstructionModesError extends Schema.TaggedErrorClass<LoomInstructionModesError>()(
  "LoomInstructionModesError",
  {
    reason: Schema.Literals([
      "conflict",
      "exists",
      "not-found",
      "invalid",
      "builtin-read-only",
      "folder-unavailable",
      "storage",
    ]),
    detail: Schema.String,
    /** On conflict: the hash now on disk, for "Overwrite". */
    currentHash: Schema.optional(Schema.String),
  },
) {}

export const BUILTIN_PACKS: ReadonlyArray<Pack> = [
  /* builtin:minimal-code, builtin:extra-careful, builtin:explain-as-you-go */
];
export const parsePackFile = (input: {
  readonly fileName: string;
  readonly content: string;
  readonly archived: boolean;
}): Pack | PackFileProblem => {
  /* rules in "File format" */
};
export const renderPackFile = (pack: Pick<Pack, "name" | "description" | "body">): string => {
  /* frontmatter with name and description, blank line, body, trailing newline */
};
export const slugFromName = (name: string): string => {
  /* lowercase, [^a-z0-9]+ to "-", trim dashes, max 64, "mode" when empty */
};
export const renderInstructionModesBlock = (packs: ReadonlyArray<Pack>): string => {
  /* above */
};
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
```

RPCs (all unary, no streams; every `error` is
`Schema.Union([LoomInstructionModesError, EnvironmentAuthorizationError])`):

| Tag                 | Payload -> success                                                                           | Scope                   |
| ------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| `listPacks`         | `{}` -> `PackLibrary`                                                                        | `orchestration:read`    |
| `reload`            | `{}` -> `PackLibrary`                                                                        | `orchestration:read`    |
| `savePack`          | `{ packId?: user id, slug?: PackSlug, name, description, body, expectedHash? }` -> `Pack`    | `orchestration:operate` |
| `archivePack`       | `{ packId }` -> `Pack`                                                                       | `orchestration:operate` |
| `restorePack`       | `{ packId }` -> `Pack`                                                                       | `orchestration:operate` |
| `importPack`        | `{ markdown: string (<= 20,000), fileName?: string }` -> `Pack`                              | `orchestration:operate` |
| `getSettings`       | `{}` -> `InstructionModesSettings`                                                           | `orchestration:read`    |
| `setSettings`       | `InstructionModesSettings` -> `{ settings: InstructionModesSettings, library: PackLibrary }` | `terminal:operate`      |
| `getThread`         | `{ threadId }` -> `ThreadModes`                                                              | `orchestration:read`    |
| `setThread`         | `{ threadId, packIds: PackId[] \| null }` -> `ThreadModes`                                   | `orchestration:operate` |
| `getProjectDefault` | `{ projectId }` -> `{ projectId, packIds: PackId[] }`                                        | `orchestration:read`    |
| `setProjectDefault` | `{ projectId, packIds: PackId[] }` -> same                                                   | `orchestration:operate` |
| `preview`           | `{ threadId }` -> `ModesPreview`                                                             | `orchestration:read`    |

`savePack`, `archivePack` and `restorePack` on a `builtin:` id fail with
`builtin-read-only`. `setThread` and `setProjectDefault` accept ids that are currently
missing (a file may come back); they cap the list at 20 ids.

## Server (`apps/server/src/fork/instruction-modes/`)

- `packLibrary.ts`: folder resolution, load (list, size check, read, `parsePackFile`, hash),
  single-flight reload, watch management, the write operations (atomic write, rename for
  archive and restore, slug collision handling). Depends on `FileSystem`, `Path`,
  `ServerConfig`.
- `InstructionModesService.ts` (`Context.Service`, in `ForkServicesLive`): the library,
  repositories over the three tables, resolution with the cache, the contributor
  registration (in its layer scope), and the RPC operations. Depends on `SqlClient`,
  `ProjectionSnapshotQuery`, `FileSystem`, `Path`, `ServerConfig`.
- `contributor.ts`: the contribute function over injectable resolution and state.
- `cleanupReactor.ts`: a `Layer.effectDiscard` in `ForkServicesLive` using `forkParked`
  (`apps/server/src/serverActivation.ts:11-26`) that consumes
  `OrchestrationEngineService.streamDomainEvents`
  (`apps/server/src/orchestration/Services/OrchestrationEngine.ts:83`) and deletes the rows of
  `thread.deleted` and `project.deleted` events (`packages/contracts/src/orchestration.ts:1944,1954`).
  Missing an event only leaves a harmless row; at server start the service also prunes thread
  rows older than 30 days whose thread no longer exists. It never touches mode files.
- `migrations.ts`, `rpc.ts`.

## Storage

Migration set `instruction-modes`, tracking table `fork_migrations_instruction_modes`:

```sql
-- 1_Selections
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
CREATE TABLE IF NOT EXISTS fork_instruction_modes_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,       -- InstructionModesSettings; invalid JSON decodes to defaults
  updated_at TEXT NOT NULL
);
```

No mode text is stored in SQLite. No foreign keys into upstream tables (EXTENSION-POINTS.md,
section 2). Draft threads: the composer sends `setThread` with the draft's thread id; the row
simply waits for the thread to exist (verify that the draft's `threadRef.threadId` is the id
`thread.create` uses; if not, keep the draft's choice in client state and send `setThread`
right after creation, and record the finding here).

## Clients

- `packages/client-runtime/src/fork/instruction-modes.ts`: query families `listPacks`,
  `getSettings`, `getThread` (keyed by environment and thread), `getProjectDefault`,
  `preview`; commands for the writes that refresh the matching queries (`listPacks` after
  any pack or folder write; `getThread` and `preview` for the thread after `setThread`).
- `apps/web/src/fork/instruction-modes/`:
  - `ComposerModesControl.tsx`: an `ext-composer` block (`FORK_COMPOSER_BLOCKS`, id
    `instruction-modes`), sized by `size`, rendering a menu button built from upstream's
    menu primitives. It renders nothing when
    `supportsLoomFeature(caps, "instruction-modes")` is false. Label logic lives in a pure
    `modesLabel.ts`. Missing ids render as "<id> (file not found)" with "Remove" (a
    `setThread` without that id).
  - `settings.tsx`: the "Instruction modes" `ForkSettingsSection` with `FolderRow` (path
    input bound to `setSettings`, "Reload", "Use default", the folder state and a
    "watching" or "reloads on open" note), `PackList` (built-ins with "Duplicate to edit";
    files with Edit, Archive, Export; Archived with Restore), `PackEditor` (name,
    description, rules textarea with a character count, the 2,000 character warning, the
    conflict dialog), `ProblemsList`, import (file input, read client-side, sent as text with
    the file name) and `ProjectDefaults` (project picker from the environment's projects,
    checkboxes).
  - `palette.ts`: items `action:loom:instruction-modes:toggle:<packId>` for the active thread
    and `action:loom:instruction-modes:edit`.
  - `keybindings.ts`: `onForkCommand("loom.instruction-modes.open", ...)` opens the control's
    menu through a tiny store the control subscribes to.
  - `PreviewDialog.tsx`: text, characters, "about N tokens".
- State freshness: queries refetch on window focus, when the Modes menu opens, and after
  writes. Another client's or an outside editor's change shows up on focus; a stale save is
  caught by the hash check.

## Agent-facing tools

None. An MCP tool that returns the active modes would only help if the agent chose to call
it; delivery already puts them in front of the agent.

## Performance

- The contributor reads the in-memory snapshot and a cached resolution: no disk and no SQL on
  the hot path after the first turn of a thread, and a small write only when the block hash
  changes.
- Library loads read at most 200 files of at most 20 KB each, only at start, on watch events
  (debounced), on "Reload", and on a stale check when watching is unavailable.
- Token cost is the block size on every turn while modes are on; the editor warns above 2,000
  characters, the preview shows the estimate, and the block is capped at 10,000 characters.
- The composer control fetches once per thread and on focus; no polling, no subscription.

## Alternatives considered

- **Packs in fork tables** (the first design): not versionable in dotfiles and not editable
  with Kyle's own editor. Replaced by files (Kyle, 2026-09-24).
- **Selections in files too** (for example a `threads.json` in the folder): thread ids are
  environment-local and churn constantly; they would pollute a dotfiles repository.
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
  reliable signal to resend. Kyle chose every turn.
- **Orchestration events for modes**: forbidden (EXTENSION-POINTS.md, section 12, rule 1).
