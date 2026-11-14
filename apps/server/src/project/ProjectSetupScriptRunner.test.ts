import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it, vi } from "@effect/vitest"; // fork: project-lifecycle
// fork: project-lifecycle
import {
  ProjectId,
  TerminalNotRunningError,
  ThreadId,
  type TerminalEvent,
  type TerminalSessionSnapshot,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ProjectLifecycleError } from "@t3tools/contracts/fork"; // fork: project-lifecycle
// fork: project-lifecycle
import * as ProjectLifecycle from "../fork/project-lifecycle/ProjectLifecycleService.ts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
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
  readonly command?: string;
  readonly history?: string;
  readonly opening?: Deferred.Deferred<void>;
  readonly shell?: string | null;
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
    getShell: () =>
      options.shell === null
        ? Effect.fail(new TerminalNotRunningError({ threadId, terminalId }))
        : Effect.succeed(options.shell ?? "/bin/zsh"),
    subscribe: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    write: (input) => Queue.offer(writes, input.data).pipe(Effect.asVoid),
    closeIdle: () => Effect.void,
    closeOnSettle: () => Effect.void,
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
          command: options.command ?? "vp i",
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

const setup = Effect.fn(function* (
  options: {
    readonly command?: string;
    readonly history?: string;
    readonly shell?: string | null;
  } = {},
) {
  const harness = yield* makeHarness(options);
  const result = yield* harness.start;
  const completion = result.status === "started" ? result.completion : undefined;
  if (!completion) return yield* Effect.die("setup did not start an observed run");
  return { ...harness, result, completion };
});

describe("ProjectSetupScriptRunner", () => {
  it.effect("writes immediately when the spawned fallback is PowerShell", () =>
    Effect.gen(function* () {
      const { writes } = yield* setup({
        shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      });
      expect(yield* Queue.take(writes)).toContain("$global:LASTEXITCODE");
    }),
  );

  it.effect("types an escaped Nushell wrapper once its line editor starts", () =>
    Effect.gen(function* () {
      const command =
        'print "quoted"; print \'C:\\tools\'; print "$env.PATH"\nexit 7 # comment\r\n\t';
      const escaped =
        'print \\"quoted\\"; print \'C:\\\\tools\'; print \\"$env.PATH\\"\\u{a}exit 7 # comment\\u{d}\\u{a}\\u{9}';
      const { writes, emit } = yield* setup({ shell: "/opt/homebrew/bin/nu", command });
      yield* TestClock.adjust("1 second");
      expect(yield* Queue.size(writes)).toBe(0);
      yield* emit({ ...event, type: "output", data: "> \x1b[?2004h" });
      const written = yield* Queue.take(writes);
      const sentinel = written.match(/__T3_SETUP_DONE___[0-9a-f]{32}:/)?.[0];
      expect(sentinel).toBeDefined();
      expect(written).toBe(
        ` ${[
          "$env.LAST_EXIT_CODE = 0",
          "let __t3f = try { mktemp --tmpdir-path $env.T3CODE_WORKTREE_PATH --suffix .nu .t3-setup-XXXXXXXX } catch {|e| print -e $e.msg; null }",
          `if $__t3f == null { $env.LAST_EXIT_CODE = 1 } else { try { [$"rm --permanent ($__t3f | to nuon)" "${escaped}"] | str join (char newline) | save --force --raw $__t3f; ^$nu.current-exe --login --commands $"cd $env.T3CODE_WORKTREE_PATH; source ($__t3f | to nuon)" } catch {|e| if $e != null and $e.exit_code? == null { print -e $e.msg }; if $env.LAST_EXIT_CODE == 0 { $env.LAST_EXIT_CODE = 1 } } }`,
          "let __t3c = $env.LAST_EXIT_CODE",
          "try { if $__t3f != null and ($__t3f | path exists) { rm --permanent $__t3f } } catch {|e| print -e $e.msg }",
          `print $"\\n${sentinel}($__t3c)"`,
        ].join("; ")}\r`,
      );
    }),
  );

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
      expect(yield* Queue.take(writes)).toContain("vp i");
    }),
  );

  it.effect("types into a quiet shell that has no line editor", () =>
    Effect.gen(function* () {
      const { writes } = yield* setup();
      yield* TestClock.adjust("3 seconds");
      expect(yield* Queue.take(writes)).toContain("vp i");
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
      expect(yield* Queue.take(writes)).toContain("vp i");
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

  it.effect.each([false, true])(
    "does not type into a shell that exits during startup (before shell lookup: %s)",
    (beforeShellLookup) =>
      Effect.gen(function* () {
        const { completion, writes, emit, listeners } = yield* setup(
          beforeShellLookup ? { shell: null } : {},
        );
        if (!beforeShellLookup) {
          yield* emit({ ...event, type: "exited", exitCode: 1, exitSignal: null });
        }
        expect(yield* completion).toMatchObject({ exitCode: null });
        yield* TestClock.adjust("1 minute");
        expect(yield* Queue.size(writes)).toBe(0);
        expect(listeners.size).toBe(0);
      }),
  );
});

// fork: project-lifecycle
it.effect.each(["setup", "isolated", "disabled", "no-script", "settle", "failure"] as const)(
  "prepares the setup directory's lane before opening its shell (%s)",
  (mode) =>
    Effect.gen(function* () {
      const events: string[] = [];
      const laneEnv = {
        TMPDIR: "/lanes/worker/tmp/",
        LOOM_LANE_BUILD: "/lanes/worker/build",
        LOOM_SHARED_LOCK_DIR: "/lanes/.loom/locks",
        PATH: "/lanes/.loom/shims:/usr/bin:/bin",
      };
      let openedEnv: Readonly<Record<string, string>> | undefined;
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
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getThreadShell: () => Effect.succeed(null),
            }),
            Layer.mock(TerminalManager.TerminalManager)({
              open: (input) =>
                Effect.sync(() => {
                  events.push("open");
                  openedEnv = input.env;
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
              getShell: () => Effect.succeed(mode === "isolated" ? "/bin/bash" : "/bin/zsh"),
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
          ...(mode === "isolated" ? { terminalId: "claude-setup-isolated" } : {}),
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
              shellEnvironment: () => Effect.succeed(laneEnv),
            }),
          ),
        );
      const running = yield* run.pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      if (mode === "setup" || mode === "isolated" || mode === "failure") {
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
        if (mode === "isolated") expect(openedEnv).toMatchObject(laneEnv);
        assert.deepEqual(
          events,
          mode === "setup" || mode === "isolated"
            ? ["lane-start", "lane-ready", "open", "setup"]
            : mode === "no-script"
              ? []
              : ["open", "setup"],
        );
      }
      if (mode === "isolated" && result._tag === "Success")
        assert.equal(
          result.success.status === "started" ? result.success.terminalId : null,
          "claude-setup-isolated",
        );
      if (mode !== "setup" && mode !== "isolated" && mode !== "failure")
        assert.equal(ensureForThread.mock.calls.length, 0);
    }),
);

