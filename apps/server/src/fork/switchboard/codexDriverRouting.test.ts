import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as CodexAdapterV2 from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CodexInstallation from "../../provider/CodexInstallation.ts";
import { CodexDriver } from "../../provider/Drivers/CodexDriver.ts";
import * as ModelManifest from "../../provider/ModelManifest.ts";
import * as ResetCreditCoordinator from "../../provider/resetCreditCoordinator.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { makeRoutingTestHost } from "./routingTestHost.ts";

const layerTest = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-codex-driver-routing-",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(IdAllocator.layer),
  Layer.provideMerge(McpProviderSessions.layer),
  Layer.provideMerge(
    Layer.mock(CodexAdapterV2.CodexAppServerClientFactory)({
      open: () => Effect.die("Readiness must not open a Codex session"),
    }),
  ),
  Layer.provideMerge(
    Layer.mock(CodexInstallation.CodexInstallation)({
      managedDirectory: "unused-managed-installation",
    }),
  ),
  Layer.provideMerge(Layer.mock(ServerSecretStore.ServerSecretStore)({})),
  Layer.provideMerge(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("00000000-0000-4000-8000-000000000001")),
    }),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ModelManifest.layerTest),
  Layer.provideMerge(ResetCreditCoordinator.layerTest),
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  ),
  Layer.provideMerge(ProviderLatestVersions.layer),
  Layer.provideMerge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Readiness must not make an HTTP request")),
    ),
  ),
);

const decodeRequest = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      method: Schema.String,
    }),
  ),
);

