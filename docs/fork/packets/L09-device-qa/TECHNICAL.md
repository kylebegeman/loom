# L09 technical design

Upstream citations are to this fork at `a931bd85f3` (upstream v0.0.42). argent facts are from
software-mansion/argent at `3c1f2ae` (package version 0.25.2); Apple command facts were checked
with Xcode 27.0 on 2026-09-24 (see [REFERENCES.md](./REFERENCES.md)).

## Overview

```
 web / desktop                               environment server (ForkLayer)
+-----------------------------+   RPC    +--------------------------------------------+
| Device QA panel             | -------> | DeviceQaService                            |
|  Flows | Evidence | Install |          |  flows: walk .argent/flows, parse YAML     |
| Device panel toolbar (seam) | <------- |  runner: argent flow run --json-stream     |
|  capture / open QA          |  watch   |          (DO_NOT_TRACK=1), one per device  |
+-----------------------------+  events  |  evidence: screenshot / record / install   |
        |  media-file asset URLs         |    local: xcrun simctl, adb                |
        v  (upstream, signed)            |    ssh host: DeviceService.screenshot      |
   images, videos, diff PNGs             |  store: fork_device_qa_* + files           |
                                         |  reactor: delete evidence of deleted threads|
  agents: loom_device_qa_flow / capture  +--------------------------------------------+
          (gated by upstream "device" MCP capability)
```

Upstream already owns device discovery, boot, streaming and agent control (the device hub,
`agent-device`, `device_*` tools). This packet adds only what upstream deliberately leaves out
(`apps/server/src/mcp/toolkits/device/tools.ts:21-27` leaves install, taps and logs to the
agent-device CLI): repeatable flows, durable evidence, and install of a built artifact.

## Contracts

File: `packages/contracts/src/fork/device-qa.ts`, exported from `fork/index.ts`, group merged in
`fork/rpc.ts`.

