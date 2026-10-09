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
import type { DeviceQaTarget } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
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
import { makeWith } from "./DeviceQaService.ts";
import { DeviceQaMigrations } from "./migrations.ts";

/** Unused service methods fail immediately instead of silently returning a fake value. */
function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const projectId = ProjectId.make("project-qa");
const threadId = ThreadId.make("thread-qa");
const SIMULATOR = "00000000-0000-4000-8000-000000000001";
const IOS: DeviceQaTarget = { hostId: "local", deviceId: SIMULATOR, platform: "ios" };
const fixture = (name: string) => new URL(`./__fixtures__/${name}`, import.meta.url).pathname;

/** A PNG header that `pngInfo` reads as 1206x2622. */
const pngBytes = () => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1206, 16);
  bytes.writeUInt32BE(2622, 20);
  return bytes;
};

/**
 * Stub tools that log `<name> <args>` to `<home>/calls`. argent replays a fixture by flow name;
 * the `slow` flow writes its pid and becomes `sleep`, so a cancel must signal it directly.
 */
const writeStubs = (home: string) => {
  const dir = NodePath.join(home, "stubs");
  NodeFS.mkdirSync(dir);
  const log = NodePath.join(home, "calls");
  const png = NodePath.join(home, "shot.png");
  NodeFS.writeFileSync(png, pngBytes());
  const stub = (name: string, body: string) => {
    const path = NodePath.join(dir, name);
    NodeFS.writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> '${log}'\n${body}\n`, {
      mode: 0o755,
    });
    return path;
  };
  const tools = {
    argent: stub(
      "argent",
      `echo "argent env DO_NOT_TRACK=$DO_NOT_TRACK" >> '${log}'
case "$1" in
  --version) echo "argent 0.25.2" ;;
  flow)
    case "$(basename "$3" .yaml)" in
      login) grep -v '^#' '${fixture("flow-pass.ndjson")}' ;;
      settings) grep -v '^#' '${fixture("flow-snapshot-fail.ndjson")}'; exit 1 ;;
      slow) echo $$ > '${home}/slow-pid'
        echo '{"event":"progress","data":{"index":0,"kind":"launch","flow":"slow","status":"pass"}}'
        exec sleep 30 ;;
    esac ;;
esac`,
    ),
    xcrun: stub(
      "xcrun",
      `case "$2 $4" in
  "list booted") cat '${fixture("simctl-booted.json")}' ;;
  "io screenshot") cp '${png}' "$6" ;;
  "io recordVideo")
    trap 'printf video > "$7"; exit 0' INT
    echo "Recording started" >&2
    while :; do sleep 0.1; done ;;
