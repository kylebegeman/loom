# L18 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Add `"@env-spec/parser": "0.6.0"` (exact, no `^`) to `apps/server/package.json`
  dependencies (approved by Kyle, README "Dependencies"), install, and commit only the
  intended lockfile change. If npm shows a newer version by then, still pin `0.6.0`: the
  citations in TECHNICAL.md are to that version; a bump is its own change. Fixtures may be
  adapted from varlock's parser tests (MIT; keep attribution in the fixture header).
- Install varlock locally (`npm i -g varlock@1.20.0` or the project's documented method) for
  the manual pass. Seed the worktree `.t3` with real data (AGENTS.md, "Test data").

## File layout

```
packages/contracts/src/fork/project-profiles.ts
packages/client-runtime/src/fork/project-profiles.ts
apps/server/src/fork/project-profiles/
  migrations.ts  ProfileStore.ts  envInspector.ts  EnvInspectorLive.ts
  varlock.ts  VarlockRunner.ts  budget.ts  BudgetReactor.ts
  ProjectProfileService.ts  rpc.ts  mcp.ts
  __fixtures__/ (schemas and .env files)
  *.test.ts
apps/web/src/fork/project-profiles/
  state.ts  panel.tsx  EnvPanel.tsx  EnvTable.tsx  CommandsBlock.tsx  BudgetBlock.tsx
  runInTerminal.ts  ProfileSettingsSection.tsx  bindingSources.ts  profileRows.ts  palette.tsx
  composerMenu.ts  ProjectNotesComposerBridge.tsx  composerBridgeStore.ts
  *.test.ts
docs/fork/user/project-profiles.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-panels`, `ext-settings`,
   `ext-palette`, `ext-mcp`, `ext-web-root`, `ext-composer-menu`; create missing ones, one
   commit each (SEAMS.md has the note on writing `ext-composer-menu` to its shape).
2. **Contracts.** Schemas and `ProjectProfilesRpcGroup` as in TECHNICAL; register in the fork
   group and index; `DEFAULT_PROJECT_PROFILE` helper. Typecheck contracts and consumers.
3. **Pure server logic first.**
   - `envInspector.ts`: `inspectEnv({ schemaSource, envSources, processEnv, schemaPath })`
     returning `EnvReport` minus the varlock field. Required and sensitive defaults, precedence,
     type checks, function-call detection, value-free output.
   - `varlock.ts`: `buildVarlockCommandLine(command, os)` with POSIX single-quote escaping
     (`'` becomes `'\''`) and the Windows rule; `extractVarlockErrors(json, redact)`.
   - `budget.ts`: `applyUsage(last, next)` delta rule, `crossedLevels(before, after, budget)`
     and `serverLocalDay(iso)` (the day ends at the server's local midnight).
4. **Storage.** `migrations.ts` (`ProjectProfilesMigrations`, slug `project-profiles`, id 1)
   in `FORK_MIGRATION_SETS`; `ProfileStore.ts` repository.
5. **Services.** `EnvInspectorLive.ts` (file reading with size limits and realpath checks
   through `effect/FileSystem` and `effect/Path`), `VarlockRunner.ts` (detect, validate,
   environment with telemetry disabled; spawn like `apps/server/src/processRunner.ts`),
   `ProjectProfileService.ts` (profile CRUD, checkout resolution, command resolution with
   `resolveProjectScripts`). Register in `ForkServices`, `ForkServicesLive`; append
   `"project-profiles"` to `LOOM_SERVER_FEATURES`.
6. **Reactor.** `BudgetReactor.ts` with `forkParked`, filtering `thread.activity-appended`
   for `context-window.updated`, transactions, alert rows, `thread.activity.append` dispatch,
   cleanup on `thread.deleted` / `project.deleted`, 90-day retention.
7. **RPC and MCP.** `rpc.ts` spread into `ForkRpcGroup.of`, scopes per the TECHNICAL table;
   `mcp.ts` toolkit in `ForkMcpToolkitsLive`.
8. **Client runtime.** Atoms and commands, exported from the fork index.
9. **Web.** Panel (`E`), Env table with filter and search, Commands block with "Run with
   varlock" via `runInTerminal.ts`, Budget block, settings section (scope-aware, multi-target
   saves, links to upstream Project settings), empty `PROFILE_BINDING_SOURCES`, palette items
   (`action:loom:project-profiles:open-env`, `:edit`, `:run-<intent>`). The "Share profile
   with agents" switch in the section defaults to on. Empty `PROFILE_SECTION_ROWS` rendered
   under "More" (and, if L20's private mode already exists, add its row registration here).
10. **Composer menu.** `composerBridgeStore.ts` (module store), `ProjectNotesComposerBridge`
    in `FORK_ROOT_COMPONENTS`, and `composerMenu.ts` in `FORK_COMPOSER_TRIGGERS` (TECHNICAL,
    "Composer: Insert project notes"). Pure `detectProjectNotesTrigger(text, cursor,
supported)` tested on its own. A one-time
    confirmation before the first "Validate with varlock" per environment, remembered in
    `loom:project-profiles:varlock-confirmed:v1` (try/catch around storage).
11. **Docs.** `docs/fork/user/project-profiles.md` (what the profile is for, what stays in
    upstream Project settings, the `.env.schema` format in two paragraphs with a link to
    varlock, that values never leave the server, that agents can read the profile by
    default and how to turn that off, the `%` menu for inserting notes, budgets are advisory,
    reset at the server's local midnight, and which providers report usage). Status in the
    packets index.

Commits: extension points separately, then
`feat(fork-project-profiles): keep private project notes, budgets and an env panel`. Revert
`pnpm-lock.yaml` noise; the only intended lockfile change is the approved
`@env-spec/parser@0.6.0` entry.

## Pitfalls

- **Values must not escape.** No value in RPC results, logs, errors, MCP output or telemetry.
  Parser errors can quote source text: when a parse error comes from a `.env` file (not the
  schema), replace the message with "Could not parse <file> at line N" and drop the excerpt.
- **Path traversal.** `schemaPath` is user input; resolve and realpath-check it against the
  checkout root. Never follow symlinks out of the root.
- **Default sensitivity is true** in env-spec. Treat unknown as sensitive.
- **varlock side effects.** `load` may write generated type files and contact secret
  managers; only on explicit action, with the confirmation.
- **Telemetry.** Always pass `VARLOCK_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`.
- **Shell quoting.** Test commands with quotes, `&&`, pipes, `$VARS` and newlines.
- **Multi-target scope.** Saving from a logical project scope writes to each environment; a
  partial failure shows which environments failed, like upstream's scoped settings toast
  (`apps/web/src/components/settings/useScopedSettings.ts:55-80`).
- **Reactor ordering.** Budget markers are dispatched after the usage transaction commits;
  never inside it.
- **Do not add keys to upstream `ServerSettings`.** All state is in fork tables
  (EXTENSION-POINTS.md, Persistence).
- **The `%` trigger must never open an empty menu.** `detect` returns `null` until the bridge
  reports support; test it.
- **Local midnight, not UTC.** Compute the budget day with local date parts, never
  `toISOString().slice(0, 10)`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A test proves `EnvReport` and MCP output contain no fixture values.
- The Env panel reports correct statuses for a real project with `.env.schema`, `.env` and
  `.env.local`.
- "Run with varlock" runs a mapped test action in the thread's terminal.
- A Codex or Claude thread crossing 80% of a small daily budget gets exactly one marker.
- Typing `%` in a thread's composer offers "Insert project notes", which inserts the notes as
  text; on an upstream server `%` stays plain text.
