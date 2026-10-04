import { afterEach, describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";

import { makeClaudeQueryOptions } from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { codexAppServerArgs, codexExecLaunchArgs } from "../../provider/Layers/codexLaunchArgs.ts";
import {
  SWITCHBOARD_CLAUDE_SETTINGS,
  SWITCHBOARD_CODEX_ARGS,
  setSwitchboardEnabled,
  switchboardClaudeQueryOptions,
  switchboardClaudeSettings,
} from "./switchboard.ts";

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

afterEach(() => setSwitchboardEnabled(false));

describe("Switchboard routing", () => {
  it("leaves launches alone while off", () => {
    expect(codexAppServerArgs("--enable foo")).toEqual(["app-server", "--enable", "foo"]);
    expect(switchboardClaudeSettings()).toEqual({});
    expect(claudeSessionOptions().settings).toEqual({ showThinkingSummaries: true });
  });

  it("selects the hub after the instance's own Codex arguments, so it wins", () => {
    setSwitchboardEnabled(true);
    expect(codexAppServerArgs("-c model_provider=other")).toEqual([
      "app-server",
      "-c",
      "model_provider=other",
      ...SWITCHBOARD_CODEX_ARGS,
    ]);
    // `codex exec` only takes config overrides, and must keep the hub's.
    expect(codexExecLaunchArgs("")).toEqual(SWITCHBOARD_CODEX_ARGS);
  });

  it("defines the Codex provider as an inline TOML table that reads the key from Keychain", () => {
    expect(SWITCHBOARD_CODEX_ARGS).toEqual([
      "-c",
      'model_providers.switchboard={name="Switchboard",base_url="http://127.0.0.1:8317/v1",wire_api="responses",supports_websockets=true,auth={command="/usr/bin/security",args=["find-generic-password","-s","switchboard","-a","client-api-key","-w"]}}',
      "-c",
      'model_provider="switchboard"',
    ]);
  });

  it("points Claude at the hub and blanks an instance's own API key", () => {
    setSwitchboardEnabled(true);
    expect(switchboardClaudeSettings()).toEqual({
      apiKeyHelper: "/usr/bin/security find-generic-password -s switchboard -a client-api-key -w",
      env: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:8317",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    });
  });

  it("routes Claude sessions through the hub alongside the model's own settings", () => {
    setSwitchboardEnabled(true);
    expect(claudeSessionOptions().settings).toEqual({
      ...SWITCHBOARD_CLAUDE_SETTINGS,
      showThinkingSummaries: true,
    });
  });
});
