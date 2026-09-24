# L01 technical design

All upstream citations are to this fork at upstream v0.0.42 (`a931bd85f3`). Line numbers
drift; search for the quoted code.

## Overview

```
 SQLite (state.sqlite)            Server (ForkLayer)                 Client (web/desktop)
 fork_snippets_entries   <-->  SnippetStore (repository)        loom.snippets.subscribe
 fork_snippets_aliases          SnippetService (rules, limits) --> library atom (full snapshot)
 fork_snippets_revisions        PubSub of library snapshots            |
                                                                       v
                                             pure engine (client-runtime/fork/snippetsEngine.ts)
                                             rank / parse fields / expand / artifact format
                                                                       |
                  +--------------------+----------------+--------------+---------------+
                  | Snippets panel     | Search dialog  | `;` composer menu | fill-in drawer |
                  | (ext-panels)       | (ext-web-root) | (ext-composer-menu)| (ext-composer) |
```

- The server owns storage, validation, alias uniqueness, revisions, soft delete and limits.
- The server pushes the whole live library to subscribed clients whenever it changes
  (the same shape as upstream's device state subscription,
  `apps/server/src/device/DeviceService.ts:1026-1035`). Limits keep that snapshot small.
- Search, ranking and expansion run on the client over the cached snapshot, synchronously,
  so the `;` menu and the dialog never issue an RPC per keystroke.
- Insertion into the composer uses upstream's replacement and composer handle APIs through
  the ext-composer and ext-composer-menu extension points.

## Contracts

File: `packages/contracts/src/fork/snippets.ts`, exported from `fork/index.ts`, group merged
into `ForkRpcGroup` in `fork/rpc.ts`.

