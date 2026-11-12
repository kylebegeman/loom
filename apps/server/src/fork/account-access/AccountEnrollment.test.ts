import type * as Path from "effect/Path";
import { ReachService } from "../reach/ReachService.ts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId, AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_GATEWAY_FEATURE,
  AccountComputerCredential,
  LibraryError,
  type AccountComputerEnrollment,
} from "@t3tools/contracts/fork";
import { decodeEd25519PublicKey, keyFingerprint } from "@t3tools/shared/fork/directory";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { LibraryPublishingCredential } from "../../auth/LibraryPublishingCredential.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { DirectoryReporter } from "../directory/DirectoryReporter.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import * as Enrollment from "./AccountEnrollment.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const SOURCE = EnvironmentId.make("source");
const LIBRARY = EnvironmentId.make("library");
const PUBLIC_KEY = "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=";
const FINGERPRINT = keyFingerprint(decodeEd25519PublicKey(PUBLIC_KEY)!);
const credential = {
  version: 1 as const,
  sourceEnvironmentId: SOURCE,
  libraryEnvironmentId: LIBRARY,
  libraryUrl: "https://library.example.test",
  sessionId: AuthSessionId.make("publisher"),
  accessToken: Redacted.make("machine-publisher"),
  issuedAt: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
  expiresAt: DateTime.formatIso(DateTime.makeUnsafe(NOW + 86400000)),
};
const bundle: AccountComputerEnrollment = {
  requestId: "request:fingerprint",
  credential,
  management: {
    token: "management-delegation",
    sourceEnvironmentId: SOURCE,
    libraryEnvironmentId: LIBRARY,
    authorityId: "authority",
    authorityEpoch: 1,
    keyFingerprint: FINGERPRINT,
    expiresAt: NOW + 86400000,
  },
};
const owner = {
  sessionId: AuthSessionId.make("owner"),
  subject: "owner",
  method: "bearer-access-token" as const,
  scopes: AuthStandardClientScopes,
};
const info = {
  environmentId: LIBRARY,
  authorityId: "authority",
  authorityEpoch: 1,
  isAuthority: true,
  assets: "local" as const,
  features: [ACCOUNT_GATEWAY_FEATURE],
};
const decodeCredential = Schema.decodeEffect(Schema.fromJsonString(AccountComputerCredential));
const encodeCredential = Schema.encodeEffect(Schema.fromJsonString(AccountComputerCredential));
const fixture = Effect.fnUntraced(function* (authority = false) {
  yield* TestClock.setTime(NOW);
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const file = `${config.baseDir}/custom/publisher.json`;
  const events: string[] = [];
  let refuseOwner = false;
  let activationAvailable = false;
  let libraryMatches = true;
  const read = fs.readFileString(file).pipe(Effect.flatMap(decodeCredential));
  const service = yield* Enrollment.AccountEnrollment.pipe(
    Effect.provide(
      Enrollment.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ReachService)({
              guardState: () => ({ hostname: null, serving: false }),
              ownPorts: () => [],
              setEnabled: () =>
                Effect.sync(() => {
                  events.push("reach");
                  return {
                    state: "provisioning",
                    enabled: true,
                    blocked: null,
                    url: null,
                    message: null,
                    warnings: [],
                    prepared: null,
                  };
                }),
            }),
            Layer.mock(DirectoryReporter)({
              prepare: () =>
                Effect.succeed({
                  environmentId: SOURCE,
                  request: { publicKey: PUBLIC_KEY, token: "signed-report" },
                }),
              requestReport: Effect.sync(() => {
                events.push("report");
              }),
            }),
            Layer.mock(DirectoryService)({
              report: () =>
                Effect.suspend(() => {
                  events.push("pin");
                  return Effect.succeed({
                    environmentId: SOURCE,
                    keyFingerprint: FINGERPRINT,
                    label: "Source",
                    serverVersion: "test",
                    platform: { os: "darwin", arch: "arm64" },
                    supportsExecution: true,
                    loomFeatures: [],
                    routes: [],
                    providers: [],
                    sequence: NOW,
                    reportedAt: credential.issuedAt,
                    firstSeenAt: credential.issuedAt,
                    receivedAt: credential.issuedAt,
                  });
                }),
              pinned: () =>
                Effect.succeed({
                  publicKey: PUBLIC_KEY,
                  keyFingerprint: FINGERPRINT,
                  label: "Source",
                }),
            }),
            Layer.mock(LibraryPublishingCredential)({
              enroll: () =>
                Effect.sync(() => {
                  events.push("issue");
                  return credential;
                }),
            }),
            Layer.mock(LibraryManagement)({
              authorizeEnrollment: () =>
                Effect.suspend(() => {
                  events.push("owner");
                  return refuseOwner
                    ? Effect.fail(new LibraryError({ reason: "blocked" }))
                    : Effect.void;
                }),
              issue: () => Effect.succeed(bundle.management),
              install: () =>
                read.pipe(
                  Effect.tap((saved) =>
                    Effect.sync(() => {
                      expect(saved.sessionId).toBe(credential.sessionId);
                      events.push("delegation");
                    }),
                  ),
                  Effect.asVoid,
                  Effect.mapError(() => new LibraryError({ reason: "io" })),
                ),
            }),
            Layer.mock(LibraryConnectionService)({
              current: Effect.succeed(authority ? { kind: "authority" } : { kind: "none" }),
              send: (request) =>
                Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    new Response(null, { status: activationAvailable ? 204 : 503 }),
                  ),
                ),
            }),
            Layer.mock(LibraryPublisher)({
              enabled: false,
              copyRegistrations: Stream.empty,
              info: read.pipe(
                Effect.as(info),
                Effect.mapError(() => new LibraryError({ reason: "io" })),
              ),
            }),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.sync(() => {
                  expect(request.headers.authorization).toBe("Bearer machine-publisher");
                  events.push("verify-library");
                  return HttpClientResponse.fromWeb(
                    request,
                    Response.json({
                      ...info,
                      environmentId: libraryMatches ? LIBRARY : "wrong-library",
                    }),
                  );
                }),
              ),
            ),
            Layer.succeed(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(authority ? LIBRARY : SOURCE),
            }),
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  LOOM_LIBRARY_CREDENTIAL_FILE: file,
                  LOOM_IDENTITY_REDIRECT_URI: "https://library.example.test/oauth/callback",
                },
              }),
            ),
            Layer.succeed(HostProcess.HomeDirectory, config.baseDir),
          ),
        ),
      ),
    ),
  );
  return {
    service,
    fs,
    file,
    read,
    events,
    denyOwner: () => {
      refuseOwner = true;
    },
    setActivation: () => {
      activationAvailable = true;
    },
    mismatch: () => {
      libraryMatches = false;
    },
  };
});
const run = <A, E>(
  program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig>,
) =>
  program.pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "account-enrollment-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  );

