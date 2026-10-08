import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import {
  AppleBuildError,
  AppleContainer,
  AppleDestination,
  AppleRunKind,
  AppleRunStatus,
  AppleToolchain,
  formatRunSummaryForAgent,
  type AppleRunRequest,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { AppleBuildService } from "./AppleBuildService.ts";

/** The run tool returns `running` with the run id after this; the run keeps going. */
export const AGENT_WAIT_MS = 45 * 60 * 1000;
const LOG_TAIL_LINES = 60;
const RECENT_RUNS = 5;

const failure = Schema.Union([AppleBuildError, OrchestratorMcpFailure]);

const RunToolResult = Schema.Struct({
  runId: Schema.String,
  status: AppleRunStatus,
  durationSec: Schema.Number,
  summaryText: Schema.String,
  logTail: Schema.String,
  resultBundlePath: Schema.NullOr(Schema.String),
});

const StatusToolResult = Schema.Struct({
  cwd: Schema.String,
  toolchain: AppleToolchain,
  containers: Schema.Array(
    Schema.Struct({ ...AppleContainer.fields, schemes: Schema.Array(Schema.String) }),
  ),
  lane: Schema.NullOr(Schema.String),
  recentRuns: Schema.Array(
    Schema.Struct({
      runId: Schema.String,
      kind: AppleRunKind,
      status: AppleRunStatus,
      startedAt: Schema.String,
      startedBy: Schema.String,
      errors: Schema.Int,
      failedTests: Schema.Int,
    }),
  ),
  destinations: Schema.optional(Schema.Array(AppleDestination)),
});

const RunAction = Schema.Literals(["build", "test", "run", "release_build", "generate"]);
type RunAction = typeof RunAction.Type;

const RunParams = Schema.Struct({
  action: RunAction,
  container: Schema.optional(
    Schema.String.annotate({
      description: "Workspace-relative project path; defaults to the only one found.",
    }),
  ),
  scheme: Schema.optional(Schema.String.annotate({ description: "Defaults to the only scheme." })),
  destination: Schema.optional(
    Schema.String.annotate({
      description:
        '"booted", a simulator UDID, a device identifier, "mac" or "generic". Test and run default to the booted simulator.',
    }),
  ),
  only_testing: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description: "Test identifiers, as listed by failed tests in earlier summaries.",
    }),
  ),
});

