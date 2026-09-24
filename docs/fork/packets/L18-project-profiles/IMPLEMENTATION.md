# L18 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Get Kyle's answer on `@env-spec/parser` (README, "Dependencies needing approval"). If
  approved, add it to `apps/server/package.json` and commit only the intended lockfile change.
  If declined, write `apps/server/src/fork/project-profiles/envSpec/parse.ts`: a hand-written
  parser for the subset in TECHNICAL (comment blocks, `# @decorator` lines with bare, `=value`
  and `(args)` forms, `KEY=value` with quotes and `fn(...)` values, the `# ---` header
  divider), with the same output shape, and add fixtures from varlock's parser tests
  (MIT; keep attribution in the fixture header).
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
  runInTerminal.ts  ProfileSettingsSection.tsx  bindingSources.ts  palette.tsx
  *.test.ts
docs/fork/user/project-profiles.md
```

## Steps

1. **Extension points.** Existence checks for `ext-core`, `ext-panels`, `ext-settings`,
   `ext-palette`, `ext-mcp`; create missing ones, one commit each.
2. **Contracts.** Schemas and `ProjectProfilesRpcGroup` as in TECHNICAL; register in the fork
   group and index; `DEFAULT_PROJECT_PROFILE` helper. Typecheck contracts and consumers.
3. **Pure server logic first.**
   - `envInspector.ts`: `inspectEnv({ schemaSource, envSources, processEnv, schemaPath })`
     returning `EnvReport` minus the varlock field. Required and sensitive defaults, precedence,
     type checks, function-call detection, value-free output.
   - `varlock.ts`: `buildVarlockCommandLine(command, os)` with POSIX single-quote escaping
     (`'` becomes `'\''`) and the Windows rule; `extractVarlockErrors(json, redact)`.
   - `budget.ts`: `applyUsage(last, next)` delta rule and `crossedLevels(before, after, budget)`.
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
   (`action:loom:project-profiles:open-env`, `:edit`, `:run-<intent>`). A one-time
   confirmation before the first "Validate with varlock" per environment, remembered in
   `loom:project-profiles:varlock-confirmed:v1` (try/catch around storage).
10. **Docs.** `docs/fork/user/project-profiles.md` (what the profile is for, what stays in
    upstream Project settings, the `.env.schema` format in two paragraphs with a link to
    varlock, that values never leave the server, budgets are advisory and which providers
    report usage). Status in the packets index.

Commits: extension points separately, then
`feat(fork-project-profiles): keep private project notes, budgets and an env panel`. Revert
`pnpm-lock.yaml` noise unless the approved dependency is the change.

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

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A test proves `EnvReport` and MCP output contain no fixture values.
- The Env panel reports correct statuses for a real project with `.env.schema`, `.env` and
  `.env.local`.
- "Run with varlock" runs a mapped test action in the thread's terminal.
- A Codex or Claude thread crossing 80% of a small daily budget gets exactly one marker.
