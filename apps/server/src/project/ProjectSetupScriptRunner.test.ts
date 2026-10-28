import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, expect, it, vi } from "@effect/vitest"; // fork: project-lifecycle
// fork: project-lifecycle
import {
  ProjectId,
  ThreadId,
  type TerminalEvent,
  type TerminalSessionSnapshot,
} from "@t3tools/contracts";
import { ProjectLifecycleError } from "@t3tools/contracts/fork"; // fork: project-lifecycle
import * as HostProcess from "@t3tools/shared/HostProcess";
// fork: project-lifecycle
import * as ProjectLifecycle from "../fork/project-lifecycle/ProjectLifecycleService.ts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import { TestClock } from "effect/testing";

import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

const threadId = "thread-1";
const terminalId = "setup-setup";
const event = { threadId, terminalId, sequence: 1, createdAt: "2026-01-01T00:00:00.000Z" };

const openSnapshot = (history: string): TerminalSessionSnapshot => ({
  threadId,
  terminalId,
  cwd: "/repo/.t3/worktrees/feature",
  worktreePath: null,
  status: "running",
  pid: 123,
  history,
  exitCode: null,
  exitSignal: null,
  label: "zsh",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const makeHarness = Effect.fn(function* (options: {
  readonly history?: string;
  readonly opening?: Deferred.Deferred<void>;
}) {
  const listeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();
  const writes = yield* Queue.unbounded<string>();
  const outputLines = yield* Queue.unbounded<string>();
  const terminals = Layer.mock(TerminalManager.TerminalManager)({
    open: () =>
      (options.opening
        ? Deferred.succeed(options.opening, undefined).pipe(Effect.andThen(Effect.never))
        : Effect.void
      ).pipe(Effect.as(openSnapshot(options.history ?? ""))),
    subscribe: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    write: (input) => Queue.offer(writes, input.data).pipe(Effect.asVoid),
    closeIdle: () => Effect.void,
  });
  const runner = yield* ProjectSetupScriptRunner.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        terminals,
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: () => Effect.succeed(null),
        }),
        ServerSettings.layerTest(),
        NodeCrypto.layer,
      ),
    ),
    Effect.provideService(HostProcess.Platform, "darwin"),
    Effect.provideService(HostProcess.Environment, { SHELL: "/bin/zsh" }),
  );
  const start = runner.runForThread({
    threadId,
    worktreePath: "/repo/.t3/worktrees/feature",
    observeCompletion: { onOutputLine: (line) => Queue.offer(outputLines, line) },
    project: {
      id: ProjectId.make("project-1"),
      workspaceRoot: "/repo",
      scripts: [
        {
          id: "setup",
          name: "Setup",
          command: "vp i",
          icon: "configure",
          runOnWorktreeCreate: true,
        },
      ],
    },
  });
  const emit = (terminalEvent: TerminalEvent) =>
    Effect.forEach([...listeners], (listener) => listener(terminalEvent), { discard: true });
  return { start, listeners, writes, outputLines, emit };
});

const setup = Effect.fn(function* (options: { readonly history?: string } = {}) {
  const harness = yield* makeHarness(options);
  const result = yield* harness.start;
  const completion = result.status === "started" ? result.completion : undefined;
  if (!completion) return yield* Effect.die("setup did not start an observed run");
  return { ...harness, result, completion };
});

