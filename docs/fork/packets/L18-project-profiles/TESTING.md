# L18 testing

Focused tests; no repo-wide checks; no sleeps. Server tests wait on deferreds or receipts.

## Automated tests

| File                                                                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/fork/project-profiles/envInspector.test.ts`          | Required and sensitive resolution (item decorators, root defaults, `inferFromPrefix`, `forEnv`), `currentEnv` resolution, file precedence (`.env` < `.env.local` < `.env.<env>` < `.env.<env>.local` < server environment), statuses (set, missing, empty, invalid for each checked type, resolvedByVarlock, unchecked), unschematized keys, `@example` omitted for sensitive items, parse error mapping with line and column, and **no fixture value appears anywhere in `JSON.stringify(report)`**. |
| `apps/server/src/fork/project-profiles/EnvInspectorLive.test.ts`      | Temp directory: schema path outside the root and symlink escapes are rejected; files over 256 KB rejected; missing schema gives `absent`.                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/project-profiles/varlock.test.ts`               | `buildVarlockCommandLine` for quotes, `&&`, pipes, `$VARS`, newlines on POSIX; Windows with and without operators; `extractVarlockErrors` keeps only errors and redacts every resolved value from messages (fixture JSON shaped like varlock's `json-full` output).                                                                                                                                                                                                                                   |
| `apps/server/src/fork/project-profiles/VarlockRunner.test.ts`         | With a fake `varlock` script: detection and version parsing; validate passes telemetry opt-outs in the child environment; exit code 1 with errors is a result, not a failure; timeout maps to `varlock-failed`.                                                                                                                                                                                                                                                                                       |
| `apps/server/src/fork/project-profiles/budget.test.ts`                | Delta rule (growth, session reset), crossing 80% and 100% once, both in one jump, no budget set.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/project-profiles/BudgetReactor.test.ts`         | Feeding `thread.activity-appended` events with `context-window.updated`: usage rows update; other activity kinds ignored; one marker per level per day or thread (checked through the dispatched command, awaited with a `Deferred`); `thread.deleted` and `project.deleted` clean up.                                                                                                                                                                                                                |
| `apps/server/src/fork/project-profiles/ProfileStore.test.ts`          | Migration on `SqlitePersistenceMemory`; tables start with `fork_project_profiles_`; get returns defaults when absent; patch merge and validation; reset deletes.                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/project-profiles/ProjectProfileService.test.ts` | Checkout resolution (thread worktree vs project root); command resolution through `resolveProjectScripts` for action and literal intents; `action-not-found`.                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/project-profiles/mcp.test.ts`                   | Tool name prefix and uniqueness; output without values; setting off fails with the typed error; output cap.                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/server/src/fork/rpcAuthorization.test.ts` (extension point)     | Scope table still matches the fork group.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/web/src/fork/project-profiles/palette.test.ts`                  | Item values unique and prefixed; run items only for mapped intents when varlock is available.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Extension point registry tests                                        | Panel id and shortcut `E` unique; settings section id unique.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Commands

```sh
vp test run \
  apps/server/src/fork/project-profiles/*.test.ts \
  apps/server/src/fork/rpcAuthorization.test.ts \
  apps/server/src/fork/features.test.ts \
  apps/server/src/fork/persistence/migrations.test.ts \
  apps/web/src/fork/project-profiles/*.test.ts \
  apps/web/src/fork/panels/registry.test.ts \
  apps/web/src/fork/settings/registry.test.ts \
  apps/web/src/fork/commandPalette/registry.test.ts
vp lint apps/server/src/fork/project-profiles apps/web/src/fork/project-profiles \
  packages/contracts/src/fork/project-profiles.ts packages/client-runtime/src/fork/project-profiles.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
```

## Manual check

With Kyle's permission, one integrated pass with `test-t3-app` on web, then desktop, using a
worktree-seeded `.t3` and a sample project containing `.env.schema`, `.env` and `.env.local`
(one missing required key, one invalid URL, one `fn()` value):

1. Settings, Loom, choose the project: edit notes, map "test" to an existing project action,
   map "typecheck" to a literal command, set budgets. Reload: values persist. Select a logical
   project with two checkouts: saving updates both.
2. Open the Env panel in a thread: statuses match the files; no value is visible anywhere
   (also check the WebSocket frames in devtools).
3. Validate with varlock: confirmation appears once; errors list; a generated file side effect,
   if the schema configures one, is expected and documented.
4. "Run tests with varlock": a new terminal opens and runs `varlock run -- sh -c '...'`.
5. Set a tiny daily budget, run a Codex turn: one "80% used" and one "reached" marker at most;
   a Cursor thread shows "not reported".
6. Ask an agent to call `loom_project_profiles_get`: notes and commands come back, no values.
   Turn the setting off: the call fails clearly.
7. Upstream T3 server: panel disabled with "Needs a Loom server"; settings section explains.
8. Remote over Tailscale: repeat step 2.

## Merge safety

No packet seams. Record the merge preview (SEAMS.md) and, after Kyle merges, run
`scripts/fork/loom.sh integrate nightly --dry-run` from a clean, synced `main`. Until the
`loom.sh` follow-up lands, typecheck `apps/server`, `packages/contracts` and
`packages/client-runtime` by hand on the rehearsal branch.

## Acceptance criteria

- All tests above pass; listed packages typecheck; lint clean; only the approved lockfile
  change (if any).
- No env value crosses the wire, reaches an agent or a log.
- Nothing in upstream settings is duplicated in the profile UI.
