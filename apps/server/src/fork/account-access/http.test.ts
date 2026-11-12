import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { expect, it } from "@effect/vitest";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ACCOUNT_ACCESS_HEADER, ACCOUNT_ACCESS_PREFIX } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as AccountGateway from "./AccountGateway.ts";
import * as AccountHost from "./AccountHost.ts";
import { AccountAccessError } from "./AccountAccess.ts";
import { AccountAccessRoutes } from "./http.ts";

it.effect("routes a computer request and applies host admission before protected handlers", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      Layer.mergeAll(
        Layer.mock(AccountGateway.AccountGateway)({
          forward: ({ environmentId, path, request }) =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe({
                environmentId,
                path,
                authorization: request.headers.authorization,
              }),
            ),
        }),
        Layer.mock(AccountHost.AccountHost)({
          admit: ({ grant, method, path }) =>
            grant === "valid" && method === "GET" && path === "/api/projects"
              ? Effect.succeed("local-host-session")
              : Effect.fail(new AccountAccessError({ reason: "denied" })),
        }),
      ),
    );
    const inspect = HttpRouter.add(
      "GET",
      "/api/projects",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        return HttpServerResponse.jsonUnsafe({
          authorization: request.headers.authorization,
          cookie: request.headers.cookie ?? null,
          grant: request.headers[ACCOUNT_ACCESS_HEADER] ?? null,
        });
      }),
    );
    const web = HttpRouter.toWebHandler(
      Layer.merge(AccountAccessRoutes, inspect).pipe(
        Layer.provide(
          Layer.succeed(ForkRuntime, context as unknown as Context.Context<ForkServices>),
        ),
        HttpRouter.provideRequest(
          Layer.mergeAll(
            NodeHttpPlatform.layer,
            Layer.succeed(ForkRuntime, context as unknown as Context.Context<ForkServices>),
            Layer.mock(EnvironmentAuth.EnvironmentAuth)({
              authenticateHttpRequest: () =>
                Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError()),
            }),
          ),
        ),
        Layer.provide(NodeServices.layer),
      ),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const send = (path: string, headers: Record<string, string>) =>
      Effect.promise(() =>
        web.handler(new Request(`http://library.example.test${path}`, { headers })),
      );
    const route = yield* send(`${ACCOUNT_ACCESS_PREFIX}computer%3Aa/api/projects?q=threads`, {
      authorization: "Bearer library-session",
    });
    expect(route.status).toBe(200);
    expect(yield* Effect.promise(() => route.json())).toEqual({
      environmentId: "computer:a",
      path: "/api/projects?q=threads",
      authorization: "Bearer library-session",
    });
    const admitted = yield* send("/api/projects", {
      [ACCOUNT_ACCESS_HEADER]: "valid",
      cookie: "unrelated=secret",
      authorization: "Bearer untrusted",
    });
    expect(admitted.status).toBe(200);
    expect(yield* Effect.promise(() => admitted.json())).toEqual({
      authorization: "Bearer local-host-session",
      cookie: null,
      grant: null,
    });
    const refused = yield* send("/api/projects", {
      [ACCOUNT_ACCESS_HEADER]: "invalid",
      authorization: "Bearer otherwise-valid",
    });
    expect(refused.status).toBe(403);
  }),
);
