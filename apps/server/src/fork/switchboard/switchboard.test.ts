import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../../serverSettings.ts";

import { codexThreadRuntimeParams } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { makeClaudeQueryOptions } from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { codexAppServerArgs, codexExecLaunchArgs } from "../../provider/codexLaunchArgs.ts";
import {
  resolveSwitchboardConfiguration,
  resolveSwitchboardController,
  setSwitchboardEnabled,
  setSwitchboardEnvironment,
  SwitchboardConfigurationError,
  SwitchboardLive,
  switchboardClaudeQueryOptions,
  switchboardClaudeSettings,
  switchboardCodexArgs,
  switchboardCodexResumeOptions,
  switchboardCodexThreadOptions,
  switchboardUsageController,
} from "./switchboard.ts";

const MAC_CODEX_ARGS = [
  "-c",
  'model_providers.loom_switchboard_test={name="Switchboard",base_url="http://127.0.0.1:8317/v1",wire_api="responses",supports_websockets=true,requires_openai_auth=false,auth={command="/usr/bin/security",args=["find-generic-password","-s","switchboard","-a","client-api-key","-w"]}}',
  "-c",
  'model_provider="loom_switchboard_test"',
];

// As the Claude session launch passes it (ClaudeAdapterV2.ts, fork: switchboard).
const claudeSessionOptions = () =>
  makeClaudeQueryOptions({
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-6",
    },
    nativeThreadId: "switchboard-thread",
    resume: false,
    cwd: "/workspace",
    ...switchboardClaudeQueryOptions(),
  });

beforeEach(() => setSwitchboardEnvironment({}, "darwin", "loom_switchboard_test"));

afterEach(() => {
  setSwitchboardEnabled(false);
  setSwitchboardEnvironment({}, "darwin");
});

