# L09 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

- Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md and this
  folder. Work in a worktree.
- Fixtures: record once, on a Mac, outside the repo:
  - `xcrun simctl list devices booted -j` with one booted simulator;
  - `adb devices -l` with one emulator, if Android is available;
  - an argent `--json-stream` run of a tiny flow against a sample app, one passing and one
    failing with a snapshot mismatch. If argent is not installed and Kyle has not approved
    installing it, write the fixtures by hand from the record shapes in TECHNICAL.md and
    argent's source (`packages/argent-cli/src/flow.ts`, `StepReport` and `FlowReport`); mark
    them "synthetic" in a comment.
    Scrub paths to `/Users/test/...`. Store under `apps/server/src/fork/device-qa/__fixtures__/`.
- Installing argent on Kyle's machine is his decision (it installs proprietary binaries and
  enables telemetry by default). Ask before doing it for the manual check.

## Phase 0: extension points

Existence checks and creation (own commits) for `ext-core`, `ext-panels`, `ext-settings`,
`ext-palette`, `ext-web-root`, `ext-keybindings`, `ext-mcp`.

## Phase 1: contracts and pure parsing

1. `packages/contracts/src/fork/device-qa.ts` (TECHNICAL.md, Contracts); register the group,
   the two subscription tags and the stream command tag; keybinding commands.
2. `apps/server/src/fork/device-qa/argent.ts`:
   - `ARGENT_PINNED_VERSION`, `argentInstallCommand()`.
   - `flowRunArgs({ path, deviceId, platform, outputDir, updateBaselines })`.
   - `parseArgentLine(line): ArgentRecord | { _tag: "text"; line }` with lenient schemas for
     `progress`, `result` and `error` records.
   - `stepFromReport(step, artifactsDir)`: maps `StepReport` to `DeviceQaStep`, keeping only
     string artifact paths for `baseline`, `current`, `diff`.
   - `parseTelemetryStatus(stdout)`.
3. `flows.ts`: `classifyFlow(yamlText, relativePath)` returning `DeviceQaFlow` fields; name
   charset check; nested `when:` traversal for snapshot counting.
4. `hostDevices.ts` pure parts: `parseSimctlBooted(json)`, `parseAdbDevices(text)`,
   `statusBarOverrideArgs(udid)`, `pngDimensions(bytes)` (upstream has one at
   `apps/server/src/mcp/toolkits/device/handlers.ts:242`; it is not exported, so copy the ten
   lines rather than adding a seam), `recordArgs`.

## Phase 2: server

5. `migrations.ts` (three migrations), registered in `FORK_MIGRATION_SETS`.
6. `runStore.ts`, `evidenceStore.ts` with `SqlitePersistenceMemory` tests.
7. `DeviceQaService.ts`:
   - `resolveWorkspace(threadId)` (as in L10: `ProjectionSnapshotQuery` +
     `resolveThreadWorkspaceCwd`).
   - `status`: argent probe (cached 60 s), `simctl`/`adb` availability, local devices, active
     recording.
   - `listFlows`, `readFlow` (path must resolve inside `<cwd>/.argent/flows`).
   - Run engine: global argent `Semaphore(1)`, per-device busy check, sequential flows,
     NDJSON parsing from `child.stdout` (`Stream.decodeText`, `Stream.splitLines`, as in
     `apps/server/src/device/LocalDeviceHost.ts:377-387`), `PubSub` of `DeviceQaRunEvent` per run
     for `runEvents`, `SubscriptionRef` of runs per project for `watchRuns`, report JSON and a
     `flow-report` evidence row at the end, retention.
   - Evidence: `capture` (screenshot now, or start a recording and return the `recording` row),
     `stopRecording`, `installApp`, `statusBar`, `deleteEvidence` (row and file; row only for
     `flow-report`), `deleteAllEvidence` (skips an active recording), `watchEvidence` with
     `totalCount` and `totalBytes`.
   - `runFlows` accepts only targets listed in `status.localDevices` (simulators and
     emulators).
   - Settings with defaults.
   - Startup: mark stale runs `interrupted` and stale recordings `failed`.
     Recording sketch (iOS):

   ```ts
   const startIosRecording = Effect.fn("DeviceQa.startIosRecording")(function* (
     udid: string,
     file: string,
   ) {
     const scope = yield* Scope.make("sequential");
     const child = yield* spawner
       .spawn(
         ChildProcess.make(
           "xcrun",
           ["simctl", "io", udid, "recordVideo", "--codec=h264", "--force", file],
           {
             shell: false,
             detached: false,
             stdout: "pipe",
             stderr: "pipe",
           },
         ),
       )
       .pipe(Effect.provideService(Scope.Scope, scope));
     // Resolve when simctl reports the first frame, or fail after 15 s.
     yield* child.stderr.pipe(
       Stream.decodeText(),
       Stream.splitLines,
       Stream.takeUntil((line) => line.includes("Recording started")),
       Stream.runDrain,
       Effect.timeoutFail({
         duration: "15 seconds",
         onTimeout: () =>
           new DeviceQaError({
             reason: "timeout",
             message: "The simulator did not start recording.",
           }),
       }),
     );
     return { scope, pid: Number(child.pid), exitCode: child.exitCode };
   });
   // Stop: process.kill(pid, "SIGINT") on the captured pid, then await exitCode, then close scope.
   ```

   Verify the effect `Stream` and `Effect.timeout*` names against the installed effect
   version and upstream usage before copying.

