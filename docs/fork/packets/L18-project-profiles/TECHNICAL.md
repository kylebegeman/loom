# L18 technical design

Citations are to this fork at upstream v0.0.42 (`a931bd85f3`) and to
`dmno-dev/varlock@1f4ca0e` (`varlock` 1.20.0, `@env-spec/parser` 0.6.0). The parser is a
server dependency pinned to exactly `0.6.0` (`"@env-spec/parser": "0.6.0"` in
`apps/server/package.json`, no range), approved by Kyle; there is no fallback parser.

## Overview

```
apps/server/src/fork/project-profiles/
  ProfileStore        fork_project_profiles_* tables
  EnvInspector        reads .env.schema + .env* in the checkout, computes statuses (no values out)
  VarlockRunner       detect, validate (errors only), build `varlock run` command lines
  BudgetReactor       context-window.updated activities -> usage tables -> timeline markers
  ProjectProfileService  ties them together; resolves project and thread checkouts
  rpc.ts / mcp.ts     loom.project-profiles.* and loom_project_profiles_get
apps/web/src/fork/project-profiles/
  EnvPanel (right panel "Env"), ProfileSettingsSection (Loom settings), palette items,
  composer "%" menu (Insert project notes) and its ForkRoot bridge,
  bindingSources and profileRows registries (optional integrations)
```

## What upstream already owns (do not duplicate)

| Concern                                                                             | Upstream location                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default model and its options (reasoning effort lives in `ModelSelection.options`)  | `ProjectSettingsOverrides.defaultModelSelection`, `packages/contracts/src/settings.ts:990-1007`; `ModelSelectionWire` at `orchestration.ts:75-79` |
| Runtime mode (permissions), thread env mode, worktrees from origin, auto pull       | same struct                                                                                                                                       |
| Project actions (scripts) with icons `play test lint configure build debug`         | `ProjectScript`, `orchestration.ts:391-425`; resolution `resolveProjectScripts`, `packages/shared/src/projectScripts.ts:17-28`                    |
| Checked-in project file `t3.json` (scripts, icon, env mode)                         | `packages/contracts/src/t3ProjectFile.ts`                                                                                                         |
| Agent browser and device access, text generation model, writing style, merge method | `PROJECT_SCOPED_SERVER_SETTING_KEYS`, `settings.ts:965-982`                                                                                       |
| Project settings UI                                                                 | `apps/web/src/components/settings/ProjectDefaultsSettings.tsx`, `ProjectSettingsPanel` via `settings.projects.tsx`                                |

The profile references upstream actions by `ProjectScript.id` and links to
`/settings/projects` for everything in this table.

## Contracts

`packages/contracts/src/fork/project-profiles.ts`:

