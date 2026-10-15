import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ClaudeSettings, CodexSettings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type * as CodexSchema from "effect-codex-app-server/schema";
import { vi } from "vite-plus/test";

import {
  buildClaudeCapabilitiesProbeQueryOptions,
  checkClaudeProviderStatus,
  probeClaudeCapabilities,
} from "../../provider/ClaudeProvider.ts";
import { checkCodexProviderStatus } from "../../provider/CodexProvider.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);
const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const switchboardSettings = {
  apiKeyHelper: "/test/switchboard-key",
  env: {
    ANTHROPIC_BASE_URL: "http://gateway.example.test:8317",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    CLAUDE_CODE_USE_BEDROCK: "",
    CLAUDE_CODE_USE_VERTEX: "",
    CLAUDE_CODE_USE_FOUNDRY: "",
    CLAUDE_CODE_DISABLE_CLAUDEAI_MCP: "1",
  },
};

const versionSpawner = ChildProcessSpawner.make(() =>
  Effect.succeed(
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
  ),
);

it("applies routed Claude auth while preserving probe isolation", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: {
      ANTHROPIC_BASE_URL: "http://native.example.test",
      ANTHROPIC_API_KEY: "native-api-key",
      ANTHROPIC_AUTH_TOKEN: "native-token",
      CLAUDE_CODE_OAUTH_TOKEN: "native-oauth",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      CLAUDE_CODE_USE_FOUNDRY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "true",
    },
    cwd: "/workspace/project",
    switchboardSettings,
  });
  assert.deepEqual(options.settings, { ...switchboardSettings, disableAllHooks: true });
  for (const [name, value] of Object.entries(switchboardSettings.env)) {
    assert.equal(options.env?.[name], value);
  }
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  assert.deepEqual(options.allowedTools, []);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.strictMcpConfig, true);
});

it.layer(NodeServices.layer)("routed Claude readiness", (it) => {
  it.effect(
    "uses independently verified helper auth without publishing local subscription allowances",
    () =>
      Effect.gen(function* () {
        let usageCalls = 0;
        const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
          assert.deepEqual(options?.settings, { ...switchboardSettings, disableAllHooks: true });
          return {
            initializationResult: async () => ({
              account: {
                email: "unrelated-local@example.test",
                subscriptionType: "max",
                tokenSource: "apiKeyHelper",
                apiProvider: "firstParty",
              },
              commands: [],
            }),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
              usageCalls++;
              return { rate_limits_available: true, rate_limits: null };
            },
          } as unknown as ReturnType<typeof ClaudeSdk.query>;
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
        const settings = decodeClaudeSettings({});
        const capabilities = yield* probeClaudeCapabilities(
          settings,
          undefined,
          undefined,
          true,
          switchboardSettings,
        );
        assert.equal(usageCalls, 0);
        assert.equal(capabilities?.email, undefined);
        assert.equal(capabilities?.subscriptionType, undefined);
        assert.equal(capabilities?.usage, undefined);
        const status = yield* checkClaudeProviderStatus(settings, () =>
          Effect.succeed(capabilities && { ...capabilities, switchboardCredentialAvailable: true }),
        ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, versionSpawner));
        assert.equal(status.status, "ready");
        assert.deepEqual(status.auth, {
          status: "authenticated",
          type: "switchboard",
          label: "Switchboard",
        });
        assert.equal(status.usageLimits?.unavailable?.reason, "unsupported");
      }).pipe(Effect.scoped),
  );

  it.effect(
    "rejects cached helper metadata and local OAuth without independent credential proof",
    () =>
      Effect.gen(function* () {
        const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(
          () =>
            ({
              initializationResult: async () => ({
                account: {
                  email: "native@example.test",
                  subscriptionType: "pro",
                  tokenSource: "oauth",
                  apiKeySource: "apiKeyHelper",
                  apiProvider: "firstParty",
                },
                commands: [],
              }),
            }) as unknown as ReturnType<typeof ClaudeSdk.query>,
        );
        yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
        const settings = decodeClaudeSettings({});
        const capabilities = yield* probeClaudeCapabilities(
          settings,
          undefined,
          undefined,
          true,
          switchboardSettings,
        );
        const status = yield* checkClaudeProviderStatus(settings, () =>
          Effect.succeed(capabilities),
        ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, versionSpawner));
        assert.equal(status.status, "error");
        assert.equal(status.auth.status, "unauthenticated");
        assert.equal(
          status.message,
          "Claude could not authenticate through Switchboard. Check this environment's Switchboard key helper.",
        );
      }).pipe(Effect.scoped),
  );

  it.effect("keeps routed initialization failures unverified", () =>
    Effect.gen(function* () {
      const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(
        () =>
          ({
            initializationResult: async () => {
              throw new Error("Helper unavailable");
            },
          }) as unknown as ReturnType<typeof ClaudeSdk.query>,
      );
      yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
      const settings = decodeClaudeSettings({});
      const capabilities = yield* probeClaudeCapabilities(
        settings,
        undefined,
        undefined,
        true,
        switchboardSettings,
      );
      assert.equal(capabilities, undefined);
      const status = yield* checkClaudeProviderStatus(
        settings,
        () => Effect.succeed(capabilities),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "switchboard",
      ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, versionSpawner));
      assert.equal(status.status, "warning");
      assert.equal(status.auth.status, "unknown");
      assert.equal(
        status.message,
        "Could not verify Claude authentication through Switchboard. Check this environment's Switchboard endpoint and key helper.",
      );
    }).pipe(Effect.scoped),
  );
});

