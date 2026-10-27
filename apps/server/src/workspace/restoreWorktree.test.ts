import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  CheckpointRef,
  CheckpointScopeId,
  GitCommandError,
  ProjectId,
  RunId,
  type TerminalEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as ProjectLifecycle from "../fork/project-lifecycle/ProjectLifecycleService.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { restoreWorktree } from "./restoreWorktree.ts";

const layer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-restore-worktree-" })),
  Layer.provide(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const parent = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
  const root = `${parent}/project`;
  const cwd = `${parent}/worktree`;
  yield* fs.makeDirectory(root);
  const command = (args: string[], workdir = root) =>
    driver.execute({ operation: "restore-worktree-test", cwd: workdir, args });
  yield* command(["init", "-b", "main"]);
  yield* command(["config", "user.name", "Workspace test"]);
  yield* command(["config", "user.email", "workspace@example.test"]);
  yield* fs.writeFileString(`${root}/proof.txt`, "committed\n");
  yield* command(["add", "."]);
  yield* command(["commit", "-m", "initial"]);
  const head = (yield* command(["rev-parse", "HEAD"])).stdout.trim();
  yield* fs.writeFileString(`${root}/proof.txt`, "saved work\n");
  yield* fs.writeFileString(`${root}/note.txt`, "saved new file\n");
  yield* command(["add", "."]);
  const tree = (yield* command(["write-tree"])).stdout.trim();
  const checkpoint = (yield* command([
    "commit-tree",
    tree,
    "-p",
    head,
    "-m",
    "checkpoint",
  ])).stdout.trim();
  const ref = CheckpointRef.make("refs/t3/orchestration-v2/checkpoints/test/ordinal/1");
  yield* command(["update-ref", ref, checkpoint]);
  yield* command(["reset", "--hard", head]);
  yield* fs.writeFileString(`${root}/root-only.txt`, "keep the existing checkout\n");
  const threadId = ThreadId.make("restored-thread");
  const projectId = ProjectId.make("restored-project");
  const scopeId = CheckpointScopeId.make("restored-scope");
  const runId = RunId.make("restored-run");
  const branch = "feature/released";
  const input = { threadId, projectId, worktreePath: cwd, branch };
  const context: ProjectionStore.ProjectionCheckpointContext = {
    runs: [{ id: runId, ordinal: 1, status: "completed" }],
    checkpointScopes: [{ id: scopeId, runId, kind: "root_run", cwd }],
    checkpoints: [
      { scopeId, runId, ordinalWithinScope: 1, appRunOrdinal: 1, status: "ready", ref },
    ],
  };
  let contextReads = 0;
  let setupCalls = 0;
  const restore = (options?: {
    readonly checkpoints?: ProjectionStore.ProjectionCheckpointContext;
    readonly git?: GitVcsDriver.GitVcsDriver["Service"];
    readonly failSetup?: boolean;
    readonly runSetup?: ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]["runForThread"];
  }) =>
    restoreWorktree(input).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(GitWorkflow.GitWorkflowService)({
            hasCommit: ({ cwd: workdir, refName }) =>
              driver
                .execute({
                  operation: "restore-worktree-test.hasCommit",
                  cwd: workdir,
                  args: ["rev-parse", "--verify", `${refName}^{commit}`],
                  allowNonZeroExit: true,
                })
                .pipe(Effect.map((result) => result.exitCode === 0)),
            pruneWorktrees: driver.pruneWorktrees,
            createWorktree: driver.createWorktree,
          }),
          Layer.succeed(GitVcsDriver.GitVcsDriver, options?.git ?? driver),
          Layer.mock(ProjectService.ProjectService)({
            getById: () => Effect.succeedSome({ workspaceRoot: root } as never),
          }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getCheckpointContext: () =>
              Effect.sync(() => {
                contextReads++;
                return options?.checkpoints ?? context;
              }),
          }),
          Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
            runForThread:
              options?.runSetup ??
              (() =>
                Effect.sync(() => {
                  setupCalls++;
                  return options?.failSetup
                    ? {
                        status: "started",
                        scriptId: "setup",
                        scriptName: "Setup",
                        scriptCommand: "setup",
                        terminalId: "setup",
                        cwd,
                        async: false,
                        completion: Effect.succeed({ exitCode: 1, durationMs: 1 }),
                      }
                    : { status: "no-script" };
                })),
          }),
          Layer.mock(WorktreeSetupTracker.WorktreeSetupTracker)({
            begin: () => Effect.void,
            stageStatus: () => Effect.void,
            update: () => Effect.void,
            finish: () => Effect.succeed(null),
          }),
        ),
      ),
    );
  return {
    fs,
    driver,
    root,
    cwd,
    head,
    command,
    checkpoint,
    input,
    context,
    restore,
    counts: () => ({ contextReads, setupCalls }),
  };
});

