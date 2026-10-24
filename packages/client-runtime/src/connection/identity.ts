import { LOOM_IDENTITY_LOGOUT_PATH } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Redacted from "effect/Redacted";
import { ConnectionTransientError } from "./model.ts";

/** The caller checks the credential's environment binding before sending it to its saved origin. */
export const revokeIdentitySession = Effect.fn("connection.identity.revoke")(function* (input: {
  readonly httpBaseUrl: string;
  readonly token: string;
}) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http
    .execute(
      HttpClientRequest.post(new URL(LOOM_IDENTITY_LOGOUT_PATH, input.httpBaseUrl).href).pipe(
        HttpClientRequest.bearerToken(Redacted.make(input.token)),
      ),
    )
    .pipe(
      Effect.provideService(FetchHttpClient.RequestInit, {
        redirect: "error",
        credentials: "omit",
      }),
      Effect.timeout("10 seconds"),
      Effect.mapError(
        () =>
          new ConnectionTransientError({
            reason: "network",
            detail: "Could not reach this computer to end its Identity session.",
          }),
      ),
    );
  if (response.status !== 200)
    return yield* new ConnectionTransientError({
      reason: "remote-unavailable",
      detail: "This computer did not confirm that it ended the Identity session.",
    });
});