describe("Switchboard routing", () => {
  it("leaves launches alone while off, including invalid unused Switchboard configuration", () => {
    setSwitchboardEnvironment({ LOOM_SWITCHBOARD_URL: "not an endpoint" }, "linux");
    expect(codexAppServerArgs("--enable foo")).toEqual(["app-server", "--enable", "foo"]);
    expect(switchboardClaudeSettings()).toEqual({});
    expect(codexThreadRuntimeParams({ mcpSession: undefined })).toEqual({
      config: { "tools.update_plan.enabled": true },
    });
    expect(claudeSessionOptions().settings).toEqual({ showThinkingSummaries: true });
  });

  it("selects the hub after the instance's own Codex arguments, so it wins", () => {
    setSwitchboardEnabled(true);
    expect(codexAppServerArgs("-c model_provider=other")).toEqual([
      "app-server",
      "-c",
      "model_provider=other",
      ...MAC_CODEX_ARGS,
    ]);
    expect(codexExecLaunchArgs("")).toEqual(MAC_CODEX_ARGS);
  });

  it("keeps the macOS Keychain default and local cached controller endpoint", () => {
    setSwitchboardEnabled(true);
    expect(switchboardCodexArgs()).toEqual(MAC_CODEX_ARGS);
    expect(resolveSwitchboardController({})).toBe("http://127.0.0.1:8318");
    expect(switchboardClaudeSettings()).toEqual({
      apiKeyHelper: "/usr/bin/security find-generic-password -s switchboard -a client-api-key -w",
      env: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:8317",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
        CLAUDE_CODE_USE_BEDROCK: "",
        CLAUDE_CODE_USE_VERTEX: "",
        CLAUDE_CODE_USE_FOUNDRY: "",
        CLAUDE_CODE_DISABLE_CLAUDEAI_MCP: "1",
      },
    });
  });

  it("uses Linux Secret Service and the configured remote proxy for both provider launches", () => {
    setSwitchboardEnvironment(
      { LOOM_SWITCHBOARD_URL: "https://ai.example.test/gateway/" },
      "linux",
    );
    setSwitchboardEnabled(true);
    expect(codexExecLaunchArgs("")).toEqual([
      "-c",
      'model_providers.loom_switchboard_test={name="Switchboard",base_url="https://ai.example.test/gateway/v1",wire_api="responses",supports_websockets=true,requires_openai_auth=false,auth={command="/usr/bin/secret-tool",args=["lookup","service","switchboard","account","client-api-key"]}}',
      "-c",
      'model_provider="loom_switchboard_test"',
    ]);
    expect(switchboardClaudeSettings()).toEqual({
      apiKeyHelper: "/usr/bin/secret-tool lookup service switchboard account client-api-key",
      env: {
        ANTHROPIC_BASE_URL: "https://ai.example.test/gateway",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
        CLAUDE_CODE_USE_BEDROCK: "",
        CLAUDE_CODE_USE_VERTEX: "",
        CLAUDE_CODE_USE_FOUNDRY: "",
        CLAUDE_CODE_DISABLE_CLAUDEAI_MCP: "1",
      },
    });
  });

  it("routes Claude SDK sessions through the hub alongside the selected model's settings", () => {
    setSwitchboardEnabled(true);
    expect(claudeSessionOptions().settings).toEqual({
      ...switchboardClaudeSettings(),
      showThinkingSummaries: true,
    });
  });

  it("keeps a configured credential helper executable intact in Codex and shell-quotes it for Claude", () => {
    const helper = "/opt/Ops team's tools/$(unused)/switchboard-key";
    setSwitchboardEnvironment({ LOOM_SWITCHBOARD_KEY_HELPER: helper }, "linux");
    setSwitchboardEnabled(true);
    expect(switchboardClaudeSettings().apiKeyHelper).toBe(
      "'/opt/Ops team'\\''s tools/$(unused)/switchboard-key'",
    );
    expect(switchboardCodexArgs()[1]).toContain(
      'auth={command="/opt/Ops team\'s tools/$(unused)/switchboard-key",args=[]}',
    );
  });

  it("captures only the owning server's configuration and restores instance routing when disabled", () => {
    const serverEnvironment = { LOOM_SWITCHBOARD_URL: "https://first.example.test" };
    setSwitchboardEnvironment(serverEnvironment, "linux");
    serverEnvironment.LOOM_SWITCHBOARD_URL = "https://another.example.test";
    setSwitchboardEnabled(true);
    expect(switchboardClaudeSettings().env?.ANTHROPIC_BASE_URL).toBe("https://first.example.test");
    setSwitchboardEnvironment({ LOOM_SWITCHBOARD_URL: "https://second.example.test" }, "linux");
    expect(switchboardClaudeSettings().env?.ANTHROPIC_BASE_URL).toBe("https://second.example.test");
    setSwitchboardEnabled(false);
    expect(codexExecLaunchArgs("-c model_provider=account-b")).toEqual([
      "-c",
      "model_provider=account-b",
    ]);
    expect(switchboardClaudeQueryOptions()).toEqual({});
  });

  it("keeps inherited Switchboard provider credentials out of the selected isolated route", () => {
    setSwitchboardEnvironment({}, "darwin", "loom_switchboard_fresh_process");
    setSwitchboardEnabled(true);
    const args = codexExecLaunchArgs(
      '-c model_providers.switchboard.env_key="ACCOUNT_TOKEN" -c model_providers.switchboard.experimental_bearer_token="old-static-token" -c model_provider="switchboard"',
    );
    expect(args.at(-1)).toBe('model_provider="loom_switchboard_fresh_process"');
    const selectedProvider = args.at(-3)!;
    expect(selectedProvider).toContain("model_providers.loom_switchboard_fresh_process={");
    expect(selectedProvider).toContain(
      'requires_openai_auth=false,auth={command="/usr/bin/security"',
    );
    expect(selectedProvider).not.toContain("env_key");
    expect(selectedProvider).not.toContain("experimental_bearer_token");
  });

  it("explicitly selects the current Switchboard provider when resuming without a model override", () => {
    setSwitchboardEnvironment({}, "linux", "loom_switchboard_new_process");
    setSwitchboardEnabled(true);
    expect(codexThreadRuntimeParams({ mcpSession: undefined })).toEqual({
      modelProvider: "loom_switchboard_new_process",
      config: { "tools.update_plan.enabled": true },
    });
    setSwitchboardEnabled(false);
    expect(codexThreadRuntimeParams({ mcpSession: undefined })).toEqual({
      config: { "tools.update_plan.enabled": true },
    });
  });

  it("keeps the opened Codex session's routing through later setting changes", () => {
    setSwitchboardEnabled(true);
    const routing = switchboardCodexThreadOptions();
    const args = switchboardCodexArgs();
    setSwitchboardEnabled(false);
    expect(codexAppServerArgs("", args)).toEqual(["app-server", ...MAC_CODEX_ARGS]);
    expect(codexThreadRuntimeParams({ mcpSession: undefined }, routing).modelProvider).toBe(
      "loom_switchboard_test",
    );
    const nativeRouting = switchboardCodexThreadOptions();
    const nativeArgs = switchboardCodexArgs();
    setSwitchboardEnabled(true);
    expect(codexAppServerArgs("", nativeArgs)).toEqual(["app-server"]);
    expect(
      codexThreadRuntimeParams({ mcpSession: undefined }, nativeRouting).modelProvider,
    ).toBeUndefined();
  });

  it.effect.each(["switchboard", "loom_switchboard_previous_process"])(
    "restores native instance configuration for saved hub provider %s without guessing a provider",
    (modelProvider) =>
      Effect.gen(function* () {
        const options = yield* switchboardCodexResumeOptions({
          routing: {},
          fallbackModel: "session-selected-model",
          readThread: Effect.succeed({ thread: { modelProvider, model: "saved-thread-model" } }),
        });
        expect(options).toEqual({ model: "saved-thread-model" });
      }),
  );

  it.effect(
    "preserves saved reasoning effort while leaving the hub's persisted provider behind",
    () =>
      Effect.gen(function* () {
        const options = yield* switchboardCodexResumeOptions({
          routing: {},
          fallbackModel: "session-selected-model",
          readThread: Effect.succeed({
            thread: { modelProvider: "switchboard", model: "saved-model", reasoningEffort: "high" },
          }),
        });
        expect(options).toEqual({
          model: "saved-model",
          config: { model_reasoning_effort: "high" },
        });
      }),
  );

  it.effect("leaves saved null effort unset instead of sending an invalid TOML value", () =>
    Effect.gen(function* () {
      const options = yield* switchboardCodexResumeOptions({
        routing: {},
        fallbackModel: "session-selected-model",
        readThread: Effect.succeed({
          thread: { modelProvider: "switchboard", model: "saved-model", reasoningEffort: null },
        }),
      });
      expect(options).toEqual({ model: "saved-model" });
    }),
  );

  it.effect("uses the session's selected model when old hub metadata has no saved model", () =>
    Effect.gen(function* () {
      const options = yield* switchboardCodexResumeOptions({
        routing: {},
        fallbackModel: "session-selected-model",
        readThread: Effect.succeed({ thread: { modelProvider: "switchboard", model: null } }),
      });
      expect(options).toEqual({ model: "session-selected-model" });
    }),
  );

  it.effect(
    "preserves native resume fallback when hub metadata is malformed, unavailable or mismatched",
    () =>
      Effect.gen(function* () {
        for (const readThread of [
          Effect.succeed({}),
          Effect.fail("metadata-unavailable"),
          Effect.succeed({
            thread: { id: "another-thread", modelProvider: "switchboard", model: "saved-model" },
          }),
        ]) {
          const options = yield* switchboardCodexResumeOptions({
            routing: {},
            threadId: "expected-thread",
            fallbackModel: "session-selected-model",
            readThread,
          });
          expect(options).toEqual({});
        }
      }),
  );

  it.effect("leaves unrelated native providers and explicit model selections unchanged", () =>
    Effect.gen(function* () {
      const native = yield* switchboardCodexResumeOptions({
        routing: {},
        fallbackModel: "session-selected-model",
        readThread: Effect.succeed({
          thread: { modelProvider: "custom-provider", model: "saved-model" },
        }),
      });
      expect(native).toEqual({});
      const selected = yield* switchboardCodexResumeOptions({
        routing: {},
        model: "intentionally-selected-model",
        fallbackModel: "session-selected-model",
        readThread: Effect.die("An explicit model must not read old metadata"),
      });
      expect(selected).toEqual({});
      const routed = yield* switchboardCodexResumeOptions({
        routing: { modelProvider: "loom_switchboard_current_process" },
        fallbackModel: "session-selected-model",
        readThread: Effect.die("An enabled hub route must not read old metadata"),
      });
      expect(routed).toEqual({ modelProvider: "loom_switchboard_current_process" });
    }),
  );

  it.effect(
    "allocates one isolated Codex provider key for all launches owned by a server process",
    () => {
      const start = Effect.sync(() => {
        const first = codexExecLaunchArgs("").at(-1)!;
        expect(first).toMatch(/^model_provider="loom_switchboard_[a-f0-9]{32}"$/);
        expect(codexAppServerArgs("").at(-1)).toBe(first);
        return first;
      }).pipe(
        Effect.provide(
          SwitchboardLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                ServerSettings.layerTest({ switchboardEnabled: true }),
                NodeCrypto.layer,
                Layer.succeed(HostProcess.Environment, {}),
                Layer.succeed(HostProcess.Platform, "linux"),
              ),
            ),
          ),
        ),
      );
      return Effect.gen(function* () {
        const firstProcess = yield* start;
        const anotherProcess = yield* start;
        expect(anotherProcess).not.toBe(firstProcess);
      });
    },
  );

  it("refuses malformed enabled routing instead of silently launching with another account", () => {
    setSwitchboardEnvironment({ LOOM_SWITCHBOARD_URL: "https://user:password@host.test" }, "linux");
    setSwitchboardEnabled(true);
    expect(switchboardCodexArgs).toThrow(SwitchboardConfigurationError);
    expect(switchboardClaudeSettings).toThrow(
      "Switchboard configuration LOOM_SWITCHBOARD_URL is invalid.",
    );
  });
});