8. `reactor.ts`: `DeviceQaCleanupReactorLive` (`forkParked` + `streamDomainEvents`, filter
   `thread.deleted`; startup sweep of evidence whose thread is missing from the projection).
   Add the expiry sweep: a pure `expiryCutoff(now, days)` plus a store query, run at startup,
   every 6 hours and after a settings change, only when `evidenceExpireDays` is set.
9. Register the service, reactor, feature slug, handlers, scopes.
10. `mcp.ts`: `loom_device_qa_flow` and `loom_device_qa_capture`, gated with
    `requireMcpCapability("device")`; default device resolution: the thread's open device
    session (`DeviceService.sessionsForThread`), else the only booted local device, else a
    typed error listing the booted devices.

## Phase 3: clients

11. `packages/client-runtime/src/fork/device-qa.ts` atoms.
12. `apps/web/src/fork/device-qa/`: panel definition (`Q`), lazy panel body with the three tabs,
    device picker (physical devices get the "simulators and emulators" note in the Flows tab),
    flow list and run view, evidence list with thumbnails, attach, the size header and "Delete
    all for this thread", install form, argent setup card (copy command, "Type in terminal",
    telemetry off).
13. `DeviceToolbarActions.tsx` and the Device panel seam (SEAMS.md). Test the seam by hand:
    buttons render only for Loom servers.
14. Palette source, `ForkRoot` shortcuts component, settings section (argent path, run history
    size, "Delete evidence older than N days" as a switch plus a number field, 1 to 365,
    default 30 when switched on; default clean status bar).
15. Optional integrations (README): if `apps/web/src/fork/apple-build-tooling/` exists, list its
    latest successful build products in the Install tab through its atoms; do not add the import
    otherwise.

## Phase 4: documentation and finish

16. `docs/fork/user/device-qa.md`: what the panel does; installing argent (and that its
    per-platform binaries are proprietary and telemetry is on by default, with Loom forcing it
    off for its own runs); recording a flow through an agent (`argent init` sets up argent's MCP
    server for the editor, or add it to the provider manually); running flows and updating
    baselines; evidence and attaching it; agent tools and the Agent device access switch;
    remote and SSH-host limits.
17. FORK.md "Packet seams" row, packet index Status, this README's Status.
18. Merge check and definition of done.

## Pitfalls

- argent's tool-server is shared by the whole machine and auto-starts on port 3001 by default;
  a project dev server on 3001 will clash. Surface argent's error text; do not set
  `ARGENT_PORT` for Loom runs (that would start a second tool-server that editors do not use).
- `--json-stream` and `--json` cannot be combined, and `--json-stream` refuses directories.
- Flow names: letters, numbers, `_`, `-` only; argent refuses paths with `..`.
- `simctl io recordVideo` must be stopped with SIGINT, not SIGTERM or SIGKILL, or the file is not
  finalized. Always signal the captured pid.
- Android `screenrecord` stops at 180 seconds by itself; handle the process exiting on its own.
- `adb exec-out screencap -p` writes binary to stdout; use the streaming spawner and write bytes,
  not `ProcessRunner` (which decodes text).
- The Device panel seam must not import anything heavy: `DeviceToolbarActions.tsx` imports only
  icons, the capability helper and the evidence atoms.
- Evidence paths are absolute host paths. Never send them to a different environment; the
  `media-file` URL is always requested from the evidence's own environment.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- A failing flow shows the failing step's reason and the three snapshot images.
- A screenshot captured from the Device panel toolbar can be attached to the composer and sent.
- Deleting a thread removes its evidence files (checked on disk).
- "Delete all for this thread" empties the Evidence tab and its total; with expiry set to 1
  day, items older than a day disappear after the next sweep (tested with `TestClock`).
- No argent process Loom starts runs without `DO_NOT_TRACK=1` (unit test on the spawn env).
