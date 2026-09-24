# L10 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling and ends with its focused
checks from [TESTING.md](./TESTING.md).

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder.
- Work in a worktree (`vp i` if module resolution looks broken).
- Record real tool output once, for fixtures, on a Mac with Xcode (read-only commands, safe to
  run): `xcrun xcresulttool get build-results --schema`, `get test-results summary --schema`,
  and one real `--compact` output of each from any small sample project you create under the
  scratch directory (not in the repo). Store trimmed copies under
  `apps/server/src/fork/apple-build-tooling/__fixtures__/`. Scrub absolute home paths to
  `/Users/test/...`.
- No dev server is needed until the manual check; ask Kyle before starting one or using a
  browser (AGENTS.md).

## Phase 0: extension points

Run the existence checks for `ext-core`, `ext-panels`, `ext-settings`, `ext-palette`,
`ext-web-root`, `ext-keybindings` and `ext-mcp`. Create each missing one exactly as
EXTENSION-POINTS.md specifies, one commit each (`feat(fork): add the <name> extension point`),
with its FORK.md rows. Do not mix packet code into those commits.

## Phase 1: contracts and pure logic

1. `packages/contracts/src/fork/apple-build-tooling.ts`: the schemas, errors, method table and
   `AppleBuildToolingRpcGroup` from TECHNICAL.md. Register it in `fork/index.ts` and
   `fork/rpc.ts`; add `watchRuns` to `ForkSubscriptionRpcTag` and `tailLog` to
   `ForkStreamCommandRpcTag` (replace `never` if this is the first streaming fork tag,
   otherwise add a union member).
2. `packages/contracts/src/fork/keybindings.ts`: append `"loom.apple-build-tooling.toggle"`,
   `".build"`, `".test"`, `".run"`.
