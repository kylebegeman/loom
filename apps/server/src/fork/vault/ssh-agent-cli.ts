import { decodeSshAgentInput } from "./ssh-agent-input.ts";
import { Argument, Command } from "effect/cli";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as SshAgentClient from "./SshAgentClient.ts";
import * as SshAgentTerminal from "./SshAgentTerminal.ts";
class SshChildExit extends Schema.TaggedError<SshChildExit>()("SshChildExit", {
  code: Schema.Int,
}) {
  override readonly [Runtime.errorReported] = false;
  override get [Runtime.errorExitCode]() {
    return this.code;
  }
  override get message() {
    return "The Vault SSH/Git command exited unsuccessfully.";
  }
}
const runtime = SshAgentTerminal.layer.pipe(Layer.provide(SshAgentClient.layer));

export const sshAgentExecCommand = Command.make("ssh-agent-exec", {
  input: Argument.String("arguments-json"),
}).pipe(
  Command.withDescription(
    "Activate a Vault SSH agent for one ordinary terminal SSH/Git command. Requires an authenticated active agent run and current Vault host policy permission. Owner-trusted mode needs no individual grant. Uses no personal keys; child streams and exit code are preserved.",
  ),
  Command.withHandler(({ input }) =>
    Effect.gen(function* () {
      const request = yield* decodeSshAgentInput(input);
      const terminal = yield* SshAgentTerminal.SshAgentTerminal;
      const code = yield* terminal.execute(request);
      if (code !== 0) return yield* new SshChildExit({ code: Math.min(255, Math.max(1, code)) });
    }).pipe(
      Effect.catchIf(
        (error) => error._tag !== "SshChildExit",
        (error) => Console.error(error.message).pipe(Effect.andThen(new SshChildExit({ code: 1 }))),
      ),
      Effect.provide(runtime),
    ),
  ),
);