const runObservedSetup = Effect.fnUntraced(function* (command: string) {
  const { writes, outputLines, emit, completion } = yield* setup({ command });
  yield* emit({ ...event, type: "output", data: "\x1b[?2004h" });
  const submitted = yield* Queue.take(writes);
  const cwd = yield* HostProcess.WorkingDirectory;
  const env = yield* HostProcess.Environment;

  // Enter becomes a newline at the terminal boundary; transport assertions below
  // cover line-editor submissions and canonical TTY limits that bash -c bypasses.
  const child = yield* Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        "/bin/bash",
        ["--noprofile", "--norc", "-c", submitted.replaceAll("\r", "\n")],
        {
          cwd,
          env: { PATH: env.PATH },
        },
      ),
    );
    return yield* Effect.all(
      {
        stdout: handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
        stderr: handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        exitCode: handle.exitCode,
      },
      { concurrency: "unbounded" },
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
  yield* emit({ ...event, type: "output", data: submitted + "\n" });
  yield* emit({ ...event, type: "output", data: child.stdout + child.stderr });
  yield* emit({ ...event, type: "closed" });
  return {
    submitted,
    lines: yield* Queue.clear(outputLines),
    exitCode: (yield* completion).exitCode,
  };
});

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("POSIX setup completion", () => {
  it.live("submits one line while preserving multiline shell syntax and literal text", () =>
    Effect.gen(function* () {
      const result = yield* runObservedSetup(
        [
          "printf '%s\\n' \"it's ready\" 'literal \\n $(printf wrong) `printf wrong` café'",
          "cat <<'END'",
          "$literal \\path 雪",
          "END",
          "printf '%s\\n' done # trailing comment",
        ].join("\r\n"),
      );
      assert.equal(result.submitted.at(-1), "\r");
      assert.notMatch(result.submitted.slice(0, -1), /[\r\n]/);
      assert.deepEqual(result.lines, [
        "it's ready",
        "literal \\n $(printf wrong) `printf wrong` café",
        "$literal \\path 雪",
        "done",
      ]);
      assert.equal(result.exitCode, 0);
    }),
  );

  it.live("completes long scripts without exceeding canonical terminal line limits", () =>
    Effect.gen(function* () {
      const expected = Array.from(
        { length: 120 },
        (_, index) => `line-${index}: café 雪 'quoted' \\path`,
      );
      const command = expected
        .map((line) => `printf '%s\\n' "${line.replaceAll("\\", "\\\\")}"`)
        .join("\n");
      const utf8 = new TextEncoder();
      assert.isAbove(utf8.encode(command).byteLength, 4_096);

      const result = yield* runObservedSetup(command);
      assert.deepEqual(result.lines, expected);
      assert.equal(result.exitCode, 0);
      assert.equal(result.submitted.at(-1), "\r");
      assert.notInclude(result.submitted, "\n");
      // The runner can write before the shell switches the terminal out of canonical mode.
      for (const line of result.submitted.slice(0, -1).split("\r")) {
        assert.isBelow(utf8.encode(line).byteLength, 1_024);
      }
    }),
  );

  it.live("preserves a trailing backslash-newline even when losing it would still exit zero", () =>
    Effect.gen(function* () {
      const result = yield* runObservedSetup("printf '%s\\n' direct\\\n");
      assert.deepEqual(result.lines, ["direct"]);
      assert.equal(result.exitCode, 0);
    }),
  );

  it.live.each([
    { name: "an explicit exit", command: "exit 7", exitCode: 7 },
    { name: "a syntax error", command: "if then", exitCode: 2 },
  ])("reports a nonzero completion for $name", ({ command, exitCode }) =>
    Effect.gen(function* () {
      const result = yield* runObservedSetup(command);
      assert.equal(result.exitCode, exitCode);
    }),
  );
});
