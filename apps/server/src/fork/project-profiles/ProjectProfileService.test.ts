import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as Settings from "../../serverSettings.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectProfilesMigrations } from "./migrations.ts";
import * as Profiles from "./ProjectProfileService.ts";
import * as Inspector from "./EnvInspectorLive.ts";
import * as Varlock from "./VarlockRunner.ts";
function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected call: ${String(key)}`);
    },
  });
}
const projectId = ProjectId.make("project"),
  threadId = ThreadId.make("thread");
const project = {
  projectId,
  workspaceRoot: "/root",
  scripts: [
    {
      id: "test",
      name: "Tests",
      command: "old test",
      icon: "test" as const,
      runOnWorktreeCreate: false,
    },
  ],
} as unknown as ProjectStore.ProjectRow;
const serviceLayer = Profiles.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(
        ProjectStore.ProjectStoreV2,
        partial<ProjectStore.ProjectStoreV2["Service"]>({
          get: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
        }),
      ),
      Layer.succeed(
        ProjectionStore.ProjectionStoreV2,
        partial<ProjectionStore.ProjectionStoreV2["Service"]>({
          getThreadShell: (id) =>
            Effect.succeed(
              id === threadId
                ? ({ id, projectId, worktreePath: "/worktree" } as OrchestrationV2ThreadShell)
                : ({ id, projectId: ProjectId.make("other") } as OrchestrationV2ThreadShell),
            ),
        }),
      ),
      Layer.succeed(
        Settings.ServerSettingsService,
        partial<Settings.ServerSettingsService["Service"]>({
          getSettings: Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            projectSettingsOverrides: {
              [projectId]: {
                defaultProjectScripts: [{ ...project.scripts[0]!, command: "current test" }],
              },
            },
          }),
        }),
      ),
      Layer.succeed(Inspector.EnvInspector, {
        inspect: (root, path) =>
          Effect.succeed({
            root,
            schema: { _tag: "ok", path, currentEnv: null, imports: [] },
            items: [],
            envFiles: [],
            unschematizedKeys: [],
          }),
      }),
      Layer.succeed(Varlock.VarlockRunner, {
        detect: Effect.succeed({ _tag: "available" as const, version: "1.20.0" }),
        validate: () => Effect.succeed({ ok: true, itemErrors: {}, rootErrors: [], durationMs: 0 }),
      }),
    ),
  ),
);
const run = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectProfilesMigrations);
    return yield* program.pipe(Effect.provide(serviceLayer));
  }).pipe(Effect.provide(layerMemory));
describe("environment-local project profile service", () => {
  it.effect("merges updates, resolves current upstream actions, preserves notes and resets", () =>
    run(
      Effect.gen(function* () {
        const service = yield* Profiles.ProjectProfileService;
        const saved = yield* service.update({
          projectId,
          patch: {
            agentNotes: "private",
            commands: { test: { _tag: "action", scriptId: "test" } },
          },
        });
        expect(saved.updatedAt).not.toBe(null);
        yield* service.update({
          projectId,
          patch: { budgets: { dailyTokens: 1000, threadTokens: null } },
        });
        expect((yield* service.get(projectId)).agentNotes).toBe("private");
        expect(
          yield* service.varlockCommand({ projectId, threadId, target: { intent: "test" } }),
        ).toEqual({ cwd: "/worktree", commandLine: "varlock run -- sh -c 'current test'" });
        expect((yield* service.envReport({ projectId })).root).toBe("/root");
        expect(
          (yield* Effect.flip(service.envReport({ projectId, threadId: ThreadId.make("other") })))
            .reason,
        ).toBe("thread-not-found");
        expect(
          (yield* Effect.flip(service.varlockCommand({ projectId, target: { intent: "build" } })))
            .reason,
        ).toBe("action-not-found");
        yield* service.update({
          projectId,
          patch: {
            commands: { build: { _tag: "command", command: "echo 'done'" } },
            env: { schemaPath: ".env.schema", varlock: "never" },
          },
        });
        expect(
          (yield* service.varlockCommand({ projectId, target: { intent: "build" } })).commandLine,
        ).toBe("echo 'done'");
        expect((yield* service.reset(projectId)).agentNotes).toBe("");
      }),
    ),
  );
  it.effect("shares by default, refuses after opt-out, and bounds agent output", () =>
    run(
      Effect.gen(function* () {
        const service = yield* Profiles.ProjectProfileService;
        yield* service.update({ projectId, patch: { agentNotes: "note".repeat(2000) } });
        const summary = yield* service.forAgent(threadId, true);
        expect(summary).toContain("Project notes:");
        expect(summary.length).toBeLessThanOrEqual(6000);
        yield* service.updateSettings({ agentTool: false });
        expect((yield* Effect.flip(service.forAgent(threadId, true))).reason).toBe(
          "sharing-disabled",
        );
      }),
    ),
  );
});
