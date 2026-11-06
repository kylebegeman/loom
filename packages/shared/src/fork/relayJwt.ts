import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Jwt from "effect/jose/Jwt";
import * as JoseError from "effect/jose/JoseError";
import { RelayJwtError } from "../relayJwt.ts";
import * as Schema from "effect/Schema";
import { verifyRelayJwt as verify } from "../relayJwt.ts";

export const verifyRelayJwt = Effect.fn("LoomRelayJwt.verify")(function* (input: {
  readonly publicKey: string;
  readonly token: string;
  readonly typ: string;
  readonly issuer: string;
  readonly audience: string;
  readonly nowEpochSeconds: number;
  readonly maxTokenAge: number;
}) {
  const decoded = yield* Jwt.decodeUnverified(input.token).pipe(
    Effect.mapError((cause) => new RelayJwtError({ operation: "verify", typ: input.typ, cause })),
  );
  if (decoded.protectedHeader.typ !== input.typ) {
    return yield* new RelayJwtError({
      operation: "verify",
      typ: input.typ,
      cause: new JoseError.JoseError({
        reason: new JoseError.ClaimValidationFailed({ claim: "typ", reason: "mismatch" }),
      }),
    });
  }
  const clock = yield* Clock.Clock;
  const millis = input.nowEpochSeconds * 1_000;
  // Loom proofs bind an explicit verification instant; upstream JWTs read the ambient clock.
  return yield* verify(Schema.Record(Schema.String, Schema.Json), {
    ...input,
    maxTokenAge: Duration.seconds(input.maxTokenAge),
  }).pipe(
    Effect.provideService(Clock.Clock, {
      sleep: (duration) => clock.sleep(duration),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      currentTimeNanos: Effect.succeed(BigInt(Math.floor(millis * 1_000_000))),
      currentTimeNanosUnsafe: () => BigInt(Math.floor(millis * 1_000_000)),
      currentTimeMillis: Effect.succeed(millis),
      currentTimeMillisUnsafe: () => millis,
    }),
  );
});
