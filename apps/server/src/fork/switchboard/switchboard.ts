import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import { AUTH_PROBE_TIMEOUT_MS } from "@t3tools/provider-core/server/snapshotProbe";

import { ServerSettingsService } from "../../serverSettings.ts";

/**
 * Switchboard is a CLIProxyAPI hub holding every Claude and Codex subscription. With
 * `switchboardEnabled` on, every Claude and Codex launch here points at it; off, launches are what
 * the instance configures. Hub and controller default to this machine's loopback listeners. The
 * CLIs run the key helper themselves; the opt-in shared gateway reads it to authenticate requests.
 */
const DEFAULT_URL = "http://127.0.0.1:8317";
/** The controller's cached operations API (`/api/v1/*`), served beside the default hub. */
const DEFAULT_CONTROLLER_URL = "http://127.0.0.1:8318";
/** Where a hub computer's Loom shares its Switchboard (`SwitchboardGateway.ts`). */
export const SWITCHBOARD_GATEWAY_PREFIX = "/api/loom/switchboard";
/** Names the reason on the gateway's own refusals, so a client can tell them from upstream ones. */
export const SWITCHBOARD_GATEWAY_ERROR_HEADER = "x-loom-switchboard";
/** Below the gateway, the hub controller's `/api/v1/*` reads a routed computer may make. */
export const SWITCHBOARD_CONTROLLER_PATH = "/controller";
// Set only by `SwitchboardAccount`, never on the hub itself.
let accountRoute: SwitchboardAccountRoute | undefined;

export class SwitchboardConfigurationError extends Schema.TaggedError<SwitchboardConfigurationError>()(
  "SwitchboardConfigurationError",
  {
    setting: Schema.Literals([
      "LOOM_SWITCHBOARD_URL",
      "LOOM_SWITCHBOARD_CONTROLLER_URL",
      "LOOM_SWITCHBOARD_KEY_HELPER",
    ]),
  },
) {
  override get message(): string {
    return `Switchboard configuration ${this.setting} is invalid.`;
  }
}

type SwitchboardSetting = SwitchboardConfigurationError["setting"];
const containsControlCharacter = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Credentials belong in the key helper, never in an endpoint or launch argument. */
const endpoint = (value: string, setting: SwitchboardSetting): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SwitchboardConfigurationError({ setting });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    value.includes("?") ||
    value.includes("#") ||
    containsControlCharacter(value) ||
    value.includes(" ")
  ) {
    throw new SwitchboardConfigurationError({ setting });
  }
  return url.toString().replace(/\/+$/, "");
};

export interface SwitchboardKeyCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

/** The account's hub this computer holds a credential for, set by `SwitchboardAccount`. */
export interface SwitchboardAccountRoute {
  /** The hub's gateway, `<origin>/api/loom/switchboard`. */
  readonly url: string;
  /** Prints this computer's own credential for that hub. */
  readonly keyCommand: SwitchboardKeyCommand;
  /** Every origin the hub's directory entry lists, so a hand-set URL for it adopts the credential. */
  readonly hubOrigins: ReadonlyArray<string>;
}

/** The helper that prints the shared key from this computer's Keychain or Secret Service. */
const personalKeyCommand = (
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): SwitchboardKeyCommand => {
  const helper = environment.LOOM_SWITCHBOARD_KEY_HELPER;
  if (helper !== undefined) {
    const absolute =
      platform === "win32" ? /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(helper) : helper.startsWith("/");
    if (!absolute || containsControlCharacter(helper)) {
      throw new SwitchboardConfigurationError({ setting: "LOOM_SWITCHBOARD_KEY_HELPER" });
    }
    return { command: helper, args: [] };
  }
  if (platform === "darwin") {
    return {
      command: "/usr/bin/security",
      args: ["find-generic-password", "-s", "switchboard", "-a", "client-api-key", "-w"],
    };
  }
  if (platform === "linux") {
    return {
      command: "/usr/bin/secret-tool",
      args: ["lookup", "service", "switchboard", "account", "client-api-key"],
    };
  }
  throw new SwitchboardConfigurationError({ setting: "LOOM_SWITCHBOARD_KEY_HELPER" });
};

/** The local or `LOOM_SWITCHBOARD_URL` hub and the shared key, ignoring any account route. */
export function resolveSwitchboardHubConfiguration(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  const url = endpoint(environment.LOOM_SWITCHBOARD_URL ?? DEFAULT_URL, "LOOM_SWITCHBOARD_URL");
  const keyCommand = personalKeyCommand(environment, platform);
  const source: "local" | "environment" =
    environment.LOOM_SWITCHBOARD_URL === undefined &&
    environment.LOOM_SWITCHBOARD_KEY_HELPER === undefined
      ? "local"
      : "environment";
  return { url, keyCommand, source };
}

