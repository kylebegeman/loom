import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  type DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock"; // fork: identity-renewal
import { TestClock } from "effect/testing"; // fork: identity-renewal
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ConnectionResolver from "./resolver.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile, // fork: identity-renewal
  type ConnectionCatalogEntry,
  SshConnectionProfile,
  type ConnectionCredential,
  type ConnectionProfile,
} from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import {
  BearerConnectionTarget,
  type ConnectionAttemptError, // fork: identity-renewal
  ConnectionBlockedError, // fork: identity-renewal
  ConnectionTransientError,
  PrimaryConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
} from "./model.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import * as RpcHttp from "../rpc/http.ts";
import {
  PullRequestRoutingPermissions,
  pullRequestRoutingConnectionKey,
  makePullRequestRoutingPermissions,
} from "./pullRequestRoutingPermissions.ts";
// fork: identity-renewal
import {
  IdentityRenewal,
  type IdentityRenewalOutcome,
  type IdentityRenewalRequest,
} from "../fork/identity-renewal.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ENDPOINT = {
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
};
const SSH_TARGET: DesktopSshEnvironmentTarget = {
  alias: "development",
  hostname: "development.example.test",
  username: "developer",
  port: 22,
};

function catalogEntry(
  target: ConnectionTarget,
  profile: Option.Option<ConnectionProfile> = Option.none(),
): ConnectionCatalogEntry {
  return { target, profile, enabled: true };
}

const makeDependencies = Effect.fn("TestConnectionResolver.makeDependencies")((options?: {
  readonly profiles?: ReadonlyArray<ConnectionProfile>;
  readonly profileStore?: ConnectionProfileStore.ConnectionProfileStore["Service"];
  readonly credentials?: ReadonlyArray<readonly [string, ConnectionCredential]>;
  readonly authorizeBearer?: RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]["authorizeBearer"];
  readonly authorizeDpop?: RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]["authorizeDpop"];
  readonly primaryBearerToken?: string;
  readonly prepareSsh?: ClientCapabilities.SshEnvironmentGateway["Service"]["prepare"];
  readonly descriptorProtocolVersion?: number | null | undefined;
}) => {
  const profiles = new Map(
    (options?.profiles ?? []).map((profile) => [profile.connectionId, profile]),
  );
  const credentials = new Map(options?.credentials ?? []);

  const profileStore = ConnectionProfileStore.ConnectionProfileStore.of({
    get: (connectionId) => Effect.succeed(Option.fromNullishOr(profiles.get(connectionId))),
    put: (profile) => Effect.sync(() => void profiles.set(profile.connectionId, profile)),
    remove: (connectionId) => Effect.sync(() => void profiles.delete(connectionId)),
  });
  const credentialStore = ConnectionCredentialStore.ConnectionCredentialStore.of({
    get: (connectionId) => Effect.succeed(Option.fromNullishOr(credentials.get(connectionId))),
    put: (connectionId, credential) =>
      Effect.sync(() => void credentials.set(connectionId, credential)),
    remove: (connectionId) => Effect.sync(() => void credentials.delete(connectionId)),
  });
  const remote = RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization.of({
    authorizeBearer:
      options?.authorizeBearer ??
      ((input) =>
        Effect.succeed({
          environmentId: input.expectedEnvironmentId,
          label: "Authorized bearer environment",
          httpBaseUrl: input.httpBaseUrl,
          socketUrl: "wss://authorized.example.test/ws?wsTicket=bearer",
          httpAuthorization: {
            _tag: "Bearer" as const,
            token: input.bearerToken,
          },
        })),
    authorizeDpop:
      options?.authorizeDpop ??
      ((input) =>
        Effect.succeed({
          environmentId: input.expectedEnvironmentId,
          label: "Authorized relay environment",
          httpBaseUrl: ENDPOINT.httpBaseUrl,
          socketUrl: "wss://authorized.example.test/ws?wsTicket=dpop",
          httpAuthorization: {
            _tag: "Dpop" as const,
            accessToken: "dpop-access-token",
            expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
          },
        })),
    authorizeDpopHttp: () => Effect.die("unused"),
  });
  const ssh = ClientCapabilities.SshEnvironmentGateway.of({
    provision: () => Effect.die("unused"),
    prepare:
      options?.prepareSsh ??
      (() =>
        Effect.succeed({
          bootstrap: {
            target: SSH_TARGET,
            httpBaseUrl: "http://127.0.0.1:4010",
            wsBaseUrl: "ws://127.0.0.1:4010",
            pairingToken: null,
          },
          bearerToken: "ssh-bearer",
        })),
    disconnect: () => Effect.void,
  });

  const layerDependencies = Layer.mergeAll(
    RpcHttp.layerRemoteHttpClient((() =>
      Promise.resolve(
        Response.json({
          environmentId: ENVIRONMENT_ID,
          label: "Compatible environment",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.0-test",
          ...(options?.descriptorProtocolVersion === undefined
            ? { orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION }
            : options.descriptorProtocolVersion === null
              ? {}
              : { orchestrationProtocolVersion: options.descriptorProtocolVersion }),
          capabilities: { repositoryIdentity: true },
        }),
      )) satisfies typeof fetch),
    Layer.succeed(
      ConnectionProfileStore.ConnectionProfileStore,
      options?.profileStore ?? profileStore,
    ),
    Layer.succeed(ConnectionCredentialStore.ConnectionCredentialStore, credentialStore),
    Layer.succeed(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({
        bearerToken: Effect.succeed(Option.fromNullishOr(options?.primaryBearerToken)),
      }),
    ),
    Layer.succeed(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: { label: "Test Client", deviceType: "desktop", surface: "web" },
      }),
    ),
    Layer.succeed(RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization, remote),
    Layer.succeed(ClientCapabilities.SshEnvironmentGateway, ssh),
  );

  return Effect.succeed(ConnectionResolver.layer.pipe(Layer.provide(layerDependencies)));
});