/**
 * A fake `codex app-server`. Its home holds a model cache newer than the probe's
 * spawn, so a ChatGPT login does not wait out the catalog refresh on the test clock.
 */
const makeAllowanceProbePeer = Effect.fn("makeAllowanceProbePeer")(function* (
  account: CodexSchema.V2GetAccountResponse,
  codexHome: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(
    `${codexHome}/models_cache.json`,
    JSON.stringify({ fetched_at: "2026-01-01T00:00:00.000Z", models: [] }),
  );
  const output = yield* Effect.acquireRelease(Queue.unbounded<Uint8Array>(), Queue.shutdown);
  const methods: string[] = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let pendingInput = "";
  const stdin = Sink.forEach((chunk: Uint8Array) =>
    Effect.gen(function* () {
      pendingInput += decoder.decode(chunk, { stream: true });
      const lines = pendingInput.split("\n");
      pendingInput = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const request = JSON.parse(line) as {
          readonly id?: string | number;
          readonly method: string;
          readonly params?: unknown;
        };
        methods.push(request.method);
        if (request.method === "initialized") continue;
        let result: unknown;
        switch (request.method) {
          case "initialize":
            result = {
              userAgent: "allowance-probe-peer/0.156.1",
              codexHome,
              platformFamily: "unix",
              platformOs: "linux",
            };
            break;
          case "account/read":
            assert.deepEqual(request.params, {});
            result = account;
            break;
          case "skills/list":
          case "model/list":
            result = { data: [] };
            break;
          case "account/rateLimits/read":
            assert.equal(request.params, null);
            result = {
              accountId: "native-workspace",
              rateLimits: { primary: { usedPercent: 17, windowDurationMins: 300 } },
            };
            break;
          default:
            return yield* Effect.die(`Unexpected readiness RPC: ${request.method}`);
        }
        yield* Queue.offer(
          output,
          encoder.encode(`${JSON.stringify({ id: request.id, result })}\n`),
        );
      }
    }),
  );
  const spawner = ChildProcessSpawner.make((command) => {
    assert.ok(ChildProcess.isStandardCommand(command));
    assert.equal(command.args[0], "app-server");
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin,
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });
  return { spawner, methods };
});

const chatgptAccount = {
  account: { type: "chatgpt", email: "native@example.test", planType: "plus" },
  requiresOpenaiAuth: false,
} satisfies CodexSchema.V2GetAccountResponse;

it.layer(NodeServices.layer)("Codex allowance probe policy", (it) => {
  it.effect.each(["signed-out", "chatgpt"] as const)(
    "skips the outgoing native allowance RPC under routed policy with %s native auth",
    (mode) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-routed-allowance-" });
        const peer = yield* makeAllowanceProbePeer(
          mode === "chatgpt" ? chatgptAccount : { account: null, requiresOpenaiAuth: false },
          home,
        );
        const settings = decodeCodexSettings({
          binaryPath: "/fixture/codex",
          homePath: home,
          launchArgs: '-c model_provider="fixture_switchboard"',
        });
        const snapshot = yield* checkCodexProviderStatus(
          settings,
          undefined,
          { HOME: home },
          undefined,
          {
            skipNativeUsage: true,
          },
        ).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, peer.spawner),
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.HomeDirectory, home),
        );
        assert.equal(peer.methods.includes("account/rateLimits/read"), false);
        assert.equal(peer.methods.includes("account/read"), true);
        assert.equal(peer.methods.includes("skills/list"), true);
        assert.equal(peer.methods.includes("model/list"), true);
        assert.equal(snapshot.status, "ready");
        assert.deepEqual(
          snapshot.auth,
          mode === "chatgpt"
            ? {
                status: "authenticated",
                type: "chatgpt",
                label: "ChatGPT Plus Subscription",
                email: "native@example.test",
              }
            : { status: "unknown" },
        );
        assert.equal(snapshot.usageLimits?.unavailable?.reason, "unsupported");
        assert.deepEqual(snapshot.usageLimits?.windows, []);
      }).pipe(Effect.scoped),
  );

  it.effect("reads native allowances normally when routed policy is off", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-native-allowance-" });
      const peer = yield* makeAllowanceProbePeer(chatgptAccount, home);
      const settings = decodeCodexSettings({
        binaryPath: "/fixture/codex",
        homePath: home,
      });
      const snapshot = yield* checkCodexProviderStatus(
        settings,
        undefined,
        { HOME: home },
        undefined,
        {
          skipNativeUsage: false,
        },
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, peer.spawner),
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(HostProcess.HomeDirectory, home),
      );
      assert.equal(peer.methods.filter((method) => method === "account/rateLimits/read").length, 1);
      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.auth.status, "authenticated");
      assert.equal(snapshot.auth.workspaceId, "native-workspace");
      assert.equal(snapshot.usageLimits?.unavailable, undefined);
      assert.equal(snapshot.usageLimits?.windows[0]?.usedPercent, 17);
    }).pipe(Effect.scoped),
  );
});
