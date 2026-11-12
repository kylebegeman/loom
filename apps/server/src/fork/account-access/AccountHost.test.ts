import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { AuthSessionId, AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import { AccountVerification } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClientResponse } from "effect/http";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import * as AccountHost from "./AccountHost.ts";

const PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=\n-----END PUBLIC KEY-----\n";
const decodeVerification = Schema.decodeSync(Schema.fromJsonString(AccountVerification));
const keyBytes = new TextEncoder().encode(
  Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
    privateKey: "unused-test-key",
    publicKey: PUBLIC_KEY,
  }),
);

const fixture = Effect.gen(function* () {
  let checks = 0;
  let issued = 0;
  let allowed = true;
  let enrolled = true;
  const cached = new Map<string, SessionStore.VerifiedSession>();
  const verification: Array<typeof AccountVerification.Type> = [];
  const layer = AccountHost.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          get: () => Effect.succeedSome(keyBytes),
        }),
        Layer.mock(SessionStore.SessionStore)({
          cookieName: "test",
          legacyCookieName: undefined,
          issue: (input) =>
            Effect.sync(() => {
              issued += 1;
              const session: SessionStore.VerifiedSession & { expiresAt: DateTime.DateTime } = {
                sessionId: AuthSessionId.make(`host-session-${issued}`),
                token: `host-token-${issued}`,
                subject: input?.subject ?? "",
                method: "bearer-access-token",
                client: { deviceType: "unknown" },
                scopes: input?.scopes ?? [],
                expiresAt: input?.expiresAt ?? DateTime.makeUnsafe(0),
              };
              cached.set(session.token, session);
              return session;
            }),
          verify: (token) => Effect.succeed(cached.get(token)!),
        }),
        Layer.mock(LibraryConnection.LibraryConnectionService)({
          current: Effect.sync(() => ({
            kind: "remote" as const,
            origin: "https://library.example.test",
            endpoint: (path: string) => `https://library.example.test${path}`,
            credential: enrolled
              ? {
                  version: 1 as const,
                  sourceEnvironmentId: EnvironmentId.make("computer"),
                  libraryEnvironmentId: EnvironmentId.make("library"),
                  libraryUrl: "https://library.example.test",
                  sessionId: "publisher",
                  accessToken: Redacted.make("publisher-token"),
                  expiresAt: "2030-01-01T00:00:00Z",
                }
              : null,
            send: (request) =>
              Effect.sync(() => {
                checks += 1;
                if (request.body._tag === "Uint8Array")
                  verification.push(
                    decodeVerification(new TextDecoder().decode(request.body.body)),
                  );
                return HttpClientResponse.fromWeb(
                  request,
                  Response.json(
                    {
                      sessionId: "owner-device",
                      principal: "identity-principal:v1:test-owner",
                      scopes: AuthStandardClientScopes,
                      expiresAt: 24 * 60 * 60_000,
                    },
                    { status: allowed ? 200 : 403 },
                  ),
                );
              }),
          })),
        }),
      ),
    ),
    Layer.provide(NodeCrypto.layer),
  );
  const service = yield* AccountHost.AccountHost.pipe(Effect.provide(layer));
  const admit = (grant: string) => service.admit({ grant, method: "GET", path: "/ws" });
  return {
    service,
    admit,
    verification,
    checks: () => checks,
    issued: () => issued,
    deny: () => {
      allowed = false;
    },
    unenroll: () => {
      enrolled = false;
    },
  };
});

it.effect("checks each request with the enrolled Library and reuses a local scoped session", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    expect(yield* f.admit("a".repeat(64))).toBe("host-token-1");
    expect(yield* f.admit("b".repeat(64))).toBe("host-token-1");
    expect(f.checks()).toBe(2);
    expect(f.issued()).toBe(1);
    expect(
      f.verification.every(
        (request) =>
          request.method === "GET" &&
          request.path === "/ws" &&
          /^[a-f0-9]{64}$/u.test(request.keyFingerprint),
      ),
    ).toBe(true);
    f.deny();
    expect((yield* Effect.result(f.admit("c".repeat(64))))._tag).toBe("Failure");
    expect(f.issued()).toBe(1);
  }),
);

it.effect("refuses invalid grants and legacy unbound connections before calling the Library", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    expect((yield* Effect.result(f.admit("invalid")))._tag).toBe("Failure");
    f.unenroll();
    expect((yield* Effect.result(f.admit("a".repeat(64))))._tag).toBe("Failure");
    expect(f.checks()).toBe(0);
    expect(f.issued()).toBe(0);
  }),
);
