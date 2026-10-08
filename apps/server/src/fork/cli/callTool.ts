import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Console from "effect/Console";
import { callAcpMcpTool } from "../../mcp/AcpMcpStdioBridge.ts";

class ForkCliError extends Schema.TaggedError<ForkCliError>()("ForkCliError", {
  message: Schema.String,
}) {}

const argumentsSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const encodeResult = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const toolFailure = Schema.Struct({ isError: Schema.Literal(true) });
/** Reuse the authenticated MCP boundary from any configured terminal or ACP agent session. */
export const callForkTool = Effect.fn("callForkTool")(function* (
  tool: string,
  argumentsJson: string,
  environment: Readonly<Record<string, string | undefined>>,
) {
  const endpoint = environment.LOOM_MCP_ENDPOINT ?? environment.T3_ACP_MCP_ENDPOINT;
  const authorization = environment.LOOM_MCP_AUTHORIZATION ?? environment.T3_ACP_MCP_AUTHORIZATION;
  if (!endpoint || !authorization)
    return yield* Effect.fail(
      new ForkCliError({
        message:
          "Configure LOOM_MCP_ENDPOINT and LOOM_MCP_AUTHORIZATION, or run from an ACP agent terminal with its MCP environment.",
      }),
    );
  const args = yield* Schema.decodeEffect(argumentsSchema)(argumentsJson);
  const result = yield* callAcpMcpTool({ endpoint, authorization, tool, arguments: args });
  yield* Console.log(yield* encodeResult(result));
  if (Schema.is(toolFailure)(result))
    return yield* Effect.fail(
      new ForkCliError({ message: "The Loom tool failed. See the JSON result for details." }),
    );
});
