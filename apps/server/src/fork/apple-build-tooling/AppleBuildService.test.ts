// @effect-diagnostics nodeBuiltinImport:off - Runs real stub executables in a scratch workspace.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import type { AppleContainer, AppleLogChunk, AppleRunRequest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Config from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLifecycleService } from "../project-lifecycle/ProjectLifecycleService.ts";
import { makeWith, type AppleTool } from "./AppleBuildService.ts";
import { AppleBuildToolingMigrations } from "./migrations.ts";

/** Unused service methods fail immediately instead of silently returning a fake value. */
function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const projectId = ProjectId.make("project-app");
const threadId = ThreadId.make("thread-app");
const PACKAGE: AppleContainer = { kind: "package", path: "Package.swift", name: "app" };
const PROJECT: AppleContainer = { kind: "project", path: "App.xcodeproj", name: "App" };
const XUNIT = new URL("./__fixtures__/xunit.xml", import.meta.url).pathname;
const XUNIT_SWIFT_TESTING = new URL("./__fixtures__/xunit-swift-testing.xml", import.meta.url)
  .pathname;

/**
 * Stub tools that log `<name> <args>` to `<home>/calls`. `swift` behaves by the word in
 * `<home>/swift-mode`; xcodebuild fails a build while `<home>/xcode-fail` exists.
 */
const writeStubs = (home: string) => {
  const dir = NodePath.join(home, "stubs");
  NodeFS.mkdirSync(dir);
  const log = NodePath.join(home, "calls");
  const stub = (name: string, body: string) => {
    const path = NodePath.join(dir, name);
    NodeFS.writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> '${log}'\n${body}\n`, {
      mode: 0o755,
    });
    return path;
  };
  const tools: Partial<Record<AppleTool, string>> = {
    swift: stub(
      "swift",
      `echo "lane build: $LOOM_LANE_BUILD"
case "$(cat '${home}/swift-mode' 2>/dev/null)" in
  fail) echo "$PWD/Sources/App/App.swift:3:5: error: cannot find 'missing' in scope"; exit 1 ;;
  slow) sleep 30 & echo $! > '${home}/sleep-pid'; echo started; wait; echo late ;;
  stream) echo one; sleep 0.2; echo two ;;
  test) cp '${XUNIT}' "$4"; cp '${XUNIT_SWIFT_TESTING}' "\${4%.xml}-swift-testing.xml"
     echo "Test addBreaks() recorded an issue at SwiftTests.swift:4:26: Expectation failed"
     echo "Test Suite 'All tests' failed"; exit 1 ;;
  *) echo "Build complete!" ;;
esac`,
    ),
    xcodebuild: stub(
      "xcodebuild",
      `case "$*" in
  -version) printf 'Xcode 27.0\\nBuild version 27A266a\\n' ;;
  -checkFirstLaunchStatus) ;;
  -list*) printf '{"project":{"name":"App","schemes":["App"],"targets":["App"],"configurations":["Debug","Release"]}}' ;;
  *-showBuildSettings*) printf '[{"target":"App","buildSettings":{"PRODUCT_TYPE":"com.apple.product-type.application","TARGET_BUILD_DIR":"/build","WRAPPER_NAME":"App.app","PRODUCT_BUNDLE_IDENTIFIER":"dev.loom.App"}}]' ;;
  *) echo "Compiling App"
     [ -f '${home}/xcode-fail' ] && { echo "$PWD/App/App.swift:7:1: error: expected declaration"; exit 65; }
     echo "** BUILD SUCCEEDED **" ;;
