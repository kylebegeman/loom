// @effect-diagnostics nodeBuiltinImport:off - Captures write evidence files and runs append logs on disk.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { LOCAL_DEVICE_HOST_ID, type ProjectId, type ThreadId } from "@t3tools/contracts";
import {
  DEVICE_QA_MAX_RECORDING_SECONDS,
  DeviceQaError,
  DeviceQaRunDetail,
  deviceQaTargetKey,
  isArgentFlowName,
  type DeviceQaActiveRecording,
  type DeviceQaArgentStatus,
  type DeviceQaCaptureInput,
  type DeviceQaDeleteAllResult,
  type DeviceQaEvidence,
  type DeviceQaEvidenceList,
  type DeviceQaFlowRun,
  type DeviceQaInstallInput,
  type DeviceQaLocalDevice,
  type DeviceQaRun,
  type DeviceQaRunEvent,
  type DeviceQaRunFlowsInput,
  type DeviceQaRunStatus,
  type DeviceQaSettingsPatch,
  type DeviceQaStatus,
  type DeviceQaStep,
  type DeviceQaTarget,
} from "@t3tools/contracts/fork";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import {
  argentEnv,
  flowRunArgs,
  flowStatusOf,
  parseArgentLine,
  parseArgentVersion,
  stepFromReport,
  stepsFromReport,
  telemetryFromConfig,
  ARGENT_PINNED_VERSION,
  type ArgentRecord,
} from "./argent.ts";
import { expiryCutoff, makeEvidenceStore } from "./evidenceStore.ts";
import { flowLocation, resolveFlowPath, walkFlows } from "./flows.ts";
import {
  EMULATOR_PROPS_COMMAND,
  MAX_RECORDING_BYTES,
  MAX_SCREENSHOT_BYTES,
  adbRecordArgs,
  adbScreenshotArgs,
  androidRecordingPath,
  parseAaptPackage,
  parseAdbDevices,
  parseAvdDisplayName,
  parseDevicePid,
  parseEmulatorProps,
  parseSimctlBooted,
  pngInfo,
  simctlBootedArgs,
  simctlRecordArgs,
  simctlScreenshotArgs,
  statusBarClearArgs,
  statusBarOverrideArgs,
} from "./hostDevices.ts";
import {
  execToFile,
  makeExec,
  outputOf,
  spawnChild,
  stopChild,
  succeeded,
  type ChildProcess,
} from "./process.ts";
import { makeRunStore, mergeSettings, type StoredRun } from "./runStore.ts";

/** Steps kept per flow for `getRun` and live events. */
const MAX_STEPS_PER_FLOW = 500;
const ARGENT_STATUS_TTL_MS = 60_000;
const MAX_FLOW_FILE_BYTES = 256 * 1024;
/** Finished runs kept in memory so a late `runEvents` subscriber still sees the end. */
const RECENT_FINISHED_KEPT = 10;
const RECORDING_START_TIMEOUT_MS = 15_000;
const RECORDING_STOP_GRACE_MS = 30_000;

export type DeviceQaTool = "argent" | "npm" | "xcrun" | "adb" | "aapt" | "plutil";

export interface DeviceQaOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  /** argent's global config is `<homeDir>/.argent/config.json`. */
  readonly homeDir: string;
  /** Tests point these at stubs; by default they are found on PATH and in the Android SDK. */
  readonly tools?: Partial<Record<DeviceQaTool, string>>;
  /** Grace period between SIGTERM and SIGKILL when a run is cancelled. */
  readonly killAfterMs?: number;
}

const error = (reason: DeviceQaError["reason"], message: string) =>
  new DeviceQaError({ reason, message });

const exists = (path: string) =>
  Effect.promise(() =>
    NodeFSP.access(path).then(
      () => true,
      () => false,
    ),
  );

const readOrNull = (path: string) =>
  Effect.promise(() => NodeFSP.readFile(path, "utf8").catch(() => null));

const sizeOrNull = (path: string) =>
  Effect.promise(() =>
    NodeFSP.stat(path).then(
      (stat) => (stat.isFile() ? stat.size : null),
      () => null,
    ),
  );

const removeFile = (path: string) =>
  Effect.promise(() => NodeFSP.rm(path, { force: true, recursive: true }).catch(() => undefined));

const encodeReport = Schema.encodeSync(Schema.fromJsonString(DeviceQaRunDetail));

const adbShell = (serial: string, command: string) => ["-s", serial, "shell", command];

interface LiveRun {
  stored: StoredRun;
  readonly steps: Map<string, Array<DeviceQaStep>>;
  readonly listeners: Set<(event: DeviceQaRunEvent | null) => void>;
  readonly deviceName: string;
  child: ChildProcess | null;
  /** Waiting for the host's argent lock; a cancel then ends the wait. */
  queued: boolean;
  cancelled: boolean;
  finished: boolean;
  readonly cancelWhileQueued: Deferred.Deferred<void>;
  readonly done: Deferred.Deferred<void>;
}

interface ActiveRecording {
  readonly view: DeviceQaActiveRecording;
  item: DeviceQaEvidence;
  readonly startedMs: number;
  readonly cleanStatusBar: boolean;
  /** Ends the capture and leaves the file at `item.path`; returns failure text or null. */
  readonly finish: Effect.Effect<string | null>;
  stopped: Deferred.Deferred<DeviceQaEvidence> | null;
  timer: Fiber.Fiber<unknown, unknown> | null;
}

