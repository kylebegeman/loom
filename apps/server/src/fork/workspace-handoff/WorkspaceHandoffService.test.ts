import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ModelSelection,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as CommandReceiptStore from "../../orchestration-v2/CommandReceiptStore.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as Settings from "../../serverSettings.ts";
import * as SourceControlRepository from "../../sourceControl/SourceControlRepositoryService.ts";
import * as ProjectLifecycle from "../project-lifecycle/ProjectLifecycleService.ts";
import * as Handoff from "./WorkspaceHandoffService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";

const platform = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "handoff-test-" })),
  Layer.provideMerge(NodeServices.layer),
);
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const root = yield* fs.makeTempDirectoryScoped();
  const remote = `${root}/remote`;
  const source = `${root}/source`;
  const destination = `${root}/destination`;
  const execute = (cwd: string, args: string[]) =>
    git.execute({ operation: "handoff-test", cwd, args });
  yield* fs.makeDirectory(remote);
  yield* execute(remote, ["init", "--bare", "-b", "main"]);
  yield* execute(root, ["clone", remote, source]);
  yield* execute(source, ["config", "user.email", "test@example.test"]);
  yield* execute(source, ["config", "user.name", "Handoff test"]);
  yield* fs.writeFileString(`${source}/tracked.txt`, "saved work\n");
  yield* fs.writeFileString(`${source}/.gitignore`, ".env\nnode_modules/\n");
  yield* execute(source, ["add", "."]);
  yield* execute(source, ["commit", "-m", "saved"]);
  yield* execute(source, ["push", "-u", "origin", "main"]);
  yield* execute(source, ["checkout", "-b", "feature"]);
  yield* execute(source, ["push", "-u", "origin", "feature"]);
  yield* execute(root, ["clone", remote, destination]);
  const now = DateTime.makeUnsafe("2026-10-12T00:00:00Z");
  let sourceShell = {
    id: ThreadId.make("source-thread"),
    projectId: ProjectId.make("source-project"),
    title: "Saved work",
    branch: "feature",
    worktreePath: null,
    status: "completed",
    archivedAt: null,
    deletedAt: null,
    activeRunId: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestUserMessageAt: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestRunId: null,
    settledOverride: null,
    updatedAt: now,
  } as unknown as OrchestrationV2ThreadShell;
  let prepared: {
    id: ThreadId;
    projectId: ProjectId;
    worktreePath: string;
    branch: string;
    modelSelection: ModelSelection;
    runtimeMode: RuntimeMode;
  } | null = null;
  let provider: ServerProvider | undefined = {
    instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [
      {
        slug: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        aliases: [],
      },
    ],
  } as unknown as ServerProvider;
  let providerChecks = 0;
  let setupFails = false;
  let laneData: string | null = null;
  let deliveryCount = 0;
  let delivered = false;
  let launchCount = 0;
  const receipts = new Map<string, CommandReceiptStore.CommandReceiptV2>();
  const contextFor = (isSource: boolean) =>
    Layer.build(Handoff.layer).pipe(
      Effect.provideService(ProviderRegistry.ProviderRegistry, {
        refreshInstance: () =>
          Effect.sync(() => {
            providerChecks++;
            return provider ? [provider] : [];
          }),
      } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
      Effect.provideService(CommandReceiptStore.CommandReceiptStoreV2, {
        getByCommandId: (id) => Effect.succeed(Option.fromNullishOr(receipts.get(id))),
        insertIfAbsent: () => Effect.die("unused"),
        upsert: () => Effect.die("unused"),
        getProjectByCommandId: () => Effect.die("unused"),
      } as CommandReceiptStore.CommandReceiptStoreV2["Service"]),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, {
        getThreadShell: () => Effect.sync(() => (isSource ? sourceShell : null)),
      } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
      Effect.provideService(ThreadManagement.ThreadManagementService, {
        getThreadSnapshotWindow: () =>
          Effect.succeed({
            projection: {
              messages: [
                {
                  id: "initial",
                  role: "user",
                  text: "Keep the source until the destination is ready.",
                },
              ],
            },
          }),
        getTimelinePage: () => Effect.succeed({ items: [] }),
        getMessageCount: () => Effect.succeed(1),
        getThreadRecords: () =>
          Effect.sync(() => ({
            thread: prepared,
            messages: delivered ? [{ id: "handoff:request-1234:message" }] : [],
          })),
        sendToThread: () =>
          Effect.sync(() => {
            if (!delivered) deliveryCount++;
            delivered = true;
            return {} as never;
          }),
        dispatch: (command: import("@t3tools/contracts").OrchestrationV2Command) =>
          Effect.sync(() => {
            receipts.set(command.commandId, {
              commandId: command.commandId,
              threadId: "threadId" in command ? command.threadId : ThreadId.make("unused"),
              commandType: command.type,
              status: "accepted",
              acceptedAt: now,
              resultSequence: 1 as never,
              error: null,
            });
            if (command.type === "thread.settle")
              sourceShell = { ...sourceShell, settledOverride: "settled" };
            return {} as never;
          }),
      } as unknown as ThreadManagement.ThreadManagementService["Service"]),
      Effect.provideService(ThreadLaunch.ThreadLaunchService, {
        launch: (input: ThreadLaunch.ThreadLaunchInput) =>
          Effect.gen(function* () {
            expect(input.waitForPreparation).toBe(true);
            const strategy = input.workspaceStrategy;
            if (strategy.type !== "worktree")
              return yield* Effect.die("expected a managed worktree");
            const worktree = `${root}/worktree`;
            if (prepared === null) {
              launchCount++;
              yield* execute(destination, [
                "worktree",
                "add",
                "-b",
                strategy.branch!,
                worktree,
                strategy.baseRef,
              ]).pipe(
                Effect.mapError(
                  (cause) =>
                    new ThreadLaunch.ThreadLaunchError({
                      operation: "provision-worktree",
                      commandId: input.commandId,
                      projectId: input.projectId,
                      cause,
                    }),
                ),
              );
              prepared = {
                id: input.threadId!,
                projectId: input.projectId,
                branch: strategy.branch!,
                worktreePath: worktree,
                modelSelection: input.modelSelection,
                runtimeMode: input.runtimeMode,
              };
            }
            if (setupFails)
              return yield* Effect.fail(
                new ThreadLaunch.ThreadLaunchError({
                  operation: "run-setup-script",
                  commandId: input.commandId,
                  projectId: input.projectId,
                  cause: "test failure",
                }),
              );
            return { threadId: prepared.id } as never;
          }),
      } as unknown as ThreadLaunch.ThreadLaunchService["Service"]),
      Effect.provideService(ProjectService.ProjectService, {
        getById: (id: ProjectId) =>
          Effect.succeed(Option.some({ id, workspaceRoot: isSource ? source : destination })),
      } as unknown as ProjectService.ProjectService["Service"]),
      Effect.provideService(ServerEnvironment.ServerEnvironment, {
        getEnvironmentId: Effect.succeed(
          EnvironmentId.make(isSource ? "source-host" : "destination-host"),
        ),
      } as ServerEnvironment.ServerEnvironment["Service"]),
      Effect.provideService(Settings.ServerSettingsService, {
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      } as unknown as Settings.ServerSettingsService["Service"]),
      Effect.provideService(SourceControlRepository.SourceControlRepositoryService, {
        cloneRepository: (input: { remoteUrl: string; destinationPath: string }) =>
          execute(root, ["clone", input.remoteUrl, input.destinationPath]).pipe(
            Effect.as({} as never),
          ),
      } as unknown as SourceControlRepository.SourceControlRepositoryService["Service"]),
      Effect.provideService(ProjectLifecycle.ProjectLifecycleService, {
        currentBuildEnvironment: () =>
          Effect.succeed(laneData === null ? null : { spacePath: laneData }),
      } as unknown as ProjectLifecycle.ProjectLifecycleService["Service"]),
    );
  const src = Context.get(yield* contextFor(true), Handoff.WorkspaceHandoffService);
  const dst = Context.get(yield* contextFor(false), Handoff.WorkspaceHandoffService);
  return {
    src,
    dst,
    root,
    fs,
    source,
    destination,
    execute,
    projectId: ProjectId.make("destination-project"),
    sourceShell: () => sourceShell,
    changeSource: () => {
      sourceShell = { ...sourceShell, title: "Changed work" };
    },
    failSetup: (fail: boolean) => {
      setupFails = fail;
    },
    useLane: (space: string) => {
      laneData = space;
    },
    setProvider: (changes: Partial<ServerProvider> | null) => {
      provider = changes === null ? undefined : { ...provider!, ...changes };
    },
    providerChecks: () => providerChecks,
    deliveryCount: () => deliveryCount,
    launchCount: () => launchCount,
  };
});
const run = <A, E>(effect: Effect.Effect<A, E, Effect.Services<typeof fixture>>) =>
  effect.pipe(Effect.provide(platform), Effect.scoped);

