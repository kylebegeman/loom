import { expect, it } from "@effect/vitest";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { VaultOwnerLinkHttpRoutes } from "./owner-link-http.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  AuthLibraryPublishScope,
  AuthSessionId,
  AuthStandardClientScopes,
  EnvironmentId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  LibraryError,
  VaultOwnerLinkApproval,
  type VaultOwnerLinkRequest,
} from "@t3tools/contracts/fork";
import { decodeEd25519PublicKey, keyFingerprint } from "@t3tools/shared/fork/directory";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClientResponse } from "effect/http";
import { identityOwnershipSubject, identitySessionPrefix } from "../../auth/identityPolicy.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { DirectoryReporter } from "../directory/DirectoryReporter.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { LibraryService } from "../project-library/LibraryService.ts";
import { VaultAccess } from "./VaultAccess.ts";
import * as OwnerLink from "./VaultOwnerLink.ts";

const SOURCE = EnvironmentId.make("source");
const LIBRARY = EnvironmentId.make("library");
const NOW = 1_000_000;
const PUBLIC_KEY = "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=";
const FINGERPRINT = keyFingerprint(decodeEd25519PublicKey(PUBLIC_KEY)!);
const environment = {
  LOOM_IDENTITY_ISSUER: "https://identity.test",
  LOOM_IDENTITY_AUDIENCE: "library",
  LOOM_IDENTITY_ALLOWED_SUBJECTS: "kyle",
};
const owner = {
  sessionId: AuthSessionId.make("human"),
  subject: `${identitySessionPrefix(environment)}${Buffer.from("kyle").toString("base64url")}`,
  method: "bearer-access-token" as const,
  scopes: AuthStandardClientScopes,
};
const local = { ...owner, sessionId: AuthSessionId.make("local"), subject: "desktop-bootstrap" };
const publisher = {
  sessionId: AuthSessionId.make("publisher"),
  subject: `loom-host:${SOURCE}`,
  method: "bearer-access-token" as const,
  scopes: [AuthLibraryPublishScope],
};
const request: VaultOwnerLinkRequest = {
  operationId: "a".repeat(32),
  expectedRevision: 18,
  ownerId: "b".repeat(32),
  inventoryEnvironmentId: SOURCE,
  sourceEnvironmentId: SOURCE,
  libraryEnvironmentId: LIBRARY,
  authorityId: "authority",
  authorityEpoch: 1,
  keyFingerprint: FINGERPRINT,
};
const clientState = {
  client: { deviceType: "desktop" as const },
  issuedAt: DateTime.makeUnsafe(NOW),
  lastConnectedAt: null,
  connected: true,
  current: true,
};
const encodeApproval = Schema.encodeEffect(Schema.fromJsonString(VaultOwnerLinkApproval));
const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(NOW);
  const state = {
    ownerActive: true,
    publisherActive: true,
    permissions: AuthStandardClientScopes as ReadonlyArray<AuthEnvironmentScope>,
    keyFingerprint: FINGERPRINT,
    authorityEpoch: 1,
    writes: 0,
    verificationCount: 0,
    revokeAtVerification: null as number | null,
  };
  const info = Effect.sync(() => ({
    environmentId: LIBRARY,
    authorityId: "authority",
    authorityEpoch: state.authorityEpoch,
    isAuthority: true,
    assets: "local" as const,
  }));
  const common = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.succeed(HostProcess.Environment, environment),
    Layer.mock(VaultAccess)({
      ownerLinkBinding: () =>
        Effect.succeed({
          expectedRevision: request.expectedRevision,
          ownerId: request.ownerId,
          inventoryEnvironmentId: request.inventoryEnvironmentId,
        }),
      linkOwner: (_input, subject, actor, authorize) =>
        Effect.gen(function* () {
          expect(subject).toBe(identityOwnershipSubject(owner.subject, environment));
          expect(actor).toBe(local.subject);
          yield* authorize;
          state.writes++;
          return {
            environmentId: SOURCE,
            revision: 19,
            grants: [],
            audit: [],
            omittedAuditEvents: 0,
          };
        }),
    }),
    Layer.mock(LibraryManagement)({
      authorizeEnrollment: () =>
        state.ownerActive ? Effect.void : Effect.fail(new LibraryError({ reason: "blocked" })),
    }),
    Layer.mock(LibraryService)({ info }),
    Layer.mock(LibraryPublisher)({ info, enabled: true }),
    Layer.mock(DirectoryService)({
      pinned: () =>
        Effect.sync(() => ({
          publicKey: PUBLIC_KEY,
          keyFingerprint: state.keyFingerprint,
          label: "Source",
        })),
    }),
    Layer.mock(DirectoryReporter)({
      prepare: () =>
        Effect.succeed({
          environmentId: SOURCE,
          request: { publicKey: PUBLIC_KEY, token: "report" },
        }),
    }),
    Layer.mock(SessionStore)({
      cookieName: "test",
      legacyCookieName: "legacy",
      renewalsOf: (id) => Effect.succeed(new Set([id])),
      listActive: () =>
        Effect.sync(() => [
          ...(state.ownerActive
            ? [
                {
                  ...owner,
                  ...clientState,
                  permissions: state.permissions,
                  expiresAt: DateTime.makeUnsafe(NOW + 3_600_000),
                },
              ]
            : []),
          ...(state.publisherActive
            ? [{ ...publisher, ...clientState, expiresAt: DateTime.makeUnsafe(NOW + 3_600_000) }]
            : []),
        ]),
    }),
  );
  const authority = yield* OwnerLink.VaultOwnerLink.pipe(
    Effect.provide(
      OwnerLink.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            common,
            Layer.mock(ServerEnvironmentIdentity)({ getEnvironmentId: Effect.succeed(LIBRARY) }),
            Layer.mock(LibraryConnectionService)({
              current: Effect.succeed({ kind: "authority" }),
            }),
          ),
        ),
      ),
    ),
  );
  const runtime = Layer.succeed(
    ForkRuntime,
    Context.make(OwnerLink.VaultOwnerLink, authority) as unknown as Context.Context<ForkServices>,
  );
  const clock = yield* Clock.Clock;
  const web = HttpRouter.toWebHandler(
    VaultOwnerLinkHttpRoutes.pipe(
      HttpRouter.provideRequest(
        Layer.mergeAll(
          NodeHttpPlatform.layer,
          runtime,
          Layer.succeed(Clock.Clock, clock),
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({
            authenticateHttpRequest: (incoming) =>
              incoming.headers.authorization === "Bearer machine-only"
                ? Effect.succeed(publisher)
                : Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError()),
          }),
        ),
      ),
      Layer.provide(NodeServices.layer),
    ),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  const source = yield* OwnerLink.VaultOwnerLink.pipe(
    Effect.provide(
      OwnerLink.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            common,
            Layer.mock(ServerEnvironmentIdentity)({ getEnvironmentId: Effect.succeed(SOURCE) }),
            Layer.mock(LibraryConnectionService)({
              current: Effect.succeed({
                kind: "remote",
                origin: "https://library.test",
                endpoint: (path) => `https://library.test${path}`,
                credential: {
                  version: 1,
                  sourceEnvironmentId: SOURCE,
                  libraryEnvironmentId: LIBRARY,
                  libraryUrl: "https://library.test",
                  sessionId: "publisher",
                  accessToken: Redacted.make("test"),
                  expiresAt: "2099-01-01T00:00:00.000Z",
                },
                send: (httpRequest) =>
                  Effect.gen(function* () {
                    if (httpRequest.body._tag !== "Uint8Array")
                      return yield* new LibraryError({ reason: "invalid" });
                    state.verificationCount++;
                    if (state.verificationCount === state.revokeAtVerification)
                      state.ownerActive = false;
                    const body = new TextDecoder().decode(httpRequest.body.body);
                    const response = yield* Effect.promise(() =>
                      web.handler(
                        new Request(httpRequest.url, {
                          method: httpRequest.method,
                          headers: { ...httpRequest.headers, authorization: "Bearer machine-only" },
                          body,
                        }),
                      ),
                    );
                    return HttpClientResponse.fromWeb(httpRequest, response);
                  }),
              }),
            }),
          ),
        ),
      ),
    ),
  );
  return { state, authority, source, web };
});

