import { expect, it } from "@effect/vitest";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Generate a disposable RSA key matching GitHub App downloads.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { decodeJwt } from "jose";
import * as Transport from "./GitHubTransport.ts";
it.effect("mints repository-limited App tokens using native GitHub RSA PEM and bounded JWTs", () =>
  Effect.gen(function* () {
    const key = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs1", format: "pem" })
      .toString();
    const paths: string[] = [];
    const client = HttpClient.make((request) => {
      paths.push(request.url);
      if (request.url.endsWith("/app/installations/42")) {
        const jwt = decodeJwt(request.headers.authorization!.replace(/^Bearer /, ""));
        expect(jwt.iss).toBe("7");
        expect(jwt.exp! - jwt.iat!).toBeLessThanOrEqual(600);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ app_id: 7, account: { login: "loom-org" } }),
          ),
        );
      }
      if (request.url.endsWith("/installation/token")) {
        expect(request.method).toBe("DELETE");
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })),
        );
      }
      if (request.url.endsWith("/access_tokens")) {
        expect(request.method).toBe("POST");
        expect(request.body._tag).toBe("Uint8Array");
        if (request.body._tag === "Uint8Array")
          expect(JSON.parse(new TextDecoder().decode(request.body.body))).toEqual({
            repositories: ["repo"],
          });
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              token: "synthetic-installation-token",
              expires_at: "2099-01-01T00:00:00.000Z",
            }),
          ),
        );
      }
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ id: 1 })));
    });
    const service = yield* Transport.GitHubTransport.pipe(
      Effect.provide(Transport.layer),
      Effect.provideService(HttpClient.HttpClient, client),
    );
    const credential = {
      type: "app" as const,
      appId: "7",
      installationId: "42",
      privateKey: Redacted.make(key),
    };
    const session = yield* service.session(credential, ["loom-org/repo"]);
    expect(session.account).toBe("loom-org");
    expect(Redacted.value(session.token)).toBe("synthetic-installation-token");
    yield* service.probe(session, "loom-org/repo");
    expect(paths.every((path) => path.startsWith("https://api.github.com/"))).toBe(true);
    expect(paths).toHaveLength(3);
    yield* service.release(session);
    expect(paths.at(-1)).toBe("https://api.github.com/installation/token");
    yield* service.release({
      account: "dedicated-user",
      token: Redacted.make("dedicated-token"),
      expiresAt: null,
    });
    expect(paths).toHaveLength(4);
    expect((yield* service.session(credential, ["other/repo"]).pipe(Effect.flip)).reason).toBe(
      "repository-denied",
    );
  }).pipe(Effect.scoped),
);
it.effect.each([401, 403, 404, 500])(
  "classifies provider HTTP %s without returning response bodies or credentials",
  (status) =>
    Effect.gen(function* () {
      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ message: "synthetic-sensitive-response" }, { status }),
          ),
        ),
      );
      const service = yield* Transport.GitHubTransport.pipe(
        Effect.provide(Transport.layer),
        Effect.provideService(HttpClient.HttpClient, client),
      );
      const error = yield* service
        .session({ type: "token", token: Redacted.make("synthetic_private_token") }, ["owner/repo"])
        .pipe(Effect.flip);
      expect(error.reason).toBe(
        status === 401
          ? "unauthorized"
          : status === 403 || status === 404
            ? "repository-denied"
            : "failed",
      );
      expect(JSON.stringify(error)).not.toContain("synthetic-sensitive-response");
    }).pipe(Effect.scoped),
);
it.effect("rejects invalid credential structure and malformed identity responses", () =>
  Effect.gen(function* () {
    let calls = 0;
    const client = HttpClient.make((request) => {
      calls++;
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, Response.json({ notIdentity: true })),
      );
    });
    const service = yield* Transport.GitHubTransport.pipe(
      Effect.provide(Transport.layer),
      Effect.provideService(HttpClient.HttpClient, client),
    );
    expect(
      (yield* service
        .session({ type: "token", token: Redacted.make("a\nheader") }, ["owner/repo"])
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-credential");
    expect(calls).toBe(0);
    expect(
      (yield* service
        .session({ type: "token", token: Redacted.make("synthetic_private_token") }, ["owner/repo"])
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-response");
  }).pipe(Effect.scoped),
);