esac`,
    ),
    xcodeSelect: stub("xcode-select", "echo /Applications/Xcode.app/Contents/Developer"),
    xcrun: stub("xcrun", "exit 1"),
    open: stub("open", ""),
    du: stub("du", 'printf "4\\t%s\\n" "$2"'),
    slot: stub("slot", 'exec "$@"'),
    xcodegen: NodePath.join(dir, "missing-xcodegen"),
    xcbeautify: NodePath.join(dir, "missing-xcbeautify"),
  } as Partial<Record<AppleTool, string>> & { slot: string };
  return { tools, log };
};

const calls = (log: string) =>
  NodeFS.existsSync(log) ? NodeFS.readFileSync(log, "utf8").trim().split("\n") : [];

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const setup = (platform: NodeJS.Platform = "darwin") =>
  Effect.gen(function* () {
    const home = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-apple-")),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
    );
    const cwd = NodePath.join(home, "app");
    NodeFS.mkdirSync(NodePath.join(cwd, "App.xcodeproj"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(cwd, "Package.swift"), "// swift-tools-version: 6.0\n");
    const { tools, log } = writeStubs(home);
    const slot = (tools as { slot: string }).slot;
    const lane = {
      current: null as null | {
        name: string;
        spacePath: string;
        tmpPath: string;
        buildPath: string;
        xcodebuild: string;
        slot: string;
      },
    };

    const projectShell = {
      id: projectId,
      title: "App",
      workspaceRoot: cwd,
    } as OrchestrationProjectShell;
    const context = yield* Layer.build(
      Layer.mergeAll(
        Config.layerTest(home, NodePath.join(home, "state")),
        SqlitePersistenceMemory,
        ProcessRunner.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    );
    yield* runForkMigrationSet(AppleBuildToolingMigrations).pipe(Effect.provide(context));
    const service = yield* makeWith({ platform, env: process.env, tools, killAfterMs: 2_000 }).pipe(
      Effect.provide(context),
      Effect.provideService(
        ProjectionStore.ProjectionStoreV2,
        partial<ProjectionStore.ProjectionStoreV2["Service"]>({
          getThread: (id) =>
            Effect.succeed({
              id,
              projectId,
              worktreePath: null,
            } as unknown as OrchestrationV2AppThread),
        }),
      ),
      Effect.provideService(
        ProjectStore.ProjectStoreV2,
        partial<ProjectStore.ProjectStoreV2["Service"]>({
          get: () => Effect.succeed(Option.some(projectShell as never)),
          listShells: () => Effect.succeed([projectShell]),
        }),
      ),
      Effect.provideService(DeviceService, partial<DeviceService["Service"]>({})),
      Effect.provideService(
        ProjectLifecycleService,
        partial<ProjectLifecycleService["Service"]>({
          buildEnvironment: () => Effect.succeed(lane.current as never),
          currentBuildEnvironment: () => Effect.succeed(lane.current as never),
        }),
      ),
    );
    const mode = (value: string) => NodeFS.writeFileSync(NodePath.join(home, "swift-mode"), value);
    const request = (fields: Partial<AppleRunRequest>): AppleRunRequest => ({
      workspace: { threadId },
      kind: "swiftBuild",
      container: PACKAGE,
      ...fields,
    });
    /** Starts a run and waits for it to finish. */
    const finished = (fields: Partial<AppleRunRequest>) =>
      Effect.gen(function* () {
        const run = yield* service.start(request(fields), "user");
        expect(yield* service.waitForRun(run.id, 20_000)).toBe(true);
        return yield* service.getRun(run.id, true);
      });
    return { home, cwd, log, slot, lane, service, mode, request, finished };
  });

const textOf = (chunks: ReadonlyArray<AppleLogChunk>) => chunks.map((chunk) => chunk.text).join("");

describe("AppleBuildService", () => {
  it.live("runs swift build in the thread's workspace and summarizes compiler errors", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      t.mode("fail");
      const detail = yield* t.finished({});
      expect(detail.run).toMatchObject({
        status: "failed",
        phase: "done",
        exitCode: 1,
        cwd: t.cwd,
        startedBy: "user",
        counts: { errors: 1, warnings: 0, failedTests: 0 },
      });
      expect(detail.summary?.build?.issues).toEqual([
        {
          severity: "error",
          message: "cannot find 'missing' in scope",
          file: "Sources/App/App.swift",
          line: 3,
        },
      ]);
      expect(detail.logTail).toContain("$ ");
      expect(detail.logTail).toContain("Failed.");
      expect((yield* t.service.listRuns(t.cwd)).map((run) => run.id)).toEqual([detail.run.id]);
    }).pipe(Effect.scoped),
  );

  it.live("runs through the thread's lane: its build slot and folders", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      t.lane.current = {
        name: "main",
        spacePath: `${t.home}/lane`,
        tmpPath: `${t.home}/lane/tmp`,
        buildPath: `${t.home}/lane/build`,
        xcodebuild: `${t.home}/missing-shim`,
        slot: t.slot,
      };
      const detail = yield* t.finished({});
      expect(detail.run.status).toBe("succeeded");
      expect(detail.logTail).toContain(`Building in lane main.`);
      expect(detail.logTail).toContain(`lane build: ${t.home}/lane/build`);
      expect(calls(t.log)).toContain(`slot ${NodePath.join(t.home, "stubs", "swift")} build`);
    }).pipe(Effect.scoped),
  );

  it.live("holds one run per workspace and cancels a run's whole process tree", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      t.mode("slow");
      const run = yield* t.service.start(t.request({}), "agent");
      // Wait for the stub to report its child before cancelling.
      yield* t.service.tailLog(run.id, 0).pipe(
        Stream.takeUntil((chunk) => chunk.text.includes("started")),
        Stream.runDrain,
      );
      const sleeper = Number(NodeFS.readFileSync(`${t.home}/sleep-pid`, "utf8"));
      expect(alive(sleeper)).toBe(true);

      const busy = yield* t.service.start(t.request({}), "user").pipe(Effect.flip);
      expect(busy.reason).toBe("busy");

      yield* t.service.cancel(run.id);
      expect(yield* t.service.waitForRun(run.id, 20_000)).toBe(true);
      const detail = yield* t.service.getRun(run.id, true);
      expect(detail.run.status).toBe("cancelled");
      expect(detail.logTail).not.toContain("late");
      expect(alive(sleeper)).toBe(false);

      // The lock is free again for the next run.
      t.mode("ok");
      expect((yield* t.finished({})).run.status).toBe("succeeded");
    }).pipe(Effect.scoped),
  );

  it.live("tails the live log in order and resumes from an offset", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      t.mode("stream");
      const run = yield* t.service.start(t.request({}), "user");
      const tail = yield* Effect.forkChild(Stream.runCollect(t.service.tailLog(run.id, 0)));
      const chunks = [...(yield* Fiber.join(tail))];
      let offset = 0;
      for (const chunk of chunks) {
        expect(chunk.offset).toBe(offset);
        offset += chunk.text.length;
      }
      expect(chunks.at(-1)?.done).toBe(true);
      expect(chunks.slice(0, -1).every((chunk) => !chunk.done)).toBe(true);
      const text = textOf(chunks);
      expect(text).toMatch(/one\n[\s\S]*two\n[\s\S]*Succeeded\.\n$/);

      const resumed = [...(yield* Stream.runCollect(t.service.tailLog(run.id, 5)))];
      expect(resumed[0]?.offset).toBe(5);
      expect(textOf(resumed)).toBe(text.slice(5));

      const missing = yield* Stream.runCollect(t.service.tailLog("abt_missing", 0)).pipe(
        Effect.flip,
      );
      expect(missing.reason).toBe("run-not-found");
    }).pipe(Effect.scoped),
  );

  it.live("summarizes swift test results from the xUnit file", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      t.mode("test");
      NodeFS.mkdirSync(NodePath.join(t.cwd, "Tests/AppTests"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(t.cwd, "Tests/AppTests/SwiftTests.swift"), "");
      const detail = yield* t.finished({ kind: "swiftTest" });
      expect(detail.run).toMatchObject({ status: "failed", counts: { failedTests: 3 } });
      // The tests ran, so the build itself succeeded.
      expect(detail.summary?.build?.status).toBe("succeeded");
      expect(detail.summary?.tests).toMatchObject({ total: 6, passed: 2, failed: 3 });
      expect(
        detail.summary?.tests?.failures.map((failure) => [failure.identifier, failure.file]),
      ).toEqual([
        ["PkgTests.MathTests/testAddFails", undefined],
        ["PkgTests.addBreaks()", "Tests/AppTests/SwiftTests.swift"],
        ["PkgTests.Grouped/insideSuiteFails()", undefined],
      ]);
    }).pipe(Effect.scoped),
  );

  it.live("builds a scheme into Loom's DerivedData and launches it on this Mac", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      const detail = yield* t.finished({
        kind: "run",
        container: PROJECT,
        scheme: "App",
        destination: { _tag: "mac" },
      });
      expect(detail.run.status).toBe("succeeded");
      expect(detail.summary?.launched).toMatchObject({
        appPath: "/build/App.app",
        bundleId: "dev.loom.App",
      });
      const derived = NodePath.join(
        t.home,
        "state",
        "userdata",
        "fork",
        "apple-build-tooling",
        "derived",
      );
      const build = calls(t.log).find(
        (line) => line.startsWith("xcodebuild") && line.includes(" build"),
      );
      expect(build).toContain(`-derivedDataPath ${derived}/`);
      expect(calls(t.log)).toContain("open -n /build/App.app");
    }).pipe(Effect.scoped),
  );

  it.live("reports compiler errors from the log when there is no result bundle", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      NodeFS.writeFileSync(`${t.home}/xcode-fail`, "");
      const detail = yield* t.finished({ kind: "build", container: PROJECT, scheme: "App" });
      expect(detail.run).toMatchObject({ status: "failed", exitCode: 65 });
      expect(detail.summary?.build?.issues[0]).toMatchObject({ file: "App/App.swift", line: 7 });
      expect(calls(t.log).some((line) => line.startsWith("open"))).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("checks requests against the workspace and the platform", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      const reasons = yield* Effect.forEach(
        [
          t.request({ kind: "build", container: PACKAGE, scheme: "App" }),
          t.request({ kind: "run", container: PROJECT, scheme: "App" }),
          t.request({ container: { ...PACKAGE, path: "Missing/Package.swift" } }),
          t.request({ kind: "xcodegenGenerate", container: PROJECT }),
        ],
        (request) =>
          t.service.start(request, "user").pipe(
            Effect.flip,
            Effect.map((failure) => failure.reason),
          ),
      );
      expect(reasons).toEqual([
        "invalid-request",
        "invalid-request",
        "container-not-found",
        "invalid-request",
      ]);

      const linux = yield* setup("linux");
      const xcode = yield* linux.service
        .start(linux.request({ kind: "build", container: PROJECT, scheme: "App" }), "user")
        .pipe(Effect.flip);
      expect(xcode.reason).toBe("unsupported-platform");
      expect((yield* linux.finished({})).run.status).toBe("succeeded");
    }).pipe(Effect.scoped),
  );

  it.live("keeps settings and clears finished history", () =>
    Effect.gen(function* () {
      const t = yield* setup();
      const updated = yield* t.service.updateSettings({
        keepRunsPerProject: 5,
        useXcbeautify: undefined,
      });
      expect(updated.keepRunsPerProject).toBe(5);
      expect(updated.useXcbeautify).toBe(true);
      const first = yield* t.finished({});
      const rest = yield* Effect.forEach([1, 2, 3, 4, 5], () => t.finished({}));
      const second = rest.at(-1)!;
      // Retention keeps the newest runs of the project and deletes the oldest run's folder.
      const listed = (yield* t.service.listRuns(t.cwd)).map((run) => run.id);
      expect(listed).toHaveLength(5);
      expect(listed).not.toContain(first.run.id);
      expect(NodeFS.existsSync(NodePath.dirname(first.logPath))).toBe(false);
      expect((yield* t.service.getSettings).storage.runCount).toBe(5);

      yield* t.service.clearHistory({ projectId, includeDerivedData: true });
      expect(yield* t.service.listRuns(t.cwd)).toEqual([]);
      expect(NodeFS.existsSync(NodePath.dirname(second.logPath))).toBe(false);
    }).pipe(Effect.scoped),
  );
});