it.effect(
  "saves a verified enrollment privately at the configured path and resumes after a lost activation reply",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture();
        expect((yield* Effect.result(f.service.install(bundle)))._tag).toBe("Failure");
        expect((yield* f.read).sessionId).toBe(credential.sessionId);
        expect((yield* f.fs.stat(f.file)).mode & 0o777).toBe(0o600);
        expect(f.events).toEqual(["verify-library", "delegation", "report"]);
        f.setActivation();
        yield* f.service.install(bundle);
        expect(Redacted.value((yield* f.read).accessToken)).toBe("machine-publisher");
        const newer = {
          ...credential,
          sessionId: AuthSessionId.make("newer"),
          issuedAt: DateTime.formatIso(DateTime.makeUnsafe(NOW + 1000)),
        };
        yield* f.fs.writeFileString(f.file, yield* encodeCredential(newer));
        expect((yield* Effect.result(f.service.install(bundle)))._tag).toBe("Failure");
        expect((yield* f.read).sessionId).toBe("newer");
      }),
    ),
);
it.effect(
  "refuses wrong computer, wrong key, wrong Library and cross-Library replacement before saving",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture();
        for (const input of [
          {
            ...bundle,
            credential: { ...credential, sourceEnvironmentId: EnvironmentId.make("other") },
          },
          { ...bundle, management: { ...bundle.management, keyFingerprint: "0".repeat(64) } },
        ])
          expect((yield* Effect.result(f.service.install(input)))._tag).toBe("Failure");
        expect(yield* f.fs.exists(f.file)).toBe(false);
        f.mismatch();
        expect((yield* Effect.result(f.service.install(bundle)))._tag).toBe("Failure");
        expect(yield* f.fs.exists(f.file)).toBe(false);
        yield* f.fs.makeDirectory(`${(yield* ServerConfig.ServerConfig).baseDir}/custom`);
        yield* f.fs.writeFileString(
          f.file,
          yield* encodeCredential({
            ...credential,
            libraryEnvironmentId: EnvironmentId.make("other-library"),
          }),
          { mode: 0o600 },
        );
        expect((yield* Effect.result(f.service.install(bundle)))._tag).toBe("Failure");
        expect((yield* f.read).libraryEnvironmentId).toBe("other-library");
      }),
    ),
);
it.effect(
  "requires current owner authorization and the declared Library before pinning or issuing",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture(true);
        const proof = {
          requestId: "request",
          environmentId: SOURCE,
          libraryEnvironmentId: LIBRARY,
          libraryUrl: credential.libraryUrl,
          request: { publicKey: PUBLIC_KEY, token: "signed-report" },
        };
        const approved = yield* f.service.approve(proof, owner);
        expect(approved.requestId).toBe(`request:${FINGERPRINT}`);
        expect(f.events).toEqual(["owner", "pin", "issue"]);
        f.events.length = 0;
        expect(
          (yield* Effect.result(
            f.service.approve({ ...proof, libraryUrl: "https://wrong.example.test" }, owner),
          ))._tag,
        ).toBe("Failure");
        expect(f.events).toEqual(["owner"]);
        f.events.length = 0;
        f.denyOwner();
        expect((yield* Effect.result(f.service.approve(proof, owner)))._tag).toBe("Failure");
        expect(f.events).toEqual(["owner"]);
      }),
    ),
);