```ts
export const PROJECT_PROFILES_WS_METHODS = {
  get: "loom.project-profiles.get",
  update: "loom.project-profiles.update",
  reset: "loom.project-profiles.reset",
  envReport: "loom.project-profiles.envReport",
  varlockValidate: "loom.project-profiles.varlockValidate",
  varlockCommand: "loom.project-profiles.varlockCommand",
  budgetStatus: "loom.project-profiles.budgetStatus",
  getSettings: "loom.project-profiles.getSettings",
  updateSettings: "loom.project-profiles.updateSettings",
} as const;

export const CommandIntent = Schema.Literals(["dev", "test", "typecheck", "lint", "format", "build"]);

export const IntentCommand = Schema.Union([
  Schema.TaggedStruct("action", { scriptId: TrimmedNonEmptyString }),       // upstream ProjectScript.id
  Schema.TaggedStruct("command", { command: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)) }),
]);

export const ProfileBinding = Schema.Struct({
  kind: TrimmedNonEmptyString,   // "snippet", "skill", ... owned by the registering packet
  id: TrimmedNonEmptyString,
});

export const ProjectProfile = Schema.Struct({
  projectId: ProjectId,
  agentNotes: Schema.String.check(Schema.isMaxLength(8_000)),
  commands: Schema.Record(CommandIntent, IntentCommand),   // partial: absent intents unmapped
  budgets: Schema.Struct({
    dailyTokens: Schema.NullOr(PositiveInt),
    threadTokens: Schema.NullOr(PositiveInt),
  }),
  env: Schema.Struct({
    schemaPath: TrimmedNonEmptyString.check(Schema.isMaxLength(512)), // default ".env.schema"
    varlock: Schema.Literals(["auto", "never"]),
  }),
  bindings: Schema.Array(ProfileBinding).check(Schema.isMaxLength(200)),
  updatedAt: Schema.NullOr(IsoDateTime),   // null: defaults, nothing stored
});

export const ProjectProfilePatch = /* every field of ProjectProfile except projectId and updatedAt, optional */;

export const EnvItemStatus = Schema.Union([
  Schema.TaggedStruct("set", { source: Schema.String }),        // ".env.local", "server environment"
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("empty", { source: Schema.String }),
  Schema.TaggedStruct("invalid", { source: Schema.String, reason: Schema.String }), // reason never contains the value
  Schema.TaggedStruct("resolvedByVarlock", { functionName: Schema.String }),
  Schema.TaggedStruct("unchecked", { source: Schema.String }),   // types this preview does not check
]);

export const EnvItem = Schema.Struct({
  key: Schema.String,
  description: Schema.NullOr(Schema.String),
  type: Schema.NullOr(Schema.String),                // "url", "enum(a,b)", "port", ...
  required: Schema.Boolean,
  sensitive: Schema.Boolean,
  example: Schema.NullOr(Schema.String),             // from @example, never from values; omitted when sensitive
  docs: Schema.Array(Schema.Struct({ label: Schema.NullOr(Schema.String), url: Schema.String })),
  tags: Schema.Array(Schema.String),
  line: Schema.Number,
  status: EnvItemStatus,
});

export const EnvReport = Schema.Struct({
  root: Schema.String,                               // checkout root the report used
  schema: Schema.Union([
    Schema.TaggedStruct("absent", { path: Schema.String }),
    Schema.TaggedStruct("invalid", { path: Schema.String, message: Schema.String, line: Schema.Number, column: Schema.Number }),
    Schema.TaggedStruct("ok", { path: Schema.String, currentEnv: Schema.NullOr(Schema.String), imports: Schema.Array(Schema.String) }),
  ]),
  items: Schema.Array(EnvItem),
  unschematizedKeys: Schema.Array(Schema.String),   // keys in .env files not in the schema (names only)
  envFiles: Schema.Array(Schema.String),
  varlock: Schema.Union([
    Schema.TaggedStruct("available", { version: Schema.String }),
    Schema.TaggedStruct("missing", { installHint: Schema.String }),
  ]),
});

export const VarlockValidation = Schema.Struct({
  ok: Schema.Boolean,
  itemErrors: Schema.Record(Schema.String, Schema.String),  // key -> message, values redacted
  rootErrors: Schema.Array(Schema.String),
  durationMs: Schema.Number,
});

export const BudgetStatus = Schema.Struct({
  day: Schema.String,                               // server-local YYYY-MM-DD (ends at local midnight)
  projectTokensToday: Schema.Number,
  dailyTokens: Schema.NullOr(Schema.Number),
  thread: Schema.NullOr(Schema.Struct({
    threadId: ThreadId,
    tokens: Schema.Number,
    threadTokens: Schema.NullOr(Schema.Number),
    reported: Schema.Boolean,                       // false for providers without token usage
  })),
});

export class ProjectProfileError extends Schema.TaggedError<ProjectProfileError>()("ProjectProfileError", {
  reason: Schema.Literals([
    "project-not-found", "thread-not-found", "path-outside-checkout", "file-too-large",
    "varlock-missing", "varlock-failed", "action-not-found", "unsupported-platform",
  ]),
  message: Schema.String,
}) {}
```

| Tag                                                    | Payload                                                        | Success                                      | Scope                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `loom.project-profiles.get`                            | `{ projectId }`                                                | `ProjectProfile` (defaults when none stored) | `orchestration:read`                                                   |
| `loom.project-profiles.update`                         | `{ projectId, patch: ProjectProfilePatch }`                    | `ProjectProfile`                             | `orchestration:operate`                                                |
| `loom.project-profiles.reset`                          | `{ projectId }`                                                | `ProjectProfile`                             | `orchestration:operate`                                                |
| `loom.project-profiles.envReport`                      | `{ projectId, threadId? }`                                     | `EnvReport`                                  | `orchestration:read`                                                   |
| `loom.project-profiles.varlockValidate`                | `{ projectId, threadId? }`                                     | `VarlockValidation`                          | `terminal:operate` (runs project-configured code: plugins, generators) |
| `loom.project-profiles.varlockCommand`                 | `{ projectId, threadId?, target: { intent } \| { scriptId } }` | `{ commandLine, cwd }`                       | `terminal:operate`                                                     |
| `loom.project-profiles.budgetStatus`                   | `{ projectId, threadId? }`                                     | `BudgetStatus`                               | `orchestration:read`                                                   |
| `loom.project-profiles.getSettings` / `updateSettings` | `{}` / `{ agentTool: boolean }`                                | `{ agentTool }` (default `true`)             | read / `orchestration:operate`                                         |