describe("destination-first workspace handoff", () => {
  it.live(
    "prepares published code, settles the source and starts a linked continuation exactly once",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          const offer = yield* f.src.offer({
            threadId: ThreadId.make("source-thread"),
            requestId: "request-1234",
          });
          const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
          expect(f.sourceShell().settledOverride).toBeNull();
          expect(yield* f.fs.readFileString(`${receipt.worktreePath}/tracked.txt`)).toBe(
            "saved work\n",
          );
          expect((yield* f.src.finish({ offer, receipt })).sourceSettled).toBe(true);
          expect(f.sourceShell().settledOverride).toBe("settled");
          yield* f.dst.resume({ offer, receipt });
          yield* f.dst.resume({ offer, receipt });
          expect(f.deliveryCount()).toBe(1);
          yield* f.dst.prepare({ offer, projectId: f.projectId });
          expect(f.launchCount()).toBe(1);
        }),
      ),
  );
  it.live("retries accepted source settlement after checkout cleanup", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
        yield* f.src.finish({ offer, receipt });
        yield* f.fs.remove(f.source, { recursive: true });
        expect((yield* f.src.finish({ offer, receipt })).sourceSettled).toBe(true);
      }),
    ),
  );
  it.live("retries delivery after the destination changes HEAD and rejects altered receipts", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
        yield* f.dst.resume({ offer, receipt });
        yield* f.execute(receipt.worktreePath, [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.test",
          "commit",
          "--allow-empty",
          "-m",
          "continued work",
        ]);
        yield* f.dst.resume({ offer, receipt });
        expect((yield* f.dst.prepare({ offer, projectId: f.projectId })).headSha).toBe(
          offer.headSha,
        );
        expect(f.deliveryCount()).toBe(1);
        expect(
          (yield* f.dst
            .resume({ offer, receipt: { ...receipt, worktreePath: f.source } })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-receipt");
        expect(
          (yield* f.src
            .finish({ offer, receipt: { ...receipt, branch: "wrong" } })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-receipt");
      }),
    ),
  );
  it.live("tracks the published branch so an unchanged continuation can hand off again", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
        expect(
          (yield* f.execute(receipt.worktreePath, [
            "rev-parse",
            "--abbrev-ref",
            "@{upstream}",
          ])).stdout.trim(),
        ).toBe("origin/feature");
      }),
    ),
  );
  it.live("restores a destination project whose checkout was released", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        yield* f.fs.remove(f.destination, { recursive: true });
        const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
        expect(yield* f.fs.readFileString(`${receipt.worktreePath}/tracked.txt`)).toBe(
          "saved work\n",
        );
        expect(f.sourceShell().settledOverride).toBeNull();
      }),
    ),
  );
  it.live("keeps ignored source configuration even under permissive cleanup settings", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
        yield* f.fs.writeFileString(`${f.source}/.env`, "local configuration");
        expect((yield* f.src.finish({ offer, receipt })).sourceSettled).toBe(false);
        expect(yield* f.fs.readFileString(`${f.source}/.env`)).toBe("local configuration");
      }),
    ),
  );
  it.live(
    "keeps the source on setup failure and reuses the destination when preparation is retried",
    () =>
      run(
        Effect.gen(function* () {
          const f = yield* fixture;
          const offer = yield* f.src.offer({
            threadId: ThreadId.make("source-thread"),
            requestId: "request-1234",
          });
          f.failSetup(true);
          expect(
            (yield* f.dst.prepare({ offer, projectId: f.projectId }).pipe(Effect.flip)).reason,
          ).toBe("preparation-failed");
          expect(f.sourceShell().settledOverride).toBeNull();
          f.failSetup(false);
          yield* f.dst.prepare({ offer, projectId: f.projectId });
          expect(f.launchCount()).toBe(1);
        }),
      ),
  );
  it.live("refuses to settle a source that changed during destination preparation", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
        f.changeSource();
        expect((yield* f.src.finish({ offer, receipt }).pipe(Effect.flip)).reason).toBe(
          "source-changed",
        );
        expect(f.sourceShell().settledOverride).toBeNull();
        expect(yield* f.fs.exists(receipt.worktreePath)).toBe(true);
      }),
    ),
  );
  it.live("retains application data and source configuration after the destination is ready", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
        yield* f.fs.makeDirectory(`${f.root}/lane/data`, { recursive: true });
        yield* f.fs.writeFileString(`${f.root}/lane/data/keep`, "application data");
        f.useLane(`${f.root}/lane`);
        expect((yield* f.src.finish({ offer, receipt })).sourceSettled).toBe(false);
        expect(yield* f.fs.readFileString(`${f.root}/lane/data/keep`)).toBe("application data");
        yield* f.fs.writeFileString(`${f.source}/.env`, "local configuration");
        expect(f.sourceShell().settledOverride).toBeNull();
      }),
    ),
  );
  it.live("rejects local edits, unpublished commits and a different destination repository", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.fs.writeFileString(`${f.source}/notes`, "unsaved");
        expect(
          (yield* f.src
            .offer({ threadId: ThreadId.make("source-thread"), requestId: "request-1234" })
            .pipe(Effect.flip)).reason,
        ).toBe("local-changes");
        yield* f.execute(f.source, ["add", "notes"]);
        yield* f.execute(f.source, ["commit", "-m", "unpublished"]);
        expect(
          (yield* f.src
            .offer({ threadId: ThreadId.make("source-thread"), requestId: "request-1234" })
            .pipe(Effect.flip)).reason,
        ).toBe("unpublished");
        yield* f.execute(f.source, ["push"]);
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        yield* f.execute(f.destination, [
          "remote",
          "set-url",
          "origin",
          `${f.root}/different-repository`,
        ]);
        expect(
          (yield* f.dst.prepare({ offer, projectId: f.projectId }).pipe(Effect.flip)).reason,
        ).toBe("repository-mismatch");
        expect(f.sourceShell().settledOverride).toBeNull();
      }),
    ),
  );
});