3. In the same contracts file (contracts may hold small derived helpers, AGENTS.md "Where code
   lives"), so server and web share it without a new `packages/shared` subpath export:
   `formatRunSummaryForAgent(run, summary)` returning compact text:

   ```ts
   export function formatRunSummaryForAgent(
     run: AppleRunRecord,
     summary: AppleRunSummary | null,
   ): string {
     const lines = [`${run.kind} ${run.status} (${run.commandLine})`];
     for (const issue of summary?.build?.issues
       .filter((i) => i.severity === "error")
       .slice(0, 20) ?? []) {
       lines.push(`error: ${issue.file ?? "?"}:${issue.line ?? "?"}: ${issue.message}`);
     }
     const tests = summary?.tests;
     if (tests) {
       lines.push(
         `tests: ${tests.passed}/${tests.total} passed, ${tests.failed} failed, ${tests.skipped} skipped`,
       );
       for (const f of tests.failures.slice(0, 20))
         lines.push(`FAIL ${f.identifier}: ${f.message}`);
     }
     return truncateUtf8(lines.join("\n"), 8 * 1024);
   }
   ```

4. Server pure modules with unit tests (no I/O):
   - `commands.ts`: argv builders and `destinationSpecifier`.
   - `xcresult.ts`: decode `BuildResults` and test `Summary` JSON into `AppleRunSummary`;
     `parseSourceUrl(sourceURL, cwd)`.
   - `simulators.ts`: parse `simctl list devices available -j`, `simctl list runtimes -j`,
     `devicectl list devices --json-output -` (schema version 5; tolerate unknown keys and the
     `_deprecationNotice` field).
   - `readiness.ts`: pure evaluation from a build settings object plus file facts.
   - `detect.ts`: pure classification of a path list into containers (walk is separate).

## Phase 2: server service and storage

5. `migrations.ts` with `1_Runs` and `2_Settings` (DDL in TECHNICAL.md); register in
   `FORK_MIGRATION_SETS`.
6. `AppleRunStore.ts`: insert, update status/phase/summary, list by cwd/project (limit 20),
   get, delete beyond retention, mark interrupted on start. Tests on
   `SqlitePersistenceMemory` (`apps/server/src/persistence/Layers/Sqlite.ts:41-44`).
7. `AppleBuildService.ts`:
   - `resolveWorkspace(threadId)`: `ProjectionSnapshotQuery.getThreadShellById` +
     `getProjectShellById` + `resolveThreadWorkspaceCwd`; fail with `workspace-not-found`.
   - `status`, `inspect` (cache keyed by cwd, container path and mtime), `destinations`,
     `xcodegen`, `readiness`.
   - Run engine: per-cwd lock, run directory, `ChildProcessSpawner` spawn in a run scope, log
     fan-out (file, 256 KB ring, `PubSub`), optional `xcbeautify` pipe, phase updates, summary
     extraction, retention, `watchRuns` stream (a `SubscriptionRef` of the latest 20 records
     per cwd), `tailLog` (ring catch-up from `fromOffset`, then the PubSub until done).
   - Settings read/write through the settings table with defaults.
   - Optional Device panel open after a simulator launch.
     Sketch of the run core:

   ```ts
   const runCommand = Effect.fn("AppleBuildService.runCommand")(function* (
     run: ActiveRun,
     command: string,
     args: ReadonlyArray<string>,
     cwd: string,
   ) {
     const child = yield* spawner
       .spawn(
         ChildProcess.make(command, args, {
           cwd,
           shell: false,
           detached: false,
           stdout: "pipe",
           stderr: "pipe",
           env: { ...process.env, NSUnbufferedIO: "YES" },
         }),
       )
       .pipe(Effect.provideService(Scope.Scope, run.scope));
     yield* Ref.set(run.pid, Number(child.pid));
     yield* child.all.pipe(
       Stream.decodeText(),
       Stream.runForEach((text) => run.log.append(text)), // file + ring + PubSub
       Effect.forkIn(run.scope),
     );
     return yield* child.exitCode;
   });
   ```

   Check the exact `ChildProcess.make` option names against
   `apps/server/src/device/LocalDeviceHost.ts:322-357` and the installed effect version.

8. Register: `AppleBuildService.layer` in `ForkServicesLive`, the service in `ForkServices`,
   `"apple-build-tooling"` in `LOOM_SERVER_FEATURES`.
9. `rpc.ts` handlers, each `(input) => auth.effect(TAG, withForkRuntime(...))` or
   `auth.stream(...)`; scopes in `FORK_RPC_REQUIRED_SCOPES` per TECHNICAL.md.
10. `mcp.ts`: the two tools and handlers; register in `ForkMcpToolkitsLive`.

## Phase 3: client runtime and web

11. `packages/client-runtime/src/fork/apple-build-tooling.ts`: atom factories; export from
    `client-runtime/src/fork/index.ts`.
12. `apps/web/src/fork/apple-build-tooling/`:
    - `state.ts`, selection store.
    - `panel.tsx` (definition, letter `X`, `HammerIcon`), `AppleBuildPanel.tsx` loaded with
      `React.lazy` so the panel body is not in the main chunk.
    - Components: toolchain card (collapsible, with copyable fix commands), container and
      scheme pickers, destination picker (grouped: Booted, Simulators by runtime, Devices, This
      Mac, Generic), action buttons, run history list, run summary (errors grouped by file, test
      failures with "Copy identifier" and "Test only this"), live log, XcodeGen card with diff
      viewer (reuse upstream's diff rendering component if one accepts a plain unified diff;
      otherwise a `<pre>` with line classes), readiness card.
    - Loading, empty, unsupported-platform, toolchain-problem and disabled states from
      PRODUCT.md.
    - Register the panel in `FORK_PANELS`.
13. `palette.tsx`: items `action:loom:apple-build-tooling:open|build|test|run|cancel`, returning
    `[]` when the feature is absent. Register the source.
14. `shortcuts.tsx`: a `ForkRoot` component that subscribes with `onForkCommand` to the four
    commands; `toggle` opens or closes the panel for the active thread (use the same active
    thread lookup as `useForkCommandPaletteItems`), the others start runs with the remembered
    selection or open the panel when there is none.
15. `settings.tsx`: the section (agent tools, xcbeautify, test diagnostics, derived data mode
    with size and "Delete derived data", retention, Device panel option, "Clear run history"
    for the selected environment's projects). Scope-gated as EXTENSION-POINTS.md section 7
    describes.

## Phase 4: optional pieces

16. `swiftBuild` / `swiftTest` kinds with an xUnit parser (`xunit.xml`; Swift Testing may write
    a second file named with a `-swift-testing` suffix, verify with the installed toolchain
    before relying on it). Skip if Kyle answers PRODUCT.md question 3 with "later".
17. If L09 exists in the tree, the "Run flows after launch" option (README, optional
    integrations).

## Phase 5: documentation and finish

18. `docs/fork/user/apple-build-tooling.md`: what the panel does, how to start, the
    toolchain fixes, how runs and history work, agent tools and how to turn them off, and a
    short "Xcode's own MCP server" section (`xcrun mcpbridge`, needs a running Xcode unless the
    Xcode 27 headless preview is enabled with `sudo xcrun mcp-server enable`).
19. Set the packet Status in `docs/fork/packets/README.md` and in this folder's README.
20. Merge check (SEAMS.md) and the definition of done (CONVENTIONS.md).

## Pitfalls

- `-resultBundlePath` fails if the path exists. Always a fresh run directory.
- `xcodebuild -list -json` on a workspace with packages resolves them (network, minutes on a
  cold cache). Show "Resolving packages..." and allow cancel; do not run it on every panel
  open (cache).
- `simctl boot` on a booted device exits non-zero; treat "current state: Booted" as success.
- `devicectl` human output is not stable; always `--json-output -`.
- `xcodebuild` prints the result bundle path at the end; do not parse it, you chose it.
- Test failures do not always have a `sourceURL`; the summary must render without file and line.
- Do not pass `-skipMacroValidation` or `-skipPackagePluginValidation`.
- Never run `sudo` (runtime downloads that need it, `xcode-select -s`, `mcp-server enable`);
  show the command for the user to copy.
- A run started by an agent through MCP uses the thread's workspace; a user run from the panel
  uses the active thread's workspace. Worktrees are separate workspaces with separate locks and
  derived data.
- Keep the MCP descriptions short; they cost tokens on every turn (EXTENSION-POINTS.md, MCP).

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A failing test run shows each failure with its identifier, and "Test only this" re-runs it.
- Old Loom's XCResult bug is covered by a fixture test (non-zero counts decode as non-zero).
- A cancelled build leaves no `xcodebuild` child running (checked by pid, not by name).
