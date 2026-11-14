import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  DirectoryError,
  LibraryError,
  SWITCHBOARD_HUB_FEATURE,
  SWITCHBOARD_TICKET_ROUTE,
  type DirectoryEnvironment,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import * as Account from "./SwitchboardAccount.ts";
import { SwitchboardClients } from "./SwitchboardClients.ts";
import { resolveSwitchboardConfiguration, setSwitchboardAccountRoute } from "./switchboard.ts";

const AIR = EnvironmentId.make("air");
const HUB = EnvironmentId.make("dorothy");
const GATEWAY = "https://dorothy-loom.loomhost.dev/api/loom/switchboard";
const hubEntry = {
  environmentId: HUB,
  label: "Dorothy",
  loomFeatures: [SWITCHBOARD_HUB_FEATURE],
  routes: [
    { kind: "tailnet", url: "http://dorothy.tail.test:3773" },
    { kind: "public", url: "https://dorothy-loom.loomhost.dev" },
  ],
  firstSeenAt: "2026-01-01T00:00:00.000Z",
} as unknown as DirectoryEnvironment;

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped();
  const state = {
    environment: {} as NodeJS.ProcessEnv,
    library: "up" as "up" | "down" | "old",
    account: true,
    hubs: [hubEntry] as ReadonlyArray<DirectoryEnvironment>,
    hub: { status: 200, refusal: undefined as string | undefined },
    issued: 0,
    requests: [] as Array<{ method: string; url: string; authorization?: string }>,
  };
  const credential = (n: number) => n.toString(16).padStart(64, "0");
  const remote = {
    kind: "remote" as const,
    origin: "https://library.example.test",
    endpoint: (path: string) => `https://library.example.test${path}`,
    send: (request: Parameters<LibraryConnectionService["Service"]["send"]>[0]) => {
      state.requests.push({ method: request.method, url: request.url });
      if (state.library === "down") return Effect.fail(new LibraryError({ reason: "io" }));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          state.library === "old" || !request.url.endsWith(SWITCHBOARD_TICKET_ROUTE)
            ? new Response(null, { status: 404 })
            : Response.json({ ticket: "a".repeat(64), expiresAt: 0 }),
        ),
      );
    },
  };
  const layer = Account.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.effect(
          HostProcess.Environment,
          Effect.sync(() => state.environment),
        ),
        Layer.succeed(HostProcess.Platform, "darwin"),
        ServerSecretStore.layer.pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir))),
        Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(AIR) }),
        Layer.mock(SwitchboardClients)({ list: Effect.succeed([]) }),
        Layer.mock(LibraryConnectionService)({
          current: Effect.sync(() => ({
            ...remote,
            credential: {
              version: 1 as const,
              sourceEnvironmentId: AIR,
              libraryEnvironmentId: EnvironmentId.make("library"),
              libraryUrl: remote.origin,
              sessionId: "machine",
              accessToken: Redacted.make("publisher"),
              expiresAt: "2027-01-01T00:00:00.000Z",
              ...(state.account
                ? { account: { authorityId: "authority", authorityEpoch: 1 } }
                : {}),
            },
          })),
        }),
        Layer.mock(DirectoryService)({
          computers: Effect.suspend(() =>
            state.library === "down"
              ? Effect.fail(new DirectoryError({ reason: "io" }))
              : Effect.succeed({
                  environments: state.hubs,
                  machines: [],
                  generatedAt: "2026-11-14T00:00:00.000Z",
                }),
          ),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            const authorization = request.headers.authorization;
            state.requests.push({
              method: request.method,
              url: request.url,
              ...(authorization ? { authorization } : {}),
            });
            if (request.url === `${GATEWAY}/enroll`)
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json({ credential: credential(++state.issued) }),
                ),
              );
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(null, {
                  status: state.hub.status,
                  headers: state.hub.refusal ? { "x-loom-switchboard": state.hub.refusal } : {},
                }),
              ),
            );
          }),
        ),
      ),
    ),
  );
  const stored = fs.readFileString(
    `${baseDir}/userdata/secrets/switchboard-account-credential.bin`,
  );
  return { state, layer, credential, stored, secretsDir: `${baseDir}/userdata/secrets` };
});