/** Whether `url` names the account hub, as a URL set by hand before enrollment existed would. */
const namesAccountHub = (url: string, account: SwitchboardAccountRoute) => {
  const key = hubKey(url);
  return (
    key !== null &&
    [
      account.url,
      ...account.hubOrigins.map((origin) => `${origin}${SWITCHBOARD_GATEWAY_PREFIX}`),
    ].some((candidate) => hubKey(candidate) === key)
  );
};

/**
 * The owning server supplies these values; client and provider-instance env never override them.
 * Settings in the environment win, except that a URL naming the account hub uses this computer's
 * own credential for it in place of the shared key. With none set, the account hub wins over the
 * local default.
 */
export function resolveSwitchboardConfiguration(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  account: SwitchboardAccountRoute | undefined = accountRoute,
) {
  if (account !== undefined) {
    const configured = environment.LOOM_SWITCHBOARD_URL;
    if (configured === undefined && environment.LOOM_SWITCHBOARD_KEY_HELPER === undefined)
      return { url: account.url, keyCommand: account.keyCommand, source: "account" as const };
    if (configured !== undefined) {
      const url = endpoint(configured, "LOOM_SWITCHBOARD_URL");
      if (namesAccountHub(url, account))
        return { url, keyCommand: account.keyCommand, source: "account" as const };
    }
  }
  return resolveSwitchboardHubConfiguration(environment, platform);
}

/**
 * The controller origin whose cached `/api/v1/*` reads describe the routed hub, and the helper
 * whose key they need. An account hub's controller is read through its gateway, unless
 * `LOOM_SWITCHBOARD_CONTROLLER_URL` names another; otherwise as `resolveSwitchboardController`.
 */
export function resolveSwitchboardControllerRoute(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): { readonly url: string; readonly keyCommand?: SwitchboardKeyCommand } | null {
  const configured = environment.LOOM_SWITCHBOARD_CONTROLLER_URL;
  if (configured === "") return null;
  const routed = resolveSwitchboardConfiguration(environment, platform);
  if (routed.source === "account" && configured === undefined)
    return { url: `${routed.url}${SWITCHBOARD_CONTROLLER_PATH}`, keyCommand: routed.keyCommand };
  const url = resolveSwitchboardController(environment);
  return url === null ? null : { url };
}

/**
 * The controller origin whose cached `/api/v1/*` reads describe this hub, or null
 * when none is known. Only the default local hub implies the local controller; a
 * remote hub needs `LOOM_SWITCHBOARD_CONTROLLER_URL`, and an empty value turns the
 * reads off. Kept apart from routing, so a bad controller value never blocks a launch.
 */
export function resolveSwitchboardController(environment: NodeJS.ProcessEnv): string | null {
  const configured = environment.LOOM_SWITCHBOARD_CONTROLLER_URL;
  if (configured === "") return null;
  if (configured !== undefined) {
    const origin = endpoint(configured, "LOOM_SWITCHBOARD_CONTROLLER_URL");
    if (new URL(origin).pathname !== "/") {
      throw new SwitchboardConfigurationError({ setting: "LOOM_SWITCHBOARD_CONTROLLER_URL" });
    }
    return origin;
  }
  const url = endpoint(environment.LOOM_SWITCHBOARD_URL ?? DEFAULT_URL, "LOOM_SWITCHBOARD_URL");
  return url === DEFAULT_URL ? DEFAULT_CONTROLLER_URL : null;
}

/** One key for a hub however it is written: loopback aliases, default ports and a `/v1` suffix. */
const hubKey = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
    const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
    return `${url.protocol}//${host}:${url.port}${path}`;
  } catch {
    return null;
  }
};