it.effect("links only the existing computer owner to the current verified Library identity", () =>
  Effect.gen(function* () {
    const { state, authority, source } = yield* fixture;
    const prepared = yield* source.prepare(request.operationId, local, Effect.void);
    expect(prepared).toEqual(request);
    const approval = yield* authority.approve(prepared, owner);
    expect(approval.expiresAt).toBe(NOW + 300_000);
    expect((yield* authority.verify(approval, publisher)).ownerSubject).toBe(
      identityOwnershipSubject(owner.subject, environment),
    );
    expect((yield* source.apply(approval, local, Effect.void)).revision).toBe(19);
    expect(state.writes).toBe(1);
    for (const subject of [
      "desktop-bootstrap",
      "thread:agent",
      "mcp-client",
      "loom-host:source",
      "identity:old:kyle",
    ]) {
      expect(
        (yield* authority.approve(prepared, { ...owner, subject }).pipe(Effect.flip)).reason,
      ).toBe("denied");
    }
  }),
);

it.effect.each([
  "expiry",
  "owner-revoked",
  "publisher-revoked",
  "permissions",
  "key",
  "authority",
  "request",
  "computer",
] as const)("refuses an owner approval after %s changes", (change) =>
  Effect.gen(function* () {
    const { state, authority, source } = yield* fixture;
    const approval = yield* authority.approve(request, owner);
    let caller = publisher;
    let input = approval;
    switch (change) {
      case "expiry":
        yield* TestClock.adjust("5 minutes");
        break;
      case "owner-revoked":
        state.ownerActive = false;
        break;
      case "publisher-revoked":
        state.publisherActive = false;
        break;
      case "permissions":
        state.permissions = [];
        break;
      case "key":
        state.keyFingerprint = "f".repeat(64);
        break;
      case "authority":
        state.authorityEpoch++;
        break;
      case "request":
        input = { ...approval, request: { ...request, expectedRevision: 19 } };
        break;
      case "computer":
        caller = { ...publisher, subject: "loom-host:other" };
        break;
    }
    expect((yield* authority.verify(input, caller).pipe(Effect.flip)).reason).toBe("denied");
    if (change !== "computer")
      expect((yield* source.apply(input, local, Effect.void).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
    expect(state.writes).toBe(0);
  }),
);

it.effect("rechecks the human approval before saving and refuses changed source bindings", () =>
  Effect.gen(function* () {
    const { state, authority, source } = yield* fixture;
    const approval = yield* authority.approve(request, owner);
    expect(
      (yield* source
        .apply(
          {
            ...approval,
            request: { ...request, sourceEnvironmentId: EnvironmentId.make("other") },
          },
          local,
          Effect.void,
        )
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(
      (yield* source
        .apply(approval, { ...local, subject: "thread:agent" }, Effect.void)
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    state.revokeAtVerification = 2;
    expect((yield* source.apply(approval, local, Effect.void).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
    expect(state.writes).toBe(0);
  }),
);

it.effect(
  "authenticates owner-link verification over HTTP and returns only its bound identity",
  () =>
    Effect.gen(function* () {
      const { authority, web } = yield* fixture;
      const approval = yield* authority.approve(request, owner);
      const body = yield* encodeApproval(approval);
      const send = (body: string, token = "machine-only", contentType = "application/json") =>
        Effect.promise(() =>
          web.handler(
            new Request("https://library.test/api/loom/vault/owner-link/verify", {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": contentType },
              body,
            }),
          ),
        );
      expect((yield* send(body, "invalid")).status).toBe(401);
      expect((yield* send(body, "machine-only", "text/plain")).status).toBe(415);
      expect((yield* send("{}")).status).toBe(400);
      const tampered = yield* encodeApproval({
        ...approval,
        request: { ...request, ownerId: "c".repeat(32) },
      });
      expect((yield* send(tampered)).status).toBe(403);
      const response = yield* send(body);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const result = yield* Effect.promise(() => response.json());
      expect(result).toEqual({
        request,
        ownerSubject: identityOwnershipSubject(owner.subject, environment),
        expiresAt: approval.expiresAt,
      });
    }),
);
