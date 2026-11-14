// @effect-diagnostics-next-line nodeBuiltinImport:off -- GitHub supplies PKCS#1 RSA keys; the adapter normalizes them for JWT signing without persisting copies.
import * as NodeCrypto from "node:crypto";
import { VaultGitHubCredential, VaultGitHubError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Schedule from "effect/Schedule";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as ByteSize from "effect/ByteSize";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { importPKCS8, SignJWT } from "jose";
export type GitHubSession = {
  readonly account: string;
  readonly token: Redacted.Redacted<string>;
  readonly expiresAt: string | null;
  readonly installationToken?: boolean;
};
export class GitHubTransport extends Context.Service<
  GitHubTransport,
  {
    readonly session: (
      credential: VaultGitHubCredential,
      repositories: ReadonlyArray<string>,
      revokeAfterMs?: number,
    ) => Effect.Effect<GitHubSession, VaultGitHubError>;
    readonly release: (session: GitHubSession) => Effect.Effect<void, VaultGitHubError>;
    readonly probe: (
      session: GitHubSession,
      repository: string,
    ) => Effect.Effect<void, VaultGitHubError>;
  }
>()("t3/fork/vault/GitHubTransport") {}
const fail = (reason: VaultGitHubError["reason"]) => new VaultGitHubError({ reason });
const Identity = Schema.Struct({
  login: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
});
const Installation = Schema.Struct({ account: Identity, app_id: Schema.Number });
const Token = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(1))),
  expires_at: Schema.String,
});
const REVOCATIONS_STORE = "vault-github-token-revocations";
const MAX_REVOCATIONS = 256;
const Revocation = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.String),
  expiresAt: Schema.Number,
  revokeAt: Schema.Number,
});
const Revocations = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(1), entries: Schema.Array(Revocation) }),
);
const decodeRevocations = Schema.decodeEffect(Revocations);
const encodeRevocations = Schema.encodeEffect(Revocations);
const isCredential = Schema.is(Schema.toType(VaultGitHubCredential)),
  decodeIdentity = Schema.decodeUnknownOption(Identity),
  decodeInstallation = Schema.decodeUnknownOption(Installation),
  decodeToken = Schema.decodeUnknownOption(Token);
