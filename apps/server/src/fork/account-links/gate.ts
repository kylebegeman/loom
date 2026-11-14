import { AuthSessionId, type EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ForkRuntime } from "../ForkRuntime.ts";
import { AccountLinks } from "./AccountLinks.ts";

const find = Effect.gen(function* () {
  const direct = yield* Effect.serviceOption(AccountLinks);
  if (Option.isSome(direct)) return direct;
  const fork = yield* ForkRuntime;
  return fork === undefined ? Option.none() : Context.getOption(fork, AccountLinks);
});

/**
 * fork: account-links -- what the Linked environments seams ask, so the account's own links run
 * whatever the Labs switch says while links made with a pairing code still follow it. Resolved
 * once where it is built, and per call when the server runtime was not there yet.
 */
export const accountLinkGate = Effect.gen(function* () {
  const captured = yield* find;
  const links = Option.isSome(captured) ? Effect.succeed(captured) : find;
  const ask = (question: (service: AccountLinks["Service"]) => Effect.Effect<boolean>) =>
    links.pipe(
      Effect.flatMap(Option.match({ onNone: () => Effect.succeed(false), onSome: question })),
    );
  return {
    holdsAny: ask((service) => service.holdsAny),
    holds: (environmentId: EnvironmentId) => ask((service) => service.holds(environmentId)),
    admits: (sessionId: string) => ask((service) => service.admits(AuthSessionId.make(sessionId))),
  };
});
