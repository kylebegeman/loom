import type { LibraryError } from "@t3tools/contracts/fork";
import {
  LOOM_RELEASE_INDEX_FILE,
  LOOM_RELEASES_NOT_HOSTED,
  LOOM_RELEASES_ROUTE,
} from "@t3tools/shared/fork/release-mirror";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";

export interface ReleaseSource {
  /** `undefined` is the public release feed. */
  readonly releaseBaseUrl: string | undefined;
  readonly httpClient: HttpClient.HttpClient;
}

export class LoomReleaseSource extends Context.Service<
  LoomReleaseSource,
  {
    /**
     * An explicit base wins. Otherwise an enrolled computer downloads from its Library, unless the
     * Library says it hosts no releases; then `configured` is returned unchanged.
     */
    readonly resolve: (configured: ReleaseSource) => Effect.Effect<ReleaseSource>;
  }
>()("t3/fork/releases/LoomReleaseSource") {}

type Send = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, LibraryError>;

const transportError = (request: HttpClientRequest.HttpClientRequest, description: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description }),
  });

/** One response from the Library itself: its redirect is never followed with its credentials. */
const sendWithoutRedirect = (send: Send, request: HttpClientRequest.HttpClientRequest) =>
  send(request).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }));

/**
 * Sends Library requests with this computer's credentials and follows the Library's redirect to a
 * signed object URL without them, so no credential reaches the object store.
 */
export const libraryReleaseClient = (input: {
  readonly origin: string;
  readonly send: Send;
  readonly direct: HttpClient.HttpClient;
}): HttpClient.HttpClient =>
  HttpClient.make((request, url) => {
    if (url.origin !== input.origin) return input.direct.execute(request);
    return sendWithoutRedirect(input.send, request).pipe(
      // LibraryError never carries the request, so the token stays out of the cause.
      Effect.mapError(() => transportError(request, "The Library could not be reached.")),
      Effect.flatMap((response) => {
        const location = response.headers["location"];
        if (response.status < 300 || response.status >= 400 || location === undefined)
          return Effect.succeed(response);
        const target = URL.parse(location, url.toString());
        if (target === null || target.protocol !== "https:")
          return Effect.fail(transportError(request, "The Library redirected to an unsafe URL."));
        return input.direct.execute(HttpClientRequest.get(target.toString()));
      }),
    );
  });

const make = Effect.gen(function* () {
  const connections = yield* LibraryConnectionService;
  return LoomReleaseSource.of({
    resolve: Effect.fn("LoomReleaseSource.resolve")(function* (configured) {
      if (configured.releaseBaseUrl !== undefined) return configured;
      const connection = yield* connections.current;
      if (connection.kind !== "remote" || connection.credentialAvailable !== true)
        return configured;
      const releaseBaseUrl = connection.endpoint(LOOM_RELEASES_ROUTE);
      const notHosted = yield* sendWithoutRedirect(
        connections.send,
        HttpClientRequest.get(`${releaseBaseUrl}/${LOOM_RELEASE_INDEX_FILE}`),
      ).pipe(
        Effect.flatMap((response) =>
          response.status === 404
            ? response.json.pipe(
                Effect.map(
                  (body) =>
                    typeof body === "object" &&
                    body !== null &&
                    "reason" in body &&
                    body.reason === LOOM_RELEASES_NOT_HOSTED,
                ),
              )
            : Effect.succeed(false),
        ),
        // An unreachable Library is reported by the download itself, not hidden by a fallback.
        Effect.orElseSucceed(() => false),
      );
      if (notHosted) return configured;
      return {
        releaseBaseUrl,
        httpClient: libraryReleaseClient({
          origin: connection.origin,
          send: connections.send,
          direct: configured.httpClient,
        }),
      };
    }),
  });
});

export const layer = Layer.effect(LoomReleaseSource, make);

/** Every update from the configured source, as on a computer enrolled in no Library. */
export const configuredOnly = LoomReleaseSource.of({ resolve: Effect.succeed });