export const AppleBuildToolingToolkit = Toolkit.make(
  Tool.make("loom_apple_build_tooling_run", {
    description:
      "Build, test, or build and run the Apple app in this thread's workspace with xcodebuild or swift, and return a compact summary (errors with file:line, failed tests). This is the sanctioned way to build: prefer it over running xcodebuild, swift build or xcrun simctl yourself. action=generate runs xcodegen generate. A Package.swift container maps build and test to swift build and swift test. Waits up to 45 minutes; a longer run returns status running with its run id.",
    parameters: RunParams,
    success: RunToolResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Apple build")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_apple_build_tooling_status", {
    description:
      "List Apple projects, schemes, destinations and recent build and test results in this thread's workspace.",
    parameters: Schema.Struct({ include_destinations: Schema.optional(Schema.Boolean) }),
    success: StatusToolResult,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Apple build status")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);

const invalid = (message: string) => new AppleBuildError({ reason: "invalid-request", message });

const callerThread = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext;
  if (invocation.thread === undefined)
    return yield* invalid("Use Apple build tools from an agent running in a Loom project thread.");
  return invocation.thread.threadId;
});

const requireEnabled = (service: AppleBuildService["Service"]) =>
  service.currentSettings.pipe(
    Effect.flatMap((settings) =>
      settings.agentToolsEnabled
        ? Effect.void
        : Effect.fail(
            new AppleBuildError({
              reason: "disabled",
              message: "Apple build tools are turned off in Loom settings.",
            }),
          ),
    ),
  );

const listed = (items: ReadonlyArray<string>) => items.map((item) => `"${item}"`).join(", ");

/** One container: the named one, or the only one that suits the action. */
export const chooseContainer = (
  containers: ReadonlyArray<AppleContainer>,
  action: RunAction,
  path: string | undefined,
) => {
  if (path !== undefined) {
    const named = containers.find((container) => container.path === path);
    return (
      named ?? invalid(`${path} was not found. Found: ${listed(containers.map((c) => c.path))}.`)
    );
  }
  const suitable = containers.filter((container) =>
    action === "generate" ? container.kind === "xcodegen" : true,
  );
  if (suitable.length === 1) return suitable[0]!;
  if (suitable.length === 0)
    return invalid(
      action === "generate"
        ? "No XcodeGen spec was found in this workspace."
        : "No Xcode project, workspace or Package.swift was found in this workspace.",
    );
  return invalid(`Pass container; found ${listed(suitable.map((c) => c.path))}.`);
};

const KIND_BY_ACTION: Record<RunAction, AppleRunKind> = {
  build: "build",
  test: "test",
  run: "run",
  release_build: "releaseBuild",
  generate: "xcodegenGenerate",
};

export const runKindFor = (container: AppleContainer, action: RunAction) => {
  if (container.kind !== "package") return KIND_BY_ACTION[action];
  if (action === "build") return "swiftBuild";
  if (action === "test") return "swiftTest";
  return invalid("A Swift package can only build and test.");
};

export const chooseScheme = (
  schemes: ReadonlyArray<string>,
  container: AppleContainer,
  scheme: string | undefined,
) => {
  if (scheme !== undefined)
    return schemes.includes(scheme)
      ? scheme
      : invalid(`Scheme "${scheme}" was not found. Schemes: ${listed(schemes)}.`);
  if (schemes.length === 1) return schemes[0]!;
  if (schemes.includes(container.name)) return container.name;
  return schemes.length === 0
    ? invalid("The project has no schemes.")
    : invalid(`Pass scheme; found ${listed(schemes)}.`);
};

export const chooseDestination = (
  destinations: ReadonlyArray<AppleDestination>,
  value: string | undefined,
  kind: AppleRunKind,
): AppleDestination | undefined | AppleBuildError => {
  const simulators = destinations.filter(
    (destination): destination is Extract<AppleDestination, { _tag: "simulator" }> =>
      destination._tag === "simulator",
  );
  if (value === undefined) {
    if (kind !== "test" && kind !== "run") return undefined;
    return (
      simulators.find((simulator) => simulator.booted) ??
      simulators[0] ??
      invalid("No simulator is available; pass destination.")
    );
  }
  if (value === "booted")
    return simulators.find((simulator) => simulator.booted) ?? invalid("No simulator is booted.");
  if (value === "mac") return { _tag: "mac" };
  if (value === "generic") return { _tag: "generic", platform: "iOS" };
  return (
    destinations.find(
      (destination) =>
        (destination._tag === "simulator" && destination.udid === value) ||
        (destination._tag === "device" && destination.identifier === value),
    ) ?? invalid(`Destination "${value}" was not found.`)
  );
};

const isBuildError = Schema.is(AppleBuildError);
const orFail = <A>(value: A | AppleBuildError) =>
  isBuildError(value) ? Effect.fail(value) : Effect.succeed(value as A);

const lastLines = (text: string, count: number) => text.split("\n").slice(-count).join("\n");

export const runTool = (threadId: ThreadId, input: typeof RunParams.Type) =>
  withForkRuntime(
    Effect.gen(function* () {
      const service = yield* AppleBuildService;
      yield* requireEnabled(service);
      const workspace = { threadId };
      const status = yield* service.status(workspace);
      const container = yield* orFail(
        chooseContainer(status.containers, input.action, input.container),
      );
      const kind = yield* orFail(runKindFor(container, input.action));
      const xcode =
        kind === "build" || kind === "test" || kind === "run" || kind === "releaseBuild";
      const scheme = xcode
        ? yield* orFail(
            chooseScheme(
              (yield* service.inspect({ workspace, container })).schemes,
              container,
              input.scheme,
            ),
          )
        : undefined;
      const destination =
        xcode && (input.destination !== undefined || kind === "test" || kind === "run")
          ? yield* orFail(chooseDestination(yield* service.destinations(), input.destination, kind))
          : undefined;
      const request: AppleRunRequest = {
        workspace,
        kind,
        container,
        ...(scheme === undefined ? {} : { scheme }),
        ...(destination === undefined ? {} : { destination }),
        ...(input.only_testing?.length ? { onlyTesting: input.only_testing } : {}),
      };
      const run = yield* service.start(request, "agent");
      yield* service.waitForRun(run.id, AGENT_WAIT_MS);
      const detail = yield* service.getRun(run.id, true);
      const finished = detail.run.finishedAt ?? DateTime.formatIso(yield* DateTime.now);
      return {
        runId: run.id,
        status: detail.run.status,
        durationSec: Math.round((Date.parse(finished) - Date.parse(detail.run.startedAt)) / 1000),
        summaryText: formatRunSummaryForAgent(detail.run, detail.summary),
        logTail: lastLines(detail.logTail ?? "", LOG_TAIL_LINES),
        resultBundlePath: detail.resultBundlePath,
      };
    }),
  );

export const statusTool = (threadId: ThreadId, includeDestinations: boolean) =>
  withForkRuntime(
    Effect.gen(function* () {
      const service = yield* AppleBuildService;
      yield* requireEnabled(service);
      const workspace = { threadId };
      const status = yield* service.status(workspace);
      const containers = yield* Effect.forEach(status.containers, (container) =>
        (container.kind === "package"
          ? Effect.succeed<ReadonlyArray<string>>([])
          : service.inspect({ workspace, container }).pipe(
              Effect.map((info) => info.schemes),
              Effect.orElseSucceed((): ReadonlyArray<string> => []),
            )
        ).pipe(Effect.map((schemes) => ({ ...container, schemes }))),
      );
      const runs = yield* service.listRuns(status.cwd);
      return {
        cwd: status.cwd,
        toolchain: status.toolchain,
        containers,
        lane: status.lane?.name ?? null,
        recentRuns: runs.slice(0, RECENT_RUNS).map((run) => ({
          runId: run.id,
          kind: run.kind,
          status: run.status,
          startedAt: run.startedAt,
          startedBy: run.startedBy,
          errors: run.counts.errors,
          failedTests: run.counts.failedTests,
        })),
        ...(includeDestinations ? { destinations: yield* service.destinations() } : {}),
      };
    }),
  );

export const appleBuildToolingHandlers = McpToolAccess.toLayer(
  AppleBuildToolingToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const withRuntime = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_apple_build_tooling_run: McpToolAccess.actsAsCaller((input) =>
        withRuntime(callerThread.pipe(Effect.flatMap((threadId) => runTool(threadId, input)))),
      ),
      loom_apple_build_tooling_status: McpToolAccess.readsAsCaller((input) =>
        withRuntime(
          callerThread.pipe(
            Effect.flatMap((threadId) => statusTool(threadId, input.include_destinations ?? false)),
          ),
        ),
      ),
    };
  }),
);