describe("Switchboard environment configuration", () => {
  it.each([
    "not-a-url",
    "file:///etc/passwd",
    "ftp://host.test",
    "https://user:password@host.test",
    "https://host.test?api_key=secret",
    "https://host.test?",
    "https://host.test#",
    "https://host.test/#secret",
    "https://host.test/\npath",
  ])("rejects unsafe proxy endpoint %s without copying it into the error", (url) => {
    expect(() => resolveSwitchboardConfiguration({ LOOM_SWITCHBOARD_URL: url }, "linux")).toThrow(
      "Switchboard configuration LOOM_SWITCHBOARD_URL is invalid.",
    );
  });

  it("never assumes the local controller belongs to a remote proxy", () => {
    expect(resolveSwitchboardController({ LOOM_SWITCHBOARD_URL: "https://ai.example.test" })).toBe(
      null,
    );
    expect(
      resolveSwitchboardController({
        LOOM_SWITCHBOARD_URL: "https://ai.example.test",
        LOOM_SWITCHBOARD_CONTROLLER_URL: "https://controller.example.test:8443",
      }),
    ).toBe("https://controller.example.test:8443");
  });

  it("allows turning controller reads off and validates a configured controller", () => {
    expect(resolveSwitchboardController({ LOOM_SWITCHBOARD_CONTROLLER_URL: "" })).toBeNull();
    for (const value of [
      "http://host.test?key=x",
      "http://host.test/api/v1",
      "https://user:password@host.test",
    ]) {
      expect(() =>
        resolveSwitchboardController({ LOOM_SWITCHBOARD_CONTROLLER_URL: value }),
      ).toThrow("Switchboard configuration LOOM_SWITCHBOARD_CONTROLLER_URL is invalid.");
    }
  });

  it("names a controller only for the hub routing points at", () => {
    setSwitchboardEnvironment({}, "darwin");
    setSwitchboardEnabled(false);
    expect(switchboardUsageController("http://127.0.0.1:8317")).toBeNull();
    setSwitchboardEnabled(true);
    for (const hub of [
      "http://127.0.0.1:8317",
      "http://localhost:8317/",
      "http://127.0.0.1:8317/v1",
    ]) {
      expect(switchboardUsageController(hub)).toEqual({ controller: "http://127.0.0.1:8318" });
    }
    expect(switchboardUsageController("http://127.0.0.1:9317")).toBeNull();
    expect(switchboardUsageController("https://hub.example.test")).toBeNull();
    setSwitchboardEnvironment(
      {
        LOOM_SWITCHBOARD_URL: "https://hub.example.test",
        LOOM_SWITCHBOARD_CONTROLLER_URL: "https://controller.example.test",
      },
      "linux",
    );
    expect(switchboardUsageController("https://hub.example.test/v1")).toEqual({
      controller: "https://controller.example.test",
    });
    expect(switchboardUsageController("http://127.0.0.1:8317")).toBeNull();
  });

  it("keeps a routed hub with no usable controller off provider polling", () => {
    setSwitchboardEnabled(true);
    for (const controller of [undefined, "", "not a url"]) {
      setSwitchboardEnvironment(
        {
          LOOM_SWITCHBOARD_URL: "https://hub.example.test",
          ...(controller === undefined ? {} : { LOOM_SWITCHBOARD_CONTROLLER_URL: controller }),
        },
        "linux",
      );
      expect(switchboardUsageController("https://hub.example.test")).toEqual({
        controller: null,
      });
    }
    setSwitchboardEnvironment({ LOOM_SWITCHBOARD_URL: "not a url" }, "linux");
    expect(switchboardUsageController("https://hub.example.test")).toBeNull();
  });

  it.each(["secret-tool lookup service switchboard", "/opt/key\nhelper", "", "~/bin/key-helper"])(
    "rejects a credential helper that is not a single absolute executable: %s",
    (helper) => {
      expect(() =>
        resolveSwitchboardConfiguration({ LOOM_SWITCHBOARD_KEY_HELPER: helper }, "linux"),
      ).toThrow("Switchboard configuration LOOM_SWITCHBOARD_KEY_HELPER is invalid.");
    },
  );
});
