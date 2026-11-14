import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryError } from "@t3tools/contracts/fork";
import { newestCliReleaseVersion, type CliReleaseChannel } from "@t3tools/shared/cliRelease";
import { isLoomGitHubReleaseBaseUrl } from "@t3tools/shared/fork/cli-release";
import {
  LOOM_RELEASE_INDEX_FILE,
  LOOM_RELEASES_NOT_HOSTED,
  LOOM_RELEASES_ROUTE,
} from "@t3tools/shared/fork/release-mirror";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import {
  type LibraryConnection,
  LibraryConnectionService,
  readLibraryConnection,
} from "../project-library/LibraryConnection.ts";

export interface ReleaseSource {
  /** `undefined` is the public release feed. */
  readonly releaseBaseUrl: string | undefined;
  readonly httpClient: HttpClient.HttpClient;
}

export class LoomReleaseSource extends Context.Service<
  LoomReleaseSource,
  {
    /**
     * An explicit mirror wins. Otherwise an enrolled computer downloads from its Library, unless the
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

/**
 * Whether a configured base leaves the source to the Library: none, or Loom's own GitHub releases,
 * which LoomOS and Omarchy recipes name explicitly and which turn private with the repository.
 */
export const followsLibraryReleases = (releaseBaseUrl: string | undefined) => {
  const base = releaseBaseUrl?.trim();
  return !base || isLoomGitHubReleaseBaseUrl(base);
};

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

/** The connection's Library, unless it says it hosts no releases; then `configured` unchanged. */
const releaseSourceFor = Effect.fn("LoomReleaseSource.releaseSourceFor")(function* (
  connection: LibraryConnection,
  send: Send,
  configured: ReleaseSource,
) {
  if (connection.kind !== "remote" || connection.credentialAvailable !== true) return configured;
  const releaseBaseUrl = connection.endpoint(LOOM_RELEASES_ROUTE);
  const notHosted = yield* sendWithoutRedirect(
    send,
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
      send,
      direct: configured.httpClient,
    }),
  };
});

const make = Effect.gen(function* () {
  const connections = yield* LibraryConnectionService;
  return LoomReleaseSource.of({
    resolve: Effect.fn("LoomReleaseSource.resolve")(function* (configured) {
      if (!followsLibraryReleases(configured.releaseBaseUrl)) return configured;
      return yield* releaseSourceFor(yield* connections.current, connections.send, configured);
    }),
  });
});

export const layer = Layer.effect(LoomReleaseSource, make);

/** Every update from the configured source, as on a computer enrolled in no Library. */
export const configuredOnly = LoomReleaseSource.of({ resolve: Effect.succeed });

export interface LibraryReleases {
  readonly releaseBaseUrl: string;
  readonly httpClient: HttpClient.HttpClient;
}

/**
 * The Library's releases for `t3 update` on an enrolled computer, read with the sign-in its server
 * uses, without starting one. `undefined` when this home is not enrolled or its Library hosts none.
 */
export const libraryReleasesForHome = Effect.fn("LoomReleaseSource.libraryReleasesForHome")(
  function* (config: ServerConfig.ServerConfig["Service"]) {
    const fileSystem = yield* FileSystem.FileSystem;
    const httpClient = yield* HttpClient.HttpClient;
    // Only an existing identity: an update never creates one.
    const environmentId = (yield* fileSystem
      .readFileString(config.environmentIdPath)
      .pipe(Effect.orElseSucceed(() => ""))).trim();
    if (environmentId === "") return undefined;
    const connection = yield* readLibraryConnection.pipe(
      Effect.provideService(ServerConfig.ServerConfig, config),
      Effect.provideService(
        ServerEnvironmentIdentity,
        ServerEnvironmentIdentity.of({
          getEnvironmentId: Effect.succeed(EnvironmentId.make(environmentId)),
        }),
      ),
      Effect.orElseSucceed((): LibraryConnection => ({ kind: "unavailable" })),
    );
    if (connection.kind !== "remote") return undefined;
    const source = yield* releaseSourceFor(connection, connection.send, {
      releaseBaseUrl: undefined,
      httpClient,
    });
    return source.releaseBaseUrl === undefined
      ? undefined
      : ({
          releaseBaseUrl: source.releaseBaseUrl,
          httpClient: source.httpClient,
        } satisfies LibraryReleases);
  },
);

export class LibraryReleaseIndexError extends Schema.TaggedError<LibraryReleaseIndexError>()(
  "LibraryReleaseIndexError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const decodeReleaseIndex = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({ tag_name: Schema.String, draft: Schema.optional(Schema.Boolean) }),
    ),
  ),
);

/** The newest `channel` release a Library mirrors, from its index in GitHub's release-list shape. */
export const newestLibraryRelease = Effect.fn("LoomReleaseSource.newestLibraryRelease")(function* (
  releases: LibraryReleases,
  channel: CliReleaseChannel,
) {
  const unreadable = new LibraryReleaseIndexError({
    reason: "Could not list t3 releases from your Library.",
  });
  const body = yield* releases.httpClient
    .get(`${releases.releaseBaseUrl}/${LOOM_RELEASE_INDEX_FILE}`)
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.fail(unreadable) }),
      Effect.mapError(() => unreadable),
    );
  const version = newestCliReleaseVersion(
    yield* decodeReleaseIndex(body).pipe(Effect.mapError(() => unreadable)),
    channel,
  );
  if (version === undefined)
    return yield* new LibraryReleaseIndexError({
      reason: `Your Library has no published ${channel} release.`,
    });
  return version;
});
