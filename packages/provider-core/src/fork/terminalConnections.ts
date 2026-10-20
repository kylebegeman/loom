import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { McpProviderSessionConfig } from "../server/mcpSession.ts";

const Connection = Schema.Struct({
  protocol: Schema.Literal(1),
  endpoint: Schema.String,
  authorization: Schema.String,
});
const encode = Schema.encodeEffect(Schema.fromJsonString(Connection));

// A provider gets a path, never a bearer value in argv or its process environment.
// These files are owner-only plaintext and do not isolate same-user agents.
export const makeTerminalConnections = Effect.gen(function* () {
  const optionalFs = yield* Effect.serviceOption(FileSystem.FileSystem);
  if (Option.isNone(optionalFs)) return undefined;
  const fs = optionalFs.value;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-mcp-" }).pipe(
    Effect.flatMap((directory) => fs.realPath(directory)),
    Effect.tap((directory) => fs.chmod(directory, 0o700)),
    Effect.orElseSucceed(() => undefined),
  );
  if (root === undefined) return undefined;
  const remove = (file: string) => fs.remove(file, { force: true }).pipe(Effect.ignore);
  return {
    create: (config: McpProviderSessionConfig) =>
      Effect.gen(function* () {
        const file = yield* fs.makeTempFile({ directory: root, prefix: "session-" });
        const payload = yield* encode({
          protocol: 1,
          endpoint: config.endpoint,
          authorization: config.authorizationHeader,
        });
        yield* fs.writeFileString(file, payload, { mode: 0o600 }).pipe(
          Effect.andThen(fs.chmod(file, 0o600)),
          Effect.onError(() => remove(file)),
        );
        return file;
      }).pipe(Effect.orElseSucceed(() => undefined)),
    remove,
  };
});

export const terminalEnvironmentFor = (
  config: Pick<McpProviderSessionConfig, "terminalConnectionFile"> | undefined,
): Record<string, string> => ({
  LOOM_MCP_CONNECTION_FILE: config?.terminalConnectionFile ?? "",
  LOOM_MCP_ENDPOINT: "",
  LOOM_MCP_AUTHORIZATION: "",
  T3_ACP_MCP_ENDPOINT: "",
  T3_ACP_MCP_AUTHORIZATION: "",
  T3_MCP_URL: "",
  T3_MCP_BEARER_TOKEN: "",
});
