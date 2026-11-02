import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  DEFAULT_SERVER_SETTINGS,
  type TerminalEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ProjectionStoreV2 } from "../../orchestration-v2/ProjectionStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import { PortDiscovery } from "../../preview/PortScanner.ts";
import { ProjectProfileService } from "../project-profiles/ProjectProfileService.ts";
import { defaultProjectProfile } from "@t3tools/contracts/fork";
import { make } from "./DevEnvironmentService.ts";

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected call: ${String(key)}`);
    },
  });
}
const projectId = ProjectId.make("project");
const first = ThreadId.make("first"),
  second = ThreadId.make("second"),
  other = ThreadId.make("other");
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();
  const checkout = `${root}/checkout`;
  yield* fs.makeDirectory(checkout);
  yield* fs.writeFileString(
    `${root}/package.json`,
    JSON.stringify({ scripts: { dev: "node app.js" } }),
  );
  yield* fs.writeFileString(
    `${checkout}/package.json`,
    JSON.stringify({ scripts: { dev: "node app.js" } }),
  );
  const opened: string[] = [],
    closed: string[] = [];
  const portListeners: Array<
    (servers: readonly import("@t3tools/contracts").DiscoveredLocalServer[]) => Effect.Effect<void>
  > = [];
  let listener: (event: TerminalEvent) => Effect.Effect<void> = () => Effect.void;
  const deps = Layer.mergeAll(
    Layer.succeed(
      ProjectProfileService,
      partial<ProjectProfileService["Service"]>({
        get: () => Effect.succeed(defaultProjectProfile(projectId)),
        varlockCommand: (input) =>
          Effect.succeed({
            cwd: root,
            commandLine: "command" in input.target ? input.target.command : "npm run dev",
          }),
      }),
    ),
    Layer.succeed(
      ProjectStoreV2,
      partial<ProjectStoreV2["Service"]>({
        get: () =>
          Effect.succeedSome({
            projectId,
            workspaceRoot: root,
            scripts: [],
          } as unknown as import("../../orchestration-v2/ProjectStore.ts").ProjectRow),
      }),
    ),
    Layer.succeed(
      ProjectionStoreV2,
      partial<ProjectionStoreV2["Service"]>({
        getThreadShell: (id) =>
          Effect.succeed(
            id === ThreadId.make("missing")
              ? null
              : ({
                  id,
                  projectId,
                  worktreePath: id === other ? checkout : null,
                  deletedAt: null,
                } as import("@t3tools/contracts").OrchestrationV2ThreadShell | null),
          ),
      }),
    ),
    Layer.succeed(
      ServerSettingsService,
      partial<ServerSettingsService["Service"]>({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
    ),
    Layer.succeed(
      TerminalManager,
      partial<TerminalManager["Service"]>({
        subscribe: (next) =>
          Effect.sync(() => {
            listener = next;
            return () => {};
          }),
        open: (input) =>
          Effect.sync(() => {
            opened.push(input.terminalId);
            return {
              ...input,
              worktreePath: input.worktreePath ?? null,
              status: "running",
              history: "",
              pid: 12,
              exitCode: null,
              exitSignal: null,
              label: "Dev",
              updatedAt: "2026-11-02T00:00:00.000Z",
            };
          }),
        write: () => Effect.void,
        getShell: () => Effect.succeed("/bin/zsh"),
        close: (input) =>
          Effect.sync(() => {
            closed.push(input.terminalId!);
          }),
      }),
    ),
    Layer.succeed(
      PortDiscovery,
      partial<PortDiscovery["Service"]>({
        scan: () => Effect.succeed([]),
        retain: Effect.void,
        subscribe: (_input, onChange) =>
          Effect.sync(() => {
            portListeners.push(onChange);
          }),
      }),
    ),
  );
  const service = yield* make.pipe(Effect.provide(deps));
  return {
    service,
    opened,
    closed,
    portListeners,
    emit: (event: TerminalEvent) => listener(event),
    root,
  };
});
describe("managed checkout dev servers", () => {
  it.effect(
    "reuses starts across threads in one checkout, isolates worktrees, protects another conversation and tracks exit",
    () =>
      Effect.gen(function* () {
        const { service, opened, closed, emit, portListeners } = yield* fixture;
        const start = { threadId: first, key: "package:dev", requestId: "start" };
        const [run, racing] = yield* Effect.all(
          [service.start(start), service.start({ ...start, requestId: "racing" })],
          { concurrency: "unbounded" },
        );
        expect(racing.id).toBe(run.id);
        expect((yield* service.start(start)).id).toBe(run.id);
        expect((yield* service.start({ ...start, threadId: second, requestId: "second" })).id).toBe(
          run.id,
        );
        const isolated = yield* service.start({ ...start, threadId: other, requestId: "other" });
        expect(isolated.id).not.toBe(run.id);
        expect(opened).toHaveLength(2);
        expect(
          (yield* service
            .control({ threadId: other, runId: run.id, action: "stop", requestId: "wrong" })
            .pipe(Effect.flip)).reason,
        ).toBe("run-not-found");
        expect(
          (yield* service
            .control({ threadId: second, runId: run.id, action: "stop", requestId: "stop" })
            .pipe(Effect.flip)).reason,
        ).toBe("confirm-other-thread");
        yield* emit({
          type: "activity",
          threadId: first,
          terminalId: run.terminalId,
          hasRunningSubprocess: true,
          label: "node",
        });
        expect((yield* service.snapshot({ threadId: first })).runs[0]?.state).toBe("running");
        yield* portListeners[0]!([
          {
            url: "http://localhost:1234",
            port: 1234,
            terminal: { threadId: other, terminalId: isolated.terminalId },
          } as import("@t3tools/contracts").DiscoveredLocalServer,
        ]);
        expect((yield* service.snapshot({ threadId: first })).runs[0]?.state).toBe("running");
        yield* portListeners[0]!([
          {
            url: "http://localhost:1234",
            port: 1234,
            terminal: { threadId: first, terminalId: run.terminalId },
          } as import("@t3tools/contracts").DiscoveredLocalServer,
        ]);
        expect((yield* service.snapshot({ threadId: first })).runs[0]?.state).toBe("ready");
        yield* emit({
          type: "output",
          threadId: first,
          terminalId: run.terminalId,
          data: "x".repeat(10_000),
        });
        yield* emit({
          type: "exited",
          threadId: first,
          terminalId: run.terminalId,
          exitCode: 1,
          exitSignal: null,
        });
        const snapshot = yield* service.snapshot({ threadId: first });
        expect(snapshot.runs[0]?.state).toBe("exited");
        expect(snapshot.runs[0]?.exitCode).toBe(1);
        expect(snapshot.runs[0]?.output.length).toBe(8192);
        yield* service.control({
          threadId: second,
          runId: run.id,
          action: "stop",
          requestId: "stop",
          confirmOtherThread: true,
        });
        expect(closed).toEqual([]);
        const restarted = yield* service.control({
          threadId: first,
          runId: run.id,
          action: "restart",
          requestId: "restart",
        });
        expect(restarted.id).not.toBe(run.id);
        expect(
          (yield* service.control({
            threadId: first,
            runId: run.id,
            action: "restart",
            requestId: "restart",
          })).id,
        ).toBe(restarted.id);
        expect((yield* service.start({ ...start, key: "changed" }).pipe(Effect.flip)).reason).toBe(
          "request-conflict",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