All unary. Every error union is `Schema.Union([ProjectProfileError, EnvironmentAuthorizationError])`.
The panel refreshes on open, on a "Refresh" button and after a varlock run; no subscription
is needed for v1.

## Server

### Checkout resolution

`threadId` given: `ProjectionSnapshotQuery.getThreadShellById(threadId)`, root =
`thread.worktreePath ?? project.workspaceRoot`. Otherwise the project's `workspaceRoot` from
`getProjectShellById`. The same calls as `apps/server/src/mcp/toolkits/pullRequests/handlers.ts:148-181`.

### EnvInspector

Pure core (`inspectEnv(input): EnvReport`) plus a thin file-reading shell, so almost everything
is unit tested without a filesystem.

1. Resolve `schemaPath` against the root; reject absolute paths and any path whose realpath
   leaves the root (`path-outside-checkout`). Size limit 256 KB per file, 1,000 items.
2. Parse the schema with `parseEnvSpecDotEnvFile(source)` (`packages/env-spec-parser/src/index.ts`
   in varlock). Map `ParsedEnvSpecFile.configItems` (`classes.ts:450`), each item's
   `decoratorsObject` (`classes.ts:418`) and `description` (`classes.ts:422`), and the file's
   root `decoratorsObject` (`classes.ts:472`). Parse errors (peggy `SyntaxError` with
   `location`) become `schema: invalid`.
3. Required: an item's `@required` / `@optional` wins; otherwise the root `@defaultRequired`
   (default `true`). `@required=forEnv(...)` or other function forms count as required when
   `currentEnv` matches, and otherwise as optional with a note. `infer` is treated as
   "required when the schema gives no value".
4. Sensitive: `@sensitive` / `@public` on the item win; otherwise root `@defaultSensitive`
   (default `true`), including `inferFromPrefix(PREFIX)` (public when the key starts with the
   prefix).
5. `currentEnv`: from root `@currentEnv=$VAR`, resolved from the files or the server
   environment only when it is a static value.
6. Env files in varlock's precedence, lowest first: `.env`, `.env.local`, `.env.<currentEnv>`,
   `.env.<currentEnv>.local`, then the server process environment (terminals inherit it).
   Each file is parsed with the same parser. The highest-precedence source that defines a key
   is its `source`.
7. Status per key: the schema's own static value counts as a default (`set` from
   `.env.schema`); a function-call value is `resolvedByVarlock`; an empty string is `empty`;
   otherwise type-checked when the type is one of `string number boolean url email port enum
semver isoDate uuid` (simple checks, no options beyond enum values and number ranges), and
   `unchecked` for other types. `invalid.reason` is fixed text ("expected a URL"), never the
   value.
8. `@import(...)`: listed in `imports`; items from local relative imports inside the root are
   followed one level deep; everything else is not resolved in v1.

Values are held only inside `inspectEnv` and dropped when it returns. A test asserts that the
serialized `EnvReport` for a fixture contains none of the fixture's values.

### VarlockRunner

- Detect: `varlock --version` (timeout 10 s, cached 60 s).
- Validate: `varlock load --format json-full --agent --compact` in the checkout root, timeout
  60 s, with `VARLOCK_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` added to the environment
  (varlock telemetry is on by default: `packages/varlock/src/cli/helpers/telemetry.ts:150-196`). The JSON on
  stdout is a `SerializedEnvGraph` (`packages/varlock/src/env-graph/lib/env-graph.ts:89-167`) that includes
  **values** (sensitive ones redacted by `--agent`, non-sensitive ones in clear). The runner
  decodes only `errors.configItems` and `errors.root`, replaces every resolved value string
  found in `config` with `[value]` inside those messages, and discards the rest. Exit code 1
  with `errors` present is a normal "invalid" result, not a failure.
- There is no values-free varlock mode (`packages/varlock/src/cli/commands/load.command.ts`); validation therefore always runs
  in the server process only. `load` can run the project's configured code generators
  (`@generateTsTypes`, `load.command.ts:77`) and plugins that contact secret managers, which is
  why it is on demand only and needs `terminal:operate`.
