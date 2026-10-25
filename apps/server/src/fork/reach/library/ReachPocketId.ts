import type { ReachIdentityFailure } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { readReachCredential, reachLibraryConfig } from "./credentials.ts";

const REQUEST_TIMEOUT = "15 seconds";
const RESPONSE_MAX = ByteSize.mebibytes(1);
/** Pocket ID's API name limit (`api/dto.go`). */
const API_NAME_MAX = 50;
const API_NAME_LABEL_MAX = 34;
const SEARCH_LIMIT = "100";

/**
 * Pocket ID refuses the label, prefix and id past 50 characters, so the label is cut first and
 * the id prefix keeps two computers with one label apart.
 */
export const reachApiName = (label: string | null, environmentId: string) => {
  const shown = (label ?? "").trim().slice(0, API_NAME_LABEL_MAX).trim() || "computer";
  return `Loom ${shown} (${environmentId.slice(0, 8)})`.slice(0, API_NAME_MAX);
};

/** `not-configured`: no admin key file right now, which is normal with an on-demand key. */
export class ReachPocketIdError extends Schema.TaggedError<ReachPocketIdError>()(
  "ReachPocketIdError",
  {
    stage: Schema.String,
    reason: Schema.Literals(["not-configured", "denied", "unavailable", "conflict"]),
  },
) {
  override get message(): string {
    return `Pocket ID ${this.stage} failed: ${this.reason}.`;
  }

  /** The reason a failed identity step reports. */
  get failure(): ReachIdentityFailure {
    return this.reason === "not-configured" ? "unavailable" : this.reason;
  }
}

/**
 * Touches only `/api/apis*`. It never calls `/api/oidc/clients*`: a PUT there replaces a whole
 * client, so one mistake would rewrite the native client's callbacks.
 */
export class ReachPocketId extends Context.Service<
  ReachPocketId,
  {
    /**
     * Creates or finds the computer's API by exact resource, then grants the native client
     * user-delegated access to it. A stored id that Pocket ID no longer knows is created again.
     */
    readonly ensureApi: (input: {
      readonly apiId: string | null;
      readonly name: string;
      readonly resource: string;
      readonly clientId: string;
    }) => Effect.Effect<{ readonly apiId: string }, ReachPocketIdError>;
    /** A missing API counts as deleted. */
    readonly deleteApi: (apiId: string) => Effect.Effect<void, ReachPocketIdError>;
  }
>()("t3/fork/reach/library/ReachPocketId") {}

const Api = Schema.Struct({ id: Schema.String, resource: Schema.String });
const decodeApi = Schema.decodeUnknownOption(Api);
const decodeSearch = Schema.decodeUnknownOption(Schema.Struct({ data: Schema.Array(Api) }));
const decodeGrant = Schema.decodeUnknownOption(
  Schema.Struct({ userDelegatedAccess: Schema.Boolean }),
);
const decodeErrorCode = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }));

const GRANT = {
  userDelegatedAccess: true,
  clientAccess: false,
  userDelegatedPermissionIds: [],
  clientPermissionIds: [],
} as const;