```ts
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const SNIPPETS_WS_METHODS = {
  subscribe: "loom.snippets.subscribe",
  upsert: "loom.snippets.upsert",
  setPinned: "loom.snippets.setPinned",
  delete: "loom.snippets.delete",
  restoreDeleted: "loom.snippets.restoreDeleted",
  purge: "loom.snippets.purge",
  revisions: "loom.snippets.revisions",
  restoreRevision: "loom.snippets.restoreRevision",
  recordUse: "loom.snippets.recordUse",
  import: "loom.snippets.import",
} as const;

export const SNIPPET_LIMITS = {
  titleMax: 120,
  descriptionMax: 500,
  bodyMax: 16_000,
  aliasesMax: 8,
  aliasMax: 32,
  tagsMax: 10,
  tagMax: 32,
  liveSnippetsMax: 1_000,
  /** Sum of live body lengths; keeps the pushed snapshot under about 2 MB. */
  libraryBodyCharsMax: 1_500_000,
  revisionsPerSnippet: 50,
  deletedRetentionDays: 30,
  importBatchMax: 500,
} as const;

/** Letters, digits, dot, dash, underscore; starts with a letter or digit. Case kept, matched case-insensitively. */
export const SNIPPET_ALIAS_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,31}$/u;

export const SnippetId = TrimmedNonEmptyString.check(Schema.isMaxLength(64)).pipe(
  Schema.brand("SnippetId"),
);
export type SnippetId = typeof SnippetId.Type;

export const SnippetAlias = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SNIPPET_LIMITS.aliasMax),
  Schema.isPattern(SNIPPET_ALIAS_PATTERN),
);

/** The editable content. Also the revision snapshot shape. */
export const SnippetContent = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(SNIPPET_LIMITS.titleMax)),
  description: Schema.String.check(Schema.isMaxLength(SNIPPET_LIMITS.descriptionMax)),
  body: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(SNIPPET_LIMITS.bodyMax)),
  aliases: Schema.Array(SnippetAlias).check(Schema.isMaxLength(SNIPPET_LIMITS.aliasesMax)),
  tags: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(SNIPPET_LIMITS.tagMax))).check(
    Schema.isMaxLength(SNIPPET_LIMITS.tagsMax),
  ),
  /** null = available in every project of this environment. */
  projectId: Schema.NullOr(ProjectId),
});
export type SnippetContent = typeof SnippetContent.Type;

export const Snippet = Schema.Struct({
  id: SnippetId,
  ...SnippetContent.fields,
  pinned: Schema.Boolean,
  useCount: NonNegativeInt,
  lastUsedAt: Schema.NullOr(IsoDateTime),
  headRevision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Snippet = typeof Snippet.Type;

export const DeletedSnippet = Schema.Struct({
  id: SnippetId,
  title: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  deletedAt: IsoDateTime,
});

export const SnippetLibrary = Schema.Struct({
  /** Increases on every published change within one server run. */
  version: NonNegativeInt,
  snippets: Schema.Array(Snippet),
  deleted: Schema.Array(DeletedSnippet),
});
export type SnippetLibrary = typeof SnippetLibrary.Type;

export const SnippetRevision = Schema.Struct({
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  content: SnippetContent,
});

export class SnippetNotFoundError extends Schema.TaggedError<SnippetNotFoundError>()(
  "SnippetNotFoundError",
  { snippetId: Schema.String },
) {}
export class SnippetAliasConflictError extends Schema.TaggedError<SnippetAliasConflictError>()(
  "SnippetAliasConflictError",
  { alias: Schema.String, conflictingSnippetId: Schema.String, conflictingTitle: Schema.String },
) {}
export class SnippetLimitError extends Schema.TaggedError<SnippetLimitError>()(
  "SnippetLimitError",
  { message: Schema.String },
) {}
export class SnippetStorageError extends Schema.TaggedError<SnippetStorageError>()(
  "SnippetStorageError",
  { message: Schema.String },
) {}

const SnippetsError = Schema.Union([
  SnippetNotFoundError,
  SnippetAliasConflictError,
  SnippetLimitError,
  SnippetStorageError,
  EnvironmentAuthorizationError,
]);

const SnippetsSubscribeRpc = Rpc.make(SNIPPETS_WS_METHODS.subscribe, {
  payload: Schema.Struct({}),
  success: SnippetLibrary,
  error: Schema.Union([SnippetStorageError, EnvironmentAuthorizationError]),
  stream: true,
});

const SnippetsUpsertRpc = Rpc.make(SNIPPETS_WS_METHODS.upsert, {
  // No id creates a snippet. `expectedHeadRevision` rejects a stale editor (two clients).
  payload: Schema.Struct({
    id: Schema.optionalKey(SnippetId),
    expectedHeadRevision: Schema.optionalKey(NonNegativeInt),
    content: SnippetContent,
  }),
  success: Snippet,
  error: SnippetsError,
});
// setPinned {id, pinned} -> Snippet; delete {id} -> {}; restoreDeleted {id} ->
// { snippet: Snippet, droppedAliases: string[] }; purge {id} -> {} (only deleted ones);
// revisions {id} -> { revisions: SnippetRevision[] } newest first;
// restoreRevision {id, revision} -> Snippet; recordUse {id} -> {};
// import { items: SnippetContent[] (max importBatchMax) } ->
//   { created: number, skipped: Array<{ title: string, reason: string }>, droppedAliases: Array<{ title: string, alias: string }> }
// Each with error SnippetsError (import: SnippetLimitError | SnippetStorageError | auth).

export const SnippetsRpcGroup = RpcGroup.make(
  SnippetsSubscribeRpc,
  SnippetsUpsertRpc,
  // ...the rest
);
```

`fork/rpc.ts` registrations:

- `SnippetsRpcGroup,` inside `.merge(`.
- `ForkSubscriptionRpcTag`: `never` becomes `typeof SNIPPETS_WS_METHODS.subscribe` (or
  `| typeof SNIPPETS_WS_METHODS.subscribe` if another packet already replaced `never`).

Scopes (`FORK_RPC_REQUIRED_SCOPES`): `subscribe` and `revisions` need
`orchestration:read`; every other method needs `orchestration:operate`.

Why a stale-editor check: two clients editing the same snippet would silently overwrite each
other. `expectedHeadRevision` makes the second save fail with `SnippetLimitError` carrying
"This snippet changed on another device. Reload it and try again." (a dedicated error class
is not worth it).

## Server

Directory: `apps/server/src/fork/snippets/`.

