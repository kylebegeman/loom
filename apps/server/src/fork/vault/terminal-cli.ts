// @effect-diagnostics nodeBuiltinImport:off -- CLI boundary forwards scrubbed child output and preserves its exit code.
import * as NodeProcess from "node:process";
import { VaultGitHubTerminalRun, VaultGitHubTerminalResult } from "@t3tools/contracts/fork";
import { Argument, Command } from "effect/cli";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { callAcpMcpTool } from "../../mcp/AcpMcpStdioBridge.ts";
class TerminalCliError extends Schema.TaggedError<TerminalCliError>()("TerminalCliError", {
  reason: Schema.Literals(["connection", "tool", "response"]),
}) {
  override get message() {
    return this.reason === "connection"
      ? "Run from an authenticated Loom agent terminal or configure its MCP endpoint and authorization."
      : this.reason === "tool"
        ? "Vault could not execute this command. Check the connection, current run and repository use grant."
        : "The Loom server returned an unsupported terminal result.";
  }
}
class TerminalExit extends Schema.TaggedError<TerminalExit>()("TerminalExit", {
  code: Schema.Int,
}) {
  override readonly [Runtime.errorReported] = false;
  override get [Runtime.errorExitCode]() {
    return this.code;
  }
  override get message() {
    return "The routed command exited unsuccessfully.";
  }
}
const ResultEnvelope = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  structuredContent: Schema.optionalKey(Schema.Unknown),
  content: Schema.optionalKey(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })),
  ),
});
const decodeRun = Schema.decodeEffect(Schema.fromJsonString(VaultGitHubTerminalRun));
const decodeEnvelope = Schema.decodeUnknownOption(ResultEnvelope),
  decodeResult = Schema.decodeUnknownOption(VaultGitHubTerminalResult),
  decodeTextResult = Schema.decodeUnknownOption(Schema.fromJsonString(VaultGitHubTerminalResult));
export const runGitHubTerminalCli = Effect.fn("runGitHubTerminalCli")(function* (
  argumentsJson: string,
  environment: Readonly<Record<string, string | undefined>>,
  output: { stdout: (text: string) => void; stderr: (text: string) => void } = {
    stdout: (text) => {
      NodeProcess.stdout.write(text);
    },
    stderr: (text) => {
      NodeProcess.stderr.write(text);
    },
  },
) {
  const endpoint = environment.LOOM_MCP_ENDPOINT ?? environment.T3_ACP_MCP_ENDPOINT,
    authorization = environment.LOOM_MCP_AUTHORIZATION ?? environment.T3_ACP_MCP_AUTHORIZATION;
  if (!endpoint || !authorization) return yield* new TerminalCliError({ reason: "connection" });
  const args = yield* decodeRun(argumentsJson);
  const envelope = decodeEnvelope(
    yield* callAcpMcpTool({
      endpoint,
      authorization,
      tool: "loom_vault_github_exec",
      arguments: args,
    }),
  );
  if (Option.isNone(envelope)) return yield* new TerminalCliError({ reason: "response" });
  if (envelope.value.isError) return yield* new TerminalCliError({ reason: "tool" });
  const parsed = decodeResult(envelope.value.structuredContent).pipe(
    Option.orElse(() => {
      for (const content of envelope.value.content ?? []) {
        if (content.type !== "text" || !content.text) continue;
        const value = decodeTextResult(content.text);
        if (Option.isSome(value)) return value;
      }
      return Option.none();
    }),
  );
  if (Option.isNone(parsed)) return yield* new TerminalCliError({ reason: "response" });
  yield* Effect.sync(() => {
    output.stdout(parsed.value.stdout);
    output.stderr(parsed.value.stderr);
  });
  if (parsed.value.exitCode !== 0)
    return yield* new TerminalExit({ code: Math.max(1, Math.min(255, parsed.value.exitCode)) });
});
export const githubExecCommand = Command.make("github-exec", {
  argumentsJson: Argument.String("arguments-json"),
}).pipe(
  Command.withDescription(
    "Run a selected Vault gh/Git HTTPS command on the Loom server. Forwards output and exit status; requires an authenticated active agent run.",
  ),
  Command.withHandler(({ argumentsJson }) => runGitHubTerminalCli(argumentsJson, NodeProcess.env)),
);