it.live("restores checkpoint files before preparing the lane and running worktree setup", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const order: string[] = [];
    const listeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();
    const emit = (event: TerminalEvent) =>
      Effect.forEach([...listeners], (listener) => listener(event), { discard: true });
    const runner = yield* ProjectSetupScriptRunner.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ProjectService.ProjectService)({
            getById: () =>
              Effect.succeedSome({
                workspaceRoot: f.root,
                scripts: [
                  {
                    id: "setup",
                    name: "Setup",
                    command: "vp install",
                    icon: "configure",
                    runOnWorktreeCreate: true,
                  },
                ],
              } as never),
          }),
          Layer.mock(TerminalManager.TerminalManager)({
            open: (input, options) =>
              Effect.gen(function* () {
                expect(order).toEqual(["files-restored", "lane-ready"]);
                expect(options?.workspaceLeaseHeld).toBe(true);
                // The shell's line editor starts reading, so the runner types the command.
                yield* emit({
                  type: "output",
                  threadId: input.threadId,
                  terminalId: input.terminalId,
                  data: "\x1b[?2004h",
                });
                return {} as never;
              }),
            subscribe: (onEvent) =>
              Effect.sync(() => {
                listeners.add(onEvent);
                return () => listeners.delete(onEvent);
              }),
            write: (input) =>
              Effect.gen(function* () {
                order.push("setup");
                const sentinel = /(__T3_SETUP_DONE___\w+:)/.exec(input.data)![1]!;
                yield* emit({
                  type: "output",
                  threadId: input.threadId,
                  terminalId: input.terminalId,
                  data: `\r\n${sentinel}0\r\n$ `,
                });
              }),
            closeIdle: () => Effect.void,
          }),
          ServerSettings.layerTest(),
          NodeCrypto.layer,
        ),
      ),
    );
    yield* f.restore({ runSetup: runner.runForThread }).pipe(
      Effect.provide(
        Layer.mock(ProjectLifecycle.ProjectLifecycleService)({
          getSettings: Effect.succeed({ enabled: true } as never),
          ensureForThread: (threadId, setupCheckout) =>
            Effect.gen(function* () {
              expect(threadId).toBe(f.input.threadId);
              expect(setupCheckout).toBe(f.cwd);
              expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("saved work\n");
              expect(yield* f.fs.readFileString(`${f.cwd}/note.txt`)).toBe("saved new file\n");
              order.push("files-restored", "lane-ready");
              return {} as never;
            }).pipe(Effect.orDie),
        }),
      ),
    );
    expect(order).toEqual(["files-restored", "lane-ready", "setup"]);
    expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(false);
  }).pipe(Effect.provide(layer), Effect.scoped),
);

it.live("restores a missing branch from its exact saved HEAD and working files", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.restore();
    expect((yield* f.command(["rev-parse", "HEAD"], f.cwd)).stdout.trim()).toBe(f.head);
    expect((yield* f.command(["branch", "--show-current"], f.cwd)).stdout.trim()).toBe(
      f.input.branch,
    );
    expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("saved work\n");
    expect(yield* f.fs.readFileString(`${f.cwd}/note.txt`)).toBe("saved new file\n");
    expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(false);
    expect(yield* f.fs.readFileString(`${f.root}/proof.txt`)).toBe("committed\n");
    expect(yield* f.fs.readFileString(`${f.root}/root-only.txt`)).toBe(
      "keep the existing checkout\n",
    );
    expect(f.counts()).toEqual({ contextReads: 1, setupCalls: 1 });
  }).pipe(Effect.provide(layer), Effect.scoped),
);

it.live("retries saved file restoration before setup after checkout already succeeded", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const failure = yield* f
      .restore({
        git: {
          ...f.driver,
          execute: (input) =>
            input.operation === "Workspace.restoreWorktree.restoreCheckpoint"
              ? Effect.fail(
                  new GitCommandError({
                    operation: input.operation,
                    command: "git restore",
                    cwd: input.cwd,
                    detail: "interrupted restoration",
                  }),
                )
              : f.driver.execute(input),
        },
      })
      .pipe(Effect.result);
    expect(failure._tag).toBe("Failure");
    expect(yield* f.fs.exists(f.cwd)).toBe(true);
    expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(true);
    expect(f.counts().setupCalls).toBe(0);
    yield* f.restore();
    expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("saved work\n");
    expect(yield* f.fs.readFileString(`${f.cwd}/note.txt`)).toBe("saved new file\n");
    expect(f.counts()).toEqual({ contextReads: 1, setupCalls: 1 });
  }).pipe(Effect.provide(layer), Effect.scoped),
);

it.live("does not overwrite an existing branch with an older checkpoint", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.command(["branch", f.input.branch, f.head]);
    yield* f.restore();
    expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("committed\n");
    expect(yield* f.fs.exists(`${f.cwd}/note.txt`)).toBe(false);
    expect(f.counts()).toEqual({ contextReads: 0, setupCalls: 1 });
  }).pipe(Effect.provide(layer), Effect.scoped),
);

it.live("refuses recovery from a checkpoint belonging to a different workspace", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const failure = yield* f
      .restore({
        checkpoints: {
          ...f.context,
          checkpointScopes: f.context.checkpointScopes.map((scope) => ({ ...scope, cwd: f.root })),
        },
      })
      .pipe(Effect.result);
    expect(failure._tag).toBe("Failure");
    if (failure._tag === "Failure") expect(failure.failure.message).toContain("no saved checkout");
    expect(yield* f.fs.exists(f.cwd)).toBe(false);
    expect((yield* f.command(["branch", "--list", f.input.branch])).stdout.trim()).toBe("");
    expect(f.counts().setupCalls).toBe(0);
  }).pipe(Effect.provide(layer), Effect.scoped),
);

it.live("preserves edits made after restored setup failed", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const failure = yield* f.restore({ failSetup: true }).pipe(Effect.result);
    expect(failure._tag).toBe("Failure");
    expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(true);
    yield* f.fs.writeFileString(`${f.cwd}/proof.txt`, "edited after setup failure\n");
    yield* f.restore();
    expect(yield* f.fs.readFileString(`${f.cwd}/proof.txt`)).toBe("edited after setup failure\n");
    expect(yield* f.fs.exists(`${f.cwd}.t3-setup-pending`)).toBe(false);
    expect(f.counts()).toEqual({ contextReads: 1, setupCalls: 2 });
  }).pipe(Effect.provide(layer), Effect.scoped),
);
