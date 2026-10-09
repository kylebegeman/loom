import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  DEFAULT_APPLE_BUILD_SETTINGS,
  type AppleBuildError,
  type AppleContainer,
  type AppleDestination,
  type AppleRunDetail,
  type AppleRunRecord,
  type AppleRunRequest,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext, type McpCapability } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { AppleBuildService } from "./AppleBuildService.ts";
import {
  AppleBuildToolingToolkit,
  appleBuildToolingHandlers,
  chooseContainer,
  chooseDestination,
  chooseScheme,
  runKindFor,
} from "./mcp.ts";

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected service call: ${String(key)}`);
    },
  });
}

const threadId = ThreadId.make("apple-thread");
const PROJECT: AppleContainer = { kind: "project", path: "App.xcodeproj", name: "App" };
const PACKAGE: AppleContainer = { kind: "package", path: "Package.swift", name: "Pkg" };
const SPEC: AppleContainer = {
  kind: "xcodegen",
  path: "project.yml",
  name: "Gen",
  generatedProjectPath: "Gen.xcodeproj",
};
const SHUTDOWN: AppleDestination = {
  _tag: "simulator",
  udid: "SIM-A",
  name: "Phone A",
  runtime: "iOS 27.0",
  booted: false,
};
const BOOTED: AppleDestination = { ...SHUTDOWN, udid: "SIM-B", name: "Phone B", booted: true };

const reasonOf = (value: unknown) => (value as AppleBuildError | undefined)?.reason;

describe("argument defaults", () => {
  it("picks the only container, or the named one", () => {
    expect(chooseContainer([PROJECT], "build", undefined)).toBe(PROJECT);
    expect(chooseContainer([PROJECT, SPEC], "generate", undefined)).toBe(SPEC);
    expect(chooseContainer([PROJECT, PACKAGE], "build", "Package.swift")).toBe(PACKAGE);
    expect(reasonOf(chooseContainer([PROJECT, PACKAGE], "build", undefined))).toBe(
      "invalid-request",
    );
    expect(reasonOf(chooseContainer([PROJECT], "build", "Other.xcodeproj"))).toBe(
      "invalid-request",
    );
    expect(reasonOf(chooseContainer([PROJECT], "generate", undefined))).toBe("invalid-request");
  });

  it("maps package build and test to swift and refuses the rest", () => {
    expect(runKindFor(PACKAGE, "build")).toBe("swiftBuild");
    expect(runKindFor(PACKAGE, "test")).toBe("swiftTest");
    expect(reasonOf(runKindFor(PACKAGE, "run"))).toBe("invalid-request");
    expect(runKindFor(PROJECT, "release_build")).toBe("releaseBuild");
    expect(runKindFor(SPEC, "generate")).toBe("xcodegenGenerate");
  });

  it("picks the only scheme or the one named after the container", () => {
    expect(chooseScheme(["App"], PROJECT, undefined)).toBe("App");
    expect(chooseScheme(["App", "AppTests"], PROJECT, undefined)).toBe("App");
    expect(chooseScheme(["One", "Two"], PROJECT, "Two")).toBe("Two");
    expect(reasonOf(chooseScheme(["One", "Two"], PROJECT, undefined))).toBe("invalid-request");
    expect(reasonOf(chooseScheme(["One"], PROJECT, "Missing"))).toBe("invalid-request");
  });

  it("defaults test and run to the booted simulator", () => {
    expect(chooseDestination([SHUTDOWN, BOOTED], undefined, "test")).toBe(BOOTED);
    expect(chooseDestination([SHUTDOWN], undefined, "run")).toBe(SHUTDOWN);
    expect(chooseDestination([SHUTDOWN, BOOTED], undefined, "build")).toBeUndefined();
    expect(chooseDestination([SHUTDOWN, BOOTED], "SIM-A", "build")).toBe(SHUTDOWN);
    expect(chooseDestination([], "mac", "run")).toEqual({ _tag: "mac" });
    expect(chooseDestination([], "generic", "build")).toEqual({ _tag: "generic", platform: "iOS" });
    expect(reasonOf(chooseDestination([SHUTDOWN], "booted", "test"))).toBe("invalid-request");
    expect(reasonOf(chooseDestination([], undefined, "run"))).toBe("invalid-request");
  });
});

const callerLayer = Layer.succeed(
  ThreadManagement.ThreadManagementService,
  partial<ThreadManagement.ThreadManagementService["Service"]>({
    getThreadShell: (id) =>
      Effect.succeed(
        partial<OrchestrationV2ThreadShell>({
          id,
          deletedAt: null,
          archivedAt: null,
          activeRunId: RunId.make("apple-run"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
      ),
  }),
);

const invocation = {
  environmentId: EnvironmentId.make("test"),
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  requestNamespace: "apple-test",
  capabilities: new Set<McpCapability>(),
  issuedAt: 0,
};

const record = (request: AppleRunRequest): AppleRunRecord => ({
  id: "abt_1",
  projectId: ProjectId.make("project"),
  threadId,
  cwd: "/work/app",
  kind: request.kind,
  request,
  status: "failed",
  phase: "done",
  startedBy: "agent",
  startedAt: "2026-10-08T10:00:00.000Z",
  finishedAt: "2026-10-08T10:01:30.000Z",
  exitCode: 65,
  commandLine: "xcodebuild -scheme App test",
  counts: { errors: 1, warnings: 0, failedTests: 0 },
  hasResultBundle: true,
});

const toolkitWith = (service: Partial<AppleBuildService["Service"]>) =>
  AppleBuildToolingToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(appleBuildToolingHandlers).pipe(
        Layer.provide(callerLayer),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(
              AppleBuildService,
              partial<AppleBuildService["Service"]>(service),
            ) as unknown as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );

describe("tools", () => {
  it("uses unique Loom-prefixed names", () => {
    expect(Object.keys(AppleBuildToolingToolkit.tools).sort()).toEqual([
      "loom_apple_build_tooling_run",
      "loom_apple_build_tooling_status",
    ]);
  });

  it.effect("starts an agent run with the defaults and returns its compact summary", () =>
    Effect.gen(function* () {
      const started: Array<{ request: AppleRunRequest; by: string }> = [];
      let stored: AppleRunRecord | undefined;
      const toolkit = yield* toolkitWith({
        currentSettings: Effect.succeed(DEFAULT_APPLE_BUILD_SETTINGS),
        status: () =>
          Effect.succeed({
            cwd: "/work/app",
            containers: [PROJECT],
            truncated: false,
            lane: null,
          } as never),
        inspect: () =>
          Effect.succeed({
            schemes: ["App"],
            targets: [],
            configurations: [],
            testPlans: [],
            sharedSchemes: [],
          }),
        destinations: () => Effect.succeed([SHUTDOWN, BOOTED]),
        start: (request, by) =>
          Effect.sync(() => {
            started.push({ request, by });
            stored = record(request);
            return stored;
          }),
        waitForRun: () => Effect.succeed(true),
        getRun: () =>
          Effect.succeed({
            run: stored!,
            summary: {
              build: {
                status: "failed",
                errorCount: 1,
                warningCount: 0,
                issues: [{ severity: "error", message: "boom", file: "App/App.swift", line: 4 }],
              },
            },
            logPath: "/runs/abt_1/log.txt",
            resultBundlePath: "/runs/abt_1/Result.xcresult",
            logTail: `${Array.from({ length: 80 }, (_, index) => `line ${index}`).join("\n")}`,
          } satisfies AppleRunDetail),
      });
      const [result] = yield* toolkit
        .handle("loom_apple_build_tooling_run", { action: "test", only_testing: ["AppTests/x"] })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, invocation),
          Effect.provide(callerLayer),
        );
      expect(started).toEqual([
        {
          request: {
            workspace: { threadId },
            kind: "test",
            container: PROJECT,
            scheme: "App",
            destination: BOOTED,
            onlyTesting: ["AppTests/x"],
          },
          by: "agent",
        },
      ]);
      const value = result?.result as {
        status: string;
        durationSec: number;
        summaryText: string;
        logTail: string;
      };
      expect(value.status).toBe("failed");
      expect(value.durationSec).toBe(90);
      expect(value.summaryText).toContain("error: App/App.swift:4: boom");
      expect(value.logTail.split("\n")).toHaveLength(60);
      expect(value.logTail.endsWith("line 79")).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses both tools when agent tools are turned off", () =>
    Effect.gen(function* () {
      const toolkit = yield* toolkitWith({
        currentSettings: Effect.succeed({
          ...DEFAULT_APPLE_BUILD_SETTINGS,
          agentToolsEnabled: false,
        }),
      });
      const disabled = {
        reason: "disabled",
        message: "Apple build tools are turned off in Loom settings.",
      };
      const run = yield* toolkit
        .handle("loom_apple_build_tooling_run", { action: "build" })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.flip,
          Effect.provideService(McpInvocationContext, invocation),
          Effect.provide(callerLayer),
        );
      expect(run).toMatchObject(disabled);
      const status = yield* toolkit
        .handle("loom_apple_build_tooling_status", {})
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.flip,
          Effect.provideService(McpInvocationContext, invocation),
        );
      expect(status).toMatchObject(disabled);
    }).pipe(Effect.scoped),
  );
});
