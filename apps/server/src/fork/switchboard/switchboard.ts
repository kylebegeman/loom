import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../../serverSettings.ts";

/**
 * Switchboard is a CLIProxyAPI hub on this Mac that holds every Claude and Codex
 * subscription and picks which one serves each request. With
 * `switchboardEnabled` on, every Claude and Codex launch is pointed at it, so the
 * per-account instances stop mattering and the picker shows one of each. With it
 * off, launches are exactly what the instance configures.
 *
 * The client key never leaves Keychain: both CLIs run `security` to read it.
 */
export const SWITCHBOARD_URL = "http://127.0.0.1:8317";

const CLIENT_KEY_ARGS = [
  "find-generic-password",
  "-s",
  "switchboard",
  "-a",
  "client-api-key",
  "-w",
];

const tomlString = (value: string) => JSON.stringify(value);

/** Codex `-c` overrides that add the hub as a model provider and select it. */
export const SWITCHBOARD_CODEX_ARGS: ReadonlyArray<string> = [
  "-c",
  `model_providers.switchboard={${[
    `name=${tomlString("Switchboard")}`,
    `base_url=${tomlString(`${SWITCHBOARD_URL}/v1`)}`,
    `wire_api=${tomlString("responses")}`,
    "supports_websockets=true",
    `auth={command=${tomlString("/usr/bin/security")},args=[${CLIENT_KEY_ARGS.map(tomlString).join(",")}]}`,
  ].join(",")}}`,
  "-c",
  `model_provider=${tomlString("switchboard")}`,
];

/**
 * Claude `--settings` that send requests to the hub with its client key. An
 * instance's own API key is blanked, because Claude Code prefers it to
 * `apiKeyHelper` and the hub would refuse it.
 */
export const SWITCHBOARD_CLAUDE_SETTINGS = {
  apiKeyHelper: ["/usr/bin/security", ...CLIENT_KEY_ARGS].join(" "),
  env: { ANTHROPIC_BASE_URL: SWITCHBOARD_URL, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" },
} as const;

// Launch arguments are built synchronously deep inside the provider layers, so
// the setting is mirrored here rather than threaded through every call site.
let enabled = false;

export const switchboardCodexArgs = (): ReadonlyArray<string> =>
  enabled ? SWITCHBOARD_CODEX_ARGS : [];

export const switchboardClaudeSettings = (): Partial<typeof SWITCHBOARD_CLAUDE_SETTINGS> =>
  enabled ? SWITCHBOARD_CLAUDE_SETTINGS : {};

/** Test hook; the server sets this only from settings. */
export const setSwitchboardEnabled = (value: boolean) => {
  enabled = value;
};

/** Keeps the mirrored setting current. Sessions read it when they launch. */
export const SwitchboardLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const changes = yield* settings.subscribeChanges;
    const current = yield* settings.getSettings.pipe(Effect.orDie);
    setSwitchboardEnabled(current.switchboardEnabled);
    yield* Stream.runForEach(changes, (next) =>
      Effect.sync(() => setSwitchboardEnabled(next.switchboardEnabled)),
    ).pipe(Effect.forkScoped);
  }),
);