it.live.each([
  ["missing", null],
  ["disabled", { enabled: false }],
  ["uninstalled", { installed: false }],
  ["unavailable", { availability: "unavailable" }],
  ["failed", { status: "error" }],
  ["unchecked", { status: "warning" }],
  ["signed out", { auth: { status: "unauthenticated" } }],
  ["unsupported runtime", { supportedRuntimeModes: [] }],
  ["missing model", { models: [] }],
  [
    "model needs update",
    {
      updateRequiredModels: [
        {
          slug: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          name: "Test model",
          minVersion: "999.0.0",
        },
      ],
    },
  ],
] satisfies ReadonlyArray<readonly [string, Partial<ServerProvider> | null]>)(
  "keeps the source and avoids setup when the destination provider is %s",
  ([_label, changes]) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const offer = yield* f.src.offer({
          threadId: ThreadId.make("source-thread"),
          requestId: "request-1234",
        });
        f.setProvider(changes);
        expect(
          (yield* f.dst.prepare({ offer, projectId: f.projectId }).pipe(Effect.flip)).reason,
        ).toBe("provider-not-ready");
        expect(f.sourceShell().settledOverride).toBeNull();
        expect(f.launchCount()).toBe(0);
      }),
    ),
);
it.live("rechecks provider readiness for a saved preparation and recovers after sign-in", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const offer = yield* f.src.offer({
        threadId: ThreadId.make("source-thread"),
        requestId: "request-1234",
      });
      const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
      f.setProvider({ auth: { status: "unauthenticated" } });
      expect(
        (yield* f.dst.prepare({ offer, projectId: f.projectId }).pipe(Effect.flip)).reason,
      ).toBe("provider-not-ready");
      expect((yield* f.dst.resume({ offer, receipt }).pipe(Effect.flip)).reason).toBe(
        "provider-not-ready",
      );
      expect(f.deliveryCount()).toBe(0);
      f.setProvider({ auth: { status: "authenticated" } });
      yield* f.dst.prepare({ offer, projectId: f.projectId });
      yield* f.dst.resume({ offer, receipt });
      f.setProvider(null);
      const checks = f.providerChecks();
      yield* f.dst.prepare({ offer, projectId: f.projectId });
      yield* f.dst.resume({ offer, receipt });
      expect(f.providerChecks()).toBe(checks);
      expect(f.launchCount()).toBe(1);
      expect(f.deliveryCount()).toBe(1);
    }),
  ),
);
it.live("rejects destination edits on preparation replay and continuation delivery", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const offer = yield* f.src.offer({
        threadId: ThreadId.make("source-thread"),
        requestId: "request-1234",
      });
      const receipt = yield* f.dst.prepare({ offer, projectId: f.projectId });
      yield* f.fs.writeFileString(`${receipt.worktreePath}/tracked.txt`, "destination edits");
      expect(
        (yield* f.dst.prepare({ offer, projectId: f.projectId }).pipe(Effect.flip)).reason,
      ).toBe("preparation-failed");
      expect((yield* f.dst.resume({ offer, receipt }).pipe(Effect.flip)).reason).toBe(
        "preparation-failed",
      );
      expect(f.deliveryCount()).toBe(0);
      expect(f.sourceShell().settledOverride).toBeNull();
      expect(yield* f.fs.readFileString(`${receipt.worktreePath}/tracked.txt`)).toBe(
        "destination edits",
      );
    }),
  ),
);

it.live("accepts driver-advertised model aliases and readiness without an auth probe", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const offer = yield* f.src.offer({
        threadId: ThreadId.make("source-thread"),
        requestId: "request-1234",
      });
      f.setProvider({
        auth: { status: "unknown" },
        models: [
          {
            slug: "canonical-model",
            name: "Canonical model",
            isCustom: false,
            capabilities: null,
            aliases: [DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model],
          },
        ],
      });
      yield* f.dst.prepare({ offer, projectId: f.projectId });
      expect(f.launchCount()).toBe(1);
    }),
  ),
);
