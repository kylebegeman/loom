import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it, vi } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { ProjectLifecycleError } from "@t3tools/contracts/fork";
import * as ProjectLifecycle from "../fork/project-lifecycle/ProjectLifecycleService.ts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as TerminalManager from "../terminal/Manager.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

it.effect("resolves setup scripts through the standalone project service", () => {
  const open = vi.fn(
    (
      input: Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0],
      _options?: Parameters<TerminalManager.TerminalManager["Service"]["open"]>[1],
    ) =>
      Effect.succeed({
        threadId: input.threadId,
        terminalId: input.terminalId,
        cwd: input.cwd,
        worktreePath: input.worktreePath ?? null,
        status: "running" as const,
        pid: 123,
        history: "",
        exitCode: null,
        exitSignal: null,
        label: "Shell",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
  );
  const write = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]) => Effect.void,
  );
  const closeIdle = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["closeIdle"]>[0]) => Effect.void,
  );
  const listeners: Array<Parameters<TerminalManager.TerminalManager["Service"]["subscribe"]>[0]> =
    [];
  const subscribe: TerminalManager.TerminalManager["Service"]["subscribe"] = (listener) =>
    Effect.sync(() => {
      listeners.push(listener);
      return () => undefined;
    });
  const projectId = ProjectId.make("project:setup-runner-v2");
  const project = {
    id: projectId,
    title: "Project",
    workspaceRoot: "/repo",
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: null,
    scripts: [
      {
        id: "setup",
        name: "Setup",
        command: "vp install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "clean",
        name: "Clean",
        command: "cargo clean",
        icon: "build" as const,
        runOnWorktreeCreate: false,
        runOnSettle: true,
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  const layer = ProjectSetupScriptRunner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(TerminalManager.TerminalManager)({ open, write, subscribe, closeIdle }),
        ServerSettings.layerTest(),
        NodeCrypto.layer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
    });
    assert.deepEqual(result, {
      status: "started",
      async: true,
      scriptId: "setup",
      scriptName: "Setup",
      scriptCommand: "vp install",
      terminalId: "setup-setup",
      cwd: "/repo-worktree",
    });
    assert.equal(open.mock.calls[0]?.[0].cwd, "/repo-worktree");
    assert.deepEqual(open.mock.calls[0]?.[0].env, {
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo-worktree",
      COLORTERM: "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    });
    assert.equal(write.mock.calls[0]?.[0].data, " vp install\r");
    assert.equal(open.mock.calls[0]?.[1], undefined);
    const lines: string[] = [];
    const observed = yield* runner.runForThread({
      workspaceLeaseHeld: true,
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      observeCompletion: {
        onOutputLine: (line) =>
          Effect.sync(() => {
            lines.push(line);
          }),
      },
    });
    assert.equal(observed.status, "started");
    assert.match(write.mock.calls[1]?.[0].data ?? "", /^ \S/);
    const listener = listeners[0]!;
    yield* listener({
      type: "output",
      threadId: "thread-1",
      terminalId: "setup-setup",
      data: "Downloading 10%\rDownloading 20%\r\nDone\n",
    });
    assert.deepEqual(lines, ["Downloading 10%", "Downloading 20%", "Done"]);
    yield* listener({ type: "closed", threadId: "thread-1", terminalId: "setup-setup" });

    assert.deepEqual(open.mock.calls[1]?.[1], { workspaceLeaseHeld: true });
    const settle = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      trigger: "settle",
    });
    const settleTerminalId = settle.status === "started" ? settle.terminalId : "";
    assert.match(settleTerminalId, /^settle-clean-/);
    assert.equal(write.mock.calls.at(-1)?.[0].data, " cargo clean\r");

    const observedSettle = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      trigger: "settle",
      observeCompletion: {},
    });
    const observedTerminalId = observedSettle.status === "started" ? observedSettle.terminalId : "";
    assert.notEqual(observedTerminalId, settleTerminalId);
    assert.match(write.mock.calls.at(-1)?.[0].data ?? "", /^ \S/);
    const token = /__T3_SETUP_DONE___(\w+):/.exec(write.mock.calls.at(-1)?.[0].data ?? "")?.[1];
    const settleListener = listeners.at(-1)!;
    const completion = yield* Effect.forkChild(
      observedSettle.status === "started" && observedSettle.completion
        ? observedSettle.completion
        : Effect.die("no completion"),
    );
    yield* settleListener({
      type: "output",
      threadId: "thread-1",
      terminalId: observedTerminalId,
      data: `\r\n__T3_SETUP_DONE___${token}:0\r\n`,
    });
    yield* Effect.yieldNow;
    assert.equal(closeIdle.mock.calls.length, 0);
    yield* settleListener({
      type: "output",
      threadId: "thread-1",
      terminalId: observedTerminalId,
      data: "$ ",
    });
    assert.deepEqual((yield* Fiber.join(completion)).exitCode, 0);
    assert.deepEqual(closeIdle.mock.calls[0]?.[0], {
      threadId: "thread-1",
      terminalId: observedTerminalId,
    });
  }).pipe(Effect.provide(layer));
});