type SwitchboardConfiguration = ReturnType<typeof resolveSwitchboardConfiguration>;
const tomlString = (value: string) => JSON.stringify(value);
const shellArgument = (value: string) =>
  /^[a-zA-Z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

/** Both providers execute the helper themselves, keeping the client key out of the server's args. */
const routing = (config: SwitchboardConfiguration, providerId: string) => ({
  providerId,
  url: config.url,
  keyCommand: config.keyCommand,
  codexArgs: [
    "-c",
    `model_providers.${providerId}={${[
      `name=${tomlString("Switchboard")}`,
      `base_url=${tomlString(`${config.url}/v1`)}`,
      `wire_api=${tomlString("responses")}`,
      "supports_websockets=true",
      "requires_openai_auth=false",
      `auth={command=${tomlString(config.keyCommand.command)},args=[${config.keyCommand.args.map(tomlString).join(",")}]}`,
    ].join(",")}}`,
    "-c",
    `model_provider=${tomlString(providerId)}`,
  ],
  claudeSettings: {
    apiKeyHelper: [config.keyCommand.command, ...config.keyCommand.args]
      .map(shellArgument)
      .join(" "),
    // Clear every alternate auth/backend selector so the helper governs routing.
    env: {
      ANTHROPIC_BASE_URL: config.url,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      CLAUDE_CODE_USE_BEDROCK: "",
      CLAUDE_CODE_USE_VERTEX: "",
      CLAUDE_CODE_USE_FOUNDRY: "",
      CLAUDE_CODE_DISABLE_CLAUDEAI_MCP: "1",
    },
  },
});

/** Probe routing resolves from the owning server, without depending on launch-state subscription timing. */
export const resolveSwitchboardClaudeProbeRouting = (
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) => {
  const config = resolveSwitchboardConfiguration(environment, platform);
  return { settings: routing(config, "").claudeSettings, keyCommand: config.keyCommand };
};

export const readSwitchboardCredential = Effect.fn("Switchboard.readCredential")(
  function* (keyCommand: SwitchboardKeyCommand, environment: NodeJS.ProcessEnv) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(keyCommand.command, keyCommand.args, {
        env: environment,
        stdin: "ignore",
        // Scope cleanup must escalate when a timed-out helper ignores SIGTERM.
        forceKillAfter: "2 seconds",
      }),
    );
    const [output, , exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: 64 * 1024 }),
        child.stderr.pipe(Stream.runDrain),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    // Match Claude's helper validation after trimming. Its initialization only
    // reads a cache, and even a failed helper can populate that cache with " ".
    return Number(exitCode) === 0 &&
      !output.truncated &&
      !output.invalidUtf8 &&
      /^[\x21-\x7e]{1,16384}$/.test(output.text.trim())
      ? Option.some(Redacted.make(output.text.trim()))
      : Option.none<Redacted.Redacted<string>>();
  },
  Effect.scoped,
  Effect.timeout(AUTH_PROBE_TIMEOUT_MS),
  Effect.orElseSucceed(() => Option.none<Redacted.Redacted<string>>()),
);

/** A controller read's headers: none for a local or configured controller, a bearer for the hub's. */
export const switchboardControllerHeaders = Effect.fn("Switchboard.controllerHeaders")(function* (
  route: { readonly keyCommand?: SwitchboardKeyCommand },
  environment: NodeJS.ProcessEnv,
) {
  if (route.keyCommand === undefined) return Option.some<Record<string, string>>({});
  const key = yield* readSwitchboardCredential(route.keyCommand, environment);
  return Option.map(key, (value) => ({ authorization: `Bearer ${Redacted.value(value)}` }));
});

/** Resolve only credential availability; no credential or helper output leaves this probe. */
export const probeSwitchboardCredential = Effect.fn("Switchboard.probeCredential")(function* (
  keyCommand: SwitchboardKeyCommand,
  environment: NodeJS.ProcessEnv,
) {
  return Option.isSome(yield* readSwitchboardCredential(keyCommand, environment));
});

// Synchronous launch helpers retain the fork's existing adapter seam. The owning
// server layer captures only its three configuration values, and validates them
// when routing is enabled. Turning routing off never evaluates that configuration.
let enabled = false;
let launchEnvironment: NodeJS.ProcessEnv = {};
let launchPlatform: NodeJS.Platform = "darwin";
let launchProviderId = "loom_switchboard_uninitialized";
let launchRouting: ReturnType<typeof routing> | undefined;
const currentRouting = () =>
  (launchRouting ??= routing(
    resolveSwitchboardConfiguration(launchEnvironment, launchPlatform),
    launchProviderId,
  ));

export const switchboardCodexArgs = (): ReadonlyArray<string> =>
  enabled ? currentRouting().codexArgs : [];

/** The routed hub and its key helper, or undefined when routing is off. */
export const switchboardCatalogSource = ():
  | { readonly url: string; readonly keyCommand: SwitchboardKeyCommand }
  | undefined => {
  if (!enabled) return undefined;
  const { url, keyCommand } = currentRouting();
  return { url, keyCommand };
};

/** A resume must override the old process's persisted provider key when hub routing is enabled. */
export const switchboardCodexThreadOptions = (): { modelProvider?: string } =>
  enabled ? { modelProvider: currentRouting().providerId } : {};