export const makeWith = (options: DeviceQaOptions) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const queries = yield* ProjectionStore.ProjectionStoreV2;
    const projectStore = yield* ProjectStore.ProjectStoreV2;
    const devices = yield* DeviceService;
    const exec = yield* makeExec;
    const runStore = yield* makeRunStore;
    const evidenceStore = yield* makeEvidenceStore;
    const serviceScope = yield* Effect.scope;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const isMac = options.platform === "darwin";
    const killAfterMs = options.killAfterMs ?? 15_000;

    const root = NodePath.join(config.stateDir, "fork", "device-qa");
    const runsDir = NodePath.join(root, "runs");
    const evidenceRoot = NodePath.join(root, "evidence");
    // Thread ids name folders; encoding keeps any id inside the evidence root.
    const threadDir = (threadId: string) =>
      NodePath.join(evidenceRoot, encodeURIComponent(threadId));

    let settings = yield* runStore.getSettings().pipe(Effect.orDie);
    const hostLock = yield* Semaphore.make(1);
    const runs = new Map<string, LiveRun>();
    const busyDevices = new Set<string>();
    const runListeners = new Set<(projectId: string) => void>();
    const evidenceListeners = new Set<(threadId: string | null) => void>();
    let recording: ActiveRecording | null = null;
    let recordingStarting = false;
    let argentCache: {
      readonly at: number;
      readonly path: string | null;
      readonly version: string | null;
    } | null = null;
    let npmGlobalBin: string | null | undefined;
    let androidSdk: { readonly adb: string; readonly aapt: string | null } | undefined;

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const orDie = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.orDie(effect);
    const toolPath = (name: "xcrun" | "plutil" | "npm") => options.tools?.[name] ?? name;
    const xcrun = toolPath("xcrun");
    const commandPath = (command: string) =>
      resolveCommandPath(command, { env: options.env }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
        Effect.orElseSucceed(() => null),
      );

    // --- Tools -------------------------------------------------------------------------------

    /** adb from the Android SDK (ANDROID_HOME, the default SDK folders) or PATH; aapt beside it. */
    const android = Effect.gen(function* () {
      if (androidSdk !== undefined) return androidSdk;
      const home = options.homeDir;
      const explicit = options.env.ANDROID_HOME?.trim() || options.env.ANDROID_SDK_ROOT?.trim();
      const roots = explicit
        ? [explicit]
        : [NodePath.join(home, "Library", "Android", "sdk"), NodePath.join(home, "Android", "Sdk")];
      let adb = options.tools?.adb ?? null;
      let sdkRoot: string | null = null;
      for (const candidate of roots) {
        if (yield* exists(NodePath.join(candidate, "platform-tools", "adb"))) {
          sdkRoot = candidate;
          adb ??= NodePath.join(candidate, "platform-tools", "adb");
          break;
        }
      }
      adb ??= yield* commandPath("adb");
      if (sdkRoot === null && adb !== null && options.tools?.adb === undefined)
        sdkRoot = NodePath.dirname(NodePath.dirname(adb));
      let aapt = options.tools?.aapt ?? null;
      if (aapt === null && sdkRoot !== null) {
        const versions = yield* Effect.promise(() =>
          NodeFSP.readdir(NodePath.join(sdkRoot, "build-tools")).catch(() => []),
        );
        const newest = versions
          .toSorted((a, b) => a.localeCompare(b, "en", { numeric: true }))
          .at(-1);
        const candidate =
          newest === undefined ? null : NodePath.join(sdkRoot, "build-tools", newest, "aapt");
        if (candidate !== null && (yield* exists(candidate))) aapt = candidate;
      }
      androidSdk = { adb: adb ?? "", aapt };
      return androidSdk;
    });

    const adbPath = android.pipe(Effect.map((sdk) => (sdk.adb === "" ? null : sdk.adb)));
    const requireAdb = adbPath.pipe(
      Effect.filterOrFail(
        (adb): adb is string => adb !== null,
        () => error("unsupported-on-host", "adb was not found on this machine."),
      ),
    );

    /** The argentPath setting, then PATH, then npm's global bin folder (probed once). */
    const locateArgent = Effect.gen(function* () {
      if (settings.argentPath !== null)
        return (yield* exists(settings.argentPath)) ? settings.argentPath : null;
      const onPath = yield* commandPath(options.tools?.argent ?? "argent");
      if (onPath !== null) return onPath;
      if (npmGlobalBin === undefined) {
        const prefix = yield* exec(toolPath("npm"), ["prefix", "-g"], { env: options.env });
        npmGlobalBin = succeeded(prefix) ? NodePath.join(prefix.stdout.trim(), "bin") : null;
      }
      if (npmGlobalBin === null) return null;
      const candidate = NodePath.join(npmGlobalBin, "argent");
      return (yield* exists(candidate)) ? candidate : null;
    });

    const argentProbe = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (argentCache !== null && now - argentCache.at < ARGENT_STATUS_TTL_MS) return argentCache;
      const path = yield* locateArgent;
      const version =
        path === null
          ? null
          : yield* exec(path, ["--version"], { env: argentEnv(options.env) }).pipe(
              Effect.map((result) =>
                succeeded(result) ? parseArgentVersion(result.stdout) : null,
              ),
            );
      argentCache = { at: now, path, version };
      return argentCache;
    });

    const argentStatus = (cwd: string | null) =>
      Effect.gen(function* () {
        const probe = yield* argentProbe;
        const [globalConfig, projectConfig] = yield* Effect.all([
          readOrNull(NodePath.join(options.homeDir, ".argent", "config.json")),
          cwd === null
            ? Effect.succeed(null)
            : readOrNull(NodePath.join(cwd, ".argent", "config.json")),
        ]);
        return {
          installed: probe.path !== null,
          version: probe.version,
          path: probe.path,
          telemetry: telemetryFromConfig({ env: options.env, globalConfig, projectConfig }),
          pinnedVersion: ARGENT_PINNED_VERSION,
        } satisfies DeviceQaArgentStatus;
      });

    const requireArgent = Effect.flatMap(argentProbe, (probe) =>
      probe.path === null
        ? Effect.fail(
            error(
              "argent-missing",
              "argent is not installed on this machine. Install it from the Device QA panel.",
            ),
          )
        : Effect.succeed(probe.path),
    );

    // --- Workspace and devices ---------------------------------------------------------------

    const threadOf = (threadId: ThreadId) =>
      queries
        .getThread(threadId)
        .pipe(Effect.mapError(() => error("not-found", "The thread was not found.")));

    const resolveWorkspace = Effect.fn("DeviceQa.resolveWorkspace")(function* (threadId: ThreadId) {
      const thread = yield* threadOf(threadId).pipe(
        Effect.mapError(() => error("workspace-not-found", "The thread was not found.")),
      );
      const project = yield* projectStore
        .get(thread.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(project))
        return yield* error("workspace-not-found", "This thread has no workspace.");
      const cwd = thread.worktreePath ?? project.value.workspaceRoot;
      if (!(yield* exists(cwd)))
        return yield* error("workspace-not-found", "The thread's workspace folder is missing.");
      return { cwd, projectId: thread.projectId };
    });

    const avdHome =
      options.env.ANDROID_AVD_HOME?.trim() ||
      NodePath.join(
        options.env.ANDROID_USER_HOME?.trim() || NodePath.join(options.homeDir, ".android"),
        "avd",
      );

    /** An AVD's display name, or its id when it has none; null without an AVD. */
    const avdName = (avd: string | null) => {
      if (avd === null) return Effect.succeed(null);
      // The id comes from the device, so it only names a folder when it is a plain AVD id.
      if (!/^[\w.-]+$/.test(avd)) return Effect.succeed(avd);
      return readOrNull(NodePath.join(avdHome, `${avd}.avd`, "config.ini")).pipe(
        Effect.map((config) => (config === null ? null : parseAvdDisplayName(config)) ?? avd),
      );
    };

    /** Booted simulators and running emulators, read directly so the device hub may be off. */
    const localDevices = Effect.gen(function* () {
      const sdk = yield* android;
      const [simulators, adbDevices] = yield* Effect.all(
        [
          isMac ? exec(xcrun, simctlBootedArgs, { timeoutSeconds: 20 }) : Effect.succeed(null),
          sdk.adb === "" ? Effect.succeed(null) : exec(sdk.adb, ["devices", "-l"]),
        ],
        { concurrency: "unbounded" },
      );
      const emulators = succeeded(adbDevices) ? parseAdbDevices(adbDevices.stdout) : [];
      const androidDevices = yield* Effect.forEach(
        emulators,
        (emulator) =>
          Effect.gen(function* () {
            const result = yield* exec(sdk.adb, adbShell(emulator.serial, EMULATOR_PROPS_COMMAND));
            const props = succeeded(result)
              ? parseEmulatorProps(result.stdout)
              : { release: null, avd: null };
            return {
              target: {
                hostId: LOCAL_DEVICE_HOST_ID,
                deviceId: emulator.serial,
                platform: "android",
              },
              // Every emulator of an image shares its model name; the AVD tells them apart.
              name: (yield* avdName(props.avd)) ?? emulator.name,
              version: props.release === null ? "Android" : `Android ${props.release}`,
            } satisfies DeviceQaLocalDevice;
          }),
        { concurrency: "unbounded" },
      );
      return [
        ...(succeeded(simulators) ? parseSimctlBooted(simulators.stdout) : []),
        ...androidDevices,
      ];
    });

    const deviceNameOf = (target: DeviceQaTarget) =>
      Effect.gen(function* () {
        const state = yield* devices.state;
        const known = state.devices.find(
          (device) => device.hostId === target.hostId && device.id === target.deviceId,
        );
        if (known !== undefined) return known.name;
        if (target.hostId !== LOCAL_DEVICE_HOST_ID) return target.deviceId;
        const local = (yield* localDevices).find(
          (device) => device.target.deviceId === target.deviceId,
        );
        return local?.name ?? target.deviceId;
      });

    const requireLocal = (target: DeviceQaTarget, what: string) =>
      target.hostId === LOCAL_DEVICE_HOST_ID
        ? Effect.void
        : Effect.fail(
            error("unsupported-on-host", `${what} works for devices on this machine only.`),
          );

    const requireIos = (target: DeviceQaTarget, what: string) =>
      target.platform === "ios" && isMac
        ? Effect.void
        : Effect.fail(error("unsupported-on-host", `${what} needs an iOS simulator on a Mac.`));

    const failedCommand = (label: string, result: Parameters<typeof outputOf>[0]) =>
      result !== null && result.code === null
        ? error("timeout", `${label} timed out.`)
        : error("command-failed", `${label} failed: ${outputOf(result, "no output")}`);

    // --- Status and flows --------------------------------------------------------------------

    const status = Effect.fn("DeviceQa.status")(function* (threadId: ThreadId) {
      const workspace = yield* resolveWorkspace(threadId).pipe(Effect.orElseSucceed(() => null));
      const [argent, local, adb] = yield* Effect.all(
        [argentStatus(workspace?.cwd ?? null), localDevices, adbPath],
        { concurrency: "unbounded" },
      );
      const simctl = isMac && (yield* commandPath(xcrun)) !== null;
      return {
        argent,
        hostPlatform:
          options.platform === "darwin" ||
          options.platform === "linux" ||
          options.platform === "win32"
            ? options.platform
            : "other",
        tools: { simctl, adb: adb !== null },
        localDevices: local,
        recording: recording?.view ?? null,
      } satisfies DeviceQaStatus;
    });

    const listFlows = Effect.fn("DeviceQa.listFlows")(function* (threadId: ThreadId) {
      const { cwd } = yield* resolveWorkspace(threadId);
      return yield* walkFlows(cwd);
    });

    const readFlow = Effect.fn("DeviceQa.readFlow")(function* (threadId: ThreadId, path: string) {
      const { cwd } = yield* resolveWorkspace(threadId);
      const absolute = resolveFlowPath(cwd, path);
      if (absolute === null)
        return yield* error("invalid-path", "Flows are .yaml files under .argent/flows.");
      const size = yield* sizeOrNull(absolute);
      if (size === null) return yield* error("flow-not-found", `${path} was not found.`);
      if (size > MAX_FLOW_FILE_BYTES)
        return yield* error("invalid-path", `${path} is larger than 256 KB.`);
      const text = yield* readOrNull(absolute);
      if (text === null) return yield* error("flow-not-found", `${path} was not found.`);
      return { path, text };
    });

    // --- Evidence state ----------------------------------------------------------------------

    const publishEvidence = (threadId: string | null) =>
      Effect.sync(() => {
        for (const listener of evidenceListeners) listener(threadId);
      });

    const listEvidence = (threadId: string) =>
      Effect.gen(function* () {
        const [items, totals] = yield* Effect.all([
          evidenceStore.listForThread(threadId),
          evidenceStore.totals(threadId),
        ]);
        return {
          items,
          ...totals,
          recording: recording?.view ?? null,
        } satisfies DeviceQaEvidenceList;
      }).pipe(orDie);

    const newEvidence = (input: {
      readonly threadId: ThreadId;
      readonly kind: DeviceQaEvidence["kind"];
      readonly target: DeviceQaTarget;
      readonly deviceName: string;
      readonly label: string | null;
      readonly createdBy: "user" | "agent";
    }) =>
      Effect.gen(function* () {
        const id = `dqe_${NodeCrypto.randomUUID()}`;
        return {
          id,
          threadId: input.threadId,
          kind: input.kind,
          status: "ready",
          target: input.target,
          deviceName: input.deviceName,
          label: input.label,
          path: null,
          mimeType: null,
          sizeBytes: null,
          width: null,
          height: null,
          durationMs: null,
          detail: null,
          createdBy: input.createdBy,
          createdAt: yield* nowIso,
        } satisfies DeviceQaEvidence;
      });

    /** Only files Loom wrote under the evidence root; flow reports belong to the run history. */
    const removeEvidenceFile = (item: DeviceQaEvidence) =>
      item.kind === "flow-report" ||
      item.path === null ||
      !item.path.startsWith(evidenceRoot + NodePath.sep)
        ? Effect.void
        : removeFile(item.path);

    // --- Runs --------------------------------------------------------------------------------

    const publishRuns = (projectId: string) =>
      Effect.sync(() => {
        for (const listener of runListeners) listener(projectId);
      });

    const emit = (live: LiveRun, event: DeviceQaRunEvent | null) => {
      for (const listener of live.listeners) listener(event);
    };

    const saveRun = (live: LiveRun, run: Partial<DeviceQaRun>, steps = false) =>
      Effect.gen(function* () {
        live.stored = {
          ...live.stored,
          run: { ...live.stored.run, ...run },
          steps: steps ? Object.fromEntries(live.steps) : live.stored.steps,
        };
        yield* runStore.save(live.stored).pipe(orDie);
        yield* publishRuns(live.stored.run.projectId);
      });

    const setFlow = (live: LiveRun, index: number, flow: Partial<DeviceQaFlowRun>) =>
      saveRun(live, {
        flows: live.stored.run.flows.map((entry, at) =>
          at === index ? { ...entry, ...flow } : entry,
        ),
      });

    const evictFinished = () => {
      const finished = [...runs.values()].filter((live) => live.finished);
      for (const live of finished.slice(0, Math.max(0, finished.length - RECENT_FINISHED_KEPT)))
        runs.delete(live.stored.run.id);
    };

    /** Runs one flow file to its end; returns its row. */
    const runFlow = (live: LiveRun, index: number, argent: string, log: NodeFS.WriteStream) =>
      Effect.gen(function* () {
        const { run } = live.stored;
        const path = run.flows[index]!.path;
        const steps: Array<DeviceQaStep> = [];
        live.steps.set(path, steps);
        yield* setFlow(live, index, { status: "running" });
        emit(live, { _tag: "flowStarted", path });
        let last: ArgentRecord | null = null;
        let lastText = "";
        let pending = "";
        const onLine = (line: string) => {
          if (line.trim() === "") return;
          log.write(`${line}\n`);
          const record = parseArgentLine(line);
          if (record._tag === "text") {
            lastText = line.trim();
            return;
          }
          if (record._tag === "progress") {
            const step = stepFromReport(record.step, steps.length);
            if (step !== null && steps.length < MAX_STEPS_PER_FLOW) {
              steps.push(step);
              emit(live, { _tag: "step", path, step });
            }
            return;
          }
          last = record;
        };
        log.write(`$ argent flow run ${path}\n`);
        const child = yield* spawnChild({
          command: argent,
          args: flowRunArgs({
            path,
            deviceId: run.target.deviceId,
            platform: run.target.platform,
            outputDir: NodePath.join(live.stored.runDir, "artifacts"),
            updateBaselines: run.updateBaselines,
          }),
          cwd: live.stored.cwd,
          env: argentEnv(options.env),
          onOutput: (text) => {
            const lines = (pending + text).split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) onLine(line);
          },
        });
        live.child = child;
        const exitCode = yield* child.exit;
        live.child = null;
        onLine(pending);
        const record = last as ArgentRecord | null;
        const status = live.cancelled ? "cancelled" : flowStatusOf(record, exitCode);
        if (record?._tag === "result") {
          steps.splice(
            0,
            steps.length,
            ...stepsFromReport(record.report).slice(0, MAX_STEPS_PER_FLOW),
          );
        }
        const count = (step: DeviceQaStep["status"]) =>
          steps.filter((entry) => entry.status === step).length;
        const report = record?._tag === "result" ? record.report : null;
        const flow: Partial<DeviceQaFlowRun> = {
          status,
          passed: report?.passed ?? count("pass"),
          failed: report?.failed ?? count("fail"),
          skipped: report?.skipped ?? count("skip"),
          errored: report?.errored ?? count("error"),
          durationMs: report?.durationMs ?? null,
          error:
            record?._tag === "error"
              ? record.message
              : status === "error" && report === null
                ? lastText || `argent exited with code ${exitCode ?? "unknown"}.`
                : null,
        };
        yield* setFlow(live, index, flow);
        emit(live, { _tag: "flowFinished", path, status });
      });

    const runStatusOf = (
      flows: ReadonlyArray<DeviceQaFlowRun>,
      cancelled: boolean,
    ): DeviceQaRunStatus => {
      if (cancelled) return "cancelled";
      if (flows.some((flow) => flow.status === "error")) return "error";
      if (flows.some((flow) => flow.status === "failed")) return "failed";
      return "passed";
    };

    const reportLabel = (flows: ReadonlyArray<DeviceQaFlowRun>, status: DeviceQaRunStatus) => {
      if (flows.length === 1) return `${flowLocation(flows[0]!.path).name}: ${status}`;
      const passed = flows.filter((flow) => flow.status === "passed").length;
      const failed = flows.filter(
        (flow) => flow.status === "failed" || flow.status === "error",
      ).length;
      const cancelled = flows.filter((flow) => flow.status === "cancelled").length;
      const counts = `${flows.length} flows: ${passed} passed, ${failed} failed`;
      return cancelled === 0 ? counts : `${counts}, ${cancelled} cancelled`;
    };

    const finishRun = (live: LiveRun) =>
      Effect.gen(function* () {
        const flows = live.stored.run.flows.map((flow) =>
          flow.status === "pending" || flow.status === "running"
            ? { ...flow, status: "cancelled" as const }
            : flow,
        );
        const status = runStatusOf(flows, live.cancelled);
        yield* saveRun(live, { flows, status, finishedAt: yield* nowIso }, true);
        const { run, runDir } = live.stored;
        const reportPath = NodePath.join(runDir, "report.json");
        const detail: DeviceQaRunDetail = { run, steps: Object.fromEntries(live.steps) };
        yield* Effect.promise(() =>
          NodeFSP.writeFile(reportPath, encodeReport(detail)).catch(() => undefined),
        );
        if (run.threadId !== null) {
          const item = yield* newEvidence({
            threadId: run.threadId,
            kind: "flow-report",
            target: run.target,
            deviceName: live.deviceName,
            label: reportLabel(flows, status),
            createdBy: run.startedBy,
          });
          yield* evidenceStore
            .insert({
              ...item,
              // A cancelled run is a user's choice, not a failure.
              status: status === "passed" || status === "cancelled" ? "ready" : "failed",
              path: reportPath,
              mimeType: "application/json",
              sizeBytes: yield* sizeOrNull(reportPath),
              detail: run.id,
            })
            .pipe(orDie);
          yield* publishEvidence(run.threadId);
        }
        const doomed = yield* runStore
          .prune(run.projectId, settings.keepRunsPerProject)
          .pipe(orDie);
        yield* Effect.forEach(doomed, removeFile, { discard: true });
        live.finished = true;
        busyDevices.delete(deviceQaTargetKey(run.target));
        emit(live, { _tag: "runFinished", run: live.stored.run });
        emit(live, null);
        evictFinished();
        yield* Deferred.succeed(live.done, undefined);
        yield* publishRuns(run.projectId);
      });

    const execute = (live: LiveRun, argent: string) =>
      Effect.gen(function* () {
        const log = NodeFS.createWriteStream(NodePath.join(live.stored.runDir, "output.log"), {
          flags: "a",
        });
        log.on("error", () => undefined);
        const body = Effect.gen(function* () {
          live.queued = false;
          for (let index = 0; index < live.stored.run.flows.length; index++) {
            if (live.cancelled) break;
            yield* runFlow(live, index, argent, log);
          }
        });
        // argent's tool-server is shared by the machine: one run at a time per host.
        yield* hostLock
          .withPermits(1)(body)
          .pipe(Effect.raceFirst(Deferred.await(live.cancelWhileQueued)));
        yield* Effect.promise(() => new Promise<void>((resolve) => log.end(() => resolve())));
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Device QA run failed", { cause }).pipe(
            Effect.andThen(
              saveRun(live, {
                flows: live.stored.run.flows.map((flow) =>
                  flow.status === "running"
                    ? {
                        ...flow,
                        status: "error" as const,
                        error: Cause.pretty(cause).split("\n")[0] ?? null,
                      }
                    : flow,
                ),
              }),
            ),
          ),
        ),
        Effect.andThen(finishRun(live)),
        Effect.catchCause((cause) =>
          Effect.logError("Could not finish a Device QA run", { cause }),
        ),
        Effect.ensuring(
          Effect.sync(() => busyDevices.delete(deviceQaTargetKey(live.stored.run.target))),
        ),
      );

    const runFlows = Effect.fn("DeviceQa.runFlows")(function* (
      input: DeviceQaRunFlowsInput,
      startedBy: "user" | "agent",
    ) {
      const { cwd, projectId } = yield* resolveWorkspace(input.threadId);
      const argent = yield* requireArgent;
      for (const path of input.paths) {
        const absolute = resolveFlowPath(cwd, path);
        if (absolute === null)
          return yield* error("invalid-path", `${path} is not a .yaml file under .argent/flows.`);
        if (!isArgentFlowName(flowLocation(path).name))
          return yield* error(
            "invalid-path",
            `argent cannot run ${path}: flow names use letters, numbers, _ and - only.`,
          );
        if (!(yield* exists(absolute)))
          return yield* error("flow-not-found", `${path} was not found.`);
      }
      const local = (yield* localDevices).find(
        (device) =>
          device.target.hostId === input.target.hostId &&
          device.target.deviceId === input.target.deviceId,
      );
      if (local === undefined)
        return yield* error(
          "device-unavailable",
          "Flows run on a booted simulator or a running emulator on this machine.",
        );
      const key = deviceQaTargetKey(input.target);
      if (busyDevices.has(key))
        return yield* error(
          "busy",
          "A flow run is already going on this device. Wait for it or cancel it.",
        );
      busyDevices.add(key);
      return yield* Effect.gen(function* () {
        const id = `dqa_${NodeCrypto.randomUUID()}`;
        const runDir = NodePath.join(runsDir, id);
        yield* Effect.promise(() =>
          NodeFSP.mkdir(NodePath.join(runDir, "artifacts"), { recursive: true }),
        );
        const stored: StoredRun = {
          run: {
            id,
            projectId,
            threadId: input.threadId,
            target: local.target,
            flows: input.paths.map((path) => ({
              path,
              status: "pending",
              passed: 0,
              failed: 0,
              skipped: 0,
              errored: 0,
              durationMs: null,
              error: null,
            })),
            updateBaselines: input.updateBaselines ?? false,
            status: "running",
            startedBy,
            startedAt: yield* nowIso,
            finishedAt: null,
          },
          cwd,
          runDir,
          steps: null,
        };
        yield* runStore.insert(stored).pipe(orDie);
        const live: LiveRun = {
          stored,
          steps: new Map(),
          listeners: new Set(),
          deviceName: local.name,
          child: null,
          queued: true,
          cancelled: false,
          finished: false,
          cancelWhileQueued: yield* Deferred.make<void>(),
          done: yield* Deferred.make<void>(),
        };
        runs.set(id, live);
        yield* publishRuns(projectId);
        yield* execute(live, argent).pipe(Effect.forkIn(serviceScope));
        return stored.run;
      }).pipe(Effect.onError(() => Effect.sync(() => busyDevices.delete(key))));
    });

    const cancelRun = Effect.fn("DeviceQa.cancelRun")(function* (runId: string) {
      const live = runs.get(runId);
      if (live === undefined || live.finished) {
        if ((yield* runStore.get(runId).pipe(orDie)) === null)
          return yield* error("not-found", "The run was not found.");
        return;
      }
      if (live.cancelled) return;
      live.cancelled = true;
      if (live.queued) yield* Deferred.succeed(live.cancelWhileQueued, undefined);
      const child = live.child;
      if (child !== null)
        yield* stopChild(child, "SIGTERM", killAfterMs).pipe(Effect.forkIn(serviceScope));
    });

    const waitForRun = (runId: string, timeoutMs: number) =>
      Effect.gen(function* () {
        const live = runs.get(runId);
        if (live === undefined || live.finished) return true;
        return Option.isSome(
          yield* Deferred.await(live.done).pipe(Effect.timeoutOption(`${timeoutMs} millis`)),
        );
      });

    const getRun = Effect.fn("DeviceQa.getRun")(function* (runId: string) {
      const live = runs.get(runId);
      if (live !== undefined)
        return {
          run: live.stored.run,
          steps: Object.fromEntries(live.steps),
        } satisfies DeviceQaRunDetail;
      const stored = yield* runStore.get(runId).pipe(orDie);
      if (stored === null) return yield* error("not-found", "The run was not found.");
      return { run: stored.run, steps: stored.steps ?? {} } satisfies DeviceQaRunDetail;
    });

    const watchRuns = (threadId: ThreadId) =>
      Stream.unwrap(
        threadOf(threadId).pipe(
          Effect.map(({ projectId }) =>
            Stream.callback<void>(
              (queue) =>
                Effect.acquireRelease(
                  Effect.sync(() => {
                    const listener = (changed: string) => {
                      if (changed === projectId) Queue.offerUnsafe(queue, undefined);
                    };
                    runListeners.add(listener);
                    Queue.offerUnsafe(queue, undefined);
                    return listener;
                  }),
                  (listener) => Effect.sync(() => runListeners.delete(listener)),
                ),
              // Only the newest list matters; bursts of changes collapse into one read.
              { bufferSize: 1, strategy: "sliding" },
            ).pipe(
              Stream.mapEffect(() =>
                runStore.listForProject(projectId).pipe(
                  orDie,
                  Effect.map((rows) => ({ runs: rows.map((row) => row.run) })),
                ),
              ),
            ),
          ),
        ),
      );

    /** The run so far as events, then live events until it ends. */
    const runEvents = (runId: string) =>
      Stream.callback<DeviceQaRunEvent, DeviceQaError>((queue) =>
        Effect.gen(function* () {
          const live = runs.get(runId);
          const detail =
            live === undefined
              ? yield* getRun(runId).pipe(Effect.option)
              : Option.some({ run: live.stored.run, steps: Object.fromEntries(live.steps) });
          if (Option.isNone(detail)) {
            Queue.failCauseUnsafe(queue, Cause.fail(error("not-found", "The run was not found.")));
            return;
          }
          const { run, steps } = detail.value;
          for (const flow of run.flows) {
            if (flow.status === "pending") continue;
            Queue.offerUnsafe(queue, { _tag: "flowStarted", path: flow.path });
            for (const step of steps[flow.path] ?? [])
              Queue.offerUnsafe(queue, { _tag: "step", path: flow.path, step });
            if (flow.status !== "running")
              Queue.offerUnsafe(queue, {
                _tag: "flowFinished",
                path: flow.path,
                status: flow.status,
              });
          }
          if (live === undefined || live.finished) {
            Queue.offerUnsafe(queue, { _tag: "runFinished", run });
            Queue.endUnsafe(queue);
            return;
          }
          const listener = (event: DeviceQaRunEvent | null) => {
            if (event === null) Queue.endUnsafe(queue);
            else Queue.offerUnsafe(queue, event);
          };
          live.listeners.add(listener);
          yield* Effect.addFinalizer(() => Effect.sync(() => live.listeners.delete(listener)));
        }),
      );

    // --- Capture -----------------------------------------------------------------------------

    const screenshotBytes = (target: DeviceQaTarget, file: string) =>
      Effect.gen(function* () {
        if (target.hostId !== LOCAL_DEVICE_HOST_ID) {
          const shot = yield* devices
            .screenshot({ hostId: target.hostId, deviceId: target.deviceId })
            .pipe(Effect.mapError((cause) => error("device-unavailable", cause.message)));
          if (shot.png.byteLength > MAX_SCREENSHOT_BYTES)
            return yield* error("command-failed", "The screenshot is larger than 12 MiB.");
          yield* Effect.promise(() => NodeFSP.writeFile(file, shot.png));
          return;
        }
        if (target.platform === "ios") {
          yield* requireIos(target, "This screenshot");
          const result = yield* exec(xcrun, simctlScreenshotArgs(target.deviceId, file), {
            timeoutSeconds: 30,
          });
          if (!succeeded(result)) return yield* failedCommand("simctl screenshot", result);
          return;
        }
        const adb = yield* requireAdb;
        const result = yield* execToFile({
          command: adb,
          args: adbScreenshotArgs(target.deviceId),
          file,
          env: options.env,
          timeoutMs: 30_000,
        });
        if (!succeeded(result)) return yield* failedCommand("adb screencap", result);
      });

    const withCleanStatusBar = <A, E, R>(
      target: DeviceQaTarget,
      clean: boolean,
      effect: Effect.Effect<A, E, R>,
    ) =>
      clean
        ? exec(xcrun, statusBarOverrideArgs(target.deviceId)).pipe(
            Effect.andThen(effect),
            Effect.ensuring(exec(xcrun, statusBarClearArgs(target.deviceId))),
          )
        : effect;

    const wantsCleanStatusBar = (input: DeviceQaCaptureInput) =>
      input.target.platform === "ios" &&
      input.target.hostId === LOCAL_DEVICE_HOST_ID &&
      isMac &&
      (input.cleanStatusBar ?? settings.defaultCleanStatusBar);

    const screenshot = Effect.fn("DeviceQa.screenshot")(function* (
      input: DeviceQaCaptureInput,
      createdBy: "user" | "agent",
    ) {
      const item = yield* newEvidence({
        threadId: input.threadId,
        kind: "screenshot",
        target: input.target,
        deviceName: yield* deviceNameOf(input.target),
        label: input.label?.trim() || null,
        createdBy,
      });
      const dir = threadDir(input.threadId);
      yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
      const file = NodePath.join(dir, `${item.id}.png`);
      yield* withCleanStatusBar(
        input.target,
        wantsCleanStatusBar(input),
        screenshotBytes(input.target, file),
      ).pipe(Effect.tapError(() => removeFile(file)));
      const size = yield* sizeOrNull(file);
      const bytes =
        size === null || size > MAX_SCREENSHOT_BYTES
          ? null
          : yield* Effect.promise(() => NodeFSP.readFile(file).catch(() => null));
      const info = bytes === null ? null : pngInfo(bytes);
      if (info === null) {
        yield* removeFile(file);
        return yield* error(
          "command-failed",
          size !== null && size > MAX_SCREENSHOT_BYTES
            ? "The screenshot is larger than 12 MiB."
            : "The device did not return a PNG image.",
        );
      }
      const saved: DeviceQaEvidence = {
        ...item,
        path: file,
        mimeType: "image/png",
        sizeBytes: size,
        width: info.width,
        height: info.height,
      };
      yield* evidenceStore.insert(saved).pipe(orDie);
      yield* publishEvidence(input.threadId);
      return saved;
    });

    /** Starts the platform's recorder; returns how to finish it. */
    const startRecorder = (
      target: DeviceQaTarget,
      file: string,
      evidenceId: string,
      seconds: number,
    ) =>
      Effect.gen(function* () {
        if (target.platform === "ios") {
          yield* requireIos(target, "Recording");
          let output = "";
          let markStarted: (started: boolean) => void = () => undefined;
          const started = new Promise<boolean>((resolve) => {
            markStarted = resolve;
          });
          const child = yield* spawnChild({
            command: xcrun,
            args: simctlRecordArgs(target.deviceId, file),
            env: options.env,
            onOutput: (text) => {
              output = (output + text).slice(-4000);
              if (/recording started/i.test(output)) markStarted(true);
            },
          });
          yield* child.exit.pipe(
            Effect.tap(() => Effect.sync(() => markStarted(false))),
            Effect.forkIn(serviceScope),
          );
          const ready = yield* Effect.promise(() => started).pipe(
            Effect.timeoutOption(`${RECORDING_START_TIMEOUT_MS} millis`),
          );
          if (Option.isNone(ready) || !ready.value) {
            yield* stopChild(child, "SIGINT", 2_000);
            return yield* error(
              "command-failed",
              `simctl did not start recording: ${output.trim().slice(-500) || "no output"}`,
            );
          }
          return {
            finish: stopChild(child, "SIGINT", RECORDING_STOP_GRACE_MS).pipe(
              Effect.map((code) => (code === null ? "simctl did not finish the recording." : null)),
            ),
          };
        }
        const adb = yield* requireAdb;
        const devicePath = androidRecordingPath(evidenceId);
        const startedRecording = yield* exec(
          adb,
          adbRecordArgs(target.deviceId, devicePath, seconds),
        );
        const pid = succeeded(startedRecording) ? parseDevicePid(startedRecording.stdout) : null;
        if (pid === null) return yield* failedCommand("adb screenrecord", startedRecording);
        const finish = Effect.gen(function* () {
          yield* exec(adb, adbShell(target.deviceId, `kill -INT ${pid}`));
          // screenrecord writes the file's index after SIGINT; wait for it to exit.
          for (let waited = 0; waited < 10_000; waited += 250) {
            const alive = yield* exec(adb, adbShell(target.deviceId, `kill -0 ${pid}`));
            if (!succeeded(alive)) break;
            yield* Effect.sleep("250 millis");
          }
          const pulled = yield* exec(adb, ["-s", target.deviceId, "pull", devicePath, file], {
            timeoutSeconds: 300,
          });
          yield* exec(adb, adbShell(target.deviceId, `rm -f ${devicePath}`));
          return succeeded(pulled) ? null : `adb pull failed: ${outputOf(pulled, "no output")}`;
        });
        return { finish };
      });

    const startRecording = Effect.fn("DeviceQa.startRecording")(function* (
      input: DeviceQaCaptureInput,
      createdBy: "user" | "agent",
    ) {
      yield* requireLocal(input.target, "Recording");
      if (recording !== null || recordingStarting)
        return yield* error("busy", "A recording is already running. Stop it first.");
      recordingStarting = true;
      return yield* Effect.gen(function* () {
        const seconds = input.maxSeconds ?? DEVICE_QA_MAX_RECORDING_SECONDS;
        const created = yield* newEvidence({
          threadId: input.threadId,
          kind: "recording",
          target: input.target,
          deviceName: yield* deviceNameOf(input.target),
          label: input.label?.trim() || null,
          createdBy,
        });
        const dir = threadDir(input.threadId);
        yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
        const item: DeviceQaEvidence = {
          ...created,
          status: "recording",
          path: NodePath.join(dir, `${created.id}.mp4`),
          mimeType: "video/mp4",
        };
        const clean = wantsCleanStatusBar(input);
        if (clean) yield* exec(xcrun, statusBarOverrideArgs(input.target.deviceId));
        const { finish } = yield* startRecorder(input.target, item.path!, item.id, seconds).pipe(
          Effect.tapError(() =>
            clean ? exec(xcrun, statusBarClearArgs(input.target.deviceId)) : Effect.void,
          ),
        );
        yield* evidenceStore.insert(item).pipe(orDie);
        const active: ActiveRecording = {
          view: {
            evidenceId: item.id,
            threadId: input.threadId,
            target: input.target,
            startedAt: item.createdAt,
          },
          item,
          startedMs: yield* Clock.currentTimeMillis,
          cleanStatusBar: clean,
          finish,
          stopped: null,
          timer: null,
        };
        recording = active;
        active.timer = yield* Effect.sleep(`${seconds} seconds`).pipe(
          Effect.andThen(stopActive(active, true)),
          Effect.ignore,
          Effect.forkIn(serviceScope),
        );
        yield* publishEvidence(null);
        return item;
      }).pipe(Effect.ensuring(Effect.sync(() => (recordingStarting = false))));
    });

    const stopActive = (active: ActiveRecording, fromTimer: boolean) =>
      Effect.gen(function* () {
        if (active.stopped !== null) return yield* Deferred.await(active.stopped);
        const stopped = yield* Deferred.make<DeviceQaEvidence>();
        active.stopped = stopped;
        if (!fromTimer && active.timer !== null) yield* Fiber.interrupt(active.timer);
        active.item = { ...active.item, status: "finalizing" };
        yield* evidenceStore.save(active.item).pipe(orDie);
        yield* publishEvidence(active.view.threadId);
        const failure = yield* active.finish.pipe(
          Effect.catchCause((cause) =>
            Effect.succeed(Cause.pretty(cause).split("\n")[0] ?? "failed"),
          ),
        );
        if (active.cleanStatusBar)
          yield* exec(xcrun, statusBarClearArgs(active.view.target.deviceId));
        const path = active.item.path!;
        const size = yield* sizeOrNull(path);
        const problem =
          failure ??
          (size === null || size === 0
            ? "The recording produced no video."
            : size > MAX_RECORDING_BYTES
              ? "The recording is larger than 1 GiB."
              : null);
        if (problem !== null) yield* removeFile(path);
        const final: DeviceQaEvidence =
          problem === null
            ? {
                ...active.item,
                status: "ready",
                sizeBytes: size,
                durationMs: (yield* Clock.currentTimeMillis) - active.startedMs,
              }
            : { ...active.item, status: "failed", path: null, mimeType: null, detail: problem };
        yield* evidenceStore.save(final).pipe(orDie);
        recording = null;
        yield* Deferred.succeed(stopped, final);
        yield* publishEvidence(null);
        return final;
      });

    const stopRecording = Effect.fn("DeviceQa.stopRecording")(function* (evidenceId: string) {
      const active = recording;
      if (active !== null && active.view.evidenceId === evidenceId)
        return yield* stopActive(active, false);
      const item = yield* evidenceStore.get(evidenceId).pipe(orDie);
      if (item === null) return yield* error("not-found", "The recording was not found.");
      return item;
    });

    const capture = Effect.fn("DeviceQa.capture")(function* (
      input: DeviceQaCaptureInput,
      createdBy: "user" | "agent",
    ) {
      yield* threadOf(input.threadId);
      return input.kind === "screenshot"
        ? yield* screenshot(input, createdBy)
        : yield* startRecording(input, createdBy);
    });

    // --- Install and status bar --------------------------------------------------------------

    const installApp = Effect.fn("DeviceQa.installApp")(function* (
      input: DeviceQaInstallInput,
      createdBy: "user" | "agent",
    ) {
      yield* requireLocal(input.target, "Installing");
      const { cwd } = yield* resolveWorkspace(input.threadId);
      const extension = input.target.platform === "ios" ? ".app" : ".apk";
      const artifact = NodePath.isAbsolute(input.artifactPath)
        ? NodePath.normalize(input.artifactPath)
        : NodePath.resolve(cwd, input.artifactPath);
      if (!NodePath.isAbsolute(input.artifactPath) && !artifact.startsWith(cwd + NodePath.sep))
        return yield* error("invalid-path", "Relative paths must stay inside the workspace.");
      if (!artifact.endsWith(extension))
        return yield* error(
          "invalid-path",
          input.target.platform === "ios"
            ? "Simulators install a .app bundle."
            : "Emulators install an .apk file.",
        );
      if (!(yield* exists(artifact)))
        return yield* error("not-found", `${input.artifactPath} was not found.`);
      const launch = input.launch ?? true;
      let identifier: string | null;
      if (input.target.platform === "ios") {
        yield* requireIos(input.target, "Installing a .app");
        const bundle = yield* exec(toolPath("plutil"), [
          "-extract",
          "CFBundleIdentifier",
          "raw",
          NodePath.join(artifact, "Info.plist"),
        ]);
        identifier = succeeded(bundle) ? bundle.stdout.trim() || null : null;
        if (identifier === null && launch)
          return yield* error("command-failed", "The app's Info.plist has no CFBundleIdentifier.");
        const installed = yield* exec(
          xcrun,
          ["simctl", "install", input.target.deviceId, artifact],
          {
            timeoutSeconds: 300,
          },
        );
        if (!succeeded(installed)) return yield* failedCommand("simctl install", installed);
        if (launch && identifier !== null) {
          const launched = yield* exec(xcrun, [
            "simctl",
            "launch",
            "--terminate-running-process",
            input.target.deviceId,
            identifier,
          ]);
          if (!succeeded(launched)) return yield* failedCommand("simctl launch", launched);
        }
      } else {
        const adb = yield* requireAdb;
        const { aapt } = yield* android;
        const badging =
          aapt === null
            ? null
            : yield* exec(aapt, ["dump", "badging", artifact], { timeoutSeconds: 60 });
        identifier = succeeded(badging) ? parseAaptPackage(badging.stdout) : null;
        if (identifier === null && launch)
          return yield* error(
            "unsupported-on-host",
            "aapt was not found, so Loom cannot tell the package to launch. Install without launching, then launch it from the device.",
          );
        const installed = yield* exec(
          adb,
          ["-s", input.target.deviceId, "install", "-r", artifact],
          {
            timeoutSeconds: 300,
          },
        );
        if (!succeeded(installed) || /Failure/.test(installed.stdout))
          return yield* failedCommand("adb install", installed);
        if (launch && identifier !== null) {
          const launched = yield* exec(
            adb,
            adbShell(
              input.target.deviceId,
              `monkey -p ${identifier} -c android.intent.category.LAUNCHER 1`,
            ),
          );
          if (!succeeded(launched)) return yield* failedCommand("adb launch", launched);
        }
      }
      const item = yield* newEvidence({
        threadId: input.threadId,
        kind: "install",
        target: input.target,
        deviceName: yield* deviceNameOf(input.target),
        label: NodePath.basename(artifact),
        createdBy,
      });
      const saved = { ...item, detail: identifier };
      yield* evidenceStore.insert(saved).pipe(orDie);
      yield* publishEvidence(input.threadId);
      return saved;
    });

    const statusBar = Effect.fn("DeviceQa.statusBar")(function* (
      target: DeviceQaTarget,
      mode: "clean" | "clear",
    ) {
      yield* requireLocal(target, "The clean status bar");
      yield* requireIos(target, "The clean status bar");
      const result = yield* exec(
        xcrun,
        mode === "clean"
          ? statusBarOverrideArgs(target.deviceId)
          : statusBarClearArgs(target.deviceId),
      );
      if (!succeeded(result)) return yield* failedCommand("simctl status_bar", result);
    });

    const disableArgentTelemetry = Effect.gen(function* () {
      const argent = yield* requireArgent;
      const result = yield* exec(argent, ["telemetry", "disable"], { env: argentEnv(options.env) });
      if (!succeeded(result)) return yield* failedCommand("argent telemetry disable", result);
      return yield* argentStatus(null);
    });

    // --- Evidence management -----------------------------------------------------------------

    const isActive = (item: DeviceQaEvidence) =>
      item.status === "recording" || item.status === "finalizing";

    const watchEvidence = (threadId: ThreadId) =>
      Stream.callback<void>(
        (queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const listener = (changed: string | null) => {
                if (changed === null || changed === threadId) Queue.offerUnsafe(queue, undefined);
              };
              evidenceListeners.add(listener);
              Queue.offerUnsafe(queue, undefined);
              return listener;
            }),
            (listener) => Effect.sync(() => evidenceListeners.delete(listener)),
          ),
        { bufferSize: 1, strategy: "sliding" },
      ).pipe(Stream.mapEffect(() => listEvidence(threadId)));

    const deleteEvidence = Effect.fn("DeviceQa.deleteEvidence")(function* (evidenceId: string) {
      const item = yield* evidenceStore.get(evidenceId).pipe(orDie);
      if (item === null) return yield* error("not-found", "The item was not found.");
      if (isActive(item)) return yield* error("busy", "Stop the recording first.");
      yield* removeEvidenceFile(item);
      yield* evidenceStore.delete(item.id).pipe(orDie);
      yield* publishEvidence(item.threadId);
    });

    const deleteAllEvidence = Effect.fn("DeviceQa.deleteAllEvidence")(function* (
      threadId: ThreadId,
    ) {
      const items = yield* evidenceStore.allForThread(threadId).pipe(orDie);
      let deletedCount = 0;
      let freedBytes = 0;
      let skippedActive = 0;
      for (const item of items) {
        if (isActive(item)) {
          skippedActive++;
          continue;
        }
        yield* removeEvidenceFile(item);
        yield* evidenceStore.delete(item.id).pipe(orDie);
        deletedCount++;
        if (item.kind !== "flow-report") freedBytes += item.sizeBytes ?? 0;
      }
      // Leaves the folder when something is still in it.
      yield* Effect.promise(() => NodeFSP.rmdir(threadDir(threadId)).catch(() => undefined));
      yield* publishEvidence(threadId);
      return { deletedCount, freedBytes, skippedActive } satisfies DeviceQaDeleteAllResult;
    });

    /** Removes a thread's evidence rows and folder; stops its recording first. */
    const forgetThread = Effect.fn("DeviceQa.forgetThread")(function* (threadId: string) {
      const active = recording;
      if (active !== null && active.view.threadId === threadId)
        yield* stopActive(active, false).pipe(Effect.ignore);
      yield* evidenceStore.deleteForThread(threadId).pipe(orDie);
      yield* removeFile(threadDir(threadId));
      yield* publishEvidence(threadId);
    });

    /** Evidence of threads that no longer exist, as rows or folders. */
    const forgetMissingThreads = Effect.fn("DeviceQa.forgetMissingThreads")(function* (
      known: ReadonlySet<string>,
    ) {
      const fromRows = yield* evidenceStore.threadIds().pipe(orDie);
      const fromFolders = yield* Effect.promise(() =>
        NodeFSP.readdir(evidenceRoot).catch(() => [] as Array<string>),
      );
      const threads = new Set([
        ...fromRows,
        ...fromFolders.map((name) => decodeURIComponent(name)),
      ]);
      const missing = [...threads].filter((threadId) => !known.has(threadId));
      yield* Effect.forEach(missing, forgetThread, { discard: true });
      return missing.length;
    });

    /** Deletes settled items older than the expiry setting; nothing when expiry is off. */
    const sweepExpired = Effect.gen(function* () {
      const days = settings.evidenceExpireDays;
      if (days === null) return 0;
      const cutoff = expiryCutoff(yield* Clock.currentTimeMillis, days);
      const items = yield* evidenceStore.expired(cutoff).pipe(orDie);
      for (const item of items) {
        yield* removeEvidenceFile(item);
        yield* evidenceStore.delete(item.id).pipe(orDie);
      }
      for (const threadId of new Set(items.map((item) => item.threadId)))
        yield* publishEvidence(threadId);
      return items.length;
    });

    // --- Settings ----------------------------------------------------------------------------

    const updateSettings = Effect.fn("DeviceQa.updateSettings")(function* (
      patch: DeviceQaSettingsPatch,
    ) {
      const previous = settings;
      settings = yield* runStore.updateSettings(mergeSettings(settings, patch)).pipe(orDie);
      if (settings.argentPath !== previous.argentPath) argentCache = null;
      if (settings.evidenceExpireDays !== previous.evidenceExpireDays)
        yield* sweepExpired.pipe(Effect.ignore({ log: true }), Effect.forkIn(serviceScope));
      return settings;
    });

    // --- Startup -----------------------------------------------------------------------------

    yield* Effect.promise(() => NodeFSP.mkdir(runsDir, { recursive: true }));
    yield* runStore.markInterrupted(yield* nowIso).pipe(orDie);
    const stale = yield* evidenceStore.failStaleRecordings().pipe(orDie);
    yield* Effect.forEach(stale, removeEvidenceFile, { discard: true });

    return {
      status,
      listFlows,
      readFlow,
      runFlows,
      cancelRun,
      getRun,
      waitForRun,
      watchRuns,
      runEvents,
      capture,
      stopRecording,
      watchEvidence,
      deleteEvidence,
      deleteAllEvidence,
      installApp,
      statusBar,
      disableArgentTelemetry,
      getSettings: Effect.sync(() => settings),
      updateSettings,
      sweepExpired,
      forgetThread,
      forgetMissingThreads,
      localDevices,
      /** Devices the thread has open in its Device panel, for the agent tools' default. */
      threadDeviceIds: (threadId: ThreadId) =>
        devices
          .sessionsForThread(threadId)
          .pipe(Effect.map((sessions) => sessions.map((session) => session.deviceId as string))),
      /** For agent tools: the project's flows by thread. */
      resolveWorkspace,
      projectRuns: (projectId: ProjectId) =>
        runStore.listForProject(projectId).pipe(
          orDie,
          Effect.map((rows) => rows.map((row) => row.run)),
        ),
    };
  });

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  return yield* makeWith({ platform, env, homeDir: env.HOME || NodeOS.homedir() });
});

export class DeviceQaService extends Context.Service<
  DeviceQaService,
  Effect.Success<typeof make>
>()("t3/fork/device-qa/DeviceQaService") {}

export const layer = Layer.effect(DeviceQaService, make).pipe(Layer.provide(ProcessRunner.layer));
