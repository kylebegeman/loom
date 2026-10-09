// @effect-diagnostics nodeBuiltinImport:off - Runs append logs and read result bundles on disk.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { ProjectId } from "@t3tools/contracts";
import {
  AppleBuildError,
  type AppleBuildSettingsPatch,
  type AppleBuildSettingsView,
  type AppleContainer,
  type AppleDestination,
  type AppleLogChunk,
  type AppleRunDetail,
  type AppleRunKind,
  type AppleRunPhase,
  type AppleRunRecord,
  type AppleRunRequest,
  type AppleRunSummary,
  type AppleRunsEvent,
  type AppleSchemeInfo,
  type AppleStatus,
  type AppleToolchain,
  type AppleWorkspaceRef,
} from "@t3tools/contracts/fork";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { ProjectLifecycleService } from "../project-lifecycle/ProjectLifecycleService.ts";
import { countsOf, makeRunStore, mergeSettings, type StoredRun } from "./AppleRunStore.ts";
import {
  deviceLaunchSteps,
  isAlreadyBooted,
  listArgs,
  releaseDestination,
  shellQuote,
  showBuildSettingsArgs,
  showTestPlansArgs,
  simulatorLaunchSteps,
  swiftBuildArgs,
  swiftTestArgs,
  xcodebuildArgs,
  xcodegenGenerateArgs,
} from "./commands.ts";
import {
  SIGNING_FAILURE_REASON,
  classifyMissingDestination,
  classifySigningIssue,
  parseCompilerDiagnostics,
  parseTestFailureLines,
} from "./diagnostics.ts";
import {
  findEntries,
  parseSchemeList,
  parseTestPlans,
  walkWorkspace,
  workspaceProjectRefs,
} from "./detect.ts";
import { makeExec, spawnRun, succeeded, terminateTree, type ExecResult } from "./process.ts";
import {
  applicationProduct,
  evaluateReadiness,
  parseBuildSettings,
  type BuildSettingsEntry,
  type LatestRun,
} from "./readiness.ts";
import { parseDevicectlDevices, parseRuntimes, parseSimulators } from "./simulators.ts";
import {
  buildSummaryFromXcresult,
  relativeTo,
  testSummaryFromXcresult,
  withLoggedLocations,
} from "./xcresult.ts";
import { mergeSwiftTestSummary, readXunit } from "./xunit.ts";
import { xcodegenReport } from "./xcodegen.ts";

/** `tailLog` catch-up and `getRun` log tails. */
const LOG_TAIL_CHARS = 256 * 1024;
const LOG_CHUNK_CHARS = 16 * 1024;
const LOG_FLUSH_MS = 250;
/** The end of a log that diagnostics parsing reads; errors come last in a failed build. */
const LOG_PARSE_BYTES = 8 * 1024 * 1024;
const TOOLCHAIN_TTL_MS = 60_000;
/** Finished runs whose display log stays in memory so a live `tailLog` can finish cleanly. */
const RECENT_FINISHED_KEPT = 10;
const JSON_OUTPUT_BYTES = 32 * 1024 * 1024;
const XCODE_GENERIC: ReadonlyArray<AppleDestination> = (
  ["iOS", "iOS Simulator", "visionOS", "watchOS", "tvOS"] as const
).map((platform) => ({ _tag: "generic", platform }));

export type AppleTool =
  | "xcodebuild"
  | "xcrun"
  | "xcodeSelect"
  | "swift"
  | "xcodegen"
  | "xcbeautify"
  | "git"
  | "open"
  | "plutil"
  | "xtool"
  | "du";

const TOOL_NAMES: Record<AppleTool, string> = {
  xcodebuild: "xcodebuild",
  xcrun: "xcrun",
  xcodeSelect: "xcode-select",
  swift: "swift",
  xcodegen: "xcodegen",
  xcbeautify: "xcbeautify",
  git: "git",
  open: "open",
  plutil: "plutil",
  xtool: "xtool",
  du: "du",
};

export interface AppleBuildOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  /** Tests point these at stubs; by default the tools are found on PATH. */
  readonly tools?: Partial<Record<AppleTool, string>>;
  /** Grace period between SIGTERM and SIGKILL when a run is cancelled. */
  readonly killAfterMs?: number;
}

const error = (reason: AppleBuildError["reason"], message: string) =>
  new AppleBuildError({ reason, message });

const exists = (path: string) =>
  Effect.promise(() =>
    NodeFSP.access(path).then(
      () => true,
      () => false,
    ),
  );

const readOrNull = (path: string) =>
  Effect.promise(() => NodeFSP.readFile(path, "utf8").catch(() => null));

/** The last `maxBytes` of a file as text, starting at a line boundary when it was cut. */
const readTail = (path: string, maxBytes: number) =>
  Effect.promise(async () => {
    const handle = await NodeFSP.open(path, "r").catch(() => null);
    if (handle === null) return "";
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const text = buffer.toString("utf8");
      if (length === size) return text;
      const newline = text.indexOf("\n");
      return newline === -1 ? text : text.slice(newline + 1);
    } finally {
      await handle.close();
    }
  });

const hashOf = (text: string) =>
  NodeCrypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

const lastText = (result: ExecResult | null, fallback: string) => {
  const text = (result?.stderr.trim() || result?.stdout.trim() || "").slice(-2000);
  return text === "" ? fallback : text;
};

/** devicectl's error JSON is not documented; take the most readable field present. */
const devicectlError = (result: ExecResult | null) => {
  try {
    const parsed: unknown = JSON.parse(result?.stdout ?? "");
    const failure = (parsed as { error?: unknown } | null)?.error;
    if (typeof failure === "object" && failure !== null) {
      const info = (failure as { userInfo?: Record<string, unknown> }).userInfo;
      const description =
        info?.NSLocalizedDescription ??
        (failure as { description?: unknown }).description ??
        (failure as { localizedDescription?: unknown }).localizedDescription;
      if (typeof description === "string") return description;
    }
  } catch {
    // Fall back to the text output.
  }
  return lastText(result, "The device could not be reached.");
};

type LogEvent = { readonly offset: number; readonly text: string } | null;

interface LiveRun {
  stored: StoredRun;
  /** The display stream (xcbeautify output when it is on): the last 256 KB of it. */
  ring: string;
  /** Characters emitted on the display stream so far; `tailLog` offsets count these. */
  emitted: number;
  readonly listeners: Set<(event: LogEvent) => void>;
  readonly log: NodeFS.WriteStream;
  pid: number | null;
  cancelled: boolean;
  finished: boolean;
  readonly done: Deferred.Deferred<void>;
}

interface Outcome {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly summary: AppleRunSummary;
  readonly resultBundlePath: string | null;
}

interface Lane {
  readonly name: string;
  readonly spacePath: string;
  readonly tmpPath: string;
  readonly buildPath: string;
  readonly xcodebuild: string;
  readonly slot: string;
}

