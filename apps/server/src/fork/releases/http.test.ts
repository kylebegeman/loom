import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ReleaseHttpRoutes } from "./http.ts";

const ORIGIN = "https://library.example.test";
const HOSTED = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_RELEASES_BACKEND: "b2",
  LOOM_B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  LOOM_B2_REGION: "us-west-004",
  LOOM_B2_ASSET_BUCKET: "library-assets",
  LOOM_B2_KEY_ID: "key-id",
  LOOM_B2_APPLICATION_KEY: "application-key",
};

const sessionFor = (
  subject: string,
  scopes: EnvironmentAuth.AuthenticatedSession["scopes"],
): EnvironmentAuth.AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${subject}`),
  subject,
  method: "bearer-access-token",
  scopes,
});
const PUBLISHER = sessionFor("loom-host:environment-studio", [AuthLibraryPublishScope]);
const OWNER = sessionFor("owner", [AuthOrchestrationReadScope]);

const fixture = (env: Record<string, string>) =>
  Effect.gen(function* () {
    const caller = yield* Ref.make<EnvironmentAuth.AuthenticatedSession | null>(PUBLISHER);
    const app = ReleaseHttpRoutes.pipe(
      Layer.provide(
        Layer.succeed(ForkRuntime, Context.empty() as unknown as Context.Context<ForkServices>),
      ),
      HttpRouter.provideRequest(
        Layer.mergeAll(
          NodeHttpPlatform.layer,
          Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })),
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({
            authenticateHttpRequest: () =>
              Ref.get(caller).pipe(
                Effect.filterOrFail(
                  (session): session is EnvironmentAuth.AuthenticatedSession => session !== null,
                  () => new EnvironmentAuth.ServerAuthMissingCredentialError(),
                ),
              ),
          }),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const get = (path: string) =>
      Effect.promise(() => web.handler(new Request(`${ORIGIN}/api/loom/releases/${path}`)));
    return { caller, get };
  });

const run = <A, E>(
  env: Record<string, string>,
  use: (f: Effect.Success<ReturnType<typeof fixture>>) => Effect.Effect<A, E>,
) => fixture(env).pipe(Effect.flatMap(use), Effect.scoped);

describe("release routes", () => {
  it.effect("tell clients when this server hosts no releases", () =>
    Effect.gen(function* () {
      for (const env of [
        { ...HOSTED, LOOM_LIBRARY_AUTHORITY: "false" },
        { ...HOSTED, LOOM_RELEASES_BACKEND: "" },
      ]) {
        yield* run(env, (f) =>
          Effect.gen(function* () {
            yield* Ref.set(f.caller, null);
            const response = yield* f.get("latest-mac.yml");
            expect(response.status).toBe(404);
            expect(yield* Effect.promise(() => response.json())).toEqual({ reason: "not-hosted" });
          }),
        );
      }
    }),
  );

  it.effect("redirect enrolled computers and owners to a short-lived signed object", () =>
    run(HOSTED, (f) =>
      Effect.gen(function* () {
        for (const [session, path, key] of [
          [PUBLISHER, "latest-mac.yml", "releases/latest-mac.yml"],
          [
            OWNER,
            "v0.0.208-nightly.20261112.4606/t3-0.0.208-nightly.20261112.4606-linux-x64.tar.gz",
            "releases/v0.0.208-nightly.20261112.4606/t3-0.0.208-nightly.20261112.4606-linux-x64.tar.gz",
          ],
        ] as const) {
          yield* Ref.set(f.caller, session);
          const response = yield* f.get(path);
          expect(response.status).toBe(302);
          expect(response.headers.get("cache-control")).toBe("no-store");
          const location = new URL(response.headers.get("location")!);
          expect(location.origin).toBe(HOSTED.LOOM_B2_ENDPOINT);
          expect(location.pathname).toBe(`/library-assets/${key}`);
          expect(location.searchParams.get("X-Amz-Expires")).toBe("300");
          expect(location.searchParams.get("X-Amz-Credential")).toMatch(/^key-id\//);
          expect(location.toString()).not.toContain("application-key");
        }
      }),
    ),
  );

  it.effect("sign from a separate release bucket when one is configured", () =>
    run({ ...HOSTED, LOOM_B2_RELEASE_BUCKET: "loom-releases" }, (f) =>
      Effect.gen(function* () {
        const response = yield* f.get("index.json");
        expect(new URL(response.headers.get("location")!).pathname).toBe(
          "/loom-releases/releases/index.json",
        );
      }),
    ),
  );

  it.effect("refuse callers without a computer or owner session", () =>
    run(HOSTED, (f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.caller, null);
        expect((yield* f.get("latest-mac.yml")).status).toBe(401);
        for (const session of [
          sessionFor("mcp-client", [AuthOrchestrationReadScope, AuthLibraryPublishScope]),
          sessionFor("computer:environment-studio", [AuthLibraryPublishScope]),
          sessionFor("owner", []),
        ]) {
          yield* Ref.set(f.caller, session);
          const response = yield* f.get("latest-mac.yml");
          expect(response.status).toBe(403);
          expect(response.headers.get("location")).toBeNull();
        }
      }),
    ),
  );

  it.effect("refuse paths outside the mirror layout", () =>
    run(HOSTED, (f) =>
      Effect.gen(function* () {
        for (const path of [
          "",
          ".hidden",
          "%2e%2e/secrets",
          "..%2fobjects%2fabc",
          "objects/abc",
          "v1.2/SHA256SUMS",
          "v0.0.1/..%2FSHA256SUMS",
          "v0.0.1/a/b",
          "v0.0.1/%E0%A4%A",
        ]) {
          const response = yield* f.get(path);
          // URL parsing resolves dot segments first, so some never reach this route.
          expect([400, 404], path).toContain(response.status);
          expect(response.headers.get("location"), path).toBeNull();
        }
      }),
    ),
  );
});