describe("ConnectionResolver", () => {
  it.effect("blocks an old host during discovery before opening orchestration RPC", () =>
    Effect.gen(function* () {
      const layerBroker = yield* makeDependencies({ descriptorProtocolVersion: null });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(layerBroker));
      const target = new PrimaryConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        wsBaseUrl: "ws://127.0.0.1:3777",
      });

      const error = yield* Effect.flip(broker.prepare(catalogEntry(target)));

      expect(error).toMatchObject({ reason: "unsupported" });
      // fork: brand
      expect(error.message).toContain("Update Loom on Compatible environment");
    }),
  );

  it.effect("prepares a primary environment without remote capabilities", () =>
    Effect.gen(function* () {
      const layerBroker = yield* makeDependencies();
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(layerBroker));
      const target = new PrimaryConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        wsBaseUrl: "ws://127.0.0.1:3777",
      });

      expect(yield* broker.prepare(catalogEntry(target))).toEqual({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        socketUrl:
          "ws://127.0.0.1:3777/ws?clientSurface=web&clientDeviceType=desktop&connectionMethod=direct&orchestrationProtocol=2",
        httpAuthorization: null,
        target,
      });
    }),
  );

  // fork: identity-renewal
  it.effect(
    "binds Identity credentials to the saved computer and account, and requires interactive renewal after expiry",
    () =>
      Effect.gen(function* () {
        const identity = { issuer: "https://id.example.test", subject: "owner" };
        const target = new BearerConnectionTarget({
          environmentId: ENVIRONMENT_ID,
          label: "Computer",
          connectionId: "identity",
        });
        const profile = new BearerConnectionProfile({
          ...ENDPOINT,
          environmentId: ENVIRONMENT_ID,
          label: "Computer",
          connectionId: "identity",
          identity,
        });
        const expiresAt = (yield* Clock.currentTimeMillis) + 1000;
        let calls = 0;
        for (const binding of [
          { ...identity, environmentId: EnvironmentId.make("other"), expiresAt },
          { ...identity, subject: "another-owner", environmentId: ENVIRONMENT_ID, expiresAt },
          {
            ...identity,
            issuer: "https://other-id.test",
            environmentId: ENVIRONMENT_ID,
            expiresAt,
          },
          { ...identity, environmentId: ENVIRONMENT_ID, expiresAt },
        ]) {
          const layer = yield* makeDependencies({
            credentials: [
              [
                "identity",
                new BearerConnectionCredential({ token: "host-identity", identity: binding }),
              ],
            ],
            authorizeBearer: (input) => {
              calls++;
              return Effect.succeed({
                environmentId: input.expectedEnvironmentId,
                label: "Computer",
                httpBaseUrl: input.httpBaseUrl,
                socketUrl: "wss://environment.example.test/ws",
                httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
              });
            },
          });
          const resolver = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(layer));
          if (
            binding.environmentId !== ENVIRONMENT_ID ||
            binding.subject !== identity.subject ||
            binding.issuer !== identity.issuer
          ) {
            expect(
              yield* resolver.prepare(catalogEntry(target, Option.some(profile))).pipe(Effect.flip),
            ).toMatchObject({ reason: "configuration" });
            expect(calls).toBe(0);
          } else {
            yield* resolver.prepare(catalogEntry(target, Option.some(profile)));
            expect(calls).toBe(1);
            yield* TestClock.adjust("1 second");
            const error = yield* resolver
              .prepare(catalogEntry(target, Option.some(profile)))
              .pipe(Effect.flip);
            expect(error).toMatchObject({ reason: "authentication" });
            expect(error.message).toContain("Sign in again");
            expect(calls).toBe(1);
          }
        }
      }),
  );

  // fork: identity-renewal
  it.effect("renews an expired Identity credential before connecting with it", () =>
    Effect.gen(function* () {
      const identity = { issuer: "https://id.example.test", subject: "owner" };
      const target = new BearerConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Computer",
        connectionId: "identity",
      });
      const entry = catalogEntry(
        target,
        Option.some(
          new BearerConnectionProfile({
            ...ENDPOINT,
            environmentId: ENVIRONMENT_ID,
            label: "Computer",
            connectionId: "identity",
            identity,
          }),
        ),
      );
      const now = yield* Clock.currentTimeMillis;
      const resolverWith = Effect.fn("test.resolverWith")(function* (
        expiresAt: number,
        outcome: Effect.Effect<IdentityRenewalOutcome, ConnectionAttemptError>,
        rejects: ReadonlyArray<string> = [],
      ) {
        const requests: Array<IdentityRenewalRequest> = [];
        const layer = yield* makeDependencies({
          authorizeBearer: (input) =>
            rejects.includes(input.bearerToken)
              ? Effect.fail(
                  new ConnectionBlockedError({ reason: "authentication", detail: "Rejected." }),
                )
              : Effect.succeed({
                  environmentId: input.expectedEnvironmentId,
                  label: "Computer",
                  httpBaseUrl: input.httpBaseUrl,
                  socketUrl: "wss://authorized.example.test/ws?wsTicket=bearer",
                  httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
                }),
          credentials: [
            [
              "identity",
              new BearerConnectionCredential({
                token: "saved",
                identity: { ...identity, environmentId: ENVIRONMENT_ID, expiresAt },
              }),
            ],
          ],
        });
        const resolver = yield* ConnectionResolver.ConnectionResolver.pipe(
          Effect.provide(layer),
          Effect.provideService(IdentityRenewal, {
            renew: (request) =>
              Effect.suspend(() => {
                requests.push(request);
                return outcome;
              }),
            forget: () => Effect.void,
          }),
        );
        return { resolver, requests };
      });

      const renewed = yield* resolverWith(
        now - 1,
        Effect.succeed({ _tag: "Renewed", token: "renewed", expiresAt: now + 3_600_000 }),
      );
      const first = yield* renewed.resolver.prepare(entry);
      const second = yield* renewed.resolver.prepare(entry);
      expect(first.httpAuthorization).toMatchObject({ token: "renewed" });
      expect(second.httpAuthorization).toMatchObject({ token: "renewed" });
      // The computer refuses to renew a session it revoked, so it sees the one being replaced.
      expect(renewed.requests).toEqual([
        {
          httpBaseUrl: ENDPOINT.httpBaseUrl,
          environmentId: ENVIRONMENT_ID,
          identity,
          currentToken: "saved",
        },
      ]);

      const signInRequired = yield* resolverWith(
        now - 1,
        Effect.succeed({ _tag: "SignInRequired", reason: "Session limit reached." }),
      );
      const blocked = yield* signInRequired.resolver.prepare(entry).pipe(Effect.flip);
      expect(blocked).toMatchObject({ reason: "authentication" });
      expect(blocked.message).toContain("Sign in again");

      const offline = new ConnectionTransientError({ reason: "network", detail: "offline" });
      const expired = yield* resolverWith(now - 1, Effect.fail(offline));
      expect(yield* expired.resolver.prepare(entry).pipe(Effect.flip)).toBe(offline);

      // A live credential is the renewal worker's, which swaps it under the registry's lock.
      const stillLive = yield* resolverWith(now + 30_000, Effect.fail(offline));
      expect((yield* stillLive.resolver.prepare(entry)).httpAuthorization).toMatchObject({
        token: "saved",
      });
      expect(stillLive.requests).toEqual([]);

      // A computer that refuses a live credential, as after a policy change, gets one renewal.
      const refused = yield* resolverWith(
        now + 3_600_000,
        Effect.succeed({ _tag: "Renewed", token: "renewed", expiresAt: now + 3_600_000 }),
        ["saved"],
      );
      expect((yield* refused.resolver.prepare(entry)).httpAuthorization).toMatchObject({
        token: "renewed",
      });
      expect(refused.requests.map((request) => request.currentToken)).toEqual(["saved"]);

      // A revoked session is refused renewal, so the computer's refusal stands.
      const revoked = yield* resolverWith(
        now + 3_600_000,
        Effect.succeed({ _tag: "SignInRequired", reason: "Sign in again." }),
        ["saved"],
      );
      expect(yield* revoked.resolver.prepare(entry).pipe(Effect.flip)).toMatchObject({
        reason: "authentication",
        detail: "Rejected.",
      });
    }),
  );

  it.effect("offers the saved SSH token on each connect and saves the one it gets back", () =>
    Effect.gen(function* () {
      const offeredTokens = yield* Ref.make<ReadonlyArray<string | undefined>>([]);
      const target = new SshConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "SSH",
        connectionId: "ssh-1",
      });
      const profile = new SshConnectionProfile({
        connectionId: "ssh-1",
        environmentId: ENVIRONMENT_ID,
        label: "SSH",
        target: SSH_TARGET,
      });
      const layerBroker = yield* makeDependencies({
        credentials: [["ssh-1", new BearerConnectionCredential({ token: "revoked-token" })]],
        // The host accepts only the token it paired last; anything else pairs again.
        prepareSsh: (input) =>
          Ref.update(offeredTokens, (tokens) => [...tokens, input.bearerToken]).pipe(
            Effect.as({
              bootstrap: {
                target: input.target,
                httpBaseUrl: "http://127.0.0.1:4010",
                wsBaseUrl: "ws://127.0.0.1:4010",
                pairingToken: null,
              },
              bearerToken: "paired-token",
            }),
          ),
      });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(layerBroker));
      const entry = catalogEntry(target, Option.some(profile));

      const first = yield* broker.prepare(entry);
      const second = yield* broker.prepare(entry);

      expect(yield* Ref.get(offeredTokens)).toEqual(["revoked-token", "paired-token"]);
      expect(first.httpAuthorization).toMatchObject({ token: "paired-token" });
      expect(second.httpAuthorization).toMatchObject({ token: "paired-token" });
    }),
  );

  it.effect.each(["unchanged", "changed", "revocation-failed"] as const)(
    "handles %s SSH routing consent before saving or authorizing",
    (scenario) =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const target = new SshConnectionTarget({
          environmentId: ENVIRONMENT_ID,
          label: "SSH",
          connectionId: "ssh-1",
        });
        const profile = new SshConnectionProfile({
          connectionId: target.connectionId,
          environmentId: ENVIRONMENT_ID,
          label: "SSH",
          target: SSH_TARGET,
        });
        const entry = catalogEntry(target, Option.some(profile));
        const preparedTarget =
          scenario === "unchanged"
            ? SSH_TARGET
            : { ...SSH_TARGET, hostname: "replacement.example.test" };
        const failure = new ConnectionTransientError({
          reason: "remote-unavailable",
          detail: "Could not persist routing consent.",
        });
        const permissions = yield* makePullRequestRoutingPermissions({
          read: Effect.succeed([
            {
              environmentId: ENVIRONMENT_ID,
              connectionKey: pullRequestRoutingConnectionKey(entry)!,
              permission: "read-write",
            },
          ]),
          write: () =>
            Effect.sync(() => {
              calls.push("revoke");
            }).pipe(
              Effect.andThen(scenario === "revocation-failed" ? Effect.fail(failure) : Effect.void),
            ),
        });
        let savedProfile: ConnectionProfile = profile;
        const layerBroker = yield* makeDependencies({
          profileStore: {
            get: () => Effect.sync(() => Option.some(savedProfile)),
            put: (value) =>
              Effect.sync(() => {
                calls.push("profile");
                savedProfile = value;
              }),
            remove: () => Effect.die("unused"),
          },
          prepareSsh: () =>
            Effect.succeed({
              bootstrap: {
                target: preparedTarget,
                httpBaseUrl: "http://127.0.0.1:4010",
                wsBaseUrl: "ws://127.0.0.1:4010",
                pairingToken: null,
              },
              bearerToken: "ssh-bearer",
            }),
          authorizeBearer: (input) =>
            Effect.sync(() => {
              calls.push("authorize");
              return {
                environmentId: input.expectedEnvironmentId,
                label: "SSH",
                httpBaseUrl: input.httpBaseUrl,
                socketUrl: "ws://127.0.0.1:4010/ws?wsTicket=ssh",
                httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
              };
            }),
        });
        const broker = yield* ConnectionResolver.ConnectionResolver.pipe(
          Effect.provide(layerBroker),
        );
        const prepare = broker
          .prepare(entry)
          .pipe(Effect.provideService(PullRequestRoutingPermissions, permissions));
        if (scenario === "revocation-failed") {
          expect(yield* Effect.flip(prepare)).toBe(failure);
          expect(savedProfile).toBe(profile);
          expect(calls).toEqual(["revoke"]);
        } else {
          expect((yield* prepare).socketUrl).toContain("wsTicket=ssh");
          expect(savedProfile).toMatchObject({ target: preparedTarget });
          expect(calls).toEqual(
            scenario === "unchanged"
              ? ["profile", "authorize"]
              : ["revoke", "profile", "authorize"],
          );
        }
        expect(yield* permissions.get(entry)).toBe(scenario === "changed" ? "off" : "read-write");
      }),
  );
});
