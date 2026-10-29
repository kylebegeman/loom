import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { ConnectionTransientError } from "../connection/model.ts";

/** Native clients can authenticate the handshake without changing Loom's own session credential. */
export class NativeTransportAuth extends Context.Service<
  NativeTransportAuth,
  {
    readonly headers: (
      url: string,
    ) => Effect.Effect<Readonly<Record<string, string>> | undefined, ConnectionTransientError>;
  }
>()("@t3tools/client-runtime/fork/cloudflare-access/NativeTransportAuth") {}

export const nativeTransportHeaders = Effect.fn("nativeTransportHeaders")(function* (url: string) {
  const auth = yield* Effect.serviceOption(NativeTransportAuth);
  return Option.isSome(auth) ? yield* auth.value.headers(url) : undefined;
});
