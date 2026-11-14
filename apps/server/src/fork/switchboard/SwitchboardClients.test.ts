import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { SWITCHBOARD_MEMBERS_ROUTE, SWITCHBOARD_REDEEM_ROUTE } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { HttpClientResponse } from "effect/http";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Clients from "./SwitchboardClients.ts";

const HUB = EnvironmentId.make("dorothy");
const AIR = EnvironmentId.make("air");
const MINI = EnvironmentId.make("mini");
const membership = (environmentId: EnvironmentId) => ({
  environmentId,
  keyFingerprint: "f".repeat(64),
  authorityId: "authority",
  authorityEpoch: 1,
  membershipRevision: 10,
  membershipEpoch: 0,
  ownerSubject: "kyle",
});

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped();
  const state = {
    redeemFor: AIR,
    /** Tickets that redeem for another computer than `redeemFor`. */
    tickets: {} as Record<string, EnvironmentId>,
    active: [AIR] as ReadonlyArray<EnvironmentId>,
    library: "up" as "up" | "down" | 401 | 403,
    environment: { LOOM_SWITCHBOARD_SHARE_GATEWAY: "true" } as NodeJS.ProcessEnv,
  };
  const connection = Layer.mock(LibraryConnectionService)({
    current: Effect.succeed({
      kind: "remote",
      credential: null,
      origin: "https://library.example.test",
      endpoint: (path) => `https://library.example.test${path}`,
      send: (request) => {
        if (state.library === "down") return Effect.fail(new LibraryError({ reason: "io" }));
        const ticket =
          request.body._tag === "Uint8Array"
            ? String(JSON.parse(new TextDecoder().decode(request.body.body)).ticket)
            : "";
        const body = request.url.endsWith(SWITCHBOARD_REDEEM_ROUTE)
          ? {
              label: "Kyle’s MacBook Air",
              membership: membership(state.tickets[ticket] ?? state.redeemFor),
            }
          : request.url.endsWith(SWITCHBOARD_MEMBERS_ROUTE)
            ? { active: state.active }
            : null;
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            typeof state.library === "number"
              ? new Response(null, { status: state.library })
              : Response.json(body, { status: body === null ? 404 : 200 }),
          ),
        );
      },
    }),
  });
  const layer = Clients.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        connection,
        ServerSecretStore.layer.pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir))),
        Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(HUB) }),
        Layer.effect(
          HostProcess.Environment,
          Effect.sync(() => state.environment),
        ),
      ),
    ),
  );
  const secretsDir = `${baseDir}/userdata/secrets`;
  return { state, layer, fs, secretsDir };
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("Switchboard clients", (it) => {
  it.effect(
    "issues each computer one credential, keeps only its hash, and survives a restart",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const second = yield* Effect.gen(function* () {
          const clients = yield* Clients.SwitchboardClients;
          const first = Redacted.value(yield* clients.enroll("t".repeat(64)));
          expect(yield* clients.authenticate(first)).toEqual(
            Option.some({ device: "kyle-s-macbook-air" }),
          );
          const [listed] = yield* clients.list;
          expect(listed).toMatchObject({ environmentId: AIR, label: "Kyle’s MacBook Air" });
          expect(listed?.lastUsedAt).not.toBeNull();
          const second = Redacted.value(yield* clients.enroll("u".repeat(64)));
          // Enrolling again revokes the computer's earlier credential.
          expect(yield* clients.authenticate(first)).toEqual(Option.none());
          expect(yield* clients.list).toHaveLength(1);
          return second;
        }).pipe(Effect.provide(f.layer));
        const stored = yield* f.fs.readFileString(
          `${f.secretsDir}/switchboard-account-computers.bin`,
        );
        expect(stored).not.toContain(second);
        const restarted = yield* Clients.SwitchboardClients.pipe(
          Effect.flatMap((clients) => clients.authenticate(second)),
          Effect.provide(f.layer),
        );
        expect(restarted).toEqual(Option.some({ device: "kyle-s-macbook-air" }));
      }),
  );

  it.effect("drops computers the Library stops confirming or refuses to check", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const clients = yield* Clients.SwitchboardClients;
        const credential = Redacted.value(yield* clients.enroll("t".repeat(64)));
        f.state.library = "down";
        expect((yield* clients.check.pipe(Effect.flip)).reason).toBe("unavailable");
        expect(Option.isSome(yield* clients.authenticate(credential))).toBe(true);
        f.state.library = "up";
        yield* clients.check;
        expect(Option.isSome(yield* clients.authenticate(credential))).toBe(true);
        f.state.active = [];
        yield* clients.check;
        expect(yield* clients.authenticate(credential)).toEqual(Option.none());
        expect(yield* clients.list).toEqual([]);
        // Refusing the hub's sign-in or its place on the account ends every credential it issued.
        f.state.active = [AIR];
        for (const status of [401, 403] as const) {
          f.state.library = "up";
          const issued = Redacted.value(yield* clients.enroll("t".repeat(64)));
          f.state.library = status;
          expect((yield* clients.check.pipe(Effect.flip)).reason).toBe("denied");
          expect(yield* clients.authenticate(issued)).toEqual(Option.none());
          expect(yield* clients.list).toEqual([]);
        }
      }).pipe(Effect.provide(f.layer));
    }),
  );

  it.effect("stops honoring a credential a day after the Library last confirmed it", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const clients = yield* Clients.SwitchboardClients;
        const credential = Redacted.value(yield* clients.enroll("t".repeat(64)));
        yield* TestClock.adjust("20 hours");
        yield* clients.check;
        f.state.library = "down";
        yield* TestClock.adjust("23 hours");
        expect(Option.isSome(yield* clients.authenticate(credential))).toBe(true);
        expect((yield* clients.check.pipe(Effect.flip)).reason).toBe("unavailable");
        expect(yield* clients.list).toHaveLength(1);
        yield* TestClock.adjust("1 hour");
        expect(yield* clients.authenticate(credential)).toEqual(Option.none());
        expect((yield* clients.check.pipe(Effect.flip)).reason).toBe("unavailable");
        expect(yield* clients.list).toEqual([]);
      }).pipe(Effect.provide(f.layer));
    }),
  );

  it.effect(
    "keeps every computer's newest credential when enrollments and revocations overlap",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        f.state.tickets = { ["m".repeat(64)]: MINI };
        const air = yield* Effect.gen(function* () {
          const clients = yield* Clients.SwitchboardClients;
          const [, mini] = yield* Effect.all(
            [clients.enroll("t".repeat(64)), clients.enroll("m".repeat(64))],
            { concurrency: "unbounded" },
          );
          expect((yield* clients.list).map((entry) => entry.environmentId).toSorted()).toEqual([
            AIR,
            MINI,
          ]);
          const [, air] = yield* Effect.all(
            [clients.revoke(MINI), clients.enroll("t".repeat(64))],
            {
              concurrency: "unbounded",
            },
          );
          expect(yield* clients.authenticate(Redacted.value(mini))).toEqual(Option.none());
          return air;
        }).pipe(Effect.provide(f.layer));
        const restarted = yield* Effect.gen(function* () {
          const clients = yield* Clients.SwitchboardClients;
          return {
            listed: (yield* clients.list).map((entry) => entry.environmentId),
            air: Option.isSome(yield* clients.authenticate(Redacted.value(air))),
          };
        }).pipe(Effect.provide(f.layer));
        expect(restarted).toEqual({ listed: [AIR], air: true });
      }),
  );

  it.effect("issues nothing unless sharing, and never to the hub itself", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.redeemFor = HUB;
      yield* Effect.gen(function* () {
        const clients = yield* Clients.SwitchboardClients;
        expect((yield* clients.enroll("t".repeat(64)).pipe(Effect.flip)).reason).toBe("denied");
        expect(yield* clients.list).toEqual([]);
      }).pipe(Effect.provide(f.layer));
      f.state.environment = {};
      const refused = yield* Clients.SwitchboardClients.pipe(
        Effect.flatMap((clients) => clients.enroll("t".repeat(64))),
        Effect.flip,
        Effect.provide(f.layer),
      );
      expect(refused.reason).toBe("disabled");
    }),
  );
});

it.each([
  ["Kyle’s MacBook Air", "air", "kyle-s-macbook-air"],
  ["  Dorothy  ", "dorothy", "dorothy"],
  ["Café Mini", "mini", "cafe-mini"],
  ["工作站", "7CB920E8-D4FB-B182", "computer-7cb920e8d4fb"],
  [`${"a".repeat(62)} b`, "x", "a".repeat(62)],
])("names %s (id %s) as %s in the ledger", (label, id, device) => {
  expect(Clients.switchboardDevice(label, id)).toBe(device);
});