const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const { identity } = reachLibraryConfig(env);
  const http = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const base = identity.issuer === null ? null : new URL(identity.issuer).origin;

  const fail = (stage: string, reason: ReachPocketIdError["reason"]) =>
    new ReachPocketIdError({ stage, reason });

  // Each caller is an `Effect.fn` span already; a span per exchange would only repeat it.
  const send = Effect.fnUntraced(function* (
    stage: string,
    build: (base: string) => HttpClientRequest.HttpClientRequest,
  ) {
    if (base === null) return yield* fail(stage, "not-configured");
    const key = yield* readReachCredential(identity.adminKeyFile).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.mapError((error) =>
        fail(stage, error.reason === "missing" ? "not-configured" : "denied"),
      ),
    );
    const answer = yield* http
      .execute(
        build(base).pipe(
          // `x-api-key` is one of the headers Effect redacts when it prints a request.
          HttpClientRequest.setHeader("x-api-key", Redacted.value(key)),
          HttpClientRequest.acceptJson,
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          (response.status === 204 ? Effect.succeed(null) : response.json).pipe(
            Effect.orElseSucceed(() => null),
            Effect.map((body) => ({ status: response.status, body })),
          ),
        ),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, RESPONSE_MAX),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError(() => fail(stage, "unavailable")),
      );
    if (answer.status >= 400 && answer.status !== 404 && answer.status !== 409)
      yield* Effect.logWarning("Pocket ID refused a reach call.", {
        stage,
        status: answer.status,
        code: Option.getOrNull(Option.map(decodeErrorCode(answer.body), (error) => error.code)),
      });
    return answer;
  });

  const refused = (stage: string, status: number) =>
    fail(
      stage,
      status === 401 || status === 403 ? "denied" : status >= 500 ? "unavailable" : "conflict",
    );

  const grant = (stage: string, apiId: string, clientId: string) =>
    send(stage, (origin) =>
      HttpClientRequest.put(
        `${origin}/api/apis/${encodeURIComponent(apiId)}/clients/${encodeURIComponent(clientId)}`,
      ).pipe(HttpClientRequest.bodyJsonUnsafe(GRANT)),
    ).pipe(
      Effect.flatMap((answer) => {
        if (answer.status === 404) return Effect.succeed(false);
        if (answer.status < 200 || answer.status >= 300)
          return Effect.fail(refused(stage, answer.status));
        // A grant that does not echo the access it was given is not one sign-in can rely on.
        return Option.exists(decodeGrant(answer.body), (body) => body.userDelegatedAccess)
          ? Effect.succeed(true)
          : Effect.fail(fail(stage, "conflict"));
      }),
    );

  const findByResource = (resource: string) =>
    send("api.search", (origin) =>
      HttpClientRequest.get(`${origin}/api/apis`).pipe(
        HttpClientRequest.setUrlParams({
          search: resource,
          "pagination[page]": "1",
          "pagination[limit]": SEARCH_LIMIT,
        }),
      ),
    ).pipe(
      Effect.flatMap((answer) =>
        answer.status >= 200 && answer.status < 300
          ? Effect.succeed(
              Option.match(decodeSearch(answer.body), {
                onNone: () => null,
                // Search matches substrings; only the exact resource is this computer's.
                onSome: (page) => page.data.find((api) => api.resource === resource)?.id ?? null,
              }),
            )
          : Effect.fail(refused("api.search", answer.status)),
      ),
    );

  const create = (name: string, resource: string) =>
    send("api.create", (origin) =>
      HttpClientRequest.post(`${origin}/api/apis`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ name, resource }),
      ),
    ).pipe(
      Effect.flatMap((answer) => {
        if (answer.status === 409) {
          return Option.exists(
            decodeErrorCode(answer.body),
            (error) => error.code === "already_in_use",
          )
            ? findByResource(resource).pipe(
                Effect.flatMap((apiId) =>
                  apiId === null
                    ? Effect.fail(fail("api.search", "conflict"))
                    : Effect.succeed(apiId),
                ),
              )
            : Effect.fail(fail("api.create", "conflict"));
        }
        if (answer.status < 200 || answer.status >= 300)
          return Effect.fail(refused("api.create", answer.status));
        return Option.match(decodeApi(answer.body), {
          onNone: () => Effect.fail(fail("api.create", "conflict")),
          onSome: (api) =>
            api.resource === resource
              ? Effect.succeed(api.id)
              : Effect.fail(fail("api.create", "conflict")),
        });
      }),
    );

  const ensureApi = Effect.fn("ReachPocketId.ensureApi")(function* (input: {
    readonly apiId: string | null;
    readonly name: string;
    readonly resource: string;
    readonly clientId: string;
  }) {
    if (input.apiId !== null && (yield* grant("grant.put", input.apiId, input.clientId))) {
      return { apiId: input.apiId };
    }
    const apiId = yield* create(input.name, input.resource);
    if (!(yield* grant("grant.put", apiId, input.clientId)))
      return yield* fail("grant.put", "conflict");
    return { apiId };
  });

  const deleteApi = Effect.fn("ReachPocketId.deleteApi")(function* (apiId: string) {
    const answer = yield* send("api.delete", (origin) =>
      HttpClientRequest.delete(`${origin}/api/apis/${encodeURIComponent(apiId)}`),
    );
    if (answer.status === 404 || (answer.status >= 200 && answer.status < 300)) return;
    return yield* refused("api.delete", answer.status);
  });

  return ReachPocketId.of({ ensureApi, deleteApi });
});

export const layer = Layer.effect(ReachPocketId, make);
