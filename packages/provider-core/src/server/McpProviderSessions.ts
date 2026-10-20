import { makeTerminalConnections } from "../fork/terminalConnections.ts"; // fork: ext-vault-terminal
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SynchronizedRef from "effect/SynchronizedRef";

import type { McpProviderSessionConfig } from "./mcpSession.ts";

export class McpProviderSessions extends Context.Service<
  McpProviderSessions,
  {
    readonly set: (config: McpProviderSessionConfig) => Effect.Effect<void>;
    readonly read: (threadId: ThreadId) => Effect.Effect<McpProviderSessionConfig | undefined>;
    readonly clear: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("@t3tools/provider-core/server/McpProviderSessions") {}

const make = Effect.gen(function* () {
  const terminal = yield* makeTerminalConnections; // fork: ext-vault-terminal
  const sessions = yield* SynchronizedRef.make(new Map<ThreadId, McpProviderSessionConfig>());
  return McpProviderSessions.of({
    // fork: ext-vault-terminal
    set: (config) =>
      SynchronizedRef.updateEffect(sessions, (current) =>
        Effect.gen(function* () {
          const prior = current.get(config.threadId);
          const file = yield* terminal?.create(config) ?? Effect.undefined;
          if (prior?.terminalConnectionFile)
            yield* terminal?.remove(prior.terminalConnectionFile) ?? Effect.void;
          const { terminalConnectionFile: _untrusted, ...rest } = config;
          return new Map(current).set(config.threadId, {
            ...rest,
            ...(file === undefined ? {} : { terminalConnectionFile: file }),
          });
        }),
      ),
    read: (threadId) =>
      SynchronizedRef.get(sessions).pipe(Effect.map((current) => current.get(threadId))),
    // fork: ext-vault-terminal
    clear: (threadId) =>
      SynchronizedRef.updateEffect(sessions, (current) =>
        Effect.gen(function* () {
          const prior = current.get(threadId);
          if (prior?.terminalConnectionFile)
            yield* terminal?.remove(prior.terminalConnectionFile) ?? Effect.void;
          const next = new Map(current);
          next.delete(threadId);
          return next;
        }),
      ),
  });
});

export const layer = Layer.effect(McpProviderSessions, make);
