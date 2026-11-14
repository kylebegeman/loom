import type { AccountVaultFailure } from "@t3tools/contracts/fork";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AccountVaultHuman } from "./AccountVaultHuman.ts";

// Preserve each handler's payload, success and errors; only the transport changes on a Library without a backend.
export const accountVaultHandlers = Effect.fn("AccountVault.rpcHandlers")(function* <
  H extends object,
>(session: AuthenticatedSession, handlers: H) {
  const human = yield* AccountVaultHuman;
  const local = handlers as Record<
    string,
    (input: unknown) => Effect.Effect<unknown, typeof AccountVaultFailure.Type>
  >;
  return Object.fromEntries(
    Object.entries(local).map(([method, handler]) => [
      method,
      (input: unknown) =>
        human
          .forward(session, method, input ?? {})
          .pipe(
            Effect.flatMap((remote) =>
              Option.isSome(remote) ? Effect.succeed(remote.value) : handler(input),
            ),
          ),
    ]),
  ) as H;
});