it.effect.each(["setup", "disabled", "no-script", "settle", "failure"] as const)(
  "prepares the setup directory's lane before opening its shell (%s)",
  (mode) =>
    Effect.gen(function* () {
      const events: string[] = [];
      const entered = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const laneFailure = new ProjectLifecycleError({
        reason: "command-failed",
        message: "Lane unavailable",
      });
      const ensureForThread = vi.fn(
        (
          ..._input: Parameters<
            ProjectLifecycle.ProjectLifecycleService["Service"]["ensureForThread"]
          >
        ) =>
          Effect.gen(function* () {
            events.push("lane-start");
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(ready);
            if (mode === "failure") return yield* laneFailure;
            events.push("lane-ready");
            return {} as never;
          }),
      );
      // Construct without ProjectLifecycle: settlement also uses this runner.
      const runner = yield* ProjectSetupScriptRunner.make.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ProjectService.ProjectService)({}),
            Layer.mock(TerminalManager.TerminalManager)({
              open: () =>
                Effect.sync(() => {
                  events.push("open");
                  return {} as never;
                }),
              write: () =>
                Effect.sync(() => {
                  events.push("setup");
                }),
            }),
            ServerSettings.layerTest(),
            NodeCrypto.layer,
          ),
        ),
      );
      const run = runner
        .runForThread({
          threadId: "thread-setup-order",
          worktreePath: "/repo",
          workspaceLeaseHeld: true,
          trigger: mode === "settle" ? "settle" : "setup",
          project: {
            id: ProjectId.make("project-setup-order"),
            workspaceRoot: "/repo",
            scripts:
              mode === "no-script"
                ? []
                : [
                    {
                      id: "setup",
                      name: "Setup",
                      command: "vp install",
                      icon: "configure",
                      runOnWorktreeCreate: true,
                      runOnSettle: true,
                    },
                  ],
          },
        })
        .pipe(
          Effect.provide(
            Layer.mock(ProjectLifecycle.ProjectLifecycleService)({
              getSettings: Effect.succeed({ enabled: mode !== "disabled" } as never),
              ensureForThread,
            }),
          ),
        );
      const running = yield* run.pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      if (mode === "setup" || mode === "failure") {
        yield* Effect.raceFirst(
          Deferred.await(entered),
          Fiber.join(running).pipe(Effect.andThen(Effect.die("Setup ran before lane preparation"))),
        );
        assert.deepEqual(events, ["lane-start"]);
        assert.deepEqual(ensureForThread.mock.calls, [
          [ThreadId.make("thread-setup-order"), "/repo"],
        ]);
        yield* Deferred.succeed(ready, undefined);
      }
      const result = yield* Fiber.join(running);
      if (mode === "failure") {
        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.equal(result.failure._tag, "ProjectSetupScriptOperationError");
          if (result.failure._tag === "ProjectSetupScriptOperationError")
            assert.equal(result.failure.cause, laneFailure);
        }
        assert.deepEqual(events, ["lane-start"]);
      } else {
        assert.equal(result._tag, "Success");
        assert.deepEqual(
          events,
          mode === "setup"
            ? ["lane-start", "lane-ready", "open", "setup"]
            : mode === "no-script"
              ? []
              : ["open", "setup"],
        );
      }
      if (mode !== "setup" && mode !== "failure")
        assert.equal(ensureForThread.mock.calls.length, 0);
    }),
);
