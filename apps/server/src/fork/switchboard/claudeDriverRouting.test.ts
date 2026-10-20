import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ModelCatalog from "@t3tools/provider-core/server/ModelCatalog";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { vi } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import * as ClaudeAdapterV2 from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { ClaudeDriver } from "../../provider/Drivers/ClaudeDriver.ts";
import * as ResetCreditCoordinator from "../../provider/resetCreditCoordinator.ts";
import { makeRoutingTestHost } from "./routingTestHost.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const layerTest = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-claude-driver-routing-",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(IdAllocator.layer),
  Layer.provideMerge(McpProviderSessions.layer),
  Layer.provideMerge(ResetCreditCoordinator.layerTest),
  Layer.provideMerge(Layer.mock(ClaudeAdapterV2.ClaudeAgentSdkQueryRunner)({})),
  Layer.provideMerge(
    Layer.succeed(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  ),
  Layer.provideMerge(ProviderLatestVersions.layer),
  Layer.provideMerge(
    Layer.succeed(ModelCatalog.ModelCatalog, {
      current: () => Effect.succeed(undefined),
      bundled: () => undefined,
      refreshInBackground: Effect.void,
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Readiness must not make an HTTP request")),
    ),
  ),
);

function hasKeyHelper(options: ClaudeSdk.Options): boolean {
  return (
    typeof options.settings === "object" &&
    options.settings !== null &&
    "apiKeyHelper" in options.settings
  );
}

let helperCalls = 0;
const readinessSpawner = ChildProcessSpawner.make((command) => {
  if (ChildProcess.isStandardCommand(command) && command.command === "/owning-host/key-helper") {
    assert.deepEqual(command.args, []);
    assert.equal(command.options.env?.LOOM_SWITCHBOARD_URL, "http://owning-host.example:8317");
    assert.equal(command.options.env?.LOOM_SWITCHBOARD_KEY_HELPER, "/owning-host/key-helper");
    assert.equal(command.options.env?.ANTHROPIC_API_KEY, undefined);
    helperCalls++;
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(2),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make("fixture-switchboard-key\n")),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  }
  if (
    !ChildProcess.isStandardCommand(command) ||
    command.args.length !== 1 ||
    command.args[0] !== "--version"
  ) {
    return Effect.die("Readiness must not start a provider session or updater");
  }
  return Effect.succeed(
    ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(1),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      unref: Effect.succeed(Effect.void),
      stdin: Sink.drain,
      stdout: Stream.encodeText(Stream.make("2.1.288 (Claude Code)")),
      stderr: Stream.empty,
      all: Stream.empty,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
    }),
  );
});

