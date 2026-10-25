import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";

export const OPENBAO_SETTINGS_FILE = "fork/vault/openbao.json";
const decodeSettingsFile = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      url: Schema.optionalKey(Schema.String),
      tokenFile: Schema.optionalKey(Schema.String),
      mount: Schema.optionalKey(Schema.String),
    }),
  ),
);
const settings = (
  url: string | undefined,
  tokenFile: string | undefined,
  mount: string | undefined,
  invalid = false,
) => ({
  url: url?.trim() || undefined,
  tokenFile: tokenFile?.trim() || undefined,
  mount: mount?.trim() || "loom",
  invalid,
});

// Loom keeps its OpenBao address and service-token path in its own state directory, so they need
// not sit in a launchd or shell environment that every app and agent process inherits. Any
// LOOM_VAULT_OPENBAO_* variable replaces the whole file, which keeps tests and older setups working.
export const readOpenBaoSettings = Effect.fn("OpenBaoSettings.read")(function* () {
  const env = yield* HostProcess.Environment;
  const url = env.LOOM_VAULT_OPENBAO_URL?.trim(),
    tokenFile = env.LOOM_VAULT_OPENBAO_TOKEN_FILE?.trim(),
    mount = env.LOOM_VAULT_OPENBAO_MOUNT?.trim();
  const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  if (url || tokenFile || mount || Option.isNone(config)) return settings(url, tokenFile, mount);
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const path = `${config.value.stateDir}/${OPENBAO_SETTINGS_FILE}`;
  return yield* Effect.gen(function* () {
    if (!(yield* fs.exists(path))) return settings(undefined, undefined, undefined);
    const stat = yield* fs.stat(path);
    // Whoever can change this file chooses where the server sends its OpenBao token.
    if (
      stat.type !== "File" ||
      ByteSize.toBigInt(stat.size) > 16384n ||
      (platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
      return settings(undefined, undefined, undefined, true);
    const file = yield* decodeSettingsFile(yield* fs.readFileString(path));
    return settings(file.url, file.tokenFile, file.mount);
  }).pipe(Effect.orElseSucceed(() => settings(undefined, undefined, undefined, true)));
});
