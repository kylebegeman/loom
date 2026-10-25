import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as HttpClient from "effect/http/HttpClient";
import * as ReachPocketId from "./ReachPocketId.ts";
import { FakeReachApis, ISSUER, NATIVE_CLIENT_ID, POCKET_ID_KEY } from "./testing.ts";

const RESOURCE = "https://library.example.test/computers/environment-studio";

const run = <A, E>(
  use: (fixture: {
    readonly pocketId: ReachPocketId.ReachPocketId["Service"];
    readonly apis: FakeReachApis;
    readonly keyFile: string;
    readonly logs: ReadonlyArray<string>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem>,
  env: Readonly<Record<string, string | undefined>> = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "loom-reach-pocket-id-" });
    const keyFile = `${directory}/key`;
    yield* fs.writeFileString(keyFile, POCKET_ID_KEY);
    yield* fs.chmod(keyFile, 0o600);
    const apis = new FakeReachApis();
    const logs: Array<string> = [];
    const logger = Logger.make(({ message }) => {
      logs.push(JSON.stringify(message));
    });
    const pocketId = yield* ReachPocketId.ReachPocketId.pipe(
      Effect.provide(ReachPocketId.layer),
      Effect.provideService(HttpClient.HttpClient, apis.client),
      Effect.provideService(HostProcess.Environment, {
        LOOM_IDENTITY_ISSUER: `${ISSUER}/`,
        LOOM_IDENTITY_ADMIN_API_KEY_FILE: keyFile,
        ...env,
      }),
    );
    return yield* use({ pocketId, apis, keyFile, logs }).pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const ensure = (pocketId: ReachPocketId.ReachPocketId["Service"], apiId: string | null = null) =>
  pocketId.ensureApi({
    apiId,
    name: "Loom Studio (environm)",
    resource: RESOURCE,
    clientId: NATIVE_CLIENT_ID,
  });

describe("ReachPocketId", () => {
  it.effect("creates the API and grants the native client user-delegated access only", () =>
    run(({ pocketId, apis }) =>
      Effect.gen(function* () {
        const { apiId } = yield* ensure(pocketId);
        expect(apis.steps).toEqual(["api.create", "grant.put"]);
        expect(apis.apis.get(apiId)?.resource).toBe(RESOURCE);
        expect(apis.grants.get(`${apiId}:${NATIVE_CLIENT_ID}`)).toEqual({
          userDelegatedAccess: true,
          clientAccess: false,
          userDelegatedPermissionIds: [],
          clientPermissionIds: [],
        });
        expect(apis.calls.every((call) => call.path.startsWith("/api/apis"))).toBe(true);

        apis.clearCalls();
        expect(yield* ensure(pocketId, apiId)).toEqual({ apiId });
        expect(apis.steps).toEqual(["grant.put"]);
      }),
    ),
  );

  it.effect("adopts an existing API on a 409 by its exact resource, not a lookalike", () =>
    run(({ pocketId, apis }) =>
      Effect.gen(function* () {
        apis.addApi("Loom decoy", `${RESOURCE}-old`);
        const existing = apis.addApi("Loom Studio", RESOURCE);
        const { apiId } = yield* ensure(pocketId);
        expect(apiId).toBe(existing.id);
        expect(apis.steps).toEqual(["api.create", "api.search", "grant.put"]);
        expect(apis.calls.find((call) => call.step === "api.search")?.query).toMatchObject({
          search: RESOURCE,
        });
      }),
    ),
  );

  it.effect("fails a 409 search with no exact match as a conflict", () =>
    run(({ pocketId, apis }) =>
      Effect.gen(function* () {
        apis.addApi("Loom decoy", `${RESOURCE}-old`);
        apis.script("api.create", {
          status: 409,
          body: { error: "Resource is already in use", code: "already_in_use" },
        });
        const error = yield* ensure(pocketId).pipe(Effect.flip);
        expect(error.reason).toBe("conflict");
        expect(apis.steps).not.toContain("grant.put");
      }),
    ),
  );

  it.effect("creates the API again when the stored id is gone", () =>
    run(({ pocketId, apis }) =>
      Effect.gen(function* () {
        const { apiId } = yield* ensure(pocketId, "api-forgotten");
        expect(apiId).not.toBe("api-forgotten");
        expect(apis.steps).toEqual(["grant.put", "api.create", "grant.put"]);
      }),
    ),
  );

  it.effect("reports a missing key file as not configured without calling Pocket ID", () =>
    run(
      ({ pocketId, apis }) =>
        Effect.gen(function* () {
          const error = yield* ensure(pocketId).pipe(Effect.flip);
          expect(error.reason).toBe("not-configured");
          expect(error.failure).toBe("unavailable");
          expect(apis.calls).toEqual([]);
        }),
      { LOOM_IDENTITY_ADMIN_API_KEY_FILE: "/nonexistent/loom-reach-key" },
    ),
  );

  it.effect("reads the key per call and maps refusals without logging it", () =>
    run(({ pocketId, apis, keyFile, logs }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(keyFile, "pocket-id-key-revoked");
        expect((yield* ensure(pocketId).pipe(Effect.flip)).reason).toBe("denied");
        yield* fs.writeFileString(keyFile, POCKET_ID_KEY);
        apis.script("api.create", { status: 503, body: { error: "Service unavailable" } });
        expect((yield* ensure(pocketId).pipe(Effect.flip)).reason).toBe("unavailable");
        apis.script("api.create", { status: 400, body: { error: "name is too long" } });
        expect((yield* ensure(pocketId).pipe(Effect.flip)).reason).toBe("conflict");
        apis.script("grant.put", { status: 200, body: { userDelegatedAccess: false } });
        expect((yield* ensure(pocketId).pipe(Effect.flip)).reason).toBe("conflict");
        expect(logs.some((line) => line.includes("Pocket ID refused"))).toBe(true);
        expect(logs.some((line) => line.includes(POCKET_ID_KEY))).toBe(false);
      }),
    ),
  );

  it.effect("deletes an API and treats a missing one as deleted", () =>
    run(({ pocketId, apis }) =>
      Effect.gen(function* () {
        const { apiId } = yield* ensure(pocketId);
        yield* pocketId.deleteApi(apiId);
        expect(apis.apis.has(apiId)).toBe(false);
        yield* pocketId.deleteApi(apiId);
        apis.script("api.delete", { status: 403, body: { error: "Forbidden" } });
        expect((yield* pocketId.deleteApi("api-other").pipe(Effect.flip)).reason).toBe("denied");
      }),
    ),
  );

  it("names an API within Pocket ID's limit and keeps same-label computers apart", () => {
    expect(ReachPocketId.reachApiName("Studio", "environment-studio")).toBe(
      "Loom Studio (environm)",
    );
    expect(ReachPocketId.reachApiName("  ", "abcdefghijk")).toBe("Loom computer (abcdefgh)");
    expect(ReachPocketId.reachApiName(null, "abcdefghijk")).toBe("Loom computer (abcdefgh)");
    const long = ReachPocketId.reachApiName("A".repeat(80), "0123456789");
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("(01234567)")).toBe(true);
  });
});