```ts
export const DEVICE_QA_WS_METHODS = {
  status: "loom.device-qa.status",
  listFlows: "loom.device-qa.listFlows",
  readFlow: "loom.device-qa.readFlow",
  runFlows: "loom.device-qa.runFlows",
  cancelRun: "loom.device-qa.cancelRun",
  getRun: "loom.device-qa.getRun",
  watchRuns: "loom.device-qa.watchRuns",
  runEvents: "loom.device-qa.runEvents",
  capture: "loom.device-qa.capture",
  stopRecording: "loom.device-qa.stopRecording",
  watchEvidence: "loom.device-qa.watchEvidence",
  deleteEvidence: "loom.device-qa.deleteEvidence",
  installApp: "loom.device-qa.installApp",
  statusBar: "loom.device-qa.statusBar",
  disableArgentTelemetry: "loom.device-qa.disableArgentTelemetry",
  getSettings: "loom.device-qa.getSettings",
  updateSettings: "loom.device-qa.updateSettings",
} as const;

export const DeviceQaTarget = Schema.Struct({
  hostId: DeviceHostId, // "local" for the environment host (LOCAL_DEVICE_HOST_ID)
  deviceId: DeviceId, // simulator udid or adb serial
  platform: DevicePlatform, // "ios" | "android"
});

export const DeviceQaStatus = Schema.Struct({
  argent: Schema.Struct({
    installed: Schema.Boolean,
    version: Schema.NullOr(Schema.String),
    path: Schema.NullOr(Schema.String),
    telemetry: Schema.Literals(["enabled", "disabled", "unknown"]),
    pinnedVersion: Schema.String, // the version Loom's install command uses
  }),
  hostPlatform: Schema.Literals(["darwin", "linux", "win32", "other"]),
  tools: Schema.Struct({ simctl: Schema.Boolean, adb: Schema.Boolean }),
  /** Booted local simulators and running emulators, read without the device hub. */
  localDevices: Schema.Array(
    Schema.Struct({
      target: DeviceQaTarget,
      name: Schema.String,
      version: Schema.String,
    }),
  ),
  recording: Schema.NullOr(
    Schema.Struct({ evidenceId: Schema.String, target: DeviceQaTarget, startedAt: Schema.String }),
  ),
});

export const DeviceQaFlow = Schema.Struct({
  path: TrimmedNonEmptyString, // workspace-relative, under .argent/flows
  name: Schema.String, // file name without .yaml
  folder: Schema.String, // relative folder under .argent/flows ("" for the root)
  kind: Schema.Literals(["e2e", "fragment", "invalid"]),
  prerequisite: Schema.NullOr(Schema.String), // executionPrerequisite
  firstEcho: Schema.NullOr(Schema.String), // start-state note of an e2e flow
  stepCount: Schema.Int,
  snapshotSteps: Schema.Int,
  platforms: Schema.Array(Schema.String), // from launch maps / when: { platform } blocks, best effort
  parseError: Schema.NullOr(Schema.String),
  modifiedAt: Schema.String,
});

export const DeviceQaStep = Schema.Struct({
  index: Schema.Int,
  kind: Schema.String,
  status: Schema.Literals(["pass", "fail", "skip", "error"]),
  reason: Schema.optional(Schema.String),
  warning: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tool: Schema.optional(Schema.String),
  flow: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  depth: Schema.optional(Schema.Int),
  durationMs: Schema.optional(Schema.Number),
  /** Absolute paths on the environment host, fetched through media-file asset URLs. */
  artifacts: Schema.optional(
    Schema.Struct({
      baseline: Schema.optional(Schema.String),
      current: Schema.optional(Schema.String),
      diff: Schema.optional(Schema.String),
    }),
  ),
});

export const DeviceQaRunStatus = Schema.Literals([
  "running",
  "passed",
  "failed",
  "error",
  "cancelled",
  "interrupted",
]);

export const DeviceQaRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  target: DeviceQaTarget,
  flows: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      status: Schema.Literals([
        "pending",
        "running",
        "passed",
        "failed",
        "error",
        "skipped",
        "cancelled",
      ]),
      passed: Schema.Int,
      failed: Schema.Int,
      skipped: Schema.Int,
      errored: Schema.Int,
      durationMs: Schema.NullOr(Schema.Number),
      error: Schema.NullOr(Schema.String), // argent `event: "error"` text or exit reason
    }),
  ),
  updateBaselines: Schema.Boolean,
  status: DeviceQaRunStatus,
  startedBy: Schema.Literals(["user", "agent"]),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});

export const DeviceQaRunDetail = Schema.Struct({
  run: DeviceQaRun,
  /** Steps of each flow, by flow path; capped at 500 steps per flow. */
  steps: Schema.Record(Schema.String, Schema.Array(DeviceQaStep)),
});

export const DeviceQaRunEvent = Schema.Union([
  Schema.TaggedStruct("flowStarted", { path: Schema.String }),
  Schema.TaggedStruct("step", { path: Schema.String, step: DeviceQaStep }),
  Schema.TaggedStruct("flowFinished", { path: Schema.String, status: Schema.String }),
  Schema.TaggedStruct("runFinished", { run: DeviceQaRun }),
]);

export const DeviceQaEvidenceKind = Schema.Literals([
  "screenshot",
  "recording",
  "install",
  "flow-report",
]);
export const DeviceQaEvidence = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  kind: DeviceQaEvidenceKind,
  status: Schema.Literals(["recording", "finalizing", "ready", "failed"]),
  target: DeviceQaTarget,
  deviceName: Schema.String,
  label: Schema.NullOr(Schema.String),
  /** Absolute file path on the environment host (PNG, MP4 or JSON); null for installs. */
  path: Schema.NullOr(Schema.String),
  mimeType: Schema.NullOr(Schema.String),
  sizeBytes: Schema.NullOr(Schema.Number),
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(Schema.Number),
  detail: Schema.NullOr(Schema.String), // install: bundle id / package; flow-report: run id; failure text
  createdBy: Schema.Literals(["user", "agent"]),
  createdAt: Schema.String,
});

export const DeviceQaCaptureInput = Schema.Struct({
  threadId: ThreadId,
  target: DeviceQaTarget,
  kind: Schema.Literals(["screenshot", "recording"]),
  label: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  /** iOS simulators: apply the clean status bar before and clear it after the capture. */
  cleanStatusBar: Schema.optional(Schema.Boolean),
  /** Recordings: hard stop after this many seconds (1..180). */
  maxSeconds: Schema.optional(Schema.Int),
});

export const DeviceQaRunFlowsInput = Schema.Struct({
  threadId: ThreadId,
  target: DeviceQaTarget,
  /** Workspace-relative flow files, run in order. A folder is expanded by the client from listFlows. */
  paths: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  updateBaselines: Schema.optional(Schema.Boolean),
});

export const DeviceQaInstallInput = Schema.Struct({
  threadId: ThreadId,
  target: DeviceQaTarget,
  /** Workspace-relative or absolute path to a .app directory or an .apk file on the environment host. */
  artifactPath: TrimmedNonEmptyString,
  launch: Schema.optional(Schema.Boolean),
});

export const DeviceQaSettings = Schema.Struct({
  argentPath: Schema.NullOr(Schema.String), // override; null = PATH lookup
  keepRunsPerProject: Schema.Int, // default 20
  defaultCleanStatusBar: Schema.Boolean, // default true
});

export class DeviceQaError extends Schema.TaggedError<DeviceQaError>()("DeviceQaError", {
  reason: Schema.Literals([
    "argent-missing",
    "workspace-not-found",
    "flow-not-found",
    "invalid-path",
    "device-unavailable",
    "unsupported-on-host",
    "busy",
    "not-found",
    "command-failed",
    "timeout",
  ]),
  message: Schema.String,
}) {}
```

