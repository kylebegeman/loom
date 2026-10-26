import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { mcpToolSession, type McpToolSessionOptions } from "../../mcp/AcpMcpStdioBridge.ts";

export class TerminalConnectionError extends Schema.TaggedError<TerminalConnectionError>()(
  "TerminalConnectionError",
  {},
) {
  override get message() {
    return "This terminal has no usable Loom session connection. Restart the provider session or use its hosted Vault tools.";
  }
}
const Connection = Schema.Struct({
  protocol: Schema.Literal(1),
  endpoint: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  authorization: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
});
const decode = Schema.decodeEffect(Schema.fromJsonString(Connection));
const valid = (endpoint: string, authorization: string) => {
  try {
    const url = new URL(endpoint);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      /^Bearer [^\s]+$/.test(authorization)
    );
  } catch {
    return false;
  }
};
export const readTerminalConnection = Effect.fn("readTerminalConnection")(function* (
  environment: Readonly<Record<string, string | undefined>>,
) {
  const fail = () => new TerminalConnectionError();
  let endpoint: string | undefined, authorization: string | undefined;
  if (environment.LOOM_MCP_CONNECTION_FILE) {
    const optionalFs = yield* Effect.serviceOption(FileSystem.FileSystem);
    const optionalPath = yield* Effect.serviceOption(Path.Path);
    if (Option.isNone(optionalFs) || Option.isNone(optionalPath)) return yield* fail();
    const fs = optionalFs.value,
      path = optionalPath.value,
      file = environment.LOOM_MCP_CONNECTION_FILE;
    const userId = yield* HostProcess.UserId,
      platform = yield* HostProcess.Platform;
    if (!path.isAbsolute(file)) return yield* fail();
    const real = yield* fs.realPath(file).pipe(Effect.mapError(fail));
    const info = yield* fs.stat(file).pipe(Effect.mapError(fail));
    if (
      real !== path.normalize(file) ||
      info.type !== "File" ||
      Number(info.size) > 8192 ||
      (platform !== "win32" &&
        ((info.mode & 0o077) !== 0 ||
          (userId !== undefined && Option.getOrNull(info.uid) !== userId)))
    )
      return yield* fail();
    const connection = yield* fs
      .readFileString(file)
      .pipe(Effect.flatMap(decode), Effect.mapError(fail));
    endpoint = connection.endpoint;
    authorization = connection.authorization;
  } else if (environment.LOOM_MCP_ENDPOINT || environment.LOOM_MCP_AUTHORIZATION) {
    endpoint = environment.LOOM_MCP_ENDPOINT;
    authorization = environment.LOOM_MCP_AUTHORIZATION;
  } else if (environment.T3_ACP_MCP_ENDPOINT || environment.T3_ACP_MCP_AUTHORIZATION) {
    endpoint = environment.T3_ACP_MCP_ENDPOINT;
    authorization = environment.T3_ACP_MCP_AUTHORIZATION;
  } else {
    endpoint = environment.T3_MCP_URL;
    authorization = environment.T3_MCP_BEARER_TOKEN
      ? `Bearer ${environment.T3_MCP_BEARER_TOKEN}`
      : undefined;
  }
  if (!endpoint || !authorization || !valid(endpoint, authorization)) return yield* fail();
  return { endpoint, authorization };
});

/** One tool call over its own MCP session, which ends once the call settles. */
export const callTerminalTool = (
  options: Omit<McpToolSessionOptions, "clientName"> & {
    readonly tool: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  },
) =>
  mcpToolSession({ ...options, clientName: "loom-terminal" }).pipe(
    Effect.flatMap((session) => session.call(options.tool, options.arguments)),
    Effect.scoped,
  );