export const layer = Layer.effect(
  GitHubTransport,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const secrets = yield* ServerSecretStore;
    const lock = yield* Semaphore.make(1);
    let entries: Array<typeof Revocation.Type> | undefined;
    const load = Effect.fn("GitHubTransport.loadRevocations")(function* () {
      if (entries !== undefined) return entries;
      const stored = yield* secrets
        .get(REVOCATIONS_STORE)
        .pipe(Effect.mapError(() => fail("unavailable")));
      entries = Option.isNone(stored)
        ? []
        : [
            ...(yield* decodeRevocations(new TextDecoder().decode(stored.value)).pipe(
              Effect.mapError(() => fail("invalid-response")),
            )).entries,
          ];
      return entries;
    });
    const save = Effect.fn("GitHubTransport.saveRevocations")(function* (
      next: Array<typeof Revocation.Type>,
    ) {
      const encoded = yield* encodeRevocations({ version: 1, entries: next }).pipe(
        Effect.mapError(() => fail("invalid-response")),
      );
      yield* secrets
        .set(REVOCATIONS_STORE, new TextEncoder().encode(encoded))
        .pipe(Effect.mapError(() => fail("unavailable")));
      entries = next;
    });
    const revoke = Effect.fn("GitHubTransport.revoke")(function* (entry: typeof Revocation.Type) {
      const now = yield* Clock.currentTimeMillis;
      if (entry.expiresAt > now) {
        const response = yield* http
          .execute(
            HttpClientRequest.delete("https://api.github.com/installation/token").pipe(
              HttpClientRequest.bearerToken(entry.token),
              HttpClientRequest.setHeader("User-Agent", "Loom-Vault"),
            ),
          )
          .pipe(
            Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
            Effect.timeout("15 seconds"),
            Effect.mapError(() => fail("unavailable")),
          );
        if (response.status !== 204 && response.status !== 401) return yield* fail("failed");
      }
      yield* save((yield* load()).filter((candidate) => candidate !== entry));
    });
    const retry = Effect.fn("GitHubTransport.retryRevocations")(function* () {
      const now = yield* Clock.currentTimeMillis;
      for (const entry of yield* load()) {
        if (entry.revokeAt > now && entry.expiresAt > now) continue;
        yield* revoke(entry).pipe(
          Effect.catch(() =>
            Effect.logWarning(
              "GitHub token revocation is pending; retrying until revoked or expired.",
            ),
          ),
        );
      }
    });
    yield* lock.withPermit(retry()).pipe(
      Effect.catch(() =>
        Effect.logWarning("GitHub pending revocations could not be read; retrying."),
      ),
      Effect.repeat(Schedule.spaced("30 seconds")),
      Effect.forkScoped({ startImmediately: true }),
    );
    const request = Effect.fn("GitHubTransport.request")(function* (
      path: string,
      token: Redacted.Redacted<string>,
      body?: { repositories: ReadonlyArray<string> },
    ) {
      let req = (body ? HttpClientRequest.post : HttpClientRequest.get)(
        `https://api.github.com${path}`,
      ).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeaders({
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Loom-Vault",
        }),
      );
      if (body)
        req = yield* HttpClientRequest.bodyJson(req, body).pipe(
          Effect.mapError(() => fail("invalid-credential")),
        );
      const response = yield* http.execute(req).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("15 seconds"),
        Effect.mapError(() => fail("unavailable")),
      );
      if (response.status === 401) return yield* fail("unauthorized");
      if (response.status === 403 || response.status === 404)
        return yield* fail("repository-denied");
      if (response.status < 200 || response.status >= 300) return yield* fail("failed");
      const responseBody = yield* response.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
        Effect.timeout("15 seconds"),
        Effect.mapError(() => fail("invalid-response")),
      );
      return { body: responseBody, headers: response.headers };
    });
    return GitHubTransport.of({
      session: Effect.fn("GitHubTransport.session")(
        function* (credential, repositories, revokeAfterMs) {
          if (!isCredential(credential)) return yield* fail("invalid-credential");
          if (credential.type === "token") {
            if (!/^[A-Za-z0-9_]{10,255}$/.test(Redacted.value(credential.token)))
              return yield* fail("invalid-credential");
            const response = yield* request("/user", credential.token);
            const parsed = decodeIdentity(response.body);
            if (Option.isNone(parsed)) return yield* fail("invalid-response");
            const header = response.headers["github-authentication-token-expiration"];
            const expiry =
              header && /^\d{4}-\d{2}-\d{2}[T ]/.test(header) ? Date.parse(header) : NaN;
            return {
              account: parsed.value.login,
              token: credential.token,
              expiresAt: Number.isFinite(expiry)
                ? DateTime.formatIso(DateTime.makeUnsafe(expiry))
                : null,
            };
          }
          yield* lock.withPermit(
            Effect.gen(function* () {
              if ((yield* load()).length >= MAX_REVOCATIONS) return yield* fail("unavailable");
            }),
          );
          const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
          const jwt = yield* Effect.tryPromise({
            try: async () => {
              const key = await importPKCS8(
                NodeCrypto.createPrivateKey(Redacted.value(credential.privateKey))
                  .export({ type: "pkcs8", format: "pem" })
                  .toString(),
                "RS256",
              );
              return Redacted.make(
                await new SignJWT({})
                  .setProtectedHeader({ alg: "RS256" })
                  .setIssuer(credential.appId)
                  .setIssuedAt(now - 60)
                  .setExpirationTime(now + 540)
                  .sign(key),
              );
            },
            catch: () => fail("invalid-credential"),
          });
          const installation = decodeInstallation(
            (yield* request(`/app/installations/${credential.installationId}`, jwt)).body,
          );
          if (Option.isNone(installation) || String(installation.value.app_id) !== credential.appId)
            return yield* fail("invalid-response");
          if (
            repositories.some(
              (repo) =>
                repo.split("/")[0]!.toLowerCase() !==
                installation.value.account.login.toLowerCase(),
            )
          )
            return yield* fail("repository-denied");
          const token = decodeToken(
            (yield* request(`/app/installations/${credential.installationId}/access_tokens`, jwt, {
              repositories: repositories.map((repo) => repo.split("/")[1]!),
            })).body,
          );
          if (
            Option.isNone(token) ||
            !Number.isFinite(Date.parse(token.value.expires_at)) ||
            Date.parse(token.value.expires_at) <= now * 1000
          )
            return yield* fail("invalid-response");
          const expiresAt = Date.parse(token.value.expires_at);
          yield* lock.withPermit(
            Effect.gen(function* () {
              const pending = yield* load();
              if (pending.length >= MAX_REVOCATIONS) return yield* fail("unavailable");
              yield* save([
                ...pending,
                {
                  token: token.value.token,
                  expiresAt,
                  revokeAt:
                    revokeAfterMs === undefined
                      ? expiresAt
                      : Math.min(expiresAt, (yield* Clock.currentTimeMillis) + revokeAfterMs),
                },
              ]);
            }),
          );
          return {
            account: installation.value.account.login,
            token: token.value.token,
            expiresAt: token.value.expires_at,
            installationToken: true,
          };
        },
      ),
      release: Effect.fn("GitHubTransport.release")(function* (session) {
        if (!session.installationToken) return;
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const pending = yield* load();
            const entry = pending.find(
              (candidate) => Redacted.value(candidate.token) === Redacted.value(session.token),
            );
            if (!entry) return;
            const due = { ...entry, revokeAt: yield* Clock.currentTimeMillis };
            const next = pending.map((candidate) => (candidate === entry ? due : candidate));
            entries = next;
            yield* save(next);
            yield* revoke(due);
          }),
        );
      }),
      probe: Effect.fn("GitHubTransport.probe")(function* (session, repository) {
        yield* request(`/repos/${repository}`, session.token);
      }),
    });
  }),
);