it.layer(layerTest)("CodexDriver with Switchboard routing", (it) => {
  it.effect("drops native allowances while routed and restores them when routing turns off", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const homePath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-routing-home-" });
      // A model cache newer than any probe on the test clock, so the ChatGPT
      // catalog refresh does not wait.
      yield* fs.writeFileString(
        `${homePath}/models_cache.json`,
        JSON.stringify({ fetched_at: "2026-01-01T00:00:00.000Z", models: [] }),
      );
      const routing = yield* makeRoutingTestHost;
      const initialProbeGate = yield* Deferred.make<void>();
      const probes: Array<{ routed: boolean; methods: string[] }> = [];
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.gen(function* () {
          if (
            !ChildProcess.isStandardCommand(command) ||
            command.command !== "/fixture/codex" ||
            !command.args.includes("app-server")
          ) {
            return yield* Effect.die("Readiness must only use the fixture app-server");
          }
          const probe = { routed: yield* routing.routed, methods: [] as string[] };
          probes.push(probe);
          const firstProbe = probes.length === 1;
          const output = yield* Queue.unbounded<string>();
          const decoder = new TextDecoder();
          let remainder = "";
          return ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(probes.length),
            exitCode: Effect.never,
            isRunning: Effect.succeed(true),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.forEach((bytes: Uint8Array) =>
              Effect.gen(function* () {
                remainder += decoder.decode(bytes, { stream: true });
                const lines = remainder.split("\n");
                remainder = lines.pop() ?? "";
                for (const line of lines) {
                  const request = yield* decodeRequest(line).pipe(Effect.orDie);
                  probe.methods.push(request.method);
                  if (request.method === "initialized") continue;
                  let result: unknown;
                  switch (request.method) {
                    case "initialize":
                      if (firstProbe) yield* Deferred.await(initialProbeGate);
                      result = {
                        userAgent: "codex/0.156.1",
                        codexHome: homePath,
                        platformFamily: "unix",
                        platformOs: "linux",
                      };
                      break;
                    case "account/read":
                      result = {
                        account: {
                          type: "chatgpt",
                          email: "retained-native@example.test",
                          planType: "plus",
                        },
                        requiresOpenaiAuth: true,
                      };
                      break;
                    case "skills/list":
                      result = { data: [] };
                      break;
                    case "config/read":
                      result = { config: {}, origins: {}, layers: null };
                      break;
                    case "model/list":
                      result = {
                        data: [
                          {
                            id: "gpt-test",
                            model: "gpt-test",
                            displayName: "GPT Test",
                            description: "Fixture model",
                            hidden: false,
                            isDefault: true,
                            defaultReasoningEffort: "medium",
                            supportedReasoningEfforts: [],
                          },
                        ],
                        nextCursor: null,
                      };
                      break;
                    case "account/rateLimits/read":
                      result = {
                        rateLimits: { primary: { usedPercent: 31, windowDurationMins: 300 } },
                        rateLimitResetCredits: { availableCount: 2, credits: [] },
                      };
                      break;
                    default:
                      return yield* Effect.die(`Unexpected readiness request: ${request.method}`);
                  }
                  yield* Queue.offer(output, `${JSON.stringify({ id: request.id, result })}\n`);
                }
              }),
            ),
            stdout: Stream.encodeText(Stream.fromQueue(output)),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          });
        }),
      );
      const instance = yield* CodexDriver.create({
        instanceId: ProviderInstanceId.make("codex-routing-test"),
        displayName: "Codex routing test",
        enabled: true,
        environment: [],
        config: { ...CodexDriver.defaultConfig(), binaryPath: "/fixture/codex", homePath },
      }).pipe(
        Effect.provideService(ProviderHost.ProviderHost, routing.host),
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const firstNative = yield* Stream.toPull(
        instance.snapshot.streamChanges.pipe(
          Stream.filter((snapshot) => snapshot.usageLimits?.windows.length === 1),
        ),
      );
      yield* Deferred.succeed(initialProbeGate, undefined);
      const [nativeSnapshot] = yield* firstNative;
      expect(nativeSnapshot.status).toBe("ready");
      expect(nativeSnapshot.auth).toMatchObject({
        status: "authenticated",
        type: "chatgpt",
        email: "retained-native@example.test",
      });
      expect(nativeSnapshot.usageLimits?.windows[0]?.usedPercent).toBe(31);
      expect(nativeSnapshot.usageLimits?.resetCredits?.availableCount).toBe(2);
      yield* routing.listening;

      const routedUpdate = yield* Stream.toPull(
        instance.snapshot.streamChanges.pipe(
          Stream.filter((snapshot) => snapshot.usageLimits?.unavailable?.reason === "unsupported"),
        ),
      );
      yield* routing.setRouted(true);
      const [routedSnapshot] = yield* routedUpdate;
      expect(routedSnapshot.status).toBe("ready");
      expect(routedSnapshot.auth).toEqual(nativeSnapshot.auth);
      expect(routedSnapshot.models).toEqual(nativeSnapshot.models);
      expect(routedSnapshot.usageLimits?.windows).toEqual([]);
      expect(routedSnapshot.usageLimits?.resetCredits).toBeUndefined();
      expect(probes.map((probe) => probe.routed)).toEqual([false, true]);
      expect(probes[0]?.methods).toContain("account/rateLimits/read");
      expect(probes[1]?.methods).not.toContain("account/rateLimits/read");

      const restoredUpdate = yield* Stream.toPull(
        instance.snapshot.streamChanges.pipe(
          Stream.filter((snapshot) => snapshot.usageLimits?.windows.length === 1),
        ),
      );
      yield* routing.setRouted(false);
      const [restoredSnapshot] = yield* restoredUpdate;
      expect(restoredSnapshot.status).toBe("ready");
      expect(restoredSnapshot.auth).toEqual(nativeSnapshot.auth);
      expect(restoredSnapshot.usageLimits?.unavailable).toBeUndefined();
      expect(restoredSnapshot.usageLimits?.windows).toEqual(nativeSnapshot.usageLimits?.windows);
      expect(restoredSnapshot.usageLimits?.resetCredits).toEqual(
        nativeSnapshot.usageLimits?.resetCredits,
      );
      expect(probes.map((probe) => probe.routed)).toEqual([false, true, false]);
      expect(probes[2]?.methods).toContain("account/rateLimits/read");
    }).pipe(Effect.scoped),
  );
});