| File                | Contents                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations.ts`     | `SnippetsMigrations: ForkMigrationSet` (slug `snippets`), migration 1 below.                                                                 |
| `SnippetStore.ts`   | Repository over `SqlClient` (upstream pattern: `persistence/Layers/OrchestrationCommandReceipts.ts:16-90`). Pure SQL, no rules.              |
| `SnippetService.ts` | `Context.Service` with the operations, validation, limits, alias rules, revisions, purge, and a `PubSub<SnippetLibrary>`. `layer` builds it. |
| `rpc.ts`            | `makeSnippetsRpcHandlers(auth)`, thin, each handler `auth.effect(TAG, withForkRuntime(...))`.                                                |

Registrations: `SnippetService.layer` in `ForkServicesLive`, `SnippetService` in
`ForkServices`, `"snippets"` in `LOOM_SERVER_FEATURES`, `SnippetsMigrations` in
`FORK_MIGRATION_SETS`, handlers spread into `ForkRpcGroup.of({...})`.

### Service rules

- Ids: `crypto.randomUUID()` prefixed `snp_`.
- Alias scope key: `global` when `projectId` is null, else `project:<projectId>`. Uniqueness
  is per scope, on `alias.toLowerCase()`. A project alias may equal a global alias; the
  client ranks the project one first (see Clients). Checked inside the write transaction.
- Revisions: on create, revision 1. On update, compare the new `SnippetContent` with the
  current one (normalized: trimmed title, arrays in order); append revision
  `head + 1` only when different. Then delete revisions older than the newest 50.
  `setPinned` and `recordUse` never create revisions.
- `restoreRevision` loads the snapshot and runs the normal update path (so it becomes the
  new head). If an alias in the snapshot is now taken, fail with
  `SnippetAliasConflictError` (the UI offers "Restore without that alias", which removes
  it from the content and retries).
- Delete: set `deleted_at`, delete the snippet's alias rows. Revisions stay.
- `restoreDeleted`: clear `deleted_at`; reinsert each alias that is still free; return the
  dropped ones.
- Purge: on service start (inside the layer, after migrations) delete snippets whose
  `deleted_at` is older than 30 days, with their revisions. `purge` RPC does the same for
  one deleted snippet now.
- Limits: reject a create or import that exceeds `liveSnippetsMax` or
  `libraryBodyCharsMax` with `SnippetLimitError` and a plain message.
- Import: one transaction. For each item: validate (skip with reason on failure), create
  with a new id, drop aliases already taken in its scope (reported), revision 1.
- Every successful mutation except `recordUse` publishes a fresh snapshot. `recordUse`
  only updates `use_count` and `last_used_at`; the next published snapshot carries it.
- Snapshot: live snippets ordered by `updated_at DESC`, plus deleted ones (`id`, `title`,
  `project_id`, `deleted_at`). `version` is a `Ref<number>` incremented per publish.
- Subscription stream: subscribe to the PubSub first, then read the snapshot, then
  concatenate (copy the `stateStream` shape from `DeviceService.ts:1026-1035` so no change
  between the two is lost).

### Errors

SQL failures map to `SnippetStorageError` with a short message; the cause is logged with
`Effect.logWarning`. Validation happens in contracts decoding plus the service rules.

## Storage

Migration 1 (`[1, "Library", ...]`) in the packet's own set, tracking table
`fork_migrations_snippets`:

```sql
CREATE TABLE IF NOT EXISTS fork_snippets_entries (
  snippet_id    TEXT PRIMARY KEY,
  project_id    TEXT,                       -- NULL: global
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL,
  tags_json     TEXT NOT NULL DEFAULT '[]',
  aliases_json  TEXT NOT NULL DEFAULT '[]', -- display order and case; fork_snippets_aliases enforces uniqueness
  pinned        INTEGER NOT NULL DEFAULT 0,
  use_count     INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT,
  head_revision INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS fork_snippets_entries_live
  ON fork_snippets_entries (deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS fork_snippets_aliases (
  scope_key  TEXT NOT NULL,                 -- 'global' | 'project:<id>'
  alias_key  TEXT NOT NULL,                 -- lower(alias)
  snippet_id TEXT NOT NULL,
  PRIMARY KEY (scope_key, alias_key)
);
CREATE INDEX IF NOT EXISTS fork_snippets_aliases_snippet
  ON fork_snippets_aliases (snippet_id);

CREATE TABLE IF NOT EXISTS fork_snippets_revisions (
  snippet_id    TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  content_json  TEXT NOT NULL,              -- SnippetContent, encoded with its schema
  created_at    TEXT NOT NULL,
  PRIMARY KEY (snippet_id, revision)
);
```

- No foreign keys into upstream tables (EXTENSION-POINTS.md, Persistence).
- Orphaned project snippets (project deleted) are not cleaned up: the panel lists them
  under "Unknown project" with "Make global", so no data is lost and no reactor is needed.
- Size: at the limits, about 1.5 M characters of bodies plus up to 50 revisions each.
  Revisions of large bodies can grow the file; the 50-revision cap bounds it.

## Clients

### Shared (client-runtime)

- `packages/client-runtime/src/fork/snippets.ts`: `createSnippetsEnvironmentAtoms(runtime)`
  returning `library` (`createEnvironmentRpcSubscriptionAtomFamily`, tag `subscribe`) and
  one `createEnvironmentRpcCommand` per mutation, modeled on
  `packages/client-runtime/src/state/device.ts:11-50` (serial scheduler per environment for
  writes).
- `packages/client-runtime/src/fork/snippetsEngine.ts`: pure functions, no React, no
  Effect services, fully unit tested:
  - `parseSnippetFields(body): SnippetField[]`: fields in first-appearance order with
    defaults; built-ins flagged.
  - `expandSnippet(body, { values, builtins }): { text, cursorOffset | null, unresolved[] }`.
  - `rankSnippets(snippets, query, { projectId, now }): RankedSnippet[]`.
  - `findExactAlias(snippets, token, projectId): Snippet | null`.
  - `parseSnippetArtifacts(text): { items: SnippetContent-like drafts, warnings }` and
    `buildSnippetArtifact(snippet | snippets): string`.
  - `convertLegacyBraces(body): { body, warnings }`.
- Exported from `client-runtime/src/fork/index.ts`.

### Field syntax

```
[[name]]            field, asked in the fill-in drawer
[[name|default]]    field with a default (the input starts with it)
[[cursor]]          removed; the cursor lands here (first one wins)
[[date]] [[time]] [[datetime]]           local YYYY-MM-DD, HH:MM, ISO 8601
[[project.name]] [[project.path]]        from the active thread's project
[[branch]]                               the active thread's branch, "" when none
\[[                 a literal "[["
```

Grammar (one pass, values are never re-parsed):

```ts
const FIELD = /(\\)?\[\[\s*([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*(?:\|([^\]\n]{0,200}))?\]\]/g;
```

The leading letter or underscore keeps JSON like `[[1, 2]]` from matching (the rule old
Loom's API Studio adopted). A built-in with missing context expands to an empty string and
is listed in `unresolved` so the drawer can mention it. Limits follow PromptBranch: at most
100 distinct fields; the expanded text is capped at `bodyMax * 2`.

### Ranking

Lower score is better. Per field, the best match class: exact (0), prefix (1), word-start
(2), substring (3), fuzzy subsequence (4). Field weights: alias 0, title 30, tags 60,
description 90, body 150. Score = weight + class * 10. An exact alias match always sorts
first. Ties break on: in-project over global, pinned, `lastUsedAt` (newer first),
`useCount`, title. Empty query: pinned, then recently used, then recently updated (top 50).
Adapted from old Loom's `rankSnippets` (see REFERENCES.md); simplified by dropping profile
preference and sort order.

### Artifact format (`.loom-snippet.md`)

Old Loom's format, kept so old exports import unchanged: Markdown containing one or more
fenced JSON blocks. The writer emits one block per snippet:

````
```loom-snippet
{
  "title": "Fix review finding",
  "aliases": ["fix-review"],
  "description": "",
  "tags": ["review"],
  "project": null,
  "body": "Please fix this finding: [[finding]]"
}
```
````

- Reader: accepts ` ```loom-snippet ` or ` ```json ` fences, or a bare JSON
  object or array; ignores `id`, `scopes`, `enabled`, `sortOrder` (old fields); `aliases`
  and `tags` may be arrays or comma-separated strings; aliases are stripped of a leading
  `;`; invalid aliases are dropped with a warning; `project` is ignored on import
  (imported snippets are global unless the user picks a project in the import dialog).
- Old `{{name}}`, `{{name | default}}` and `{{cursor}}` become `[[name]]`,
  `[[name|default]]`, `[[cursor]]`; old built-ins `{{workspaceRoot}}` and
  `{{project.workspaceRoot}}` become `[[project.path]]`; `{{selection}}`, `{{profile.*}}`
  and composition `{{> alias}}` are left as literal text and reported as warnings. A
  `{{` preceded by `$` (GitHub Actions `${{ secrets.X }}`) is never converted. Old Loom's
  pattern was `/\{\{\s*([A-Za-z0-9_.-]+)(?:\s*\|\s*([^{}]*?))?\s*\}\}/g`; the converter
  uses it with a `(?<!\$)` lookbehind.
- Export one: `<alias or slug>.loom-snippet.md`. Export all:
  `loom-snippets-YYYY-MM-DD.loom-snippet.md` with every live snippet. Files are built and
  downloaded in the browser (`Blob` + anchor), so export works on web and desktop without
  file system access on the server.

### Web (`apps/web/src/fork/snippets/`)

| File                      | Purpose                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state.ts`                | `snippetsEnvironment = createSnippetsEnvironmentAtoms(connectionAtomRuntime)`; `useSnippetLibrary(environmentId)` via `useEnvironmentQuery` (as `apps/web/src/state/device.ts:32-40` reads device state); `useSnippetsSupported(environmentId)`. |
| `readLibrary.ts`          | Synchronous read of the cached library for an environment from `appAtomRegistry` (used by the `;` menu and palette sources, which must not suspend). Returns `null` when not loaded.                                                             |
| `panel.tsx`               | `snippetsPanel: ForkPanelDefinition` (id `snippets`, title "Snippets", letter `S`, icon `TextQuote` from lucide).                                                                                                                                |
| `SnippetsPanel.tsx`       | Library list, filters, detail, editor, history, import and export views.                                                                                                                                                                         |
| `SnippetEditor.tsx`       | Form with inline validation (client-side schema decode before sending).                                                                                                                                                                          |
| `SnippetSearchDialog.tsx` | The search dialog (a `CommandDialog` from `~/components/ui/command`), live results and preview.                                                                                                                                                  |
| `SnippetSearchHost.tsx`   | `ForkRoot` component: subscribes to `loom.snippets.search` and palette requests; renders the dialog only while open.                                                                                                                             |
| `composerMenu.ts`         | The `;` trigger for `FORK_COMPOSER_TRIGGERS`.                                                                                                                                                                                                    |
| `fillInDrawer.tsx`        | The ext-composer drawer: fill-in fields; also installs the composer bridge.                                                                                                                                                                      |
| `composerBridge.ts`       | Module state: the active composer's handle ref, `replace` and thread ref, set by the drawer hook.                                                                                                                                                |
| `terminalSend.ts`         | Resolves the active terminal and writes text (see Terminal).                                                                                                                                                                                     |
| `palette.tsx`             | `snippetsPaletteSource`.                                                                                                                                                                                                                         |
| `commands.ts`             | Handlers for `loom.snippets.search` and `loom.snippets.open`, registered with `onForkCommand`.                                                                                                                                                   |

Gating: every component and source checks
`supportsLoomFeature(serverConfig?.environment.capabilities, "snippets")` for the relevant
environment (the thread's; the primary one without a thread).

### The composer bridge

Palette items and the search dialog live outside `ChatComposer`, so they cannot call its
replacement function directly. The fill-in drawer's `useDrawer` hook runs on every
`ChatComposer` render (ext-composer calls every drawer hook), so it records:

```ts
// composerBridge.ts
export interface SnippetsComposerBridge {
  readonly threadRef: ScopedThreadRef;
  readonly replace: ForkPromptReplace;
  readonly handle: React.RefObject<ChatComposerHandle | null> | null;
}
let current: SnippetsComposerBridge | null = null;
export const setSnippetsComposerBridge = (bridge: SnippetsComposerBridge) => {
  current = bridge;
};
/** Clears only if `bridge` is still the current one (another composer may have mounted). */
export const clearSnippetsComposerBridge = (bridge: SnippetsComposerBridge) => {
  if (current === bridge) current = null;
};
export const readSnippetsComposerBridge = () => current;
```

The hook sets it in a `useEffect` and clears it on unmount.
`handle` comes from `useComposerHandleContext()` (`apps/web/src/composerHandleContext.ts`),
which `ChatComposer` can read because it renders inside `CommandPalette`'s provider
(`apps/web/src/components/CommandPalette.tsx:542`).

Insertion from outside the composer:

1. When the dialog opens, read `handle.current?.readSnapshot()` (value, cursor,
   expandedCursor; `ChatComposer.tsx:1239-1244`).
2. On insert, if a field drawer is needed, open it (below). Otherwise, if the composer's
   current snapshot still has the same `value`, call
   `replace(expandedCursor, expandedCursor, text, { expectedText: "" })`; else fall back to
   `handle.current.insertTextAtEnd(text, { ensureLeadingBoundary: true })`
   (`ChatComposer.tsx:1224-1227`).
3. Then `handle.current.focusAt(...)` at the expansion's cursor offset if it has one.

Verify during implementation that `applyPromptReplacement`'s offsets are the
`expandedCursor` coordinates (`detectComposerTrigger(snapshot.value, snapshot.expandedCursor)`
at `ChatComposer.tsx:3501-3510` suggests so). If they are not, always use
`insertTextAtEnd` and record the finding in this file.

### The `;` composer menu (ext-composer-menu)

```ts
// composerMenu.ts, registered in FORK_COMPOSER_TRIGGERS
export const snippetsComposerTrigger = {
  id: "snippets",
  // `;` + at least one alias character, as a whole token (start of line or after whitespace).
  detect(text: string, cursor: number) {
    const start = tokenStart(text, cursor); // same rule as composer-logic's tokenStartForCursor
    const token = text.slice(start, cursor);
    const match = /^;([\p{L}\p{N}][\p{L}\p{N}_.-]*)$/u.exec(token);
    return match
      ? { kind: "loom:snippets", query: match[1]!, rangeStart: start, rangeEnd: cursor }
      : null;
  },
  useItems(query: string) {
    /* rank over readLibrary(environmentId); top 20; map to ForkComposerCommandItem */
  },
  select(item, { snapshot, trigger, replace }) {
    /* expand, or open the fill-in drawer bound to trigger's range */
  },
};
```

- `detect(text, cursor)` and `useItems(query)` receive no environment in the
  ext-composer-menu registry shape, so both read it from the composer bridge
  (`readSnippetsComposerBridge()?.threadRef.environmentId`). The bridge is set by the
  drawer hook on the composer's first render, before the user can type `;`.
- Items: `label` = title, `description` = `;alias` list plus the first line of the body.
- The trigger returns `null` when the feature is unsupported or the library is not
  loaded, so upstream triggers and typing behave exactly as today.
- With no items, upstream's `onComposerCommandKey` sees an active trigger but no selected
  item and does not consume Tab (`ChatComposer.tsx:3930-3946`), so Tab is never swallowed.
- The menu lists live results; exact alias ranks first, so `;alias` + Tab expands it.
- `select`: `recordUse` fires and forgets.

### The fill-in drawer (ext-composer)

`fillInDrawer.tsx` registers a `ForkComposerDrawer` with id `snippets-fill-in`. A small
Zustand store holds the pending request per thread key:
`{ snippetId, fields, values, target: { rangeStart, rangeEnd, expectedText } | "caret" | "end" }`.
The drawer renders one input per non-built-in field (textarea when the default contains a
newline), a live preview of the expanded text (first 12 lines), Insert (Enter; mod+Enter in
a textarea) and Escape to cancel. Empty values are allowed (old Loom blocked them). On
insert it calls `replace(...)` with the pending target and `expectedText` so a prompt edited
meanwhile is not clobbered; if `replace` returns false, it shows "The prompt changed. Try
again." and keeps the drawer open.

### Search dialog

- `CommandDialog` + `Command` input and list (`apps/web/src/components/ui/command.tsx`),
  so keyboard navigation matches the command palette.
- Left: ranked results (title, aliases, project badge, pinned mark). Right, at widths of
  640 px and up: preview of the body with fields highlighted; below, "Used 12 times".
- Actions: Enter insert, mod+C copy (expanded with defaults and built-ins; remaining fields
  stay as `[[name]]`, with a toast "2 fields left to fill"), mod+Enter send to terminal,
  mod+E edit in panel, mod+N new snippet from the query.
- Opens with the query empty (pinned and recent first) or with a query passed by the
  palette.

### Terminal send

`terminalSend.ts` resolves the target terminal for the active thread:

1. The drawer terminal when open: `useTerminalUiStateStore`
   (`apps/web/src/terminalUiStateStore.ts:585`), `terminalOpen` and `activeTerminalId` for
   the thread key.
2. Otherwise the active right-panel terminal surface
   (`useRightPanelStore`, surface `kind === "terminal"`, its `activeTerminalId`).
3. Otherwise disabled with "Open a terminal for this thread first."

It sends `WS_METHODS.terminalWrite` (`packages/contracts/src/rpc.ts:329`,
`TerminalWriteInput` max 65,536 characters, `packages/contracts/src/terminal.ts:63-66`)
through an environment RPC command atom, with `{ threadId, terminalId, data }`. Single-line
text is written as is. Multi-line text is wrapped in bracketed-paste markers
(`\x1b[200~` ... `\x1b[201~`) so the shell does not run each line; no trailing newline is
ever added. Shells without bracketed paste (rare: bash before 5.1 with it disabled) show the
markers; the user doc mentions it.

### Palette source (ext-palette)

`snippetsPaletteSource.items({ activeThreadRef, loomFeatures })` returns `[]` without
`snippets` in `loomFeatures`, else:

- `action:loom:snippets:search` "Search snippets" (`shortcutCommand: "loom.snippets.search"`).
- `action:loom:snippets:open-panel` "Open Snippets panel" (only with an active thread).
- `action:loom:snippets:save-prompt` "Save prompt as snippet" (only when the bridge has a
  composer with non-empty text; opens the panel editor prefilled with the prompt).
- A submenu `action:loom:snippets:insert` "Insert snippet" whose groups list up to 200
  snippets from `readLibrary` (pinned first) as action items; the palette's own search
  filters them. Running one inserts through the bridge (fill-in drawer when it has fields).

### Keybindings (ext-keybindings)

`FORK_KEYBINDING_COMMANDS` gains `"loom.snippets.search"` and `"loom.snippets.open"`. No
default bindings. `commands.ts` subscribes with `onForkCommand` from a `ForkRoot` component:
`search` opens the dialog; `open` toggles the panel via
`useRightPanelStore.getState().openSurface(ref, forkPanelSurface("snippets"))`, or `close`
when that surface is already active.

## Agent-facing tools

None in this packet (see README, Out).

## Performance

- Snapshot size is bounded by `libraryBodyCharsMax` (about 1.5 MB of text, typically a few
  KB). It is pushed only on user edits, never per keystroke or per use.
- Ranking over 1,000 snippets is a linear pass with cheap string tests; measure in a test
  that ranking 1,000 snippets with bodies of 2,000 characters takes under 10 ms on CI
  hardware, and memoize by `(libraryVersion, query, projectId)`.
- The `;` trigger's `detect` runs on every composer snapshot; it is a regex over the
  current token only.
- The dialog, drawer and panel render nothing and subscribe to nothing while closed. The
  library subscription is held only while a consumer (panel, dialog, or a composer on a
  Loom server) is mounted; it has an idle TTL like other environment subscriptions.
- No animations beyond upstream component defaults.

## Alternatives considered

- Server-side search RPC per keystroke (old Loom's expand path, two round trips per Tab):
  rejected for latency and because ext-composer key handlers must be synchronous.
- Client-only storage (localStorage): rejected; snippets must follow the environment and
  work from every client.
- A `;alias` Tab key handler without a menu (ext-composer only): the inline menu does the
  same with discoverability and no swallowed Tab; one mechanism instead of two.
- Mustache `{{name}}` syntax: rejected for collisions (see PRODUCT.md decisions).
- One file per snippet on disk: rejected; rows give atomic alias uniqueness and revisions
  in one transaction, and `loom.sh` already snapshots `state.sqlite`.