export const makeWith = (options: AppleBuildOptions) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const queries = yield* ProjectionStore.ProjectionStoreV2;
    const projectStore = yield* ProjectStore.ProjectStoreV2;
    const devices = yield* DeviceService;
    const lifecycle = yield* ProjectLifecycleService;
    const exec = yield* makeExec;
    const store = yield* makeRunStore;
    const serviceScope = yield* Effect.scope;
    const tool = (name: AppleTool) => options.tools?.[name] ?? TOOL_NAMES[name];
    const isMac = options.platform === "darwin";

    const root = NodePath.join(config.stateDir, "fork", "apple-build-tooling");
    const runsDir = NodePath.join(root, "runs");
    const derivedRoot = NodePath.join(root, "derived");
    const scratchDir = NodePath.join(root, "tmp");
    const derivedPathFor = (cwd: string) => NodePath.join(derivedRoot, hashOf(cwd));

    let settings = yield* store.getSettings().pipe(Effect.orDie);
    const activeByCwd = new Map<string, string>();
    const recent = new Map<string, LiveRun>();
    const runListeners = new Set<(cwd: string | null) => void>();
    const inspectCache = new Map<string, AppleSchemeInfo>();
    let toolchainCache: { readonly at: number; readonly value: AppleToolchain } | null = null;

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const orDie = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.orDie(effect);
    const requireMac = isMac
      ? Effect.void
      : Effect.fail(error("unsupported-platform", "Xcode builds need a Mac environment."));

    // --- Workspace ---------------------------------------------------------------------------

    const resolveWorkspace = Effect.fn("AppleBuild.resolveWorkspace")(function* (
      ref: AppleWorkspaceRef,
    ) {
      const thread = yield* queries
        .getThread(ref.threadId)
        .pipe(Effect.mapError(() => error("workspace-not-found", "The thread was not found.")));
      const project = yield* projectStore
        .get(thread.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(project))
        return yield* error("workspace-not-found", "This thread has no workspace.");
      const cwd = thread.worktreePath ?? project.value.workspaceRoot;
      if (!(yield* exists(cwd)))
        return yield* error("workspace-not-found", "The thread's workspace folder is missing.");
      return { cwd, projectId: thread.projectId, threadId: ref.threadId };
    });

    /** Containers come from the server's own walk; a client-sent path is only a key. */
    const findContainer = Effect.fn("AppleBuild.findContainer")(function* (
      cwd: string,
      requested: Pick<AppleContainer, "kind" | "path">,
    ) {
      const { containers } = yield* walkWorkspace(cwd);
      const found = containers.find(
        (container) => container.path === requested.path && container.kind === requested.kind,
      );
      if (found === undefined)
        return yield* error("container-not-found", `${requested.path} was not found.`);
      return { found, containers };
    });

    // --- Toolchain ---------------------------------------------------------------------------

    const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() || null;
    const versionOf = (result: ExecResult | null) =>
      succeeded(result) ? firstLine(result.stdout || result.stderr) : null;

    const probeToolchain = Effect.gen(function* () {
      if (!isMac) {
        const xtool =
          options.platform === "linux" ? yield* exec(tool("xtool"), ["--version"]) : null;
        return {
          platform: options.platform === "linux" ? "linux" : "other",
          xcodeVersion: null,
          developerDir: null,
          developerDirIsCommandLineTools: false,
          firstLaunchPending: false,
          runtimes: [],
          tools: {
            xcodegen: null,
            xcbeautify: null,
            mcpbridge: false,
            mcpServerHeadless: null,
            xtool: versionOf(xtool),
          },
        } satisfies AppleToolchain;
      }
      const [version, select, firstLaunch, runtimes, xcodegen, xcbeautify, mcpbridge, mcpServer] =
        yield* Effect.all(
          [
            exec(tool("xcodebuild"), ["-version"]),
            exec(tool("xcodeSelect"), ["-p"]),
            exec(tool("xcodebuild"), ["-checkFirstLaunchStatus"]),
            exec(tool("xcrun"), ["simctl", "list", "runtimes", "-j"]),
            exec(tool("xcodegen"), ["--version"]),
            exec(tool("xcbeautify"), ["--version"]),
            exec(tool("xcrun"), ["--find", "mcpbridge"]),
            exec(tool("xcrun"), ["mcp-server", "status"]),
          ],
          { concurrency: "unbounded" },
        );
      const versionLines = succeeded(version) ? version.stdout.trim().split("\n") : [];
      const build = versionLines[1]?.replace(/^Build version\s*/, "").trim();
      const developerDir = succeeded(select) ? select.stdout.trim() || null : null;
      return {
        platform: "darwin",
        xcodeVersion:
          versionLines[0] === undefined
            ? null
            : build
              ? `${versionLines[0].trim()} (${build})`
              : versionLines[0].trim(),
        developerDir,
        developerDirIsCommandLineTools: developerDir?.includes("CommandLineTools") ?? false,
        firstLaunchPending: succeeded(version) && firstLaunch !== null && firstLaunch.code !== 0,
        runtimes: succeeded(runtimes) ? parseRuntimes(runtimes.stdout) : [],
        tools: {
          xcodegen: versionOf(xcodegen),
          xcbeautify: versionOf(xcbeautify),
          mcpbridge: succeeded(mcpbridge),
          mcpServerHeadless: versionOf(mcpServer),
          xtool: null,
        },
      } satisfies AppleToolchain;
    });

    const toolchain = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (toolchainCache !== null && now - toolchainCache.at < TOOLCHAIN_TTL_MS)
        return toolchainCache.value;
      const value = yield* probeToolchain;
      toolchainCache = { at: now, value };
      return value;
    });

    const xcodegenPath = toolchain.pipe(
      Effect.map((chain) => (chain.tools.xcodegen === null ? null : tool("xcodegen"))),
    );

    // --- Status, inspect, destinations -------------------------------------------------------

    const status = Effect.fn("AppleBuild.status")(function* (ref: AppleWorkspaceRef) {
      const { cwd } = yield* resolveWorkspace(ref);
      const [chain, walk, lane] = yield* Effect.all(
        [
          toolchain,
          walkWorkspace(cwd),
          lifecycle.currentBuildEnvironment(cwd).pipe(Effect.orElseSucceed(() => null)),
        ],
        { concurrency: "unbounded" },
      );
      return {
        cwd,
        toolchain: chain,
        containers: walk.containers,
        truncated: walk.truncated,
        lane: lane === null ? null : { name: lane.name, buildPath: lane.buildPath },
      } satisfies AppleStatus;
    });

    const failedCommand = (label: string, result: ExecResult | null) =>
      result !== null && result.code === null
        ? error("timeout", `${label} timed out.`)
        : error("command-failed", `${label} failed: ${lastText(result, "no output")}`);

    /** Shared schemes of a project, or of a workspace and the projects it references. */
    const sharedSchemes = Effect.fn("AppleBuild.sharedSchemes")(function* (
      cwd: string,
      container: AppleContainer,
    ) {
      const projectPath =
        container.kind === "xcodegen" ? container.generatedProjectPath : container.path;
      if (projectPath === undefined) return [];
      const absolute = NodePath.join(cwd, projectPath);
      const holders = [absolute];
      if (container.kind === "workspace") {
        const contents = yield* readOrNull(NodePath.join(absolute, "contents.xcworkspacedata"));
        for (const ref of workspaceProjectRefs(contents ?? ""))
          holders.push(NodePath.resolve(NodePath.dirname(absolute), ref));
      }
      const names = yield* Effect.promise(() =>
        Promise.all(
          holders.map((holder) =>
            NodeFSP.readdir(NodePath.join(holder, "xcshareddata", "xcschemes")).catch(() => []),
          ),
        ),
      );
      return [
        ...new Set(
          names
            .flat()
            .filter((name) => name.endsWith(".xcscheme"))
            .map((name) => name.slice(0, -".xcscheme".length)),
        ),
      ].sort();
    });

    const EMPTY_SCHEME_INFO: AppleSchemeInfo = {
      schemes: [],
      targets: [],
      configurations: [],
      testPlans: [],
      sharedSchemes: [],
    };

    const inspectContainer = Effect.fn("AppleBuild.inspectContainer")(function* (
      cwd: string,
      container: AppleContainer,
      scheme: string | undefined,
      refresh: boolean,
    ) {
      const list = listArgs(container);
      if (list === null) return EMPTY_SCHEME_INFO;
      const key = `${cwd}\n${container.path}\n${scheme ?? ""}`;
      const cached = inspectCache.get(key);
      if (cached !== undefined && !refresh) return cached;
      const listed = yield* exec(tool("xcodebuild"), list, {
        cwd,
        timeoutSeconds: 120,
        maxOutputBytes: JSON_OUTPUT_BYTES,
      });
      if (!succeeded(listed)) return yield* failedCommand("xcodebuild -list", listed);
      const plans =
        scheme === undefined
          ? null
          : yield* exec(tool("xcodebuild"), showTestPlansArgs(container, scheme)!, {
              cwd,
              timeoutSeconds: 120,
            });
      const info: AppleSchemeInfo = {
        ...parseSchemeList(listed.stdout),
        testPlans: succeeded(plans) ? parseTestPlans(plans.stdout) : [],
        sharedSchemes: yield* sharedSchemes(cwd, container),
      };
      inspectCache.set(key, info);
      return info;
    });

    const inspect = Effect.fn("AppleBuild.inspect")(function* (input: {
      readonly workspace: AppleWorkspaceRef;
      readonly container: AppleContainer;
      readonly scheme?: string | undefined;
      readonly refresh?: boolean | undefined;
    }) {
      yield* requireMac;
      const { cwd } = yield* resolveWorkspace(input.workspace);
      const { found } = yield* findContainer(cwd, input.container);
      return yield* inspectContainer(cwd, found, input.scheme, input.refresh ?? false);
    });

    const forgetInspections = (cwd: string) =>
      Effect.sync(() => {
        for (const key of inspectCache.keys())
          if (key.startsWith(`${cwd}\n`)) inspectCache.delete(key);
      });

    const destinations = Effect.fn("AppleBuild.destinations")(function* () {
      yield* requireMac;
      const [simulators, physical] = yield* Effect.all(
        [
          exec(tool("xcrun"), ["simctl", "list", "devices", "available", "-j"], {
            timeoutSeconds: 30,
            maxOutputBytes: JSON_OUTPUT_BYTES,
          }),
          // No devices or no permission gives an empty list, never an error.
          exec(tool("xcrun"), ["devicectl", "list", "devices", "--json-output", "-"], {
            timeoutSeconds: 30,
            maxOutputBytes: JSON_OUTPUT_BYTES,
          }),
        ],
        { concurrency: "unbounded" },
      );
      return [
        ...(succeeded(simulators) ? parseSimulators(simulators.stdout) : []),
        ...(succeeded(physical) ? parseDevicectlDevices(physical.stdout) : []),
        { _tag: "mac" },
        ...XCODE_GENERIC,
      ] satisfies ReadonlyArray<AppleDestination>;
    });

    // --- XcodeGen and readiness --------------------------------------------------------------

    const xcodegenFor = Effect.fn("AppleBuild.xcodegenFor")(function* (cwd: string, spec: string) {
      yield* findContainer(cwd, { kind: "xcodegen", path: spec });
      return yield* xcodegenReport({
        exec,
        xcodegen: yield* xcodegenPath,
        cwd,
        spec,
        scratchDir,
      });
    });

    const xcodegen = Effect.fn("AppleBuild.xcodegen")(function* (input: {
      readonly workspace: AppleWorkspaceRef;
      readonly spec: string;
    }) {
      const { cwd } = yield* resolveWorkspace(input.workspace);
      return yield* xcodegenFor(cwd, input.spec);
    });

    const latestRun = (cwd: string, kind: AppleRunKind) =>
      store.latestFinished(cwd, kind).pipe(
        orDie,
        Effect.map(
          (stored): LatestRun | null =>
            stored && { status: stored.run.status, finishedAt: stored.run.finishedAt },
        ),
      );

    const readiness = Effect.fn("AppleBuild.readiness")(function* (input: {
      readonly workspace: AppleWorkspaceRef;
      readonly container: AppleContainer;
      readonly scheme: string;
    }) {
      yield* requireMac;
      const { cwd } = yield* resolveWorkspace(input.workspace);
      const { found, containers } = yield* findContainer(cwd, input.container);
      const settingsArgs = showBuildSettingsArgs({
        container: found,
        scheme: input.scheme,
        configuration: "Release",
        derivedDataPath: null,
      });
      const shown =
        settingsArgs === null
          ? null
          : yield* exec(tool("xcodebuild"), settingsArgs, {
              cwd,
              timeoutSeconds: 120,
              maxOutputBytes: JSON_OUTPUT_BYTES,
            });
      const entries = succeeded(shown) ? parseBuildSettings(shown.stdout) : [];
      const app =
        entries.find(
          (entry) => entry.buildSettings.PRODUCT_TYPE === "com.apple.product-type.application",
        ) ?? entries[0];
      const buildSettings = app?.buildSettings ?? {};

      const sourceRoot = buildSettings.SRCROOT ?? cwd;
      const plist = buildSettings.INFOPLIST_FILE
        ? NodePath.resolve(sourceRoot, buildSettings.INFOPLIST_FILE)
        : null;
      const iconName = buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME || null;
      const found_ = yield* findEntries(
        sourceRoot,
        (name, isDirectory) =>
          name === "PrivacyInfo.xcprivacy" ||
          (iconName !== null &&
            ((isDirectory && name === `${iconName}.appiconset`) || name === `${iconName}.icon`)),
      );
      let appIconFound: boolean | null = null;
      if (iconName !== null) {
        appIconFound = found_.some((path) => path.endsWith(`${iconName}.icon`));
        for (const path of found_.filter((candidate) => candidate.endsWith(".appiconset"))) {
          const contents = yield* readOrNull(NodePath.join(path, "Contents.json"));
          if (contents?.includes("1024")) appIconFound = true;
        }
      }
      const encryptionInPlist =
        plist === null
          ? false
          : succeeded(
              yield* exec(tool("plutil"), [
                "-extract",
                "ITSAppUsesNonExemptEncryption",
                "raw",
                plist,
              ]),
            );

      const spec =
        found.kind === "xcodegen"
          ? found
          : containers.find(
              (container) =>
                container.kind === "xcodegen" && container.generatedProjectPath === found.path,
            );
      const [gitStatus, lastCommit, xcodegenState, schemes, latestReleaseBuild, latestTest] =
        yield* Effect.all(
          [
            exec(tool("git"), ["status", "--porcelain"], { cwd }),
            exec(tool("git"), ["log", "-1", "--format=%cI"], { cwd }),
            spec === undefined
              ? Effect.succeed(null)
              : xcodegenFor(cwd, spec.path).pipe(Effect.map((report) => report.state)),
            inspectContainer(cwd, found, undefined, false).pipe(
              Effect.orElseSucceed(() => EMPTY_SCHEME_INFO),
            ),
            latestRun(cwd, "releaseBuild"),
            latestRun(cwd, "test"),
          ],
          { concurrency: "unbounded" },
        );
      return evaluateReadiness({
        buildSettings,
        schemeShared: schemes.sharedSchemes.includes(input.scheme),
        appIconFound,
        privacyManifestFound: found_.some((path) => path.endsWith("PrivacyInfo.xcprivacy")),
        infoPlistDeclaresEncryption:
          buildSettings.INFOPLIST_KEY_ITSAppUsesNonExemptEncryption !== undefined ||
          encryptionInPlist,
        gitClean: succeeded(gitStatus) ? gitStatus.stdout.trim() === "" : null,
        xcodegen: xcodegenState,
        lastCommitAt: succeeded(lastCommit) ? lastCommit.stdout.trim() || null : null,
        latestReleaseBuild,
        latestTest,
      });
    });

    // --- Run state ---------------------------------------------------------------------------

    const publishRuns = (cwd: string | null) =>
      Effect.sync(() => {
        for (const listener of runListeners) listener(cwd);
      });

    const listRuns = (cwd: string) =>
      store.listForCwd(cwd).pipe(
        orDie,
        Effect.map((rows): AppleRunsEvent => ({ runs: rows.map((row) => row.run) })),
      );

    const update = (live: LiveRun, run: Partial<AppleRunRecord>, rest: Partial<StoredRun> = {}) =>
      Effect.gen(function* () {
        live.stored = { ...live.stored, ...rest, run: { ...live.stored.run, ...run } };
        yield* store.save(live.stored).pipe(orDie);
        yield* publishRuns(live.stored.run.cwd);
      });

    const setPhase = (live: LiveRun, phase: AppleRunPhase, commandLine?: string) =>
      update(live, commandLine === undefined ? { phase } : { phase, commandLine });

    const display = (live: LiveRun, text: string) => {
      const offset = live.emitted;
      live.emitted += text.length;
      live.ring = (live.ring + text).slice(-LOG_TAIL_CHARS);
      for (const listener of live.listeners) listener({ offset, text });
    };

    /** Text that goes to the raw log and, unbeautified, to the display stream. */
    const note = (live: LiveRun, text: string) => {
      live.log.write(text);
      display(live, text);
    };

    /** One long-running command; output streams to the log. Returns null when it never ran. */
    const step = (
      live: LiveRun,
      command: string,
      args: ReadonlyArray<string>,
      input: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly beautify: boolean },
    ) =>
      Effect.gen(function* () {
        if (live.cancelled) return null;
        note(live, `$ ${shellQuote([command, ...args])}\n`);
        const beautifier = input.beautify
          ? yield* spawnRun({
              command: tool("xcbeautify"),
              args: ["--disable-colored-output", "--disable-logging", "--preserve-unbeautified"],
              cwd: input.cwd,
              env: options.env,
              stdin: true,
              onOutput: (text) => display(live, text),
            })
          : null;
        const child = yield* spawnRun({
          command,
          args,
          cwd: input.cwd,
          env: input.env,
          onOutput: (text) => {
            live.log.write(text);
            if (beautifier === null) display(live, text);
            else beautifier.write(text);
          },
        });
        live.pid = child.pid;
        const code = yield* child.exit;
        live.pid = null;
        if (beautifier !== null) {
          beautifier.write(null);
          yield* beautifier.exit.pipe(Effect.timeoutOption("5 seconds"));
        }
        return code;
      });

    /** A short command whose output is appended to the log once it finishes. */
    const quickStep = (
      live: LiveRun,
      command: string,
      args: ReadonlyArray<string>,
      input: {
        readonly cwd: string;
        readonly env: NodeJS.ProcessEnv;
        readonly timeoutSeconds: number;
      },
    ) =>
      Effect.gen(function* () {
        if (live.cancelled) return null;
        note(live, `$ ${shellQuote([command, ...args])}\n`);
        const result = yield* exec(command, args, input);
        const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
        if (output !== "") note(live, output.endsWith("\n") ? output : `${output}\n`);
        if (result !== null && result.code === null) note(live, "Timed out.\n");
        return result;
      });

    const readLogForParsing = (live: LiveRun) =>
      readTail(NodePath.join(live.stored.runDir, "log.txt"), LOG_PARSE_BYTES);

    const buildFromLog = (log: string, cwd: string, ok: boolean) => {
      const issues = parseCompilerDiagnostics(log, cwd);
      return {
        status: ok ? "succeeded" : "failed",
        errorCount: issues.filter((issue) => issue.severity === "error").length,
        warningCount: issues.filter((issue) => issue.severity !== "error").length,
        issues,
      };
    };

    /** Swift Testing logs name only the file; use the file of that name under `root` when unique. */
    const locateTestFiles = (
      tests: NonNullable<AppleRunSummary["tests"]>,
      root: string,
      cwd: string,
    ) =>
      Effect.gen(function* () {
        const bare = new Set(
          tests.failures.flatMap((failure) =>
            failure.file !== undefined && !failure.file.includes("/") ? [failure.file] : [],
          ),
        );
        if (bare.size === 0) return tests;
        const found = yield* findEntries(
          root,
          (name, isDirectory) => !isDirectory && bare.has(name),
        );
        const paths = new Map<string, Array<string>>();
        for (const path of found) {
          const name = NodePath.basename(path);
          paths.set(name, [...(paths.get(name) ?? []), path]);
        }
        return {
          ...tests,
          failures: tests.failures.map((failure) => {
            const matches = failure.file === undefined ? undefined : paths.get(failure.file);
            return matches?.length === 1
              ? { ...failure, file: relativeTo(cwd, matches[0]!) }
              : failure;
          }),
        };
      });

    // --- Pipelines ---------------------------------------------------------------------------

    const failure = (
      exitCode: number | null,
      failureReason: string,
      rest: Partial<AppleRunSummary> = {},
      resultBundlePath: string | null = null,
    ): Outcome => ({
      ok: false,
      exitCode,
      summary: { ...rest, failureReason },
      resultBundlePath,
    });

    const xcodebuildInvocation = (lane: Lane | null, args: ReadonlyArray<string>) => {
      // The lane's shim adds the lane's DerivedData and takes a build slot.
      if (lane !== null && settings.derivedData === "loom")
        return { command: lane.xcodebuild, args };
      if (lane !== null) return { command: lane.slot, args: [tool("xcodebuild"), ...args] };
      return { command: tool("xcodebuild"), args };
    };

    const buildSettingsFor = (
      cwd: string,
      env: NodeJS.ProcessEnv,
      lane: Lane | null,
      input: Parameters<typeof showBuildSettingsArgs>[0],
    ) =>
      Effect.gen(function* () {
        const args = showBuildSettingsArgs(input);
        if (args === null) return { entries: [] as Array<BuildSettingsEntry>, result: null };
        // Read-only, so never a build slot; the shim still supplies the lane's DerivedData.
        const command =
          lane !== null && settings.derivedData === "loom" ? lane.xcodebuild : tool("xcodebuild");
        const result = yield* exec(command, args, {
          cwd,
          env,
          timeoutSeconds: 120,
          maxOutputBytes: JSON_OUTPUT_BYTES,
        });
        return { entries: succeeded(result) ? parseBuildSettings(result.stdout) : [], result };
      });

    const launchApp = (
      live: LiveRun,
      cwd: string,
      env: NodeJS.ProcessEnv,
      destination: AppleDestination,
      app: { readonly appPath: string; readonly bundleId: string },
    ) =>
      Effect.gen(function* () {
        const launched = { launched: { ...app, destination } };
        switch (destination._tag) {
          case "simulator": {
            const steps = simulatorLaunchSteps(destination.udid, app.appPath, app.bundleId);
            const quick = (args: ReadonlyArray<string>, timeoutSeconds: number) =>
              quickStep(live, tool("xcrun"), args, { cwd, env, timeoutSeconds });
            const boot = yield* quick(steps.boot, 120);
            if (!succeeded(boot) && !isAlreadyBooted(`${boot?.stdout}${boot?.stderr}`))
              return failure(
                boot?.code ?? null,
                `Could not boot the simulator: ${lastText(boot, "")}`,
              );
            const ready = yield* quick(steps.bootstatus, 300);
            if (!succeeded(ready))
              return failure(ready?.code ?? null, "The simulator did not finish booting.");
            yield* setPhase(live, "installing");
            const install = yield* quick(steps.install, 300);
            if (!succeeded(install))
              return failure(install?.code ?? null, `Install failed: ${lastText(install, "")}`);
            yield* setPhase(live, "launching");
            const launch = yield* quick(steps.launch, 120);
            if (!succeeded(launch))
              return failure(launch?.code ?? null, `Launch failed: ${lastText(launch, "")}`);
            const threadId = live.stored.run.threadId;
            if (settings.openLaunchedSimulatorInDevicePanel && threadId !== null)
              // A convenience: the device hub may be off or the simulator not supported there, and
              // nothing it does may fail a run that already launched.
              yield* Effect.suspend(() =>
                devices.open({
                  threadId,
                  deviceId: destination.udid,
                  platform: "ios",
                  boot: false,
                }),
              ).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Could not open the simulator in the Device panel", { cause }),
                ),
              );
            return { ok: true, exitCode: 0, summary: launched, resultBundlePath: null };
          }
          case "device": {
            const steps = deviceLaunchSteps(destination.identifier, app.appPath, app.bundleId);
            yield* setPhase(live, "installing");
            const install = yield* quickStep(live, tool("xcrun"), steps.install, {
              cwd,
              env,
              timeoutSeconds: 600,
            });
            if (!succeeded(install))
              return failure(install?.code ?? null, devicectlError(install), {
                hint: "device-unavailable",
              });
            yield* setPhase(live, "launching");
            const launch = yield* quickStep(live, tool("xcrun"), steps.launch, {
              cwd,
              env,
              timeoutSeconds: 120,
            });
            if (!succeeded(launch))
              return failure(launch?.code ?? null, devicectlError(launch), {
                hint: "device-unavailable",
              });
            return { ok: true, exitCode: 0, summary: launched, resultBundlePath: null };
          }
          case "mac": {
            yield* setPhase(live, "launching");
            const open = yield* quickStep(live, tool("open"), ["-n", app.appPath], {
              cwd,
              env,
              timeoutSeconds: 30,
            });
            if (!succeeded(open))
              return failure(open?.code ?? null, `Launch failed: ${lastText(open, "")}`);
            return { ok: true, exitCode: 0, summary: launched, resultBundlePath: null };
          }
          case "generic":
            return failure(null, "Choose a simulator, device or this Mac to run on.");
        }
      });

    const xcodePipeline = (
      live: LiveRun,
      request: AppleRunRequest,
      container: AppleContainer,
      env: NodeJS.ProcessEnv,
      lane: Lane | null,
    ) =>
      Effect.gen(function* () {
        const { cwd, runDir } = { cwd: live.stored.run.cwd, runDir: live.stored.runDir };
        const scheme = request.scheme!;
        const derivedDataPath =
          lane === null && settings.derivedData === "loom" ? derivedPathFor(cwd) : null;
        let effective = request;
        if (request.kind === "releaseBuild" && request.destination === undefined) {
          const { entries } = yield* buildSettingsFor(cwd, env, lane, {
            container,
            scheme,
            configuration: "Release",
            derivedDataPath,
          });
          const platforms = (
            entries.find(
              (entry) => entry.buildSettings.PRODUCT_TYPE === "com.apple.product-type.application",
            ) ?? entries[0]
          )?.buildSettings.SUPPORTED_PLATFORMS;
          effective = { ...request, destination: releaseDestination(platforms) };
        }
        const action = request.kind === "test" ? "test" : "build";
        const resultBundlePath = NodePath.join(runDir, "Result.xcresult");
        const args = xcodebuildArgs(
          effective,
          action,
          { derivedDataPath, resultBundlePath },
          settings,
        );
        if (args === null) return failure(null, "This project cannot be built with xcodebuild.");
        const chain = yield* toolchain;
        const invocation = xcodebuildInvocation(lane, args);
        yield* setPhase(
          live,
          action === "test" ? "testing" : "building",
          shellQuote(["xcodebuild", ...args]),
        );
        const code = yield* step(live, invocation.command, invocation.args, {
          cwd,
          env,
          beautify: settings.useXcbeautify && chain.tools.xcbeautify !== null,
        });

        yield* setPhase(live, "summarizing");
        const bundle = (yield* exists(resultBundlePath)) ? resultBundlePath : null;
        let build: AppleRunSummary["build"];
        let tests: AppleRunSummary["tests"];
        if (bundle !== null) {
          const buildJson = yield* exec(
            tool("xcrun"),
            ["xcresulttool", "get", "build-results", "--path", bundle, "--compact"],
            { timeoutSeconds: 60, maxOutputBytes: JSON_OUTPUT_BYTES },
          );
          build = succeeded(buildJson)
            ? buildSummaryFromXcresult(buildJson.stdout, cwd)
            : undefined;
          if (action === "test") {
            const testJson = yield* exec(
              tool("xcrun"),
              ["xcresulttool", "get", "test-results", "summary", "--path", bundle, "--compact"],
              { timeoutSeconds: 60, maxOutputBytes: JSON_OUTPUT_BYTES },
            );
            tests = succeeded(testJson) ? testSummaryFromXcresult(testJson.stdout) : undefined;
            if (tests) {
              const failureLines = parseTestFailureLines(yield* readLogForParsing(live), cwd);
              tests = yield* locateTestFiles(withLoggedLocations(tests, failureLines), cwd, cwd);
            }
          }
        }
        build ??= buildFromLog(yield* readLogForParsing(live), cwd, code === 0);
        const summary: AppleRunSummary = { build, ...(tests ? { tests } : {}) };
        if (code !== 0) {
          const onDevice = effective.destination?._tag === "device";
          return {
            ok: false,
            exitCode: code,
            summary:
              onDevice && classifySigningIssue(build.issues)
                ? { ...summary, hint: "signing", failureReason: SIGNING_FAILURE_REASON }
                : onDevice && classifyMissingDestination(build.issues)
                  ? { ...summary, hint: "device-unavailable" }
                  : code === null && !live.cancelled
                    ? { ...summary, failureReason: "xcodebuild could not run." }
                    : summary,
            resultBundlePath: bundle,
          } satisfies Outcome;
        }
        if (request.kind !== "run")
          return { ok: true, exitCode: 0, summary, resultBundlePath: bundle };

        const destination = effective.destination!;
        const { entries, result } = yield* buildSettingsFor(cwd, env, lane, {
          container,
          scheme,
          configuration: effective.configuration,
          destination,
          derivedDataPath,
        });
        if (!succeeded(result))
          return failure(
            result?.code ?? null,
            `Could not read the scheme's build settings: ${lastText(result, "")}`,
            summary,
            bundle,
          );
        const product = applicationProduct(entries);
        if ("error" in product) return failure(0, product.error, summary, bundle);
        const launched = yield* launchApp(live, cwd, env, destination, product);
        return {
          ...launched,
          summary: { ...summary, ...launched.summary },
          resultBundlePath: bundle,
        } satisfies Outcome;
      });

    const swiftPipeline = (
      live: LiveRun,
      request: AppleRunRequest,
      container: AppleContainer,
      env: NodeJS.ProcessEnv,
      lane: Lane | null,
    ) =>
      Effect.gen(function* () {
        const { cwd, runDir } = { cwd: live.stored.run.cwd, runDir: live.stored.runDir };
        const packageDir = NodePath.dirname(NodePath.join(cwd, container.path));
        const testing = request.kind === "swiftTest";
        const args = testing ? swiftTestArgs(runDir, request.onlyTesting) : swiftBuildArgs();
        yield* setPhase(live, testing ? "testing" : "building", shellQuote(["swift", ...args]));
        const code = yield* step(
          live,
          lane === null ? tool("swift") : lane.slot,
          lane === null ? args : [tool("swift"), ...args],
          { cwd: packageDir, env, beautify: false },
        );
        yield* setPhase(live, "summarizing");
        const log = yield* readLogForParsing(live);
        let tests: AppleRunSummary["tests"];
        if (testing) {
          const [xctest, swiftTesting] = yield* Effect.all([
            readOrNull(NodePath.join(runDir, "xunit.xml")),
            readOrNull(NodePath.join(runDir, "xunit-swift-testing.xml")),
          ]);
          tests = mergeSwiftTestSummary(
            xctest === null ? null : readXunit(xctest),
            swiftTesting === null ? null : readXunit(swiftTesting),
            parseTestFailureLines(log, cwd),
          );
          if (tests) tests = yield* locateTestFiles(tests, packageDir, cwd);
        }
        // Results exist only when the build succeeded; failing tests alone are not a build failure.
        const build = buildFromLog(log, cwd, code === 0 || tests !== undefined);
        return {
          ok: code === 0,
          exitCode: code,
          summary: {
            build,
            ...(tests ? { tests } : {}),
            ...(code === null && !live.cancelled ? { failureReason: "swift could not run." } : {}),
          },
          resultBundlePath: null,
        } satisfies Outcome;
      });

    const xcodegenPipeline = (live: LiveRun, container: AppleContainer, env: NodeJS.ProcessEnv) =>
      Effect.gen(function* () {
        const cwd = live.stored.run.cwd;
        const specPath = NodePath.join(cwd, container.path);
        const args = xcodegenGenerateArgs(
          NodePath.basename(specPath),
          NodePath.join(root, "xcodegen-cache", hashOf(specPath)),
        );
        yield* setPhase(live, "building", shellQuote(["xcodegen", ...args]));
        const code = yield* step(live, tool("xcodegen"), args, {
          cwd: NodePath.dirname(specPath),
          env,
          beautify: false,
        });
        if (code !== 0)
          return failure(
            code,
            code === null && !live.cancelled
              ? "xcodegen could not run."
              : "XcodeGen failed; see the log.",
          );
        yield* forgetInspections(cwd);
        const { containers } = yield* walkWorkspace(cwd);
        const generated = containers.find(
          (candidate) => candidate.path === container.path,
        )?.generatedProjectPath;
        return {
          ok: true,
          exitCode: 0,
          summary: { xcodegen: { generatedProject: generated ?? "" } },
          resultBundlePath: null,
        } satisfies Outcome;
      });

    const pipeline = (live: LiveRun, request: AppleRunRequest, container: AppleContainer) =>
      Effect.gen(function* () {
        const threadId = live.stored.run.threadId;
        const lane: Lane | null =
          threadId === null
            ? null
            : yield* lifecycle.buildEnvironment(threadId).pipe(Effect.orElseSucceed(() => null));
        if (lane !== null) note(live, `Building in lane ${lane.name}.\n`);
        const env: NodeJS.ProcessEnv = {
          ...options.env,
          NSUnbufferedIO: "YES",
          ...(lane === null
            ? {}
            : {
                LOOM_LANE_BUILD: lane.buildPath,
                LOOM_LANE_SPACE: lane.spacePath,
                LOOM_LANE_TMP: lane.tmpPath,
                TMPDIR: `${lane.tmpPath}/`,
              }),
        };
        switch (request.kind) {
          case "swiftBuild":
          case "swiftTest":
            return yield* swiftPipeline(live, request, container, env, lane);
          case "xcodegenGenerate":
            return yield* xcodegenPipeline(live, container, env);
          default:
            return yield* xcodePipeline(live, request, container, env, lane);
        }
      });

    // --- Run lifecycle -----------------------------------------------------------------------

    const removeRunDirs = (dirs: ReadonlyArray<string>) =>
      Effect.promise(() =>
        Promise.all(
          dirs
            .filter((dir) => dir.startsWith(`${runsDir}${NodePath.sep}`))
            .map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })),
        ),
      );

    /** A waiting agent may start the next run as soon as one finishes; never free its lock. */
    const releaseLock = (cwd: string, runId: string) => {
      if (activeByCwd.get(cwd) === runId) activeByCwd.delete(cwd);
    };

    const evictRecent = () => {
      const finished = [...recent.values()].filter((live) => live.finished);
      for (const live of finished.slice(0, Math.max(0, finished.length - RECENT_FINISHED_KEPT)))
        recent.delete(live.stored.run.id);
    };

    const retain = (projectId: ProjectId) =>
      Effect.gen(function* () {
        const projects = yield* projectStore.listShells().pipe(orDie);
        const removed = yield* store
          .prune(
            projectId,
            settings.keepRunsPerProject,
            projects.map((project) => project.id),
          )
          .pipe(orDie);
        yield* removeRunDirs(removed);
      });

    const finish = (live: LiveRun, outcome: Outcome) =>
      Effect.gen(function* () {
        const finishedAt = yield* nowIso;
        const status = live.cancelled ? "cancelled" : outcome.ok ? "succeeded" : "failed";
        note(
          live,
          `\n${status === "succeeded" ? "Succeeded" : status === "cancelled" ? "Cancelled" : "Failed"}.\n`,
        );
        yield* update(
          live,
          {
            status,
            phase: "done",
            finishedAt,
            exitCode: outcome.exitCode,
            counts: countsOf(outcome.summary),
            hasResultBundle: outcome.resultBundlePath !== null,
          },
          { summary: outcome.summary, resultBundlePath: outcome.resultBundlePath },
        );
        yield* Effect.promise(() => new Promise<void>((resolve) => live.log.end(() => resolve())));
        live.finished = true;
        for (const listener of live.listeners) listener(null);
        evictRecent();
        // Pruning finishes before waiters wake, so they see the history as it stays.
        yield* retain(live.stored.run.projectId).pipe(Effect.ignore({ log: true }));
        releaseLock(live.stored.run.cwd, live.stored.run.id);
        yield* Deferred.succeed(live.done, undefined);
        yield* publishRuns(live.stored.run.cwd);
      });

    const execute = (live: LiveRun, request: AppleRunRequest, container: AppleContainer) =>
      pipeline(live, request, container).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Apple build run failed", { cause }).pipe(
            Effect.as(
              failure(null, `The run stopped unexpectedly: ${Cause.pretty(cause).split("\n")[0]}`),
            ),
          ),
        ),
        Effect.flatMap((outcome) => finish(live, outcome)),
        Effect.catchCause((cause) =>
          Effect.logError("Could not finish an Apple build run", { cause }),
        ),
        Effect.ensuring(Effect.sync(() => releaseLock(live.stored.run.cwd, live.stored.run.id))),
      );

    /** Checks the request against what is on disk; returns the request with the server's container. */
    const prepare = Effect.fn("AppleBuild.prepare")(function* (
      request: AppleRunRequest,
      cwd: string,
    ) {
      const kind = request.kind;
      const swift = kind === "swiftBuild" || kind === "swiftTest";
      if (!swift) yield* requireMac;
      if (request.container === undefined)
        return yield* error("invalid-request", "Choose a project first.");
      const { found } = yield* findContainer(cwd, request.container);
      if (swift) {
        if (found.kind !== "package")
          return yield* error("invalid-request", "swift build and test need a Package.swift.");
      } else if (kind === "xcodegenGenerate") {
        if (found.kind !== "xcodegen")
          return yield* error("invalid-request", "XcodeGen generate needs an XcodeGen spec.");
        if ((yield* xcodegenPath) === null)
          return yield* error(
            "tool-missing",
            "XcodeGen is not installed. Install it with `brew install xcodegen`.",
          );
      } else {
        if (found.kind === "package")
          return yield* error("invalid-request", "Use swift build or swift test for a package.");
        if (found.kind === "xcodegen" && found.generatedProjectPath === undefined)
          return yield* error("invalid-request", "Generate the project with XcodeGen first.");
        if (!request.scheme) return yield* error("invalid-request", "Choose a scheme first.");
        if (
          kind === "run" &&
          (request.destination === undefined || request.destination._tag === "generic")
        )
          return yield* error(
            "invalid-request",
            "Choose a simulator, device or this Mac to run on.",
          );
      }
      return { ...request, container: found } satisfies AppleRunRequest;
    });

    const start = Effect.fn("AppleBuild.start")(function* (
      input: AppleRunRequest,
      startedBy: "user" | "agent",
    ) {
      const workspace = yield* resolveWorkspace(input.workspace);
      const { cwd } = workspace;
      const request = yield* prepare(input, cwd);
      const id = `abt_${NodeCrypto.randomUUID()}`;
      const holder = activeByCwd.get(cwd);
      if (holder !== undefined)
        return yield* error(
          "busy",
          `Run ${holder} is still going in this workspace. Wait for it or cancel it first.`,
        );
      activeByCwd.set(cwd, id);
      return yield* Effect.gen(function* () {
        const runDir = NodePath.join(runsDir, id);
        yield* Effect.promise(() => NodeFSP.mkdir(runDir, { recursive: true }));
        const stored: StoredRun = {
          run: {
            id,
            projectId: workspace.projectId,
            threadId: workspace.threadId,
            cwd,
            kind: request.kind,
            request,
            status: "running",
            phase: "resolving",
            startedBy,
            startedAt: yield* nowIso,
            finishedAt: null,
            exitCode: null,
            commandLine: "",
            counts: { errors: 0, warnings: 0, failedTests: 0 },
            hasResultBundle: false,
          },
          runDir,
          summary: null,
          resultBundlePath: null,
        };
        yield* store.insert(stored).pipe(orDie);
        const live: LiveRun = {
          stored,
          ring: "",
          emitted: 0,
          listeners: new Set(),
          log: NodeFS.createWriteStream(NodePath.join(runDir, "log.txt"), { flags: "a" }),
          pid: null,
          cancelled: false,
          finished: false,
          done: yield* Deferred.make<void>(),
        };
        live.log.on("error", () => undefined);
        recent.set(id, live);
        yield* publishRuns(cwd);
        yield* execute(live, request, request.container!).pipe(Effect.forkIn(serviceScope));
        return stored.run;
      }).pipe(Effect.onError(() => Effect.sync(() => releaseLock(cwd, id))));
    });

    const cancel = Effect.fn("AppleBuild.cancel")(function* (runId: string) {
      const live = recent.get(runId);
      if (live === undefined || live.finished) {
        const stored = yield* store.get(runId).pipe(orDie);
        if (stored === null) return yield* error("run-not-found", "The run was not found.");
        return;
      }
      if (live.cancelled) return;
      live.cancelled = true;
      note(live, "\nCancelling...\n");
      if (live.pid !== null)
        yield* terminateTree(exec, live.pid, options.killAfterMs).pipe(Effect.forkIn(serviceScope));
    });

    const waitForRun = (runId: string, timeoutMs: number) =>
      Effect.gen(function* () {
        const live = recent.get(runId);
        if (live === undefined || live.finished) return true;
        return Option.isSome(
          yield* Deferred.await(live.done).pipe(Effect.timeoutOption(`${timeoutMs} millis`)),
        );
      });

    const getRun = Effect.fn("AppleBuild.getRun")(function* (
      runId: string,
      includeLogTail = false,
    ) {
      const stored = yield* store.get(runId).pipe(orDie);
      if (stored === null) return yield* error("run-not-found", "The run was not found.");
      const logPath = NodePath.join(stored.runDir, "log.txt");
      return {
        run: stored.run,
        summary: stored.summary,
        logPath,
        resultBundlePath: stored.resultBundlePath,
        ...(includeLogTail ? { logTail: yield* readTail(logPath, LOG_TAIL_CHARS) } : {}),
      } satisfies AppleRunDetail;
    });

    const watchRuns = (ref: AppleWorkspaceRef) =>
      Stream.unwrap(
        resolveWorkspace(ref).pipe(
          Effect.map(({ cwd }) =>
            Stream.callback<void>(
              (queue) =>
                Effect.acquireRelease(
                  Effect.sync(() => {
                    const listener = (changed: string | null) => {
                      if (changed === null || changed === cwd) Queue.offerUnsafe(queue, undefined);
                    };
                    runListeners.add(listener);
                    Queue.offerUnsafe(queue, undefined);
                    return listener;
                  }),
                  (listener) => Effect.sync(() => runListeners.delete(listener)),
                ),
              // Only the newest list matters; bursts of changes collapse into one read.
              { bufferSize: 1, strategy: "sliding" },
            ).pipe(Stream.mapEffect(() => listRuns(cwd))),
          ),
        ),
      );

    /** Coalesced chunks from `fromOffset`, live until the run ends. */
    const tailLog = (runId: string, fromOffset: number) =>
      Stream.callback<AppleLogChunk, AppleBuildError>((queue) =>
        Effect.gen(function* () {
          const live = recent.get(runId);
          if (live === undefined) {
            const stored = yield* store.get(runId).pipe(orDie);
            if (stored === null) {
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(error("run-not-found", "The run was not found.")),
              );
              return;
            }
            // Older runs are served from the raw log; offsets restart at its tail.
            const text =
              fromOffset === 0
                ? yield* readTail(NodePath.join(stored.runDir, "log.txt"), LOG_TAIL_CHARS)
                : "";
            Queue.offerUnsafe(queue, { offset: fromOffset, text, done: true });
            Queue.endUnsafe(queue);
            return;
          }
          const ringStart = live.emitted - live.ring.length;
          let pendingOffset = Math.max(fromOffset, ringStart);
          let pending = live.ring.slice(pendingOffset - ringStart);
          const send = (text: string, done: boolean) => {
            Queue.offerUnsafe(queue, { offset: pendingOffset, text, done });
            pendingOffset += text.length;
          };
          /** Sends what is pending in chunks; when done, the last (maybe empty) one says so. */
          const flush = (done: boolean) => {
            while (pending.length > LOG_CHUNK_CHARS) {
              send(pending.slice(0, LOG_CHUNK_CHARS), false);
              pending = pending.slice(LOG_CHUNK_CHARS);
            }
            if (done || pending.length > 0) send(pending, done);
            pending = "";
            if (done) Queue.endUnsafe(queue);
          };
          if (live.finished) return flush(true);
          const listener = (event: LogEvent) => {
            if (event === null) return flush(true);
            const next = pendingOffset + pending.length;
            const skip = next - event.offset;
            if (skip < event.text.length) pending += event.text.slice(Math.max(0, skip));
          };
          live.listeners.add(listener);
          // @effect-diagnostics-next-line globalTimersInEffect:off - flushes from Node stream callbacks.
          const timer = setInterval(() => {
            if (pending.length > 0) flush(false);
          }, LOG_FLUSH_MS);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              clearInterval(timer);
              live.listeners.delete(listener);
            }),
          );
          if (pending.length > 0) flush(false);
        }),
      );

    // --- Settings and storage ----------------------------------------------------------------

    const sizeOf = (path: string) =>
      exec(tool("du"), ["-sk", path], { timeoutSeconds: 30 }).pipe(
        Effect.map((result) =>
          succeeded(result) ? (Number.parseInt(result.stdout, 10) || 0) * 1024 : 0,
        ),
      );

    const getSettings = Effect.gen(function* () {
      const [runCount, runsBytes, derivedDataBytes] = yield* Effect.all(
        [store.countRuns().pipe(orDie), sizeOf(runsDir), sizeOf(derivedRoot)],
        { concurrency: "unbounded" },
      );
      return {
        settings,
        storage: { runCount, runsBytes, derivedDataBytes },
      } satisfies AppleBuildSettingsView;
    });

    const updateSettings = Effect.fn("AppleBuild.updateSettings")(function* (
      patch: AppleBuildSettingsPatch,
    ) {
      const next = mergeSettings(settings, patch);
      settings = yield* store.updateSettings(next).pipe(orDie);
      return settings;
    });

    const clearHistory = Effect.fn("AppleBuild.clearHistory")(function* (input: {
      readonly projectId?: ProjectId | undefined;
      readonly includeDerivedData?: boolean | undefined;
    }) {
      const affected = (live: LiveRun) =>
        input.projectId === undefined || live.stored.run.projectId === input.projectId;
      const running = [...recent.values()].find((live) => !live.finished && affected(live));
      if (running !== undefined)
        return yield* error("busy", "A run is still going. Wait for it or cancel it first.");
      if (input.includeDerivedData) {
        if (input.projectId === undefined)
          yield* Effect.promise(() => NodeFSP.rm(derivedRoot, { recursive: true, force: true }));
        else {
          const project = yield* projectStore
            .get(input.projectId)
            .pipe(Effect.orElseSucceed(() => Option.none()));
          const cwds = new Set(yield* store.cwdsForProject(input.projectId).pipe(orDie));
          if (Option.isSome(project)) cwds.add(project.value.workspaceRoot);
          yield* Effect.promise(() =>
            Promise.all(
              [...cwds].map((cwd) =>
                NodeFSP.rm(derivedPathFor(cwd), { recursive: true, force: true }),
              ),
            ),
          );
        }
      }
      yield* removeRunDirs(yield* store.clear(input.projectId).pipe(orDie));
      for (const live of recent.values())
        if (live.finished && affected(live)) recent.delete(live.stored.run.id);
      yield* publishRuns(null);
    });

    const openResultBundle = Effect.fn("AppleBuild.openResultBundle")(function* (runId: string) {
      yield* requireMac;
      const { resultBundlePath } = yield* getRun(runId);
      if (resultBundlePath === null || !(yield* exists(resultBundlePath)))
        return yield* error("run-not-found", "This run has no result bundle.");
      const opened = yield* exec(tool("open"), [resultBundlePath]);
      if (!succeeded(opened)) return yield* failedCommand("open", opened);
    });

    // --- Startup -----------------------------------------------------------------------------

    yield* store.markInterrupted(yield* nowIso).pipe(orDie);
    yield* Effect.promise(() =>
      Promise.all([
        NodeFSP.mkdir(runsDir, { recursive: true }),
        NodeFSP.rm(scratchDir, { recursive: true, force: true }),
      ]),
    );

    return {
      status,
      inspect,
      destinations,
      xcodegen,
      readiness,
      start,
      cancel,
      getRun,
      waitForRun,
      watchRuns,
      tailLog,
      getSettings,
      updateSettings,
      clearHistory,
      openResultBundle,
      /** For agent tools: the current settings without storage sizes. */
      currentSettings: Effect.sync(() => settings),
      listRuns: (cwd: string) => listRuns(cwd).pipe(Effect.map((event) => event.runs)),
      resolveWorkspace,
    };
  });

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  return yield* makeWith({ platform, env });
});

export class AppleBuildService extends Context.Service<
  AppleBuildService,
  Effect.Success<typeof make>
>()("t3/fork/apple-build-tooling/AppleBuildService") {}

export const layer = Layer.effect(AppleBuildService, make).pipe(Layer.provide(ProcessRunner.layer));