const decodeCodexThreadRouting = Schema.decodeUnknownEffect(
  Schema.Struct({
    thread: Schema.Struct({
      id: Schema.optional(Schema.String),
      modelProvider: Schema.String,
      model: Schema.optional(Schema.NullOr(Schema.String)),
      reasoningEffort: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  }),
);

/** Off resumes use the saved model to bypass Codex's persisted hub provider,
 * letting the owning app-server apply its native provider config and profile.
 */
export const switchboardCodexResumeOptions = <E, R>(input: {
  readonly routing: { readonly modelProvider?: string };
  readonly threadId?: string;
  readonly model?: string | undefined;
  readonly fallbackModel: string;
  readonly readThread: Effect.Effect<unknown, E, R>;
}): Effect.Effect<
  {
    readonly model?: string;
    readonly modelProvider?: string;
    readonly config?: Readonly<Record<string, Schema.Json>>;
  },
  never,
  R
> => {
  if (input.routing.modelProvider !== undefined) return Effect.succeed(input.routing);
  if (input.model !== undefined) return Effect.succeed({});
  return input.readThread.pipe(
    Effect.flatMap(decodeCodexThreadRouting),
    Effect.map(({ thread }) =>
      (input.threadId === undefined || thread.id === input.threadId) &&
      (thread.modelProvider === "switchboard" ||
        thread.modelProvider.startsWith("loom_switchboard_"))
        ? {
            model: thread.model?.trim() || input.fallbackModel,
            ...(thread.reasoningEffort == null
              ? {}
              : { config: { model_reasoning_effort: thread.reasoningEffort } }),
          }
        : {},
    ),
    // Hub detection is advisory. Missing metadata must preserve Codex's native
    // resume fallback, including older versions and temporarily unavailable reads.
    Effect.orElseSucceed(() => ({})),
  );
};

export const switchboardClaudeSettings = (): Partial<
  ReturnType<typeof routing>["claudeSettings"]
> => (enabled ? currentRouting().claudeSettings : {});

/** Adds the hub settings to a Claude SDK session; empty when routing is off. */
export const switchboardClaudeQueryOptions = (): {
  sdkSettings?: ReturnType<typeof routing>["claudeSettings"];
} => (enabled ? { sdkSettings: currentRouting().claudeSettings } : {});

/** Where a Limits read finds the routed hub's usage; `controller` is null when none is configured. */
export interface SwitchboardUsageSource {
  readonly controller: string | null;
}

/**
 * The usage source for `hubUrl` when it is the hub this server routes through,
 * else null. Gated on routing because a plain CLIProxyAPI hub also listens on 8317
 * and must keep its own usage polling. The routed hub's controller owns collection,
 * so a missing or invalid controller setting never turns into provider polling.
 */
export const switchboardUsageController = (hubUrl: string): SwitchboardUsageSource | null => {
  if (!enabled) return null;
  let routedHub: string | null;
  try {
    routedHub = hubKey(currentRouting().url);
  } catch {
    return null;
  }
  const hub = hubKey(hubUrl);
  if (hub === null || hub !== routedHub) return null;
  try {
    return { controller: resolveSwitchboardController(launchEnvironment) };
  } catch {
    return { controller: null };
  }
};

/** Test hooks; the server sets these only from its own environment and settings. */
export const setSwitchboardEnabled = (value: boolean) => {
  enabled = value;
};

/** The account hub this computer enrolled with, or undefined to route as configured. */
export const setSwitchboardAccountRoute = (route: SwitchboardAccountRoute | undefined) => {
  accountRoute = route;
  launchRouting = undefined;
};

export const setSwitchboardEnvironment = (
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  providerId = launchProviderId,
) => {
  launchEnvironment = {
    LOOM_SWITCHBOARD_URL: environment.LOOM_SWITCHBOARD_URL,
    LOOM_SWITCHBOARD_CONTROLLER_URL: environment.LOOM_SWITCHBOARD_CONTROLLER_URL,
    LOOM_SWITCHBOARD_KEY_HELPER: environment.LOOM_SWITCHBOARD_KEY_HELPER,
  };
  launchPlatform = platform;
  launchProviderId = providerId;
  launchRouting = undefined;
};

/** Mirrors settings for the synchronous launch helpers in this provider-owning server. */
export const SwitchboardLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const environment = yield* HostProcess.Environment;
    const platform = yield* HostProcess.Platform;
    const crypto = yield* SecureRandom.SecureRandom;
    // Codex deep-merges provider tables across config layers. A fresh process key
    // prevents inherited env_key/static auth from mixing with command-backed auth.
    const providerId = `loom_switchboard_${(yield* crypto.uuidV4().pipe(Effect.orDie)).replaceAll("-", "")}`;
    setSwitchboardEnvironment(environment, platform, providerId);
    const settings = yield* ServerSettingsService;
    const changes = yield* settings.subscribeChanges;
    const current = yield* settings.getSettings.pipe(Effect.orDie);
    setSwitchboardEnabled(current.switchboardEnabled);
    yield* Stream.runForEach(changes, (next) =>
      Effect.sync(() => setSwitchboardEnabled(next.switchboardEnabled)),
    ).pipe(Effect.forkScoped);
  }),
);
