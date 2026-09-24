# L10 technical design

All upstream citations are to this fork at `a931bd85f3` (upstream v0.0.42). Command-line facts
were checked on Kyle's Mac with Xcode 27.0 (27A266a), xcresulttool 25115, XcodeGen 2.46.0 and
xcbeautify 3.2.1 on 2026-09-24; see [REFERENCES.md](./REFERENCES.md#verified-command-line-facts).

## Overview

```
 web / desktop panel                     environment server (ForkLayer)
+---------------------------+  RPC   +-----------------------------------------------+
| AppleBuildPanel           | -----> | AppleBuildService                             |
|  toolchain, containers,   |        |  detect  (fs walk, depth 4)                   |
|  scheme / destination,    |        |  inspect (xcodebuild -list -json, cached)     |
|  run history, summary,    | <----- |  destinations (simctl -j, devicectl -j)       |
|  live log                 | watch  |  runs    (ChildProcessSpawner, one per cwd)   |
+---------------------------+  tail  |    -> log.txt, Result.xcresult, summary row  |
          ^                          |  xcresult (xcresulttool get ... --compact)    |
          | MCP (agents)             |  xcodegen (dump json, generate to tmp, diff)  |
 loom_apple_build_tooling_run/status |  readiness (showBuildSettings -json + files)  |
                                     |  AppleRunStore (fork_apple_build_tooling_*)   |
                                     +-----------------------------------------------+
                                        | optional: DeviceService.open (upstream)
```

Every command runs on the environment host with `ChildProcessSpawner` (streaming) or
`ProcessRunner` (short, buffered). Only JSON summaries and bounded log chunks cross the
WebSocket. Nothing is written into the user's workspace except by an explicit "Generate"
(XcodeGen) run.

## Contracts

File: `packages/contracts/src/fork/apple-build-tooling.ts`, exported from
`packages/contracts/src/fork/index.ts`, merged into `ForkRpcGroup` in
`packages/contracts/src/fork/rpc.ts`.

```ts
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const APPLE_BUILD_TOOLING_WS_METHODS = {
  status: "loom.apple-build-tooling.status",
  inspect: "loom.apple-build-tooling.inspect",
  destinations: "loom.apple-build-tooling.destinations",
  xcodegen: "loom.apple-build-tooling.xcodegen",
  readiness: "loom.apple-build-tooling.readiness",
  start: "loom.apple-build-tooling.start",
  cancel: "loom.apple-build-tooling.cancel",
  getRun: "loom.apple-build-tooling.getRun",
  watchRuns: "loom.apple-build-tooling.watchRuns",
  tailLog: "loom.apple-build-tooling.tailLog",
  getSettings: "loom.apple-build-tooling.getSettings",
  updateSettings: "loom.apple-build-tooling.updateSettings",
  clearHistory: "loom.apple-build-tooling.clearHistory",
  openResultBundle: "loom.apple-build-tooling.openResultBundle",
} as const;

/** Where the workspace lives. Threads resolve to their worktree or project root on the server. */
export const AppleWorkspaceRef = Schema.Struct({ threadId: ThreadId });

export const AppleContainerKind = Schema.Literals(["workspace", "project", "xcodegen", "package"]);
export const AppleContainer = Schema.Struct({
  kind: AppleContainerKind,
  /** Workspace-relative path: `App.xcworkspace`, `App.xcodeproj`, `project.yml`, `Package.swift`. */
  path: TrimmedNonEmptyString,
  name: Schema.String,
  /** For xcodegen: the project the spec generates, when it exists on disk. */
  generatedProjectPath: Schema.optional(Schema.String),
});

export const AppleToolchain = Schema.Struct({
  platform: Schema.Literals(["darwin", "linux", "other"]),
  xcodeVersion: Schema.NullOr(Schema.String), // "Xcode 27.0 (27A266a)"
  developerDir: Schema.NullOr(Schema.String), // xcode-select -p
  developerDirIsCommandLineTools: Schema.Boolean,
  firstLaunchPending: Schema.Boolean, // xcodebuild -checkFirstLaunchStatus exit status
  runtimes: Schema.Array(
    Schema.Struct({ platform: Schema.String, version: Schema.String, identifier: Schema.String }),
  ),
  tools: Schema.Struct({
    xcodegen: Schema.NullOr(Schema.String), // version or null
    xcbeautify: Schema.NullOr(Schema.String),
    mcpbridge: Schema.Boolean, // xcrun --find mcpbridge
    mcpServerHeadless: Schema.NullOr(Schema.String), // raw `xcrun mcp-server status` first line, or null
    xtool: Schema.NullOr(Schema.String),
  }),
});

export const AppleStatus = Schema.Struct({
  cwd: Schema.String,
  toolchain: AppleToolchain,
  containers: Schema.Array(AppleContainer),
  /** The directory walk stopped early (depth or entry limit). */
  truncated: Schema.Boolean,
});

export const AppleSchemeInfo = Schema.Struct({
  schemes: Schema.Array(Schema.String),
  targets: Schema.Array(Schema.String),
  configurations: Schema.Array(Schema.String),
  testPlans: Schema.Array(Schema.String),
  /** False when a scheme exists only in xcuserdata (not shared). */
  sharedSchemes: Schema.Array(Schema.String),
});

export const AppleDestination = Schema.Union([
  Schema.TaggedStruct("simulator", {
    udid: Schema.String,
    name: Schema.String,
    runtime: Schema.String,
    booted: Schema.Boolean,
  }),
  Schema.TaggedStruct("device", {
    identifier: Schema.String, // devicectl identifier; also accepted by xcodebuild -destination id=
    name: Schema.String,
    platform: Schema.String, // "iOS", "iPadOS", "watchOS", ...
    osVersion: Schema.String,
    paired: Schema.Boolean,
    /** null when devicectl does not report it. */
    developerModeEnabled: Schema.NullOr(Schema.Boolean),
    /** devicectl connection state, for display ("connected", "disconnected", ...). */
    connection: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct("mac", {}),
  Schema.TaggedStruct("generic", {
    platform: Schema.Literals(["iOS", "iOS Simulator", "macOS", "watchOS", "tvOS", "visionOS"]),
  }),
]);

export const AppleRunKind = Schema.Literals([
  "build",
  "test",
  "run",
  "releaseBuild",
  "xcodegenGenerate",
  "swiftBuild",
  "swiftTest",
]);
export const AppleRunStatus = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);
export const AppleRunPhase = Schema.Literals([
  "resolving",
  "building",
  "testing",
  "installing",
  "launching",
  "summarizing",
  "done",
]);

export const AppleRunRequest = Schema.Struct({
  workspace: AppleWorkspaceRef,
  kind: AppleRunKind,
  container: Schema.optional(AppleContainer), // required except for xcodegenGenerate / swift*
  scheme: Schema.optional(Schema.String),
  configuration: Schema.optional(Schema.String),
  destination: Schema.optional(AppleDestination),
  testPlan: Schema.optional(Schema.String),
  onlyTesting: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(50))),
  /** Test runs: add `-retry-tests-on-failure -test-iterations N`. */
  retryFailedTests: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 }))),
});

export const AppleIssue = Schema.Struct({
  severity: Schema.Literals(["error", "warning", "analyzer"]),
  message: Schema.String,
  target: Schema.optional(Schema.String),
  /** Workspace-relative when inside the workspace, else absolute. */
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
});

export const AppleTestFailure = Schema.Struct({
  testName: Schema.String,
  target: Schema.String,
  /** xcodebuild: testIdentifierString (for -only-testing). swift test: the `swift test list` form (for --filter). */
  identifier: Schema.String,
  message: Schema.String,
  /** From the log when known (swift test); xcresult summaries do not carry it. */
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
});

export const AppleRunSummary = Schema.Struct({
  build: Schema.optional(
    Schema.Struct({
      status: Schema.String,
      errorCount: Schema.Int,
      warningCount: Schema.Int,
      issues: Schema.Array(AppleIssue), // capped at 100, errors first
    }),
  ),
  tests: Schema.optional(
    Schema.Struct({
      result: Schema.Literals(["Passed", "Failed", "Skipped", "Expected Failure", "unknown"]),
      total: Schema.Int,
      passed: Schema.Int,
      failed: Schema.Int,
      skipped: Schema.Int,
      expectedFailures: Schema.Int,
      environment: Schema.String,
      failures: Schema.Array(AppleTestFailure), // capped at 100
    }),
  ),
  launched: Schema.optional(
    Schema.Struct({
      bundleId: Schema.String,
      appPath: Schema.String,
      destination: AppleDestination,
    }),
  ),
  xcodegen: Schema.optional(Schema.Struct({ generatedProject: Schema.String })),
  /** Set when the run failed before any result bundle existed, or with a known cause (hint). */
  failureReason: Schema.optional(Schema.String),
  /** A known cause the panel explains with a fix: code signing not set up, or the device unavailable. */
  hint: Schema.optional(Schema.Literals(["signing", "device-unavailable"])),
});

export const AppleRunRecord = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  cwd: Schema.String,
  kind: AppleRunKind,
  request: AppleRunRequest,
  status: AppleRunStatus,
  phase: AppleRunPhase,
  startedBy: Schema.Literals(["user", "agent"]),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  exitCode: Schema.NullOr(Schema.Int),
  /** Display only: the argv of the main command, shell-quoted. */
  commandLine: Schema.String,
  /** Counts for the history list; the full summary comes from getRun. */
  counts: Schema.Struct({ errors: Schema.Int, warnings: Schema.Int, failedTests: Schema.Int }),
  hasResultBundle: Schema.Boolean,
});

export const AppleRunDetail = Schema.Struct({
  run: AppleRunRecord,
  summary: Schema.NullOr(AppleRunSummary),
  logPath: Schema.String,
  resultBundlePath: Schema.NullOr(Schema.String),
  /** Present only when requested: the last 256 KB of the raw log. */
  logTail: Schema.optional(Schema.String),
});

export const AppleXcodegenReport = Schema.Struct({
  spec: Schema.String,
  valid: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  state: Schema.Literals([
    "in-sync",
    "out-of-date",
    "not-generated",
    "invalid",
    "xcodegen-missing",
  ]),
  /** Unified diff of project.pbxproj, capped at 200 KB; null when in sync. */
  diff: Schema.NullOr(Schema.String),
  diffTruncated: Schema.Boolean,
});

export const AppleReadinessCheck = Schema.Struct({
  code: TrimmedNonEmptyString, // "bundle-id", "version", "build-number", ...
  title: Schema.String,
  severity: Schema.Literals(["pass", "warning", "fail", "unknown"]),
  message: Schema.String,
});
export const AppleReadinessReport = Schema.Struct({
  overall: Schema.Literals(["pass", "warning", "fail", "unknown"]),
  checks: Schema.Array(AppleReadinessCheck),
});

export const AppleBuildSettings = Schema.Struct({
  agentToolsEnabled: Schema.Boolean,
  useXcbeautify: Schema.Boolean,
  collectTestDiagnostics: Schema.Literals(["never", "on-failure"]),
  derivedData: Schema.Literals(["loom", "xcode-default"]),
  keepRunsPerProject: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 200 })),
  openLaunchedSimulatorInDevicePanel: Schema.Boolean,
});
export const DEFAULT_APPLE_BUILD_SETTINGS: typeof AppleBuildSettings.Type = {
  agentToolsEnabled: true,
  useXcbeautify: true,
  collectTestDiagnostics: "never",
  derivedData: "loom",
  keepRunsPerProject: 20,
  openLaunchedSimulatorInDevicePanel: true,
};

/** getSettings result: the settings plus what Loom stores on disk, for the settings section. */
export const AppleBuildSettingsView = Schema.Struct({
  settings: AppleBuildSettings,
  storage: Schema.Struct({
    runCount: Schema.Int,
    runsBytes: Schema.Number,
    derivedDataBytes: Schema.Number,
  }),
});

export const AppleRunsEvent = Schema.Struct({ runs: Schema.Array(AppleRunRecord) });
export const AppleLogChunk = Schema.Struct({
  offset: Schema.Int,
  text: Schema.String,
  done: Schema.Boolean,
});

export class AppleBuildError extends Schema.TaggedError<AppleBuildError>()("AppleBuildError", {
  reason: Schema.Literals([
    "unsupported-platform",
    "workspace-not-found",
    "container-not-found",
    "tool-missing",
    "busy",
    "run-not-found",
    "invalid-request",
    "command-failed",
    "timeout",
  ]),
  message: Schema.String,
}) {}

const errors = Schema.Union([AppleBuildError, EnvironmentAuthorizationError]);
const M = APPLE_BUILD_TOOLING_WS_METHODS;

export const AppleBuildToolingRpcGroup = RpcGroup.make(
  Rpc.make(M.status, { payload: AppleWorkspaceRef, success: AppleStatus, error: errors }),
  Rpc.make(M.inspect, {
    payload: Schema.Struct({
      workspace: AppleWorkspaceRef,
      container: AppleContainer,
      refresh: Schema.optional(Schema.Boolean),
    }),
    success: AppleSchemeInfo,
    error: errors,
  }),
  Rpc.make(M.destinations, {
    payload: Schema.Struct({}),
    success: Schema.Array(AppleDestination),
    error: errors,
  }),
  Rpc.make(M.xcodegen, {
    payload: Schema.Struct({ workspace: AppleWorkspaceRef, spec: Schema.String }),
    success: AppleXcodegenReport,
    error: errors,
  }),
  Rpc.make(M.readiness, {
    payload: Schema.Struct({
      workspace: AppleWorkspaceRef,
      container: AppleContainer,
      scheme: Schema.String,
    }),
    success: AppleReadinessReport,
    error: errors,
  }),
  Rpc.make(M.start, { payload: AppleRunRequest, success: AppleRunRecord, error: errors }),
  Rpc.make(M.cancel, {
    payload: Schema.Struct({ runId: Schema.String }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.getRun, {
    payload: Schema.Struct({
      runId: Schema.String,
      includeLogTail: Schema.optional(Schema.Boolean),
    }),
    success: AppleRunDetail,
    error: errors,
  }),
  Rpc.make(M.watchRuns, {
    payload: AppleWorkspaceRef,
    success: AppleRunsEvent,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.tailLog, {
    payload: Schema.Struct({ runId: Schema.String, fromOffset: Schema.Int }),
    success: AppleLogChunk,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.getSettings, {
    payload: Schema.Struct({}),
    success: AppleBuildSettingsView,
    error: errors,
  }),
  Rpc.make(M.updateSettings, {
    payload: Schema.partial(AppleBuildSettings),
    success: AppleBuildSettings,
    error: errors,
  }),
  // Omit projectId to clear every project. Refused with "busy" while any affected run is active.
  Rpc.make(M.clearHistory, {
    payload: Schema.Struct({
      projectId: Schema.optional(ProjectId),
      includeDerivedData: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.openResultBundle, {
    payload: Schema.Struct({ runId: Schema.String }),
    success: Schema.Void,
    error: errors,
  }),
);
```

`Schema.partial` and the exact `Schema.isBetween` spelling follow whatever the installed
effect version exports; check `packages/contracts/src/settings.ts` for the local idiom before
copying.

Streaming tags: `watchRuns` joins `ForkSubscriptionRpcTag` (durable, resubscribed on
reconnect); `tailLog` joins `ForkStreamCommandRpcTag` (one-shot, ends when the run ends).

Scopes, added to `FORK_RPC_REQUIRED_SCOPES`:

| Methods                                                                                                       | Scope                   | Why                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `status`, `inspect`, `destinations`, `xcodegen`, `readiness`, `getRun`, `watchRuns`, `tailLog`, `getSettings` | `orchestration:read`    | Read-only. `inspect` runs `xcodebuild -list`, which may resolve packages, but writes nothing into the workspace. |
| `start`, `cancel`, `clearHistory`, `openResultBundle`                                                         | `terminal:operate`      | Builds run arbitrary build phases and scripts; that is terminal-level power.                                     |
| `updateSettings`                                                                                              | `orchestration:operate` | Changes server-side behavior for agents.                                                                         |

## Server

Directory: `apps/server/src/fork/apple-build-tooling/`.

| File                   | Contents                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppleBuildService.ts` | `Context.Service` `loom/AppleBuildService`: `status`, `inspect`, `destinations`, `xcodegen`, `readiness`, `start`, `cancel`, `getRun`, `watchRuns`, `tailLog`, settings. `layer`. |
| `AppleRunStore.ts`     | Repository over the fork tables (upstream pattern: `SqlClient`, `SqlSchema`, `Layer.effect`, as in `apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts:16-90`).   |
| `migrations.ts`        | `AppleBuildToolingMigrations: ForkMigrationSet` (slug `apple-build-tooling`).                                                                                                     |
| `commands.ts`          | Pure argv builders: `xcodebuildArgs(request, paths, settings)`, `destinationSpecifier(dest)`, `simctlInstallArgs`, `devicectlInstallArgs`, and so on. No I/O.                     |
| `detect.ts`            | Workspace walk (depth 4, skip `node_modules`, `.git`, `DerivedData`, `build`, `Pods`, `.build`, `.swiftpm`, dot-directories; at most 5,000 entries).                              |
| `xcresult.ts`          | Decoders for `xcresulttool` JSON and mappers to `AppleRunSummary`.                                                                                                                |
| `xcodegen.ts`          | Validate, diff and generate.                                                                                                                                                      |
| `readiness.ts`         | Checks from build settings JSON and files.                                                                                                                                        |
| `simulators.ts`        | `simctl list -j`, `devicectl --json-output -` parsing.                                                                                                                            |
| `diagnostics.ts`       | Pure: compiler diagnostics and test-failure lines from a raw log (swift build, swift test, and xcodebuild runs without a result bundle); `classifySigningIssue`.                  |
| `xunit.ts`             | Pure: the small xUnit XML reader for `swift test --xunit-output` files.                                                                                                           |
| `rpc.ts`               | `makeAppleBuildToolingRpcHandlers(auth)`.                                                                                                                                         |
| `mcp.ts`               | Toolkit and handlers.                                                                                                                                                             |

### Dependencies from upstream

Reached from `ForkLayer` (it sits at the head of `RuntimeCoreDependenciesLive`,
`apps/server/src/server.ts:482-483`):

- `SqlClient`, `ServerConfig` (`stateDir`), `FileSystem`, `Path`,
  `ChildProcessSpawner` (platform services).
- `ProjectionSnapshotQuery` to map a thread to its workspace: `getThreadShellById`
  (`apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts:217`) plus
  `getProjectShellById` (`:174`), then `resolveThreadWorkspaceCwd`
  (`apps/server/src/checkpointing/Utils.ts:12`), the same rule the provider reactor uses.
- `DeviceService` (`apps/server/src/device/DeviceService.ts:109-154`), optional use: after a
  successful simulator launch, when the setting is on and the device hub is enabled,
  `open({ threadId, hostId: "local", deviceId: udid, platform: "ios", boot: false })`
  (`DeviceOpenInput`, `packages/contracts/src/device.ts:149-157`). Errors are logged and
  ignored: the Device panel is a convenience.
- `ProcessRunner` (`apps/server/src/processRunner.ts:140-145`) for short buffered commands.
  Upstream does not merge it into the runtime; it provides `ProcessRunner.layer` locally to
  each consumer (`server.ts:326,392,407`). Do the same inside the packet layer; the service is
  stateless, so a second instance is harmless.

### Running commands

Short commands (`--version`, `-list -json`, `simctl list -j`, `xcresulttool get`) use
`ProcessRunner.run` with explicit timeouts: 10 s for version probes, 120 s for `-list`, 60 s
for `xcresulttool`, `maxOutputBytes` 32 MiB for xcresult JSON.

Runs use `ChildProcessSpawner.spawn(ChildProcess.make(cmd, args, { cwd, env, stdout: "pipe",
stderr: "pipe", shell: false, detached: false }))` inside a per-run `Scope`, like the device
hub (`apps/server/src/device/LocalDeviceHost.ts:322-357`). `child.all` is decoded to text and
fanned out to:

1. an append-only `log.txt` in the run directory,
2. an in-memory ring of the last 256 KB for fast `tailLog` catch-up,
3. a per-run `PubSub<string>` that `tailLog` subscribers read.

With `useXcbeautify` on and `xcbeautify` installed, a second child
(`xcbeautify --disable-colored-output --disable-logging --preserve-unbeautified`) receives the
raw stream on stdin and its stdout is what the ring and PubSub carry; `log.txt` always keeps the
raw output. Exit status comes from `child.exitCode` (as in `LocalDeviceHost.ts:395`).

Cancel closes the run scope, which terminates the child; the run ends as `cancelled`.
`xcodebuild` handles SIGTERM by stopping its build service; if it has not exited 15 s later,
send SIGKILL to the captured pid. Never kill by name.

Environment: inherit the server's environment, plus `NSUnbufferedIO=YES` (line-buffered
xcodebuild output). No secrets are added.

### One run per workspace

A `SynchronizedRef<Map<cwd, runId>>` rejects a second `start` for the same `cwd` with
`AppleBuildError { reason: "busy" }`, whose message names the running run. Different
workspaces (worktrees) run in parallel. Detection, `inspect` and `readiness` do not take the
lock.

### Run pipeline per kind

All `xcodebuild` invocations share:

```
xcodebuild (-workspace W | -project P) -scheme S [-configuration C]
  -destination <spec> -derivedDataPath <D> -resultBundlePath <runDir>/Result.xcresult
  <action>
```

`<D>` is `<stateDir>/fork/apple-build-tooling/derived/<sha256(cwd)[0..16]>` for the `loom`
setting, or omitted for `xcode-default`. `-resultBundlePath` must not exist beforehand;
the run directory is new per run, so it never does.

| Kind               | Commands                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`            | `... build`                                                                                                                                                                                     |
| `test`             | `... test -collect-test-diagnostics <setting> [-testPlan T] [-only-testing:X ...] [-retry-tests-on-failure -test-iterations N]`                                                                 |
| `run`              | 1. `... build`. 2. `xcodebuild ... -showBuildSettings -json` (same scheme, configuration, destination). 3. Pick the application product (below). 4. Install and launch (below).                 |
| `releaseBuild`     | `... -configuration Release -destination generic/platform=iOS build CODE_SIGNING_ALLOWED=NO` (platform from the scheme's `SUPPORTED_PLATFORMS`; macOS schemes use `generic/platform=macOS`).    |
| `xcodegenGenerate` | `xcodegen generate --spec <spec> --use-cache --cache-path <stateDir>/fork/apple-build-tooling/xcodegen-cache/<hash>`                                                                            |
| `swiftBuild`       | `swift build` with `cwd` = the package directory (the directory of the selected `Package.swift`).                                                                                               |
| `swiftTest`        | `swift test --parallel --xunit-output <runDir>/xunit.xml [--filter <escaped identifier> ...]`, same `cwd`. The run directory exists before the command (SwiftPM writes nothing if it does not). |

Destination specifiers (`commands.ts`, unit tested):

| `AppleDestination` | `-destination`                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `simulator`        | `platform=<Platform> Simulator,id=<udid>` (platform from the runtime, for example `iOS`, `watchOS`, `visionOS`) |
| `device`           | `platform=<platform>,id=<identifier>`                                                                           |
| `mac`              | `platform=macOS`                                                                                                |
| `generic`          | `generic/platform=<platform>`                                                                                   |

Application product selection for `run` (kept from old Loom's rule "never install the first
`.app` found on disk"): from the `-showBuildSettings -json` array, keep entries whose
`buildSettings.PRODUCT_TYPE` is `com.apple.product-type.application`. Exactly one must remain;
otherwise fail with "The scheme builds N applications; choose a scheme that builds one." The
app is `TARGET_BUILD_DIR/WRAPPER_NAME` and the bundle id `PRODUCT_BUNDLE_IDENTIFIER`.

Install and launch:

| Destination | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulator   | `xcrun simctl boot <udid>` (ignore "Unable to boot device in current state: Booted"), `xcrun simctl bootstatus <udid> -b`, `xcrun simctl install <udid> <app>`, `xcrun simctl launch --terminate-running-process <udid> <bundleId>`. Then the optional Device panel open.                                                                                                                                                                         |
| Device      | `xcrun devicectl device install app --device <id> <app> --json-output -`, then `xcrun devicectl device process launch --device <id> --terminate-existing <bundleId> --json-output -`. Parse the JSON; the human text is not stable (devicectl help says so). A non-zero exit gives `hint: "device-unavailable"` with devicectl's error text (JSON `error` when present, else stderr; the exact error JSON shape is unverified, decode leniently). |
| Mac         | `open -n <app>`                                                                                                                                                                                                                                                                                                                                                                                                                                   |

`--device`, `--terminate-existing` and `--json-output` were checked with `--help` on Xcode 27.0
(2026-09-24). Xcode 27 changed JSON to version 5 and adds a `_deprecationNotice` field to
results that contain deprecated properties.

### Physical devices and signing

Minimal by design (PRODUCT.md, Decisions):

- The device build is the normal `build` step with `-destination platform=<platform>,id=<identifier>`
  and the project's own signing settings. Loom never passes `-allowProvisioningUpdates`,
  `-allowProvisioningDeviceRegistration`, `-authenticationKey*`, or any `CODE_SIGN_*`,
  `DEVELOPMENT_TEAM` or `PROVISIONING_PROFILE*` override (`commands.test.ts` asserts it).
  `-allowProvisioningUpdates` lets xcodebuild create and update profiles, app IDs and
  certificates (`xcodebuild -help`), which is exactly what Loom does not do.
- Signing failures: when a device build fails, `classifySigningIssue(summary.build.issues)`
  looks for signing errors by case-insensitive substrings (`signing for`, `requires a
development team`, `no profiles for`, `provisioning profile`, `no signing certificate`,
  `code signing`). A match sets `hint: "signing"` and `failureReason` to "Code signing is not
  set up for this scheme. Open the project in Xcode, choose a team under Signing &
  Capabilities, then build again."; the build's own issues stay listed below. The exact Xcode
  27 wording of signing errors was not reproduced for this packet; the substrings are
  deliberately loose, and the fixture test uses synthetic messages marked as such.
- Only paired devices with Developer Mode not reported off are selectable; the others are
  listed disabled with the fix text from PRODUCT.md. Loom does not pair devices or change
  Developer Mode.
- Physical-device runs are verified by hand only (TESTING.md); automated tests cover argv,
  parsing and the signing classifier.

### Swift packages: diagnostics and xUnit

Facts checked with Swift 6.4 (Xcode 27.0) on a scratch package on 2026-09-24:

- Compiler diagnostics print as `<absolute path>:<line>:<column>: error: <message>` (and
  `warning:`), followed by Swift 6's indented source excerpt that repeats the message after
  `|`. ANSI color codes are present when the output is a terminal; Loom pipes, but strips
  `\x1b[...m` anyway.
- XCTest failures print as `<absolute path>:<line>: error: -[<Module>.<Class> <test>] : <message>`.
- Swift Testing issues print as `Test <name>() recorded an issue at <File>.swift:<line>:<column>: <message>`
  (file name only, preceded by an SF Symbols glyph).
- `swift test --xunit-output <path>` writes XCTest results to `<path>` only with `--parallel`,
  and Swift Testing results to `<path without .xml>-swift-testing.xml` (for `xunit.xml`:
  `xunit-swift-testing.xml`). The directory must exist.
- XCTest xUnit: `<testcase classname="<Module>.<Class>" name="<test>" time="...">` with
  `<failure message="failure">` (the message is always the word "failure"; the real text is in
  the log line above).
- Swift Testing xUnit: `<testcase classname="<Module>" name="<func>()">` with
  `<failure message="<expectation text> (error): <comment>">` or `<skipped>reason</skipped>`;
  `<testsuite>` carries `tests`, `failures`, `skipped` attributes.
- `swift test list` prints identifiers `<Module>.<Class>/<test>` (XCTest) and
  `<Module>.<func>()` (Swift Testing); `--filter <regex>` with the escaped identifier runs one
  test. Identifiers of Swift Testing tests inside a `@Suite` type were not checked; derive
  them the same way and verify when a fixture with a suite exists.

`diagnostics.ts`:

- `parseCompilerDiagnostics(log, cwd)`: lines matching
  `^(?<file>/[^:]+):(?<line>\d+):(?<col>\d+): (?<sev>error|warning): (?<msg>.+)$` after ANSI
  stripping; lines starting with whitespace or `|` are ignored (the excerpt), duplicates of the
  same file, line and message are dropped; files inside `cwd` become workspace-relative.
  Returns `AppleIssue[]` (errors first, capped at 100). Used for `swiftBuild`, the build phase
  of `swiftTest`, and any xcodebuild run that failed before a result bundle existed.
- `parseTestFailureLines(log)`: the XCTest and Swift Testing forms above, keyed by
  `<Class>/<test>` or `<func>()`, giving message, file and line.
- `classifySigningIssue(issues)` (above).

`xunit.ts`:

- `readXunit(xml)`: no XML dependency. SwiftPM writes a fixed, flat shape, so a small scanner
  over `<testsuite ...>`, `<testcase ...>`, `<failure .../>`, `<failure ...>...</failure>` and
  `<skipped>...</skipped>` tags with attribute parsing and the five XML entities is enough.
  Anything unrecognized is skipped, never fatal. Returns
  `{ total, failed, skipped, cases: { classname, name, status, message? }[] }`.
- The summary for `swiftTest` merges both files when they exist: counts add up, `result` is
  `Failed` if any failed, else `Passed` (`Skipped` when every case skipped); each failure's
  identifier is `<classname>/<name>` for XCTest cases (classname contains a dot) and
  `<classname>.<name>` for Swift Testing cases, its message is the xUnit message, replaced by
  the log line's message when the xUnit message is the bare word "failure", and file and line
  come from the log. Missing files (build failed first) leave `tests` unset and the build
  issues from `parseCompilerDiagnostics` explain why.
- "Test only this" on a package failure starts `swiftTest` with `onlyTesting: [identifier]`,
  which becomes `--filter` with the identifier regex-escaped.

### XCResult summaries

After any `xcodebuild` run that produced a bundle (success or failure):

```
xcrun xcresulttool get build-results --path <bundle> --compact
xcrun xcresulttool get test-results summary --path <bundle> --compact   # test runs only
```

Both print JSON that matches `--schema` (schema version 0.4.0 on xcresulttool 25115). The
relevant fields, verified with `--schema`:

- `BuildResults`: `status`, `errorCount`, `warningCount`, `analyzerWarningCount`, `errors[]`,
  `warnings[]`, `analyzerWarnings[]`, `destination`, `startTime`, `endTime`. Each `Issue` has
  `issueType`, `message`, optional `targetName`, `sourceURL`, `className`.
- Test `Summary`: `title`, `environmentDescription`, `result` (`Passed | Failed | Skipped |
Expected Failure | unknown`), `totalTestCount`, `passedTests`, `failedTests`,
  `skippedTests`, `expectedFailures`, `testFailures[]` (`testName`, `targetName`,
  `failureText`, `testIdentifierString`), `devicesAndConfigurations`, `topInsights`.

Old Loom read `record.tests.failedCount`, which does not exist; its counts were always zero.
Decode with `Schema.decodeUnknown` against a local schema of only the fields above, with every
field optional except the counts, so a future schema bump degrades to "unknown" instead of
failing. Pin nothing with `--schema-version`; log the schema version once per server start.

`sourceURL` looks like `file:///abs/path/File.swift#...StartingLineNumber=12...`. Parse the
path and `StartingLineNumber` defensively; unknown shapes keep only the message. Make the path
workspace-relative when it is inside `cwd`.

Do not call `xcresulttool get object` or `export object`; xcresulttool 25115 marks both as
deprecated. Attachments (`xcresulttool export attachments`) are out of scope for v1.

### XcodeGen

- **Validate:** `xcodegen dump --spec <spec> --type json --quiet`. Exit 0 means the spec
  parses and resolves; stderr is the error. The resolved JSON gives `name`, which names the
  generated `<name>.xcodeproj`.
- **Diff:** `xcodegen generate --spec <spec> --project <tmpDir> --quiet` (the `--project` flag
  sets the output directory), then compare `<tmpDir>/<name>.xcodeproj/project.pbxproj` with the
  workspace copy. Equal bytes: `in-sync`. Missing workspace project: `not-generated`.
  Otherwise produce a unified diff with a small in-repo diff helper; cap it at 200 KB. Also
  compare `xcshareddata/xcschemes/*.xcscheme`; list changed scheme files by name only. Remove
  `tmpDir` in a finalizer. Relative paths inside the spec resolve from `--project-root`, so pass
  `--project-root <dir of spec>` to both commands.
- **Generate:** a run of kind `xcodegenGenerate` (so it has a log and history). After success,
  invalidate the `inspect` cache for the workspace.

Check whether the repo already ships a unified-diff helper before adding one
(`git grep -n "createTwoFilesPatch\|unifiedDiff" -- packages apps`). A new dependency needs
Kyle's approval (CONVENTIONS.md, "The lockfile rule").

### Release readiness

`readiness(workspace, container, scheme)` runs
`xcodebuild -showBuildSettings -json -scheme S -configuration Release` (plus the container
flag), takes the application target entry, and evaluates:

| Code                | Pass when                                                                                                                                                                     | Otherwise                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `scheme-shared`     | The scheme file exists under `xcshareddata/xcschemes`                                                                                                                         | warning: "The scheme is not shared; CI and other checkouts will not see it." |
| `bundle-id`         | `PRODUCT_BUNDLE_IDENTIFIER` set and not `com.example.*`                                                                                                                       | fail                                                                         |
| `version`           | `MARKETING_VERSION` set                                                                                                                                                       | fail                                                                         |
| `build-number`      | `CURRENT_PROJECT_VERSION` set and numeric (dots allowed)                                                                                                                      | fail                                                                         |
| `signing-team`      | `DEVELOPMENT_TEAM` set                                                                                                                                                        | warning                                                                      |
| `app-icon`          | `ASSETCATALOG_COMPILER_APPICON_NAME` names an `.appiconset` with a 1024 px image, or an Icon Composer `.icon` file of that name exists in the target's sources                | warning                                                                      |
| `privacy-manifest`  | A `PrivacyInfo.xcprivacy` exists under the target's source directories (found by walking the directory of `INFOPLIST_FILE` or the spec's target sources)                      | warning                                                                      |
| `export-compliance` | `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption` set, or `ITSAppUsesNonExemptEncryption` present in the Info.plist (`plutil -extract ITSAppUsesNonExemptEncryption raw <plist>`) | warning                                                                      |
| `deployment-target` | Always pass; message shows `IPHONEOS_DEPLOYMENT_TARGET` / `MACOSX_DEPLOYMENT_TARGET`                                                                                          | n/a                                                                          |
| `git-clean`         | `git status --porcelain` empty in `cwd`                                                                                                                                       | warning                                                                      |
| `xcodegen-sync`     | XcodeGen report `in-sync`, or no spec                                                                                                                                         | warning                                                                      |
| `release-build`     | Latest `releaseBuild` run for this workspace succeeded after the last commit time                                                                                             | unknown when none                                                            |
| `tests`             | Latest `test` run succeeded after the last commit time                                                                                                                        | unknown when none                                                            |

Overall: any fail gives fail, else any warning gives warning, else any unknown gives unknown,
else pass (old Loom's roll-up). The checklist is advice, not a gate: nothing is blocked by it.

### Toolchain and destinations

- `status` walks the workspace and runs the probes in parallel with a 10 s timeout each:
  `xcodebuild -version`, `xcode-select -p`, `xcodebuild -checkFirstLaunchStatus` (exit code),
  `xcrun simctl list runtimes -j`, `xcodegen --version`, `xcbeautify --version`,
  `xcrun --find mcpbridge`, `xcrun mcp-server status`, and on Linux `xtool --version`. Tool
  probes are cached for 60 s per server; the walk is not cached.
- `destinations` merges `xcrun simctl list devices available -j` (booted first, then by
  runtime) and `xcrun devicectl list devices --json-output -`, plus `mac` and the `generic`
  entries. `devicectl` failures (no devices, no permission) yield an empty device list, never
  an error. On Xcode 27, devicectl lists simulators too, so keep only entries whose hardware
  reality is `physical`. Read each device from the `properties` dictionary (JSON version 5:
  `hardware.reality`, `hardware.platform`, `hardware.marketingName`, `hardware.udid`,
  `connection.pairingState`, `connection.state`, `connection.transportType`, `state.name`,
  `state.developerModeStatus`, `software.osVersionNumber.stringValue`), falling back to the
  deprecated `hardwareProperties`, `deviceProperties` and `connectionProperties` (named in
  `_deprecationNotice.deprecatedFields`) when `properties` is absent. `developerModeStatus` is
  a string in the deprecated form and an object keyed by the status in `properties`; accept
  both. Field names were read from `devicectl list devices --json-output -` on Kyle's Mac
  (2026-09-24); no device values are copied into fixtures (write them by hand).

### Linux environments and xtool

On a Linux environment `status.toolchain.platform` is `linux`, Xcode fields are null, and
`tools.xtool` reports `xtool --version` when found. v1 runs no xtool commands. The documented
manual path (user doc) is `xtool dev` in the terminal. xtool is MIT, but its `xadi` dependency
is LGPL-2.1; if a later version drives xtool it must call the CLI and never vendor or link
xtool code.

### Startup and retention

- On start, mark runs still `queued` or `running` as `interrupted` (the process died with the
  server). Use `forkParked` if the sweep touches projections; the SQL update alone does not.
- After each run, delete runs beyond `keepRunsPerProject` (default 20, 5 to 200) for that
  project (oldest first), including their run directories. History is count-based only; there
  is no age rule.
- Derived data folders are not deleted automatically; the settings section shows their total
  size (`getSettings().storage`) and deletes them through `clearHistory({ includeDerivedData:
true })`, refused while a run is active. Sizes are computed on request with a bounded walk,
  not cached.
- Orphans: a run whose `project_id` no longer exists in the projection is deleted by the same
  retention pass. No reactor is needed.

## Storage

Migrations (`apps/server/src/fork/apple-build-tooling/migrations.ts`, tracking table
`fork_migrations_apple_build_tooling`):

```sql
-- 1_Runs
CREATE TABLE IF NOT EXISTS fork_apple_build_tooling_runs (
  id TEXT PRIMARY KEY,                 -- "abt_" + uuid
  project_id TEXT NOT NULL,
  thread_id TEXT,                      -- null when the thread was deleted later
  cwd TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_json TEXT NOT NULL,          -- AppleRunRequest
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  started_by TEXT NOT NULL,            -- user | agent
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  command_line TEXT NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  failed_test_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,                   -- AppleRunSummary
  run_dir TEXT NOT NULL,
  result_bundle_path TEXT
);
CREATE INDEX IF NOT EXISTS fork_apple_build_tooling_runs_project
  ON fork_apple_build_tooling_runs (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS fork_apple_build_tooling_runs_cwd
  ON fork_apple_build_tooling_runs (cwd, started_at DESC);

-- 2_Settings
CREATE TABLE IF NOT EXISTS fork_apple_build_tooling_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

Files: `<stateDir>/fork/apple-build-tooling/`

```
runs/<runId>/log.txt           raw combined output
runs/<runId>/Result.xcresult   result bundle (xcodebuild kinds)
runs/<runId>/xunit.xml         swiftTest only (XCTest results)
runs/<runId>/xunit-swift-testing.xml   swiftTest only (Swift Testing results)
derived/<hash>/                 derived data per workspace (setting "loom")
xcodegen-cache/<hash>           XcodeGen cache file
```

## Clients

- `packages/client-runtime/src/fork/apple-build-tooling.ts`: atoms built with the upstream
  factories (`createEnvironmentRpcQueryAtomFamily`, `createEnvironmentRpcSubscriptionAtomFamily`,
  `createEnvironmentRpcCommand`, `packages/client-runtime/src/state/runtime.ts:612,646,678`):
  `status`, `inspect`, `destinations`, `xcodegen`, `readiness`, `runs` (subscription on
  `watchRuns`), `run` (getRun), commands `start`, `cancel`, `updateSettings`, `clearHistory`.
- `apps/web/src/fork/apple-build-tooling/`:
  - `state.ts`: instantiates the atoms with `connectionAtomRuntime` (as
    `apps/web/src/state/device.ts:18`); selection store (container, scheme, configuration,
    destination, test plan) persisted per `environmentId + projectId` in localStorage key
    `loom:apple-build-tooling:selection:v1`, wrapped in try/catch.
  - `panel.tsx`: `ForkPanelDefinition` `{ id: "apple-build-tooling", title: "Apple build",
icon: HammerIcon, shortcut: "X", unavailableHint: "Needs a Loom server with Apple build
tooling", isAvailable: ({ threadRef, loomFeatures }) => threadRef !== null &&
loomFeatures.includes("apple-build-tooling") }`.
  - `AppleBuildPanel.tsx` (lazy-loaded body), `ToolchainCard.tsx`, `RunControls.tsx`,
    `RunHistory.tsx`, `RunSummary.tsx`, `LogView.tsx`, `XcodegenCard.tsx`,
    `ReadinessCard.tsx`.
  - `palette.tsx`, `shortcuts.tsx` (ForkRoot component subscribing to the fork commands),
    `settings.tsx`.
- `LogView` renders the last 2,000 lines in a virtualized list (reuse the list primitive the
  terminal or work log uses; check `apps/web/src/components/ui/` first), appends chunks as
  they arrive, and stops the `tailLog` stream when the panel is hidden or the run ends.
- "Add to composer" builds text with `formatRunSummaryForAgent(run, summary)` (shared with the MCP
  tool, exported from the contracts file as a small derived helper so both server and web use
  it) and inserts it through `useComposerDraftStore.getState().setPrompt` appending to the
  current draft, or through `ChatComposerHandle.insertTextAtEnd`
  (`apps/web/src/components/chat/ChatComposer.tsx:1216-1256`) when the composer is mounted.
- "Open in Xcode": the server runs `open <runDir>/Result.xcresult` on the environment host
  (`.xcresult` opens in Xcode), through a small `openResultBundle({ runId })` RPC with
  `terminal:operate` scope (add it to the method table and the group with the others). The
  button is shown only when the environment is the machine the client runs on (the desktop
  app's local environment), since opening Xcode on a remote host helps nobody. "Reveal log"
  uses upstream's `shell.openInEditor` with the `file-manager` editor
  (`packages/contracts/src/editor.ts:75`) under the same condition. Elsewhere the panel offers
  "Download log": `getRun` with `includeLogTail: true` returns the last 256 KB of log text,
  which the client saves as a file, so no fork HTTP route and no desktop IPC are needed.
- Gating: every entry checks `supportsLoomFeature(capabilities, "apple-build-tooling")`.

## Agent-facing tools

Registered through `ext-mcp` in `apps/server/src/fork/apple-build-tooling/mcp.ts`:

```ts
const RunTool = Tool.make("loom_apple_build_tooling_run", {
  description:
    "Build, test, or build and run the Apple app in this thread's workspace with xcodebuild, " +
    "and return a compact summary (errors with file:line, failed tests). Prefer this over " +
    "running xcodebuild yourself. action=generate runs xcodegen generate.",
  parameters: Schema.Struct({
    action: Schema.Literals(["build", "test", "run", "release_build", "generate"]),
    container: Schema.optional(Schema.String), // workspace-relative path; default: the only one found
    scheme: Schema.optional(Schema.String), // default: the panel's last choice, else the only scheme
    destination: Schema.optional(Schema.String), // "booted" | simulator udid | device id | "mac" | "generic"
    only_testing: Schema.optional(Schema.Array(Schema.String)),
  }),
  success: RunToolResult, // { runId, status, durationSec, summaryText, logTail, resultBundlePath }
  failure: AppleToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
}).annotate(Tool.Title, "Apple build");

const StatusTool = Tool.make("loom_apple_build_tooling_status", {
  description:
    "List Apple projects, schemes, destinations and recent run results in this thread's workspace.",
  parameters: Schema.Struct({ include_destinations: Schema.optional(Schema.Boolean) }),
  success: StatusToolResult,
  failure: AppleToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Apple build status")
  .annotate(Tool.Readonly, true);
```

- The workspace comes from `McpInvocationContext.threadId`
  (`apps/server/src/mcp/McpInvocationContext.ts`), resolved like the RPCs.
- The run tool waits for the run to finish (timeout 45 minutes; on timeout it returns
  `status: "running"` with the run id, and the run continues).
- `summaryText` is at most 8 KB; `logTail` the last 60 log lines. Details stay in the panel.
- Gating: when `agentToolsEnabled` is false, both tools fail with "Apple build tools are turned
  off in Loom settings." The upstream `McpCapability` union is not extended (EXTENSION-POINTS.md,
  MCP).
- Upstream tells agents "Do not call simctl, adb, xcrun, or serve-sim directly while these
  tools are present" (`apps/server/src/provider/CodexDeveloperInstructions.ts:19`). These fork
  tools are the sanctioned route for builds; their descriptions say so. The upstream text is
  not changed.

## Provider decisions

| Provider                                           | Decision                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex, Claude, Cursor, Grok, OpenCode, Antigravity | Same tools through the shared `t3-code` MCP server; no adapter change.                                                                                                                                                                                         |
| Xcode's own MCP server (`xcrun mcpbridge`)         | Not wired by Loom. The user doc explains `codex mcp add xcode -- xcrun mcpbridge` and `claude mcp add --transport stdio xcode -- xcrun mcpbridge`, and that Xcode must be running unless the Xcode 27 headless preview (`sudo xcrun mcp-server enable`) is on. |

## Performance

- `watchRuns` sends at most 20 small records per event, only on run state changes (start,
  phase change, finish), never per log line.
- `tailLog` coalesces output into chunks of at most 16 KB every 250 ms, and only while a
  client is subscribed. The panel subscribes only while visible.
- The workspace walk is bounded (depth 4, 5,000 entries) and runs on panel open and on an
  explicit refresh, not on a timer.
- `inspect` results are cached per `(cwd, container)` until a refresh, an XcodeGen generate, or
  a change of the container file's mtime.
- No animation beyond the upstream spinner while a run is active.

## Alternatives considered

- **Run in a terminal (like `ProjectSetupScriptRunner`).** Visible and familiar, but a PTY
  mixes stdout and stderr with control sequences, makes exit codes a sentinel game
  (`ProjectSetupScriptRunner.ts:180-191`), and ties runs to a thread's terminal. Child
  processes give clean logs and exit codes; the panel shows the log.
- **XcodeBuildMCP as the engine.** MIT and capable, but a large Node dependency with its own
  tool surface; Loom only needs a handful of commands and a summary. Kept as a reference.
- **Xcode's MCP server as the engine.** Needs a running Xcode (or the Xcode 27 headless preview,
  which needs `sudo` to enable) and returns Xcode's own formats. Complementary, not a base.
- **Parsing the build log instead of the result bundle.** Fragile across Xcode versions;
  `xcresulttool` JSON has a schema and a version.
