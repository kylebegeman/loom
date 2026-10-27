import { callTerminalTool, readTerminalConnection } from "./TerminalConnection.ts";
import { decodeVaultTerminalError, type VaultTerminalError } from "./terminal-errors.ts";
import {
  VaultSshAgentOpenInput,
  VaultSshAgentSession,
  VaultSshAgentFrame,
  VaultSshAgentResponse,
  VaultSshAgentClosed,
} from "@t3tools/contracts/fork";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
export class SshAgentClientError extends Schema.TaggedError<SshAgentClientError>()(
  "SshAgentClientError",
  {
    reason: Schema.Literals(["connection", "denied", "response"]),
  },
) {
  override get message() {
    return this.reason === "connection"
      ? "Configure an authenticated Loom MCP connection in this agent terminal before activating Vault SSH."
      : this.reason === "denied"
        ? "Vault SSH agent access was denied. Check the active run, current Vault host policy, broker, key version and host trust."
        : "The Loom server returned an unsupported SSH agent response.";
  }
}
export class SshAgentClient extends Context.Service<
  SshAgentClient,
  {
    readonly open: (
      input: VaultSshAgentOpenInput,
    ) => Effect.Effect<VaultSshAgentSession, SshAgentClientError | VaultTerminalError>;
    readonly frame: (
      input: VaultSshAgentFrame,
    ) => Effect.Effect<{ response: string }, SshAgentClientError | VaultTerminalError>;
    readonly close: (
      sessionId: string,
    ) => Effect.Effect<void, SshAgentClientError | VaultTerminalError>;
  }
>()("t3/fork/vault/SshAgentClient") {}
const Envelope = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  structuredContent: Schema.optionalKey(Schema.Unknown),
  content: Schema.optionalKey(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })),
  ),
});
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);
const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment,
    fetchImplementation = yield* FetchHttpClient.Fetch;
  const connection = yield* readTerminalConnection(environment).pipe(Effect.option);
  const call = Effect.fnUntraced(function* <A, I>(
    tool: string,
    input: Readonly<Record<string, unknown>>,
    schema: Schema.Codec<A, I>,
  ) {
    if (Option.isNone(connection)) return yield* new SshAgentClientError({ reason: "connection" });
    const { endpoint, authorization } = connection.value;
    const envelope = decodeEnvelope(
      yield* callTerminalTool({
        endpoint,
        authorization,
        tool,
        arguments: input,
        fetchImplementation: async (url, init) => {
          const timeout = AbortSignal.timeout(15_000);
          const response = await fetchImplementation(url, {
            ...init,
            redirect: "error",
            signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
          });
          if (!response.body) return response;
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              length += chunk.value.length;
              if (length > 65_536) {
                await reader.cancel();
                throw new Error("SSH agent MCP response exceeded its size limit");
              }
              chunks.push(chunk.value);
            }
          } finally {
            reader.releaseLock();
          }
          const body = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
          }
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError(() => new SshAgentClientError({ reason: "connection" })),
      ),
    );
    if (Option.isNone(envelope)) return yield* new SshAgentClientError({ reason: "response" });
    if (envelope.value.isError) {
      const failure = decodeVaultTerminalError(envelope.value);
      if (Option.isSome(failure)) return yield* failure.value;
      return yield* new SshAgentClientError({ reason: "denied" });
    }
    const decode = Schema.decodeUnknownOption(schema),
      decodeText = Schema.decodeUnknownOption(Schema.fromJsonString(schema));
    let value = decode(envelope.value.structuredContent);
    for (const content of envelope.value.content ?? []) {
      if (Option.isSome(value)) break;
      if (content.type === "text" && content.text) value = decodeText(content.text);
    }
    if (Option.isNone(value)) return yield* new SshAgentClientError({ reason: "response" });
    return value.value;
  });
  return SshAgentClient.of({
    open: Effect.fn("SshAgentClient.open")(function (input) {
      return call("loom_vault_ssh_agent_open", input, VaultSshAgentSession);
    }),
    frame: Effect.fn("SshAgentClient.frame")(function (input) {
      return call("loom_vault_ssh_agent_frame", input, VaultSshAgentResponse);
    }),
    close: Effect.fn("SshAgentClient.close")(function (sessionId) {
      return call("loom_vault_ssh_agent_close", { sessionId }, VaultSshAgentClosed).pipe(
        Effect.asVoid,
      );
    }),
  });
});
export const layer = Layer.effect(SshAgentClient, make);