esac`,
    ),
    adb: stub("adb", 'echo "List of devices attached"'),
    npm: stub("npm", "exit 1"),
    plutil: stub("plutil", "exit 1"),
    aapt: NodePath.join(dir, "missing-aapt"),
  };
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

const FLOW = "steps:\n  - launch: { ios: com.example.app }\n  - tap: { text: Sign in }\n";

const setup = () =>
  Effect.gen(function* () {
    const home = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-qa-")),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
    );
    const cwd = NodePath.join(home, "app");
    const flows = NodePath.join(cwd, ".argent", "flows");
    NodeFS.mkdirSync(NodePath.join(flows, "smoke"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(flows, "login.yaml"), FLOW);
    NodeFS.writeFileSync(NodePath.join(flows, "slow.yaml"), FLOW);
    NodeFS.writeFileSync(NodePath.join(flows, "smoke", "settings.yaml"), FLOW);
    const { tools, log } = writeStubs(home);
    const projectShell = {
      id: projectId,
      title: "App",
      workspaceRoot: cwd,
    } as OrchestrationProjectShell;
    const stateDir = NodePath.join(home, "state");
    const context = yield* Layer.build(
      Layer.mergeAll(
        Config.layerTest(home, stateDir),
        SqlitePersistenceMemory,
        ProcessRunner.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    );
    yield* runForkMigrationSet(DeviceQaMigrations).pipe(Effect.provide(context));
    const service = yield* makeWith({
      platform: "darwin",
      env: { PATH: process.env.PATH, HOME: home, ANDROID_HOME: NodePath.join(home, "no-sdk") },
      homeDir: home,
      tools,
      killAfterMs: 2_000,
    }).pipe(
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
          get: () => Effect.succeedSome(projectShell as never),
        }),
      ),
      Effect.provideService(
        DeviceService,
        partial<DeviceService["Service"]>({
          state: Effect.succeed({ devices: [] } as never),
          sessionsForThread: () => Effect.succeed([]),
        }),
      ),
    );
    /** Runs flows and waits for the run to finish. */
    const finished = (paths: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const run = yield* service.runFlows({ threadId, target: IOS, paths }, "user");
        expect(yield* service.waitForRun(run.id, 20_000)).toBe(true);
        return yield* service.getRun(run.id);
      });
    const evidence = Stream.runHead(service.watchEvidence(threadId)).pipe(
      Effect.map(Option.getOrThrow),
    );
    return { home, cwd, log, service, finished, evidence };
  });

describe("DeviceQaService", () => {
  it.live("reports argent, its telemetry and only booted iOS simulators", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        NodeFS.mkdirSync(NodePath.join(t.home, ".argent"));
        NodeFS.writeFileSync(
          NodePath.join(t.home, ".argent", "config.json"),
          '{"telemetry":{"enabled":false}}',
        );
        const status = yield* t.service.status(threadId);
        expect(status.argent).toMatchObject({
          installed: true,
          version: "0.25.2",
          telemetry: "disabled",
        });
        expect(status.tools).toEqual({ simctl: true, adb: true });
        expect(status.localDevices).toEqual([
          { target: IOS, name: "iPhone 17", version: "iOS 27.0" },
        ]);
      }),
    ),
  );

  it.live("runs a flow with telemetry off and records its report as evidence", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const detail = yield* t.finished([".argent/flows/login.yaml"]);
        expect(detail.run).toMatchObject({
          status: "passed",
          startedBy: "user",
          flows: [{ path: ".argent/flows/login.yaml", status: "passed", passed: 4, failed: 0 }],
        });
        expect(detail.steps[".argent/flows/login.yaml"]?.map((step) => step.kind)).toEqual([
          "echo",
          "launch",
          "tap",
          "snapshot",
        ]);
        const argentCalls = calls(t.log).filter((line) => line.startsWith("argent"));
        expect(argentCalls).toContain("argent env DO_NOT_TRACK=1");
        expect(argentCalls.find((line) => line.includes("flow run"))).toContain(
          `flow run .argent/flows/login.yaml --device ${SIMULATOR} --platform ios --json-stream`,
        );
        const list = yield* t.evidence;
        expect(list.items).toHaveLength(1);
        expect(list.items[0]).toMatchObject({
          kind: "flow-report",
          status: "ready",
          label: "login: passed",
          detail: detail.run.id,
        });
        const report = NodeFS.readFileSync(list.items[0]!.path!, "utf8");
        expect(JSON.parse(report).run.id).toBe(detail.run.id);
      }),
    ),
  );

  it.live("fails a run on a snapshot diff and keeps the diff images from the result", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const detail = yield* t.finished([
          ".argent/flows/login.yaml",
          ".argent/flows/smoke/settings.yaml",
        ]);
        expect(detail.run.status).toBe("failed");
        expect(detail.run.flows.map((flow) => flow.status)).toEqual(["passed", "failed"]);
        const failing = detail.steps[".argent/flows/smoke/settings.yaml"]?.find(
          (step) => step.status === "fail",
        );
        expect(failing).toMatchObject({
          kind: "snapshot",
          reason: "3.2% of pixels differ (max 0.5%)",
          artifacts: {
            diff: "/Users/test/runs/artifacts/settings/settings__ios-1206x2622-diff.png",
          },
        });
        expect((yield* t.evidence).items[0]).toMatchObject({
          status: "failed",
          label: "2 flows: 1 passed, 1 failed",
        });
      }),
    ),
  );

  it.live("refuses a second run on a busy device and cancels by signalling argent alone", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const run = yield* t.service.runFlows(
          { threadId, target: IOS, paths: [".argent/flows/slow.yaml", ".argent/flows/login.yaml"] },
          "agent",
        );
        const pidFile = NodePath.join(t.home, "slow-pid");
        for (let waited = 0; !NodeFS.existsSync(pidFile) && waited < 10_000; waited += 50)
          yield* Effect.sleep("50 millis");
        const pid = Number(NodeFS.readFileSync(pidFile, "utf8"));
        const busy = yield* t.service
          .runFlows({ threadId, target: IOS, paths: [".argent/flows/login.yaml"] }, "user")
          .pipe(Effect.flip);
        expect(busy.reason).toBe("busy");

        yield* t.service.cancelRun(run.id);
        expect(yield* t.service.waitForRun(run.id, 10_000)).toBe(true);
        const detail = yield* t.service.getRun(run.id);
        expect(detail.run.status).toBe("cancelled");
        expect(detail.run.flows.map((flow) => flow.status)).toEqual(["cancelled", "cancelled"]);
        expect(alive(pid)).toBe(false);
        expect((yield* t.evidence).items[0]).toMatchObject({
          kind: "flow-report",
          status: "ready",
          label: "2 flows: 0 passed, 0 failed, 2 cancelled",
        });
      }),
    ),
  );

  it.live("rejects devices that are not booted here and paths outside the flows folder", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const missing = yield* t.service
          .runFlows(
            {
              threadId,
              target: { ...IOS, deviceId: "00000000-0000-4000-8000-0000000000ff" },
              paths: [".argent/flows/login.yaml"],
            },
            "user",
          )
          .pipe(Effect.flip);
        expect(missing.reason).toBe("device-unavailable");
        const outside = yield* t.service
          .runFlows({ threadId, target: IOS, paths: ["../secrets.yaml"] }, "user")
          .pipe(Effect.flip);
        expect(outside.reason).toBe("invalid-path");
      }),
    ),
  );

  it.live("saves a clean-status-bar screenshot and deletes it again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const shot = yield* t.service.capture(
          { threadId, target: IOS, kind: "screenshot", label: "Sign in" },
          "agent",
        );
        expect(shot).toMatchObject({
          kind: "screenshot",
          status: "ready",
          width: 1206,
          height: 2622,
          sizeBytes: 33,
          createdBy: "agent",
          label: "Sign in",
          deviceName: "iPhone 17",
        });
        expect(NodePath.dirname(shot.path!)).toMatch(/\/fork\/device-qa\/evidence\/thread-qa$/);
        const xcrun = calls(t.log).filter((line) => line.startsWith("xcrun simctl status_bar"));
        expect(xcrun.map((line) => line.split(" ")[4])).toEqual(["override", "clear"]);
        expect(yield* t.evidence).toMatchObject({ totalCount: 1, totalBytes: 33 });

        yield* t.service.deleteEvidence(shot.id);
        expect(NodeFS.existsSync(shot.path!)).toBe(false);
        expect(yield* t.evidence).toMatchObject({ totalCount: 0, items: [] });
      }),
    ),
  );

  it.live("records one video at a time and finalizes it on stop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const started = yield* t.service.capture(
          { threadId, target: IOS, kind: "recording", cleanStatusBar: false },
          "user",
        );
        expect(started.status).toBe("recording");
        expect((yield* t.evidence).recording?.evidenceId).toBe(started.id);
        const second = yield* t.service
          .capture({ threadId, target: IOS, kind: "recording" }, "user")
          .pipe(Effect.flip);
        expect(second.reason).toBe("busy");
        const active = yield* t.service.deleteEvidence(started.id).pipe(Effect.flip);
        expect(active.reason).toBe("busy");

        const stopped = yield* t.service.stopRecording(started.id);
        expect(stopped).toMatchObject({ status: "ready", sizeBytes: 5, mimeType: "video/mp4" });
        expect(NodeFS.readFileSync(stopped.path!, "utf8")).toBe("video");
        expect((yield* t.evidence).recording).toBeNull();
      }),
    ),
  );

  it.live("deletes evidence older than the expiry setting only when it is on", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const shot = yield* t.service.capture(
          { threadId, target: IOS, kind: "screenshot" },
          "user",
        );
        const twoDaysLater = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Clock.clockWith((clock) => {
            const later = () => clock.currentTimeMillisUnsafe() + 2 * 24 * 60 * 60 * 1000;
            const shifted: Clock.Clock = Object.assign(Object.create(clock), {
              currentTimeMillisUnsafe: later,
              currentTimeMillis: Effect.sync(later),
            });
            return effect.pipe(Effect.provideService(Clock.Clock, shifted));
          });

        expect(yield* twoDaysLater(t.service.sweepExpired)).toBe(0);
        yield* t.service.updateSettings({ evidenceExpireDays: 3 });
        expect(yield* twoDaysLater(t.service.sweepExpired)).toBe(0);
        yield* t.service.updateSettings({ evidenceExpireDays: 1 });
        expect(yield* twoDaysLater(t.service.sweepExpired)).toBe(1);
        expect(NodeFS.existsSync(shot.path!)).toBe(false);
        expect(yield* t.evidence).toMatchObject({ totalCount: 0 });
      }),
    ),
  );

  it.live("forgets a deleted thread's evidence and keeps run history reports", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        const detail = yield* t.finished([".argent/flows/login.yaml"]);
        const shot = yield* t.service.capture(
          { threadId, target: IOS, kind: "screenshot" },
          "user",
        );
        const report = (yield* t.evidence).items.find((item) => item.kind === "flow-report")!;

        expect(yield* t.service.forgetMissingThreads(new Set([threadId]))).toBe(0);
        expect(yield* t.service.forgetMissingThreads(new Set())).toBe(1);
        expect(yield* t.evidence).toMatchObject({ totalCount: 0 });
        expect(NodeFS.existsSync(NodePath.dirname(shot.path!))).toBe(false);
        expect(NodeFS.existsSync(report.path!)).toBe(true);
        expect((yield* t.service.getRun(detail.run.id)).run.status).toBe("passed");
      }),
    ),
  );
});