- Command line for "Run with varlock": resolve the target (intent to mapped action or literal
  command; or a script id) through `ServerSettingsService.getSettings` and
  `resolveProjectScripts(settings, project)`. On macOS and Linux:
  `varlock run -- sh -c '<command with single quotes escaped>'` so `&&` and pipes stay inside
  varlock's environment. On Windows servers (`serverConfig.environment.platform.os`), plain
  `varlock run -- <command>` when the command has no shell operators, otherwise
  `unsupported-platform`. Never `varlock run --inject blob` or any encryption options.
- Never run: `varlock scan --install-hook`, `varlock init`, or anything that writes files
  on purpose.

### BudgetReactor

A `Layer.effectDiscard` in `ForkServicesLive`, started with `forkParked(...)`
(`apps/server/src/serverActivation.ts:11-26`), subscribed to
`orchestrationEngine.streamDomainEvents`:

1. Keep only `thread.activity-appended` (`orchestration.ts:2089`) whose
   `payload.activity.kind === "context-window.updated"`. The activity payload is the provider's
   `ThreadTokenUsageSnapshot` (`packages/contracts/src/providerRuntime.ts:315-333`, built in
   `ProviderRuntimeIngestion.ts:278-285,842-860`).
2. Use `totalProcessedTokens` (cumulative per provider session). Only the Claude
   (`ClaudeAdapter.ts:2372-2377`) and Codex (`CodexAdapter.ts:430-445,1571`) adapters emit
   token usage today; other providers never produce the activity, so their threads show
   "not reported".
3. Delta per thread: `new >= last ? new - last : new` (a lower value means a new provider
   session). Update `fork_project_profiles_thread_usage` and
   `fork_project_profiles_daily_usage` in one transaction. The `day` key is the activity's
   `createdAt` converted to the server process's local date (`YYYY-MM-DD` from the local
   year, month and day of a `Date`), so a day ends at the server's local midnight. A pure
   `serverLocalDay(iso, timeZoneOffsetMinutes?)` helper does the conversion and is tested
   across midnight and a DST change; `budgetStatus` uses the same helper for "today". Thread to project via a small cache
   over `getThreadShellById`.
4. When the project has budgets, compare after the update. On first crossing of 80% and of
   100% (per day for the project budget, per thread for the thread budget; remembered in
   `fork_project_profiles_budget_alerts`), dispatch the existing internal command
   `thread.activity.append` (`orchestration.ts:1492-1498`) to the thread that crossed it, with
   `tone: "info"`, `kind: "loom.project-profiles.budget"`, a summary such as "Project token
   budget 80% used today (412k of 500k)", `turnId: null`, and a server command id
   `server:loom-project-profiles-budget:<uuid>` (the convention in
   `apps/server/src/mcp/toolkits/pullRequests/handlers.ts:151-155`). Upstream's work log shows
   unknown activity kinds as generic rows (`apps/web/src/session-logic.ts:451-515`), so upstream
   clients and the mobile app see the marker too.
5. `thread.deleted` and `project.deleted` remove the matching usage, alert and profile rows.

No cursor table: a missed event (server down) only undercounts an advisory number.

## Storage

```sql
-- fork_migrations_project_profiles, migration 1
CREATE TABLE IF NOT EXISTS fork_project_profiles_profiles (
  project_id    TEXT PRIMARY KEY,
  profile_json  TEXT NOT NULL,     -- ProjectProfile without projectId, schema-validated
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_project_profiles_thread_usage (
  thread_id           TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  last_total_tokens   INTEGER NOT NULL,
  tokens              INTEGER NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_project_profiles_thread_usage_project
  ON fork_project_profiles_thread_usage (project_id);

CREATE TABLE IF NOT EXISTS fork_project_profiles_daily_usage (
  project_id  TEXT NOT NULL,
  day         TEXT NOT NULL,
  tokens      INTEGER NOT NULL,
  PRIMARY KEY (project_id, day)
);

CREATE TABLE IF NOT EXISTS fork_project_profiles_budget_alerts (
  scope_key   TEXT NOT NULL,       -- "project:<id>:<day>" or "thread:<id>"
  level       INTEGER NOT NULL,    -- 80 or 100
  created_at  TEXT NOT NULL,
  PRIMARY KEY (scope_key, level)
);

CREATE TABLE IF NOT EXISTS fork_project_profiles_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json  TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
```

Retention: daily usage rows older than 90 days are deleted when the reactor writes a new day.
Profiles are stored as one JSON document (the pattern old Loom used, which kept migrations
rare); `update` applies the patch to the stored document and re-validates.

## Clients

