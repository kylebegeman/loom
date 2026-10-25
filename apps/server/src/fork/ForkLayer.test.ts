import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { vi } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as DeviceService from "../device/DeviceService.ts";
import { ServerEnvironmentIdentity } from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSettlement from "../orchestration-v2/ThreadSettlementService.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { ServerActivation } from "../serverActivation.ts";
import * as Directory from "./directory/DirectoryService.ts";
import { layerProjectLifecycle, layerReachLibrary } from "./ForkLayer.ts";
import { runForkMigrationSet } from "./persistence/migrations.ts";
import { ProjectLibraryMigrations } from "./project-library/migrations.ts";
import * as ProjectLifecycle from "./project-lifecycle/ProjectLifecycleService.ts";
import { ReachStore, ReachStoredComputer } from "./reach/library/ReachStore.ts";

// Keep orchestration external to this construction test; lifecycle and migrations stay real.
vi.mock("../orchestration-v2/runtimeLayer.ts", async () => {
  const Layer = await import("effect/Layer");
  const ThreadManagement = await import("../orchestration-v2/ThreadManagementService.ts");
  const ThreadSettlement = await import("../orchestration-v2/ThreadSettlementService.ts");
  return {
    layerThreadManagementProvided: Layer.mock(ThreadManagement.ThreadManagementService)({}),
    layerThreadSettlement: Layer.mock(ThreadSettlement.ThreadSettlementServiceV2)({}),
    layerProjectService: Layer.empty,
    layerEventSink: Layer.empty,
  };
});

class RuntimeLifecycle extends Context.Service<
  RuntimeLifecycle,
  ProjectLifecycle.ProjectLifecycleService["Service"]
>()("t3/fork/ForkLayer.test/RuntimeLifecycle") {}

class ForkLifecycle extends Context.Service<
  ForkLifecycle,
  ProjectLifecycle.ProjectLifecycleService["Service"]
>()("t3/fork/ForkLayer.test/ForkLifecycle") {}

// The mocked runtime layers remove their transitive dependencies at runtime.
const lifecycle = layerProjectLifecycle as unknown as typeof ProjectLifecycle.layer;
const dependencies = Layer.mergeAll(
  SqlitePersistence.layerMemory,
  ServerConfig.layerTest(process.cwd(), { prefix: "fork-lifecycle-layer-" }),
  Layer.mock(ThreadManagement.ThreadManagementService)({}),
  Layer.mock(ThreadSettlement.ThreadSettlementServiceV2)({}),
  Layer.mock(ProjectStore.ProjectStoreV2)({}),
  Layer.mock(DeviceService.DeviceService)({}),
  // Match server construction: background workers remain parked until activation.
  Layer.succeed(ServerActivation, Effect.never),
).pipe(Layer.provideMerge(NodeServices.layer));

it.effect(
  "migrates fresh lane tables before the shared lifecycle is acquired by runtime callers",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      expect(
        yield* sql`SELECT name FROM sqlite_schema WHERE name = 'fork_project_lifecycle_lanes'`,
      ).toEqual([]);

      const context = yield* Layer.build(
        Layer.merge(
          Layer.effect(RuntimeLifecycle, ProjectLifecycle.ProjectLifecycleService).pipe(
            Layer.provide(lifecycle),
          ),
          Layer.effect(ForkLifecycle, ProjectLifecycle.ProjectLifecycleService).pipe(
            Layer.provide(lifecycle),
          ),
        ),
      );
      const runtime = Context.get(context, RuntimeLifecycle);
      const fork = Context.get(context, ForkLifecycle);
      expect(runtime).toBe(fork);
      expect((yield* runtime.getSettings).enabled).toBe(true);
      expect(yield* sql`SELECT id FROM fork_project_lifecycle_lanes`).toEqual([]);
    }).pipe(Effect.provide(dependencies), Effect.scoped),
);

const LIBRARY_AUTHORITY = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_REDIRECT_URI: "https://library.example.test/api/auth/identity/callback",
};
const STUDIO = EnvironmentId.make("environment-studio");
const decodeReachComputer = Schema.decodeSync(ReachStoredComputer);
// Cloudflare, Pocket ID and the session table are built but never called by forget.
const reachDependencies = Layer.mergeAll(
  SqlitePersistence.layerMemory,
  ServerConfig.layerTest(process.cwd(), { prefix: "fork-reach-layer-" }),
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: LIBRARY_AUTHORITY })),
  Layer.succeed(HostProcess.Environment, LIBRARY_AUTHORITY),
  Layer.mock(AuthSessionRepository)({}),
  Layer.succeed(ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-library")),
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

it.effect("hands the directory the reach store the provisioner writes, so forget waits (F2)", () =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const context = yield* Layer.build(layerReachLibrary);
    const directory = Context.get(context, Directory.DirectoryService);
    const forgetStudio = directory.forget({ kind: "environment", environmentId: STUDIO }).pipe(
      Effect.flip,
      Effect.map((error) => error.reason),
    );
    expect(yield* forgetStudio).toBe("not-found");

    yield* Context.get(context, ReachStore).update((state) => ({
      ...state,
      computers: {
        ...state.computers,
        [STUDIO]: decodeReachComputer({
          seq: 1,
          keyFingerprint: null,
          hostname: "studio-loom.reach.example.test",
          tunnelId: null,
          dnsRecordId: null,
          origin: null,
          state: "ready",
          lastError: null,
          leftoverDnsRecordId: null,
          publisherSessionId: null,
          updatedAt: "2026-10-24T12:00:00.000Z",
          lastEnsuredAt: null,
          identity: null,
        }),
      },
    }));
    expect(yield* forgetStudio).toBe("reach-active");
  }).pipe(Effect.provide(reachDependencies), Effect.scoped),
);