it.layer(layerTest)("ClaudeDriver with Switchboard routing", (it) => {
  it.effect(
    "verifies routed auth with the owning host's helper and keeps native auth apart",
    () =>
      Effect.gen(function* () {
        helperCalls = 0;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-routing-home-" });
        const configDir = path.join(tempDir, "claude-home");
        yield* fs.makeDirectory(configDir);
        yield* fs.writeFileString(
          path.join(configDir, ".claude.json"),
          JSON.stringify({
            oauthAccount: { organizationUuid: "native-workspace" },
          }),
        );
        const routing = yield* makeRoutingTestHost;
        const hostEnvironment = {
          HOME: tempDir,
          LOOM_SWITCHBOARD_URL: "http://owning-host.example:8317",
          LOOM_SWITCHBOARD_KEY_HELPER: "/owning-host/key-helper",
        };
        const probeOptions: ClaudeSdk.Options[] = [];
        const usageModes: string[] = [];
        let releaseInitialProbe = () => {};
        const initialProbeGate = new Promise<void>((resolve) => {
          releaseInitialProbe = resolve;
        });
        const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
          assert.ok(options);
          const routed = hasKeyHelper(options);
          probeOptions.push(options);
          const initial = probeOptions.length === 1;
          return {
            initializationResult: async () => {
              if (initial) await initialProbeGate;
              return {
                account: routed
                  ? {
                      email: "native-account@example.test",
                      subscriptionType: "max",
                      tokenSource: "apiKeyHelper",
                      apiProvider: "firstParty",
                    }
                  : { tokenSource: "none", apiKeySource: "none", apiProvider: "firstParty" },
                commands: [],
              };
            },
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
              usageModes.push(routed ? "switchboard" : "native");
              return {
                rate_limits_available: true,
                rate_limits: { five_hour: { utilization: 12 } },
              };
            },
          } as unknown as ReturnType<typeof ClaudeSdk.query>;
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releaseInitialProbe();
            query.mockRestore();
          }),
        );
        const instance = yield* ClaudeDriver.create({
          instanceId: ProviderInstanceId.make("claude-routing-test"),
          displayName: "Claude routing test",
          enabled: true,
          environment: [
            {
              name: "LOOM_SWITCHBOARD_URL",
              value: "http://instance.example:9999",
              sensitive: false,
            },
            {
              name: "LOOM_SWITCHBOARD_KEY_HELPER",
              value: "/instance/key-helper",
              sensitive: false,
            },
            { name: "ANTHROPIC_API_KEY", value: "fixture-native-key", sensitive: true },
            { name: "ANTHROPIC_BASE_URL", value: "http://native.example", sensitive: false },
            { name: "CLAUDE_CODE_USE_BEDROCK", value: "1", sensitive: false },
          ],
          config: {
            ...ClaudeDriver.defaultConfig(),
            binaryPath: "/fixture/claude",
            homePath: configDir,
          },
        }).pipe(
          Effect.provideService(ProviderHost.ProviderHost, routing.host),
          Effect.provideService(HostProcess.Environment, hostEnvironment),
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.HomeDirectory, tempDir),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, readinessSpawner),
        );
        // The native ANTHROPIC_BASE_URL is a custom endpoint, so the CLI's empty
        // first-party account does not read as signed out.
        const firstNative = yield* Stream.toPull(
          instance.snapshot.streamChanges.pipe(
            Stream.filter((snapshot) => snapshot.auth.type === "customEndpoint"),
          ),
        );
        yield* Effect.sync(releaseInitialProbe);
        const [nativeSnapshot] = yield* firstNative;
        assert.equal(nativeSnapshot.status, "ready");
        yield* routing.listening;
        // Same-mode refresh must keep its cached native initialization result.
        yield* instance.snapshot.refresh;
        assert.equal(probeOptions.length, 1);
        assert.equal(helperCalls, 0);

        const routedUpdate = yield* Stream.toPull(
          instance.snapshot.streamChanges.pipe(
            Stream.filter(
              (snapshot) =>
                snapshot.auth.type === "switchboard" ||
                snapshot.message?.includes("through Switchboard") === true,
            ),
          ),
        );
        yield* routing.setRouted(true);
        const [routedSnapshot] = yield* routedUpdate;
        assert.equal(routedSnapshot.status, "ready");
        assert.deepEqual(routedSnapshot.auth, {
          status: "authenticated",
          type: "switchboard",
          label: "Switchboard",
        });
        assert.equal(routedSnapshot.usageLimits?.unavailable?.reason, "unsupported");
        assert.equal(routedSnapshot.usageLimits?.resetCredits, undefined);
        assert.equal(probeOptions.length, 2);
        assert.equal(helperCalls, 1);
        assert.equal(JSON.stringify(routedSnapshot).includes("fixture-switchboard-key"), false);
        // Routed refresh reuses the boolean proof without retaining or rereading the key.
        yield* instance.snapshot.refresh;
        assert.equal(helperCalls, 1);
        assert.equal(probeOptions.length, 2);
        assert.deepEqual(usageModes, ["native"]);
        const routedOptions = probeOptions[1]!;
        assert.equal(typeof routedOptions.settings, "object");
        assert.ok(routedOptions.settings && typeof routedOptions.settings === "object");
        assert.equal(
          routedOptions.settings.apiKeyHelper,
          hostEnvironment.LOOM_SWITCHBOARD_KEY_HELPER,
        );
        assert.equal(routedOptions.settings.disableAllHooks, true);
        assert.equal(
          routedOptions.settings.env?.ANTHROPIC_BASE_URL,
          hostEnvironment.LOOM_SWITCHBOARD_URL,
        );
        assert.equal(routedOptions.settings.env?.ANTHROPIC_API_KEY, "");
        assert.equal(routedOptions.settings.env?.CLAUDE_CODE_USE_BEDROCK, "");
        assert.equal(routedOptions.env?.ANTHROPIC_BASE_URL, hostEnvironment.LOOM_SWITCHBOARD_URL);
        assert.equal(routedOptions.env?.ANTHROPIC_API_KEY, "");
        assert.equal(routedOptions.env?.CLAUDE_CODE_USE_BEDROCK, "");
        assert.deepEqual(routedOptions.mcpServers, {});
        assert.deepEqual(routedOptions.allowedTools, []);
        assert.equal(routedOptions.strictMcpConfig, true);

        const nativeUpdate = yield* Stream.toPull(
          instance.snapshot.streamChanges.pipe(
            Stream.filter((snapshot) => snapshot.auth.type === "customEndpoint"),
          ),
        );
        yield* routing.setRouted(false);
        const [restoredSnapshot] = yield* nativeUpdate;
        // The native probe keeps its own cache entry, so turning routing off reuses it.
        assert.equal(restoredSnapshot.status, "ready");
        assert.equal(restoredSnapshot.auth.type, "customEndpoint");
        assert.deepEqual(probeOptions.map(hasKeyHelper), [false, true]);
        assert.deepEqual(usageModes, ["native"]);
        assert.equal(probeOptions[0]?.env?.ANTHROPIC_API_KEY, "fixture-native-key");
        assert.equal(probeOptions[0]?.env?.ANTHROPIC_BASE_URL, "http://native.example");
        assert.equal(helperCalls, 1);
      }).pipe(Effect.scoped),
    { timeout: 10000 },
  );
});