- `packages/client-runtime/src/fork/project-profiles.ts`: query atom families for `get`,
  `envReport`, `budgetStatus`, `getSettings`; commands for `update`, `reset`,
  `varlockValidate`, `varlockCommand`, `updateSettings`.
- `apps/web/src/fork/project-profiles/`:
  - `panel.tsx`: `{ id: "project-profiles:env", title: "Env", icon: KeyRoundIcon, shortcut:
"E", isAvailable: threadRef !== null && loomFeatures.includes("project-profiles") }`.
  - `EnvPanel.tsx`: header (root path, schema path, Refresh, Validate with varlock, Edit
    profile), a status filter, the variable table (virtualized over 200 rows with
    `@legendapp/list`), a Commands block (mapped intents and project actions with "Run with
    varlock"), and a Budget block.
  - `runInTerminal.ts`: opens a new terminal for the thread and writes the command line,
    mirroring `runProjectScript` (`apps/web/src/components/ChatView.tsx:4141-4240`):
    `nextTerminalId` (`packages/shared/src/terminalLabels.ts:32`),
    `useTerminalUiStateStore.getState().newTerminal(ref, id)` and `setTerminalOpen(ref, true)`
    (`apps/web/src/terminalUiStateStore.ts:567-683`), then `terminalEnvironment.open` and
    `.write` (`apps/web/src/state/terminal.ts:5`) with `projectScriptRuntimeEnv`
    (`packages/shared/src/projectScripts.ts:58`). No upstream seam.
  - `ProfileSettingsSection.tsx` registered in `FORK_SETTINGS_SECTIONS` (id
    `project-profiles`, title "Project profile"). It reads `useSettingsScope()`
    (`apps/web/src/components/settings/SettingsScopeContext.tsx`): with a project scope it
    edits every target in `targets` (one `update` per environment and project), showing
    "Mixed" where targets differ; otherwise the "Choose a project" notice. Links to
    `/settings/projects` with the same scope search for upstream-owned fields.
  - "Edit profile" navigation computes the project key the way
    `apps/web/src/hooks/useThreadActionMenu.ts:198-210` does and navigates to
    `/settings/loom` with `search: { project: projectKey }`.
  - `bindingSources.ts`: the optional-integration registry below.
  - `palette.tsx`.

### Binding sources (optional integrations)

```ts
export interface ProfileBindingSource {
  readonly kind: string; // "snippet", "skill"
  readonly label: string; // "Snippets"
  readonly feature: string; // loomFeatures slug that must be present
  /** Hook returning pickable items for an environment. */
  readonly useOptions: (
    environmentId: EnvironmentId,
  ) => ReadonlyArray<{ id: string; label: string }> | null;
}
/** Empty in this packet. L01 and L21 append their source when they integrate. */
export const PROFILE_BINDING_SOURCES: ReadonlyArray<ProfileBindingSource> = [];
```

The Bindings section renders only when at least one source is registered and its feature is
present. Other packets read bindings through `loom.project-profiles.get` when
`project-profiles` is in `loomFeatures`.

### Profile rows (optional integrations)

```ts
export interface ProfileSectionRow {
  readonly id: string; // "<slug>-<name>"
  readonly feature: string; // loomFeatures slug that must be present
  /** Renders one SettingsRow; owns its own RPCs and states. */
  readonly Component: ComponentType<{ environmentId: EnvironmentId; projectId: ProjectId }>;
}
/** Empty in this packet. L20 appends its "No AI identification" row when both exist. */
export const PROFILE_SECTION_ROWS: ReadonlyArray<ProfileSectionRow> = [];
```

`ProfileSettingsSection` renders the rows whose feature is present, after "Bindings", under
the heading "More". With several targets in the scope it renders each row once per target
environment (a row edits one project on one environment).

## Composer: "Insert project notes"

Uses `ext-composer-menu` (EXTENSION-POINTS.md, section 11b) and `ext-web-root`. Nothing is
sent to the server beyond the `get` query the panel already uses; the notes become plain
message text, so every provider receives them.

- **Trigger** (`apps/web/src/fork/project-profiles/composerMenu.ts`, registered in
  `FORK_COMPOSER_TRIGGERS`): id `project-profiles`, kind `loom:project-profiles`. A token that
  starts at the beginning of a line or after whitespace, is `%` followed by zero or more of
  `[a-z-]`, and ends at the cursor (`^%([a-z-]*)$` on the token, found the way
  `detectComposerTrigger` finds tokens, `apps/web/src/composer-logic.ts:209-256`). `%` is not
  used by any upstream trigger (`/` at line start, `#`, `$`, `@`) nor by L01 (`;`). `detect`
  returns `null` unless the bridge says the active thread's environment supports
  `project-profiles`, so on other servers `%` stays plain text and the menu never opens
  empty.
- **Bridge** (`ProjectNotesComposerBridge.tsx`, in `FORK_ROOT_COMPONENTS`): renders `null`;
  reads `useHandleNewThread()` (`apps/web/src/hooks/useHandleNewThread.ts:473-482`,
  `activeThread ?? activeDraftThread`) and the environment's capabilities, and writes
  `{ environmentId, projectId, supported }` into a module-level store read synchronously by
  `detect`. Verify the draft thread's `environmentId` and `projectId` field names when
  implementing.
- **Items** (`useItems(query)`, a hook): reads the same store and the `get` query atom for
  the project. One item, filtered by `query` against "insert project notes":
  - notes non-empty: `{ label: "Insert project notes", description: <first line, 80 chars>,
value: { kind: "insert", notes } }`;
  - notes empty: `{ label: "Add project notes", description: "Opens the project profile",
value: { kind: "edit" } }`;
  - loading: `{ label: "Loading project notes...", value: { kind: "none" } }` (select does
    nothing).
- **Select**: `insert` calls `replace(trigger.rangeStart, trigger.rangeEnd,
"Project notes:\n" + notes + "\n", { expectedText: token })`; `edit` navigates to the
  profile the way "Edit profile" does and removes the `%` token.
- The inserted text counts toward upstream's message limits like typed text; notes are at
  most 8,000 characters, well below `PROVIDER_SEND_TURN_MAX_INPUT_CHARS`.

## Agent-facing tools

`loom_project_profiles_get`, registered in `ForkMcpToolkitsLive`:

- Parameters: `{ include: Schema.optional(Schema.Array(Schema.Literals(["notes", "commands",
"env"]))) }` (non-empty struct as required).
- Description (kept to two short sentences, since it costs prompt tokens in every session):
  "Get the user's private notes, preferred commands and environment variable status for
  this project. Read it before running project commands."
- Output: plain text: the notes, then `test: <command>` style lines resolved from upstream
  actions, then `KEY  type  required|optional  sensitive|public  status` lines (no values).
  Capped at about 1,500 tokens.
- Resolves the thread and project from `McpInvocationContext`; fails with a typed error when
  the setting "Share profile with agents" is off. The setting defaults to on: a missing or
  invalid settings row decodes to `{ agentTool: true }`.
- `Tool.Readonly` true.

## Provider decisions

- MCP tool: works on every adapter through the existing `t3-code` server (see
  EXTENSION-POINTS.md, MCP tools); nothing adapter-specific.
- Budgets: Claude and Codex report usage; Cursor, Grok, OpenCode and Antigravity show "not
  reported". If a later upstream release adds token usage to more adapters, budgets pick it
  up without changes.

## Performance

- Env reports read at most a few small files per request; nothing is watched or polled.
- Budget reactor work is one small transaction per usage activity (a few per turn).
- Payloads: an `EnvReport` for 1,000 items is well under 200 KB.
- No subscription and no continuous rendering.

## Alternatives considered

- **Old Loom's full profile** (safety, workflows, Apple, remote, Apollo, facts): most fields
  were never read by anything; dropped.
- **Storing the profile in the repository** (`.loom/profile.json`): shareable, but leaks
  private notes into repositories Kyle does not own; `t3.json` already covers shared
  configuration.
- **Wrapping upstream's own "Run" of project actions with varlock**: needs seams in
  `ChatView.runProjectScript` and `ProjectSetupScriptRunner`; the panel's "Run with varlock"
  and palette items cover the need without them. Users who want every run wrapped can write
  `varlock run -- ...` into the action itself.
- **`varlock load` for every panel refresh**: slow, can contact secret managers and write
  generated files; kept on demand.
- **Enforcing budgets** by refusing `thread.turn.start`: an orchestration seam in the hottest
  path; not worth it for an advisory need.
- **Injecting notes into every turn** through `ext-turn-input` (EXTENSION-POINTS.md, section
  16): possible, but it spends up to 8,000 characters on every turn whether or not the notes
  matter. The MCP tool (the agent pulls) and the composer item (the user pushes, visibly)
  cover the need.
- **A hand-written env-spec parser**: planned as a fallback while the dependency was
  unapproved; dropped once Kyle approved `@env-spec/parser`.
