// @effect-diagnostics nodeBuiltinImport:off -- IPC barriers verify concurrent real build processes.
import * as NodeChildProcess from "node:child_process";
import type { HookEvent, HookInput } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ProjectLifecycle from "../fork/project-lifecycle/ProjectLifecycleService.ts";
import * as ClaudeWorktreeService from "./ClaudeWorktreeService.ts";
import { claudeWorktreeHooks } from "./claudeWorktreeHooks.ts";

const decodeCreatedWorktree = Schema.decodeUnknownEffect(
  Schema.Struct({ hookSpecificOutput: Schema.Struct({ worktreePath: Schema.String }) }),
);

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "loom-claude-worktrees-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.live(
  "fans out three isolated editors and builds, then integrates and removes only completed clean worktrees",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const config = yield* ServerConfig.ServerConfig;
      const source = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "loom-workflow-parent-" }),
      );
      const command = (cwd: string, args: ReadonlyArray<string>) =>
        git.execute({ operation: "test.claudeWorkflow", cwd, args });
      yield* command(source, ["init", "-b", "main"]);
      yield* command(source, ["config", "user.name", "Loom test"]);
      yield* command(source, ["config", "user.email", "test@example.com"]);
      yield* fs.writeFileString(path.join(source, ".gitignore"), ".build/\nnode_modules/\n");
      yield* fs.writeFileString(path.join(source, "base.js"), "globalThis.base = 1;\n");
      yield* command(source, ["add", "."]);
      yield* command(source, ["commit", "-m", "initial"]);
      const originHead = yield* git.resolveCommit({ cwd: source, revision: "HEAD" });
      yield* command(source, ["update-ref", "refs/remotes/origin/main", originHead.commitSha]);
      yield* fs.writeFileString(path.join(source, "unpushed.js"), "globalThis.unpushed = true;\n");
      yield* command(source, ["add", "."]);
      yield* command(source, ["commit", "-m", "unpushed parent work"]);
      const parentHead = yield* git.resolveCommit({ cwd: source, revision: "HEAD" });
      const owner = {
        threadId: ThreadId.make("workflow-parent"),
        projectId: ProjectId.make("project"),
        sessionId: "claude-session",
      };
      const setupTerminals = new Set<string | undefined>();
      const retainedCheckouts = new Map<string, ThreadId>();
      const serviceLayer = ClaudeWorktreeService.layer.pipe(
        Layer.provide(
          Layer.mock(ProjectLifecycle.ProjectLifecycleService)({
            getSettings: Effect.succeed({ enabled: true } as never),
            retainCheckout: (threadId, checkout) =>
              Effect.sync(() => {
                retainedCheckouts.set(checkout, threadId);
                return {} as never;
              }),
            releaseCheckout: (threadId, checkout) =>
              Effect.sync(() => {
                if (retainedCheckouts.get(checkout) === threadId)
                  retainedCheckouts.delete(checkout);
              }),
            currentBuildEnvironment: () => Effect.succeed(null),
          }),
        ),
        Layer.provide(
          Layer.mock(GitWorkflowService.GitWorkflowService)({
            createWorktree: (input) =>
              git.createWorktree(input, { worktreesDirectory: config.worktreesDir }),
            removeWorktree: (input) => git.removeWorktree(input),
            deleteLocalBranch: (input) => git.deleteLocalBranch(input),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
            runForThread: (input) =>
              Effect.sync(() => {
                expect(retainedCheckouts.get(input.worktreePath)).toBe(owner.threadId);
                setupTerminals.add(input.terminalId);
                return {
                  status: "started" as const,
                  scriptId: "setup",
                  scriptName: "Setup",
                  scriptCommand: "install dependencies",
                  terminalId: input.terminalId ?? "setup",
                  cwd: input.worktreePath,
                  async: false,
                  completion: fs
                    .makeDirectory(path.join(input.worktreePath, "node_modules"), {
                      recursive: true,
                    })
                    .pipe(
                      Effect.andThen(
                        fs.writeFileString(
                          path.join(input.worktreePath, "node_modules", "installed"),
                          "ready",
                        ),
                      ),
                      Effect.as({
                        exitCode: input.worktreePath.includes("failed-setup") ? 1 : 0,
                        durationMs: 0,
                      }),
                      Effect.orDie,
                    ),
                };
              }),
          }),
        ),
      );
      const service = yield* ClaudeWorktreeService.ClaudeWorktreeService.pipe(
        Effect.provide(serviceLayer),
      );
      const hooks = yield* claudeWorktreeHooks(service, owner);
      const invoke = (event: HookEvent, input: HookInput) =>
        Effect.tryPromise(() => {
          const callback = hooks[event]?.[0]?.hooks[0];
          if (callback === undefined) throw new Error(`Missing ${event} hook`);
          return callback(input, undefined, { signal: new AbortController().signal });
        });
      const baseInput = {
        session_id: owner.sessionId,
        transcript_path: "/test/transcript",
        cwd: source,
      };
      const worktrees = yield* Effect.forEach(
        [1, 2, 3],
        (index) =>
          Effect.gen(function* () {
            const result = yield* invoke("WorktreeCreate", {
              ...baseInput,
              hook_event_name: "WorktreeCreate",
              name: `screen-${index}`,
            });
            const output = yield* decodeCreatedWorktree(result);
            const cwd = output.hookSpecificOutput.worktreePath;
            expect(cwd.startsWith(`${config.worktreesDir}${path.sep}`)).toBe(true);
            expect(yield* git.resolveCommit({ cwd, revision: "HEAD" })).toEqual(parentHead);
            expect(yield* fs.readFileString(path.join(cwd, "node_modules", "installed"))).toBe(
              "ready",
            );
            const branch = (yield* git.statusDetailsLocal(cwd)).branch;
            expect(branch).not.toBeNull();
            if (index === 1) {
              yield* invoke("Stop", {
                ...baseInput,
                hook_event_name: "Stop",
                stop_hook_active: false,
              });
              expect(yield* fs.exists(cwd)).toBe(true);
            }
            const agentId = `agent-${index}`;
            yield* invoke("SubagentStart", {
              ...baseInput,
              cwd: index === 1 ? source : cwd,
              hook_event_name: "SubagentStart",
              agent_id: agentId,
              agent_type: "general-purpose",
            });
            if (index === 1)
              yield* invoke("PreToolUse", {
                ...baseInput,
                cwd,
                hook_event_name: "PreToolUse",
                agent_id: agentId,
                tool_name: "Write",
                tool_input: {},
                tool_use_id: "screen-edit",
              });
            yield* fs.writeFileString(
              path.join(cwd, `screen-${index}.js`),
              `globalThis.screen${index} = ${index};\n`,
            );
            return { cwd, index, branch: branch!, agentId };
          }),
        { concurrency: "unbounded" },
      );
      expect(new Set(worktrees.map((entry) => entry.cwd)).size).toBe(3);
      expect(setupTerminals.size).toBe(3);
      expect(setupTerminals.has(undefined)).toBe(false);
      expect([...retainedCheckouts.keys()].toSorted()).toEqual(
        worktrees.map(({ cwd }) => cwd).toSorted(),
      );

      yield* Effect.tryPromise(async () => {
        const workers = worktrees.map(({ cwd, index }) => {
          const child = NodeChildProcess.spawn(
            process.execPath,
            [
              "-e",
              `
        const fs = require('node:fs');
        const vm = require('node:vm');
        const path = require('node:path');
        const source = fs.readFileSync('screen-${index}.js', 'utf8');
        const compiled = new vm.Script(source);
        fs.mkdirSync('.build/tmp', { recursive: true });
        process.send('building');
        process.once('message', () => {
          compiled.runInThisContext();
          fs.writeFileSync('.build/result', String(globalThis.screen${index}));
          process.disconnect();
        });
      `,
            ],
            {
              cwd,
              env: {
                ...process.env,
                TMPDIR: path.join(cwd, ".build/tmp"),
                LOOM_LANE_BUILD: path.join(cwd, ".build"),
              },
              stdio: ["ignore", "ignore", "pipe", "ipc"],
            },
          );
          const ready = new Promise<void>((resolve, reject) => {
            child.once("message", (message) =>
              message === "building" ? resolve() : reject(new Error("Unexpected build event")),
            );
            child.once("error", reject);
            child.once("exit", () => reject(new Error("Build exited before the barrier")));
          });
          const exited = new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code) =>
              code === 0 ? resolve() : reject(new Error(`Build exited ${code}`)),
            );
          });
          return { child, ready, exited };
        });
        try {
          await Promise.all(workers.map((worker) => worker.ready));
          expect(workers.every((worker) => worker.child.exitCode === null)).toBe(true);
          for (const worker of workers) worker.child.send("finish");
          await Promise.all(workers.map((worker) => worker.exited));
        } finally {
          for (const worker of workers) if (worker.child.exitCode === null) worker.child.kill();
        }
      });
      for (const entry of worktrees) {
        expect(yield* fs.readFileString(path.join(entry.cwd, ".build", "result"))).toBe(
          String(entry.index),
        );
        yield* command(entry.cwd, ["add", `screen-${entry.index}.js`]);
        yield* command(entry.cwd, ["commit", "-m", `screen ${entry.index}`]);
      }
      yield* invoke("Stop", { ...baseInput, hook_event_name: "Stop", stop_hook_active: false });
      expect((yield* git.listWorktreePaths(source)).length).toBe(4);
      for (const entry of worktrees)
        yield* invoke("SubagentStop", {
          ...baseInput,
          cwd: source,
          hook_event_name: "SubagentStop",
          agent_id: entry.agentId,
          agent_type: "general-purpose",
          agent_transcript_path: "/test/agent",
          stop_hook_active: false,
        });
      yield* invoke("Stop", { ...baseInput, hook_event_name: "Stop", stop_hook_active: false });
      expect((yield* git.listWorktreePaths(source)).length).toBe(4);
      expect(
        yield* service.remove({
          ...owner,
          sessionId: "other-session",
          worktreePath: worktrees[0]!.cwd,
        }),
      ).toBe("unowned");
      const restarted = yield* ClaudeWorktreeService.ClaudeWorktreeService.pipe(
        Effect.provide(Layer.fresh(serviceLayer)),
      );
      expect(yield* restarted.describe({ ...owner, cwd: worktrees[0]!.cwd })).toContain(
        parentHead.commitSha,
      );
      for (const entry of worktrees) yield* command(source, ["merge", "--no-edit", entry.branch]);
      const dirty = worktrees[2]!;
      yield* fs.writeFileString(path.join(dirty.cwd, "unfinished.txt"), "keep this work");
      yield* restarted.sweep(owner);
      expect(yield* git.listWorktreePaths(source)).toEqual([source, dirty.cwd]);
      expect([...retainedCheckouts.keys()]).toEqual([dirty.cwd]);
      const refused = yield* invoke("WorktreeRemove", {
        ...baseInput,
        hook_event_name: "WorktreeRemove",
        worktree_path: dirty.cwd,
      }).pipe(Effect.result);
      expect(refused._tag).toBe("Failure");
      yield* fs.remove(path.join(dirty.cwd, "unfinished.txt"));
      yield* invoke("WorktreeRemove", {
        ...baseInput,
        hook_event_name: "WorktreeRemove",
        worktree_path: dirty.cwd,
      });
      yield* invoke("SessionEnd", { ...baseInput, hook_event_name: "SessionEnd", reason: "clear" });
      const failedSetup = yield* service
        .create({ ...owner, cwd: source, name: "failed-setup" })
        .pipe(Effect.flip);
      expect(failedSetup._tag).toBe("ClaudeWorktreeError");
      expect((yield* git.listWorktreePaths(source)).length).toBe(2);
      yield* invoke("Stop", { ...baseInput, hook_event_name: "Stop", stop_hook_active: false });
      expect(yield* git.listWorktreePaths(source)).toEqual([source]);
      expect(yield* git.listLocalBranchNames(source)).toEqual(["main"]);
      expect(retainedCheckouts.size).toBe(0);
      expect(
        (yield* fs.readDirectory(path.join(config.stateDir, "claude-worktrees"))).filter((name) =>
          name.endsWith(".json"),
        ),
      ).toEqual([]);
      for (const entry of worktrees) {
        expect(yield* fs.readFileString(path.join(source, `screen-${entry.index}.js`))).toContain(
          `screen${entry.index}`,
        );
      }
      expect(yield* fs.exists(path.join(source, ".build"))).toBe(false);
      expect((yield* git.statusDetailsLocal(source)).hasWorkingTreeChanges).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