describe("ProjectSetupScriptRunner", () => {
  it.effect("shows a startup prompt and types only once the line editor starts", () =>
    Effect.gen(function* () {
      const { result, writes, outputLines, emit } = yield* setup();
      expect(result).toMatchObject({ status: "started", terminalId });

      yield* emit({ ...event, type: "output", data: "Missing Node.\r\nInstall it? [y/N]: " });
      yield* emit({ ...event, type: "activity", hasRunningSubprocess: true, label: "fnm" });
      yield* TestClock.adjust("1 minute");
      expect(yield* Queue.size(writes)).toBe(0);
      expect(yield* Queue.takeAll(outputLines)).toEqual(["Missing Node.", "Install it? [y/N]:"]);

      yield* emit({ ...event, type: "activity", hasRunningSubprocess: false, label: "zsh" });
      yield* emit({ ...event, type: "output", data: "\r\n% \x1b[?2004h" });
      expect(yield* Queue.take(writes)).toMatch(/^ \( vp i\r\);/);
    }),
  );

  it.effect("types into a quiet shell that has no line editor", () =>
    Effect.gen(function* () {
      const { writes } = yield* setup();
      yield* TestClock.adjust("3 seconds");
      expect(yield* Queue.take(writes)).toMatch(/^ \( vp i\r\);/);
    }),
  );

  it.effect("ignores line editor state restored from an earlier shell", () =>
    Effect.gen(function* () {
      const { writes, emit } = yield* setup({ history: "old run\r\n% \x1b[?2004h" });
      yield* emit({ ...event, type: "activity", hasRunningSubprocess: true, label: "fnm" });
      yield* TestClock.adjust("1 minute");
      expect(yield* Queue.size(writes)).toBe(0);
    }),
  );

  it.effect("forgets a busy startup child when the shell restarts", () =>
    Effect.gen(function* () {
      const { writes, emit } = yield* setup();
      yield* emit({ ...event, type: "activity", hasRunningSubprocess: true, label: "fnm" });
      yield* TestClock.adjust("1 minute");
      expect(yield* Queue.size(writes)).toBe(0);
      yield* emit({ ...event, type: "restarted", snapshot: openSnapshot("") });
      // The restart lands inside a quiet window, so the next full window decides.
      yield* TestClock.adjust("6 seconds");
      expect(yield* Queue.take(writes)).toMatch(/^ \( vp i\r\);/);
    }),
  );

  it.effect("drops its terminal listeners when cancelled while the terminal opens", () =>
    Effect.gen(function* () {
      const opening = yield* Deferred.make<void>();
      const { start, listeners } = yield* makeHarness({ opening });
      const fiber = yield* Effect.forkChild(start);
      yield* Deferred.await(opening);
      expect(listeners.size).toBe(2);
      yield* Fiber.interrupt(fiber);
      expect(listeners.size).toBe(0);
    }),
  );

  it.effect("does not type into a shell that exits during startup", () =>
    Effect.gen(function* () {
      const { completion, writes, emit } = yield* setup();
      yield* emit({ ...event, type: "exited", exitCode: 1, exitSignal: null });
      expect(yield* completion).toMatchObject({ exitCode: null });
      yield* TestClock.adjust("1 minute");
      expect(yield* Queue.size(writes)).toBe(0);
    }),
  );
});

// fork: project-lifecycle
it.effect.each(["setup", "disabled", "no-script", "settle", "failure"] as const)(
  "prepares the setup directory's lane before opening its shell (%s)",
  (mode) =>
    Effect.gen(function* () {
      const events: string[] = [];
      const entered = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const listeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();
      const written = yield* Deferred.make<void>();
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
              open: (input) =>
                Effect.sync(() => {
                  events.push("open");
                }).pipe(
                  // The shell's line editor starts reading, so the runner types the command.
                  Effect.andThen(
                    Effect.forEach(
                      [...listeners],
                      (listener) =>
                        listener({
                          type: "output",
                          threadId: input.threadId,
                          terminalId: input.terminalId,
                          data: "\x1b[?2004h",
                        }),
                      { discard: true },
                    ),
                  ),
                  Effect.as({} as never),
                ),
              subscribe: (listener) =>
                Effect.sync(() => {
                  listeners.add(listener);
                  return () => listeners.delete(listener);
                }),
              write: () =>
                Effect.sync(() => {
                  events.push("setup");
                }).pipe(Effect.andThen(Deferred.succeed(written, undefined)), Effect.asVoid),
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
        // The runner returns the open terminal before it types the command.
        if (mode !== "no-script") yield* Deferred.await(written);
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