RPC group `DeviceQaRpcGroup` (all errors `Schema.Union([DeviceQaError,
EnvironmentAuthorizationError])`):

| Tag                              | Payload                                | Success                                                       | Stream         | Scope                                          |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------- | -------------- | ---------------------------------------------- |
| `status`                         | `{ threadId }`                         | `DeviceQaStatus`                                              | no             | `orchestration:read`                           |
| `listFlows`                      | `{ threadId }`                         | `{ flows: DeviceQaFlow[], truncated }`                        | no             | `orchestration:read`                           |
| `readFlow`                       | `{ threadId, path }`                   | `{ path, text }` (at most 256 KB)                             | no             | `orchestration:read`                           |
| `runFlows`                       | `DeviceQaRunFlowsInput`                | `DeviceQaRun`                                                 | no             | `terminal:operate`                             |
| `cancelRun`                      | `{ runId }`                            | void                                                          | no             | `terminal:operate`                             |
| `getRun`                         | `{ runId }`                            | `DeviceQaRunDetail`                                           | no             | `orchestration:read`                           |
| `watchRuns`                      | `{ threadId }`                         | `{ runs: DeviceQaRun[] }` (latest 20 of the thread's project) | subscription   | `orchestration:read`                           |
| `runEvents`                      | `{ runId }`                            | `DeviceQaRunEvent`                                            | stream command | `orchestration:read`                           |
| `capture`                        | `DeviceQaCaptureInput`                 | `DeviceQaEvidence`                                            | no             | `terminal:operate`                             |
| `stopRecording`                  | `{ evidenceId }`                       | `DeviceQaEvidence`                                            | no             | `terminal:operate`                             |
| `watchEvidence`                  | `{ threadId }`                         | `{ items: DeviceQaEvidence[] }` (latest 200)                  | subscription   | `orchestration:read`                           |
| `deleteEvidence`                 | `{ evidenceId }`                       | void                                                          | no             | `orchestration:operate`                        |
| `installApp`                     | `DeviceQaInstallInput`                 | `DeviceQaEvidence`                                            | no             | `terminal:operate`                             |
| `statusBar`                      | `{ target, mode: "clean" \| "clear" }` | void                                                          | no             | `terminal:operate`                             |
| `disableArgentTelemetry`         | `{}`                                   | `DeviceQaStatus["argent"]`                                    | no             | `terminal:operate`                             |
| `getSettings` / `updateSettings` | `{}` / partial settings                | `DeviceQaSettings`                                            | no             | `orchestration:read` / `orchestration:operate` |

`watchRuns` and `watchEvidence` go into `ForkSubscriptionRpcTag`; `runEvents` into
`ForkStreamCommandRpcTag`.

Capturing, recording and installing need `terminal:operate` because they run host commands and
change device state; that matches how upstream scopes terminal power
(`packages/contracts/src/auth.ts:81-98`).

## Server

Directory `apps/server/src/fork/device-qa/`:

| File                              | Contents                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DeviceQaService.ts`              | `Context.Service` `loom/DeviceQaService` and `layer`.                                                                                                         |
| `argent.ts`                       | Locate and probe argent; build the `flow run` argv; parse NDJSON records. Pure parts unit tested.                                                             |
| `flows.ts`                        | Walk `.argent/flows`, parse YAML with the `yaml` package (already an `apps/server` dependency, `apps/server/package.json:36`), classify kind and count steps. |
| `hostDevices.ts`                  | Local device commands: `simctl list devices booted -j`, `adb devices -l`, screenshot, record, install, launch, status bar.                                    |
| `evidenceStore.ts`, `runStore.ts` | Repositories over the fork tables.                                                                                                                            |
| `migrations.ts`                   | `DeviceQaMigrations` (slug `device-qa`).                                                                                                                      |
| `reactor.ts`                      | Evidence cleanup for deleted threads.                                                                                                                         |
| `rpc.ts`, `mcp.ts`                | Transport.                                                                                                                                                    |

Upstream services used from `ForkLayer` (reachable per EXTENSION-POINTS.md, "What ForkLayer can
use"):

- `DeviceService` (`apps/server/src/device/DeviceService.ts:109-154`): `list` to name devices
  and see SSH hosts; `screenshot({ hostId, deviceId })` (`:731-752`, returns `{ device, png }`)
  for devices on SSH hosts; `sessionsForThread` to preselect the device the thread is watching.
  Local devices do not need the hub: they are handled with `simctl` and `adb` directly, so
  evidence works even when the device hub is off.
- `ProjectionSnapshotQuery` (`getThreadShellById`, `:217`; `getProjectShellById`, `:174`) with
  `resolveThreadWorkspaceCwd` (`apps/server/src/checkpointing/Utils.ts:12`) to find the
  workspace.
- `ServerConfig.stateDir`, `SqlClient`, `FileSystem`, `Path`, `ChildProcessSpawner`,
  `ProcessRunner` (provide `ProcessRunner.layer` locally, as upstream does at
  `apps/server/src/server.ts:326,392,407`).
- `OrchestrationEngineService.streamDomainEvents` for the cleanup reactor.

### Finding argent

Order: the `argentPath` setting, then `PATH` (use upstream's `isCommandAvailable` from
`@t3tools/shared/shell`, as `LocalDeviceHost.ts` does), then npm's global bin
(`npm prefix -g` + `/bin/argent`, probed once and cached). Version: `argent --version` (the CLI
lists `--version, -v` in its help, `packages/argent/src/cli.ts:78`). Telemetry:
`argent telemetry status`, parsed loosely (look for "disabled" or "enabled"; anything else is
`unknown`).

Every argent process Loom starts gets `DO_NOT_TRACK=1` in its environment (argent's telemetry
doc: "The environment variable `DO_NOT_TRACK=1` still turns telemetry off regardless of either
file"). The "Turn off telemetry" button runs `argent telemetry disable` (global scope) on Kyle's
click. Loom never writes argent's project config (`telemetry disable --scope project` writes
`.argent/config.json` into the repo; that is Kyle's call, and the user doc mentions it).

Install guidance: the pinned version lives in one constant, `ARGENT_PINNED_VERSION = "0.25.2"`
(update when bumping). The card offers argent's own installer,
`npx @swmansion/argent@0.25.2 init --no-telemetry` (the wizard installs the package globally,
registers argent's MCP server in the editors it finds, which agents need to record flows, copies
its skills, and with `--no-telemetry` turns telemetry off), and the plain alternative
`npm install -g @swmansion/argent@0.25.2` for runner-only use. Both come as "Copy command" and
"Type in terminal"; the latter opens a new terminal for the thread and writes the command
**without a trailing return**, so nothing runs until Kyle presses Enter (client side, see
Clients). Loom never runs either command itself. `init` copies argent's agent skills into the
workspace it runs in (argent's installation docs) and `--local` would also add a dev
dependency and committed config, so the terminal opens in the thread's workspace and the card
says what `init` will change.

### Flow discovery

- Walk `<cwd>/.argent/flows` recursively, skipping dot-directories and `__baselines__`, at most
  1,000 files. Only `*.yaml` (argent's documented extension).
- Parse with `yaml` `parse` (not `parseDocument` with custom tags; argent's own "YAML safety"
  section rejects anchors and tags, so do the same: treat parse warnings as `invalid`).
- Kind (argent's rule, `packages/docs/docs/reference/flow-yaml.mdx`, "File shape"): the first
  step that is not `echo` or `script` decides; `launch` means `e2e`, anything else `fragment`.
  `firstEcho` is the text of a leading `echo` step. `snapshotSteps` counts `snapshot` directives
  at any depth (`when:` nests steps). `stepCount` counts top-level steps.
- Names must match argent's charset (letters, numbers, `_`, `-`); others are listed as
  `invalid` with "argent cannot run a flow whose file name has other characters."
- Paths passed to argent are workspace-relative and must not contain `..` (argent refuses them).

### Running flows

One active run per device (`busy` otherwise) and one active argent run per environment host at a
time, because argent's tool-server is shared by the whole machine (it listens on
`ARGENT_PORT`, default 3001) and a directory of flows runs sequentially anyway. The lock is a
`Semaphore(1)` in the service.

For each path in `paths`, in order:

```
argent flow run <relative path> --device <deviceId> --platform <ios|android>
  --json-stream --output <runDir>/artifacts [--update-baselines]
cwd = workspace root; env = process.env + { DO_NOT_TRACK: "1" }
```

`--json-stream` prints one JSON object per line (argent `packages/argent-cli/src/flow.ts`,
`writeJsonStreamRecord`):

| Record                                                                | Meaning                                                        | Loom action                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `{ "event": "progress", "data": StepReport }`                         | A step finished                                                | Map to `DeviceQaStep`, append, publish `step`.                                  |
| `{ "event": "result", "data": FlowReport }`                           | The flow finished                                              | Store counts and steps from the report (authoritative), publish `flowFinished`. |
| `{ "event": "error", "error": string, "error_code"?, "error_kind"? }` | The run failed before a report (validation, device, transport) | Mark the flow `error` with the text.                                            |

`StepReport` fields used: `index`, `kind`, `status` (`pass | fail | skip | error`), `reason`,
`warning`, `tool`, `flow`, `message`, `target`, `depth`, `durationMs`, `snapshotKey`,
`artifacts` (role to path or null after `--output` materialization). `FlowReport`: `flow`,
`device`, `executionPrerequisite`, `ok`, `passed`, `failed`, `skipped`, `errored`, `steps`,
`startedAt`, `durationMs`. Decode with lenient schemas (unknown keys allowed, all but `status`
optional) so an argent upgrade degrades instead of breaking. Lines that are not JSON are kept in
`<runDir>/stderr.txt`-style side log and ignored.

`--json-stream` supports a single flow only (argent rejects it for directories), which is why
Loom expands folders into paths and runs them one by one. Exit code 0 means the flow passed, 1
a failed flow or run error, 2 a usage or report problem; the last record decides the status, the
exit code is a fallback.

Snapshot artifacts: with `--output <dir>`, argent copies failed snapshots' baseline, current and
diff PNGs to `<dir>/<flow>/` and reports those paths; Loom stores them as the step's
`artifacts`. `--update-baselines` writes baselines under `.argent/flows/__baselines__/<flow>/`
in the workspace; the client asks for confirmation first ("This rewrites N baseline images in
the repository").

Cancel: close the run scope, which terminates the argent child (SIGTERM). The remaining flows are
`cancelled`. argent's tool-server keeps running (it is shared and idle-safe); Loom never stops
it.

After a run: insert a `flow-report` evidence item for the thread pointing at
`<runDir>/report.json` (the collected reports), so the Evidence tab shows runs next to
screenshots.

Device conflict: upstream agents drive devices with `agent-device`, and argent injects input
through its own simulator server. Both can target one simulator; concurrent input would make a
flow flaky. Before a run, if `DeviceService.sessionsForThread` shows an agent session on the same
device in any thread, the client shows "An agent may be using this device" and asks to continue.
This is advice, not a lock (whether both stacks interfere was not verified).

### Evidence capture

Files go to `<stateDir>/fork/device-qa/evidence/<threadId>/<evidenceId>.<ext>`.

| Kind                        | Local iOS simulator                                                                                                                                                                                                                           | Local Android emulator                                                                                                                                                                                    | SSH host device                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Screenshot                  | `xcrun simctl io <udid> screenshot --type=png <file>`                                                                                                                                                                                         | `adb -s <serial> exec-out screencap -p` to file                                                                                                                                                           | `DeviceService.screenshot`, bytes written to file |
| Clean status bar (iOS only) | `xcrun simctl status_bar <udid> override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100` before, `xcrun simctl status_bar <udid> clear` after | n/a                                                                                                                                                                                                       | n/a                                               |
| Recording                   | `xcrun simctl io <udid> recordVideo --codec=h264 --force <file>`; wait for "Recording started" on stderr; stop with SIGINT to the captured pid; simctl finalizes the file and exits                                                           | `adb -s <serial> shell screenrecord --time-limit <n> /sdcard/loom-<id>.mp4` started with `echo $!` to capture the device pid; stop with `adb shell kill -INT <pid>`, then `adb pull`, then `adb shell rm` | unsupported (`unsupported-on-host`)               |
| Install                     | `xcrun simctl install <udid> <.app>`, then `xcrun simctl launch --terminate-running-process <udid> <bundleId>` when `launch`                                                                                                                  | `adb -s <serial> install -r <apk>`, then `adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1` (upstream's launch method, `apps/server/src/device/DeviceActions.ts:441-449`)              | unsupported                                       |

- Validate the PNG signature and cap screenshots at 12 MiB (old Loom's limit); read width and
  height from the PNG header. Recordings cap at 180 seconds (Android's `screenrecord` limit) and
  1 GiB.
- Only one recording per environment host at a time; `status.recording` exposes it so any
  client shows the stop button.
- Bundle id for `.app`: `plutil -extract CFBundleIdentifier raw <app>/Info.plist`. Package for
  `.apk`: `aapt dump badging` when `aapt` is on the Android SDK build-tools path, else require
  `launch: false` and say "Install done; launch it from the device." (old Loom used `aapt`).
- Artifact paths may be workspace-relative (resolved and checked with upstream's
  `WorkspacePaths.resolveRelativePathWithinRoot`) or absolute (for DerivedData); absolute paths
  must exist and end in `.app` or `.apk`.
- Never kill by name. Every process is a spawned child with a captured pid; the Android device
  pid is captured from `echo $!`.

### Clean-up and retention

- Evidence lives until its thread is deleted or the user deletes it. The fork reactor
  (`reactor.ts`) is a `Layer.effectDiscard` in `ForkServicesLive` started with `forkParked`
  (`apps/server/src/serverActivation.ts:11-26`); it subscribes to
  `OrchestrationEngineService.streamDomainEvents`, and on `thread.deleted` removes the thread's
  rows and its evidence folder. A startup pass does the same for threads missing from the
  projection, so no cursor table is needed.
- Runs beyond `keepRunsPerProject` are deleted with their run directories after each run.
- Runs and recordings active at shutdown are marked `interrupted` / `failed` on start.

## Storage

Tracking table `fork_migrations_device_qa`.

```sql
-- 1_Runs
CREATE TABLE IF NOT EXISTS fork_device_qa_runs (
  id TEXT PRIMARY KEY,               -- "dqa_" + uuid
  project_id TEXT NOT NULL,
  thread_id TEXT,
  cwd TEXT NOT NULL,
  host_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  flows_json TEXT NOT NULL,          -- DeviceQaRun["flows"]
  steps_json TEXT,                   -- DeviceQaRunDetail["steps"], written at the end
  update_baselines INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  run_dir TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_device_qa_runs_project
  ON fork_device_qa_runs (project_id, started_at DESC);

-- 2_Evidence
CREATE TABLE IF NOT EXISTS fork_device_qa_evidence (
  id TEXT PRIMARY KEY,               -- "dqe_" + uuid
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  host_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  device_name TEXT NOT NULL,
  label TEXT,
  path TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  detail TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fork_device_qa_evidence_thread
  ON fork_device_qa_evidence (thread_id, created_at DESC);

-- 3_Settings
CREATE TABLE IF NOT EXISTS fork_device_qa_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

Files: `<stateDir>/fork/device-qa/evidence/<threadId>/`, `<stateDir>/fork/device-qa/runs/<runId>/`
(`artifacts/`, `report.json`, `output.log` for non-JSON lines).

## Clients

- `packages/client-runtime/src/fork/device-qa.ts`: atoms for every method (queries,
  subscriptions for `watchRuns` and `watchEvidence`, commands for the rest).
- `apps/web/src/fork/device-qa/`:
  - `panel.tsx`: `{ id: "device-qa", title: "Device QA", icon: ClipboardCheckIcon, shortcut:
"Q", unavailableHint: "Needs a Loom server with Device QA", isAvailable: threadRef !== null
&& loomFeatures.includes("device-qa") }`. The body is `React.lazy`.
  - `DeviceQaPanel.tsx` with three tabs; `DevicePicker.tsx` merges upstream's device state
    (`useDeviceState(environmentId)`, `apps/web/src/state/device.ts:32`) with
    `status.localDevices`, preferring the device the thread is watching
    (`DeviceServiceState.sessions`). A panel opened from the Device panel toolbar gets the
    device through the surface's `resourceId` (`forkPanelSurface("device-qa", "<hostId>:<deviceId>")`).
  - `FlowList.tsx`, `FlowRunView.tsx` (steps with indentation by `depth`, snapshot image trio),
    `EvidenceList.tsx`, `InstallForm.tsx`, `ArgentSetup.tsx`.
  - `DeviceToolbarActions.tsx`: the component rendered by the Device panel seam. Renders
    nothing unless the environment has `device-qa` in `loomFeatures`. Two `DeviceButton`-sized
    icon buttons (Camera, ClipboardCheck); while a recording runs on that device the camera
    button shows a red dot and stops the recording on click.
  - `attach.ts`: attaching evidence to the composer. Images: request a URL with upstream's
    `assets.createUrl` for `{ _tag: "media-file", threadId, path }` (the `media-file` resource
    serves "images, videos, HTML, and PDF" from any path the host can read,
    `packages/contracts/src/assets.ts:19-25`), `fetch` it, turn it into a `File`, compress with
    `compressImageToByteLimit(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)`
    (`apps/web/src/lib/imageCompression.ts:450`) and call
    `useComposerDraftStore.getState().addImage(threadRef, {...})`, then
    `syncPersistedAttachments`, following `deliverSnapShot` in
    `apps/web/src/components/desktop/SnapShotCoordinator.tsx:139-184`. Recordings: `addFiles`
    when the file is under `PROVIDER_SEND_TURN_MAX_FILE_BYTES`, else insert the host path as
    text ("Screen recording on the environment host: <path>") so an agent on that host can read
    it.
  - `recordPrompt.ts`: the "Record with the agent" template, inserted with the composer handle's
    `insertTextAtEnd` (`ChatComposer.tsx:1216-1256`) or the draft store's `setPrompt`:

    ```
    Record an argent flow named "<name>" in .argent/flows/<folder>/<name>.yaml on <device name>
    (<platform>, id <deviceId>). Path: <user's description>. Use argent's flow recording tools
    (flow-start-recording, flow-add-step, flow-add-echo, flow-finish-recording). Add an echo
    label before each screen change and prefer ids or text over coordinates.
    ```

  - `installArgent.ts`: "Type in terminal" opens a new thread terminal and writes the install
    command without `\r`, the same calls `runProjectScript` makes
    (`apps/web/src/components/ChatView.tsx:4141-4259`: `newTerminal` / `setTerminalOpen` in
    `apps/web/src/terminalUiStateStore.ts:567-577`, then the terminal open and write RPCs).
  - `palette.tsx`, `shortcuts.tsx` (ForkRoot component for the three commands), `settings.tsx`.
- Images in the panel load through `useAssetUrlState(environmentId, { _tag: "media-file",
threadId, path })` (`apps/web/src/assets/assetUrls.ts:19-33`) with `loading="lazy"` and fixed
  thumbnail boxes (the asset URL result carries image dimensions).

## Agent-facing tools

`apps/server/src/fork/device-qa/mcp.ts`:

```ts
const FlowTool = Tool.make("loom_device_qa_flow", {
  description:
    "List or run the project's recorded argent UI flows (.argent/flows) on a simulator or emulator " +
    "without an LLM in the loop. Returns per-step pass/fail and snapshot diff image paths.",
  parameters: Schema.Struct({
    mode: Schema.Literals(["list", "run"]),
    flow: Schema.optional(Schema.String), // name or path under .argent/flows; a folder runs every flow in it
    device_id: Schema.optional(Schema.String), // default: the device this thread has open, else the only booted one
    update_baselines: Schema.optional(Schema.Boolean),
  }),
  success: FlowToolResult,
  failure: DeviceQaToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
}).annotate(Tool.Title, "Device QA flows");

const CaptureTool = Tool.make("loom_device_qa_capture", {
  description:
    "Save a screenshot of a simulator or emulator as evidence in this thread's Device QA panel. " +
    "Returns the PNG path on this machine.",
  parameters: Schema.Struct({
    device_id: Schema.optional(Schema.String),
    label: Schema.optional(Schema.String),
    clean_status_bar: Schema.optional(Schema.Boolean),
  }),
  success: CaptureToolResult, // { evidenceId, path, width, height }
  failure: DeviceQaToolError,
  dependencies: [McpInvocationContext.McpInvocationContext],
}).annotate(Tool.Title, "Capture device evidence");
```

- Gate both with upstream's `requireMcpCapability("device")`
  (`apps/server/src/mcp/McpInvocationContext.ts:47-56`), which is present exactly when **Agent
  device access** is on for the thread's project (`ProviderService.ts:869-914`). No new
  capability is added.
- The flow tool waits for the run (timeout 20 minutes, then returns the run id with
  `running`). Its result lists at most 50 steps per flow and only failing steps' reasons.
- The capture tool returns the path, not image bytes: fork toolkits cannot use upstream's
  private `registerImageTool` (`apps/server/src/mcp/McpHttpServer.ts:499-577`), and agents on
  the same host can read the PNG. Upstream's `device_screenshot` remains the way to "look" at
  the screen.
- Recording and install stay UI-only in v1 (agents already install through
  `agent-device install`, per upstream's quick start, `toolkits/device/handlers.ts:59`).

## Headless Apple tooling this packet uses

Checked with Xcode 27.0: `simctl io <device> screenshot|recordVideo` (recordVideo prints
"Recording started" to stderr and finalizes on SIGINT), `simctl status_bar override|clear`,
`simctl install|launch --terminate-running-process`, `simctl list devices booted -j`, and the new
Xcode 27 `simctl reboot` (not used in v1). Everything runs without the Simulator app window;
argent's `ARGENT_SIMULATOR_NO_WINDOW=1` only matters when argent itself boots a device, which Loom
never asks it to do. UI-test result bundles with screenshots are L10's domain; see README,
optional integrations.

## Performance

- Subscriptions send small records: at most 20 runs and 200 evidence items per event, and only
  on changes. Step events stream only while a client watches that run.
- Images are fetched lazily through signed asset URLs; the WebSocket never carries image bytes.
- Flow discovery runs on panel open and on refresh; it is bounded (1,000 files).
- The Device panel toolbar component reads one capability flag and the recording state from the
  existing `watchEvidence` subscription only while the Device panel is mounted; no polling.
- No animation except the recording dot, which is a static red dot, not a pulse (AGENTS.md: no
  continuously repainting animations).

## Alternatives considered

- **Old Loom's native scenario format** (7 step kinds driven through `agent-device`). Solid
  rules (unique selector matches, snapshot generations), but a second recorder and runner to
  maintain. argent's flows cover the same ground, are recorded by agents, and run from a CLI.
- **argent's MCP server inside Loom.** Loom would have to register argent in every provider
  adapter; argent's own `init` does that per editor. Loom stays a runner.
- **Serving evidence through a fork HTTP route.** Upstream's `media-file` asset already serves
  PNG and MP4 files from the host with signed URLs over every connection mode.
- **Evidence as thread activities (`thread.activity.append`).** Activities are capped at 500 per
  thread and are not storage (EXTENSION-POINTS.md, section 12). A fork table is the rule.