const routed = () => resolveSwitchboardConfiguration({}, "darwin");
const withSettings = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(ServerSettings.layerTest({ switchboardEnabled: false })),
    Effect.ensuring(Effect.sync(() => setSwitchboardAccountRoute(undefined))),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("Switchboard account", (it) => {
  it.effect("finds the account hub, enrolls once and routes launches with its own key", () =>
    withSettings(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* Effect.gen(function* () {
          const account = yield* Account.SwitchboardAccount;
          const status = yield* account.refresh;
          expect(status).toMatchObject({
            enabled: true,
            source: "account",
            url: GATEWAY,
            account: { state: "connected", hub: { environmentId: HUB, label: "Dorothy" } },
          });
          expect(f.state.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
            `POST https://library.example.test${SWITCHBOARD_TICKET_ROUTE}`,
            `POST ${GATEWAY}/enroll`,
          ]);
          expect(routed().keyCommand).toEqual({
            command: "/bin/cat",
            args: [`${f.secretsDir}/switchboard-account-credential.bin`],
          });
          expect(yield* f.stored).toBe(f.credential(1));
          f.state.requests = [];
          expect((yield* account.refresh).account.state).toBe("connected");
          expect(f.state.requests).toEqual([
            {
              method: "GET",
              url: `${GATEWAY}/v1/models`,
              authorization: `Bearer ${f.credential(1)}`,
            },
          ]);
        }).pipe(Effect.provide(f.layer));
      }),
    ),
  );

  it.effect("keeps its stored hub through a Library outage, and enrolls again when refused", () =>
    withSettings(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* Account.SwitchboardAccount.pipe(
          Effect.flatMap((account) => account.refresh),
          Effect.provide(f.layer),
        );
        const settings = yield* ServerSettings.ServerSettingsService;
        yield* settings.updateSettings({ switchboardEnabled: false });
        setSwitchboardAccountRoute(undefined);
        f.state.library = "down";
        yield* Effect.gen(function* () {
          const account = yield* Account.SwitchboardAccount;
          // Restored at startup, before any check reaches the Library or the hub.
          expect(routed()).toMatchObject({ source: "account", url: GATEWAY });
          expect((yield* account.refresh).account.state).toBe("connected");
          f.state.hub = { status: 503, refusal: undefined };
          const outage = yield* account.refresh;
          expect(outage).toMatchObject({ source: "account", account: { state: "unreachable" } });
          // A reconnect that cannot get a new credential keeps the one launches use.
          expect((yield* account.reconnect).source).toBe("account");
          expect(yield* f.stored).toBe(f.credential(1));
          f.state.hub = { status: 401, refusal: "authentication" };
          const waiting = yield* account.refresh;
          expect(waiting).toMatchObject({ source: "local", account: { state: "connecting" } });
          f.state.library = "up";
          f.state.hub = { status: 200, refusal: undefined };
          const rejoined = yield* account.refresh;
          expect(rejoined).toMatchObject({
            enabled: false,
            source: "account",
            account: { state: "connected", problem: null },
          });
          expect(yield* f.stored).toBe(f.credential(2));
          expect((yield* account.reconnect).account.state).toBe("connected");
          expect(yield* f.stored).toBe(f.credential(3));
        }).pipe(Effect.provide(f.layer));
      }),
    ),
  );

  it.effect("adopts a hand-set URL for the hub, and leaves other routing alone", () =>
    withSettings(
      Effect.gen(function* () {
        const f = yield* fixture;
        // The MacBook Air's existing setting names Dorothy by its tailnet address.
        f.state.environment = {
          LOOM_SWITCHBOARD_URL: "http://dorothy.tail.test:3773/api/loom/switchboard",
        };
        yield* Effect.gen(function* () {
          expect((yield* (yield* Account.SwitchboardAccount).refresh).source).toBe("account");
          expect(resolveSwitchboardConfiguration(f.state.environment, "darwin")).toMatchObject({
            url: "http://dorothy.tail.test:3773/api/loom/switchboard",
            keyCommand: { command: "/bin/cat" },
          });
        }).pipe(Effect.provide(f.layer));
        setSwitchboardAccountRoute(undefined);
        f.state.environment = { LOOM_SWITCHBOARD_URL: "https://elsewhere.example.test" };
        f.state.requests = [];
        yield* Effect.gen(function* () {
          const status = yield* (yield* Account.SwitchboardAccount).refresh;
          expect(status).toMatchObject({
            source: "environment",
            account: { state: "unavailable" },
          });
          expect(status.account.problem).toContain("LOOM_SWITCHBOARD_URL");
          expect(f.state.requests).toEqual([]);
        }).pipe(Effect.provide(f.layer));
        f.state.environment = { LOOM_SWITCHBOARD_SHARE_GATEWAY: "true" };
        yield* Effect.gen(function* () {
          const status = yield* (yield* Account.SwitchboardAccount).refresh;
          expect(status.account.state).toBe("hub");
          expect(status.computers).toEqual([]);
          expect(f.state.requests).toEqual([]);
        }).pipe(Effect.provide(f.layer));
      }),
    ),
  );

  it.effect("says what blocks enrollment", () =>
    withSettings(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* Effect.gen(function* () {
          const account = yield* Account.SwitchboardAccount;
          f.state.account = false;
          expect((yield* account.refresh).account).toMatchObject({
            state: "unavailable",
            problem: "Sign this computer in to your Loom account to use its Switchboard.",
          });
          f.state.account = true;
          f.state.hubs = [];
          expect((yield* account.refresh).account).toMatchObject({
            state: "searching",
            problem: null,
          });
          f.state.hubs = [hubEntry];
          f.state.library = "old";
          expect((yield* account.refresh).account).toMatchObject({
            state: "connecting",
            problem: "Update Loom on your Library to share Switchboard across your account.",
          });
          expect(routed().source).toBe("local");
        }).pipe(Effect.provide(f.layer));
      }),
    ),
  );
});

it("prefers the hub in use, then the longest-listed one, and never itself", () => {
  const later = {
    ...hubEntry,
    environmentId: EnvironmentId.make("later"),
    firstSeenAt: "2026-06-01T00:00:00.000Z",
  };
  const privateOnly = {
    ...hubEntry,
    environmentId: EnvironmentId.make("private"),
    firstSeenAt: "2025-01-01T00:00:00.000Z",
    routes: [{ kind: "tailnet", url: "http://private.tail.test:3773" }],
  } as unknown as DirectoryEnvironment;
  const all = [later, privateOnly, hubEntry];
  expect(Account.chooseSwitchboardHub(all, AIR, undefined)?.environmentId).toBe(HUB);
  expect(Account.chooseSwitchboardHub(all, AIR, later.environmentId)?.environmentId).toBe("later");
  expect(Account.chooseSwitchboardHub(all, HUB, undefined)?.environmentId).toBe("later");
});
