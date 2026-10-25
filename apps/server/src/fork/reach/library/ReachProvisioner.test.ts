import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { hasExtraReachConnector } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { RATE_LIMIT_PHASE, reachTunnelTarget } from "./ReachCloudflare.ts";
import { ReachProvisioner } from "./ReachProvisioner.ts";
import { ReachStore } from "./ReachStore.ts";
import {
  CONNECTOR_TOKEN_PREFIX,
  ISSUER,
  LIBRARY,
  LIBRARY_ID,
  NATIVE_CLIENT_ID,
  POCKET_ID_KEY,
  type ReachHarness,
  type ReachKey,
  cloudflareError,
  makeReachHarness,
  pinOf,
  reachKey,
  sessionRecord,
  signedRequest,
} from "./testing.ts";

const STUDIO = EnvironmentId.make("environment-studio");
const LAPTOP = EnvironmentId.make("environment-laptop");
const HOSTNAME = "studio-loom.reach.example.test";
const ORIGIN = "http://127.0.0.1:3773";
const RESOURCE = `${LIBRARY}/computers/${STUDIO}`;
const STARTED_AT = Date.parse("2026-10-24T12:00:00.000Z");

type Env = Readonly<Record<string, string | undefined>>;

interface Fixture extends ReachHarness {
  readonly provisioner: ReachProvisioner["Service"];
  readonly store: ReachStore["Service"];
  readonly studio: ReachKey;
  /** Another Library process over the same Cloudflare and Pocket ID. */
  readonly rebuild: (options?: {
    readonly storeFile?: string;
    readonly env?: Env;
  }) => Effect.Effect<
    { readonly provisioner: ReachProvisioner["Service"]; readonly store: ReachStore["Service"] },
    never,
    Scope.Scope
  >;
}

const withReach = <A, E>(
  use: (fixture: Fixture) => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem | Path.Path>,
  options: { readonly env?: Env } = {},
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(STARTED_AT);
    const harness = yield* makeReachHarness(options);
    const rebuild: Fixture["rebuild"] = (overrides) =>
      harness.build(overrides).pipe(
        Effect.map((context) => ({
          provisioner: Context.get(context, ReachProvisioner),
          store: Context.get(context, ReachStore),
        })),
      );
    const { provisioner, store } = yield* rebuild();
    const studio = reachKey();
    harness.pins.set(STUDIO, pinOf(studio, "Studio"));
    harness.sessions.set("session-studio", sessionRecord("session-studio", "active"));
    return yield* use({ ...harness, provisioner, store, studio, rebuild });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

interface CallOptions {
  readonly environmentId?: EnvironmentId;
  readonly key?: ReachKey;
  readonly origin?: string;
  readonly session?: string;
}

const ensure = (
  fixture: Pick<Fixture, "provisioner" | "studio">,
  seq: number,
  options: CallOptions = {},
) =>
  Effect.gen(function* () {
    const environmentId = options.environmentId ?? STUDIO;
    const request = yield* signedRequest({
      key: options.key ?? fixture.studio,
      environmentId,
      action: "ensure",
      seq,
      origin: options.origin ?? ORIGIN,
    }).pipe(Effect.orDie);
    return yield* fixture.provisioner.ensure({
      environmentId,
      publisherSessionId: options.session ?? "session-studio",
      request,
    });
  });

const remove = (
  fixture: Pick<Fixture, "provisioner" | "studio">,
  seq: number,
  options: CallOptions = {},
) =>
  Effect.gen(function* () {
    const environmentId = options.environmentId ?? STUDIO;
    const request = yield* signedRequest({
      key: options.key ?? fixture.studio,
      environmentId,
      action: "remove",
      seq,
    }).pipe(Effect.orDie);
    return yield* fixture.provisioner.remove({
      environmentId,
      publisherSessionId: options.session ?? "session-studio",
      request,
    });
  });

const refusal = <A, R>(effect: Effect.Effect<A, { readonly reason: string }, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

const recordOf = (store: ReachStore["Service"], environmentId: string = STUDIO) =>
  store.read.pipe(
    Effect.orDie,
    Effect.map((state) => state.computers[environmentId]),
  );

const liveTunnels = (fixture: Pick<Fixture, "apis">) =>
  [...fixture.apis.tunnels.values()].filter((tunnel) => tunnel.deletedAt === null);

const count = (steps: ReadonlyArray<string>, step: string) =>
  steps.filter((entry) => entry === step).length;

describe("ReachProvisioner.ensure", () => {
  it.effect("sets up edge rules before any tunnel, then the token, then Loom Identity", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        const reply = yield* ensure(fixture, 1);
        expect(fixture.apis.steps).toEqual([
          "zone",
          "allowlist.get",
          "allowlist.put",
          "ratelimit.get",
          "ratelimit.put",
          "dns.find",
          "tunnel.find",
          "tunnel.create",
          "ingress.put",
          "dns.create",
          "tunnel.rotate",
          "connections.clear",
          "token.get",
          "api.create",
          "grant.put",
        ]);
        const [tunnel] = liveTunnels(fixture);
        expect(tunnel?.name).toBe(`loom-reach-${STUDIO}`);
        expect(reply).toEqual({
          hostname: HOSTNAME,
          url: `https://${HOSTNAME}/`,
          origin: ORIGIN,
          connectorToken: fixture.apis.tokenOf(tunnel!),
          edge: { allowlist: "ready", rateLimit: "ready" },
          identity: {
            state: "ready",
            issuer: ISSUER,
            nativeClientId: NATIVE_CLIENT_ID,
            resource: RESOURCE,
          },
        });
        expect(tunnel?.config).toEqual({
          ingress: [{ hostname: HOSTNAME, service: ORIGIN }, { service: "http_status:404" }],
        });
        const [record] = fixture.apis.dns.values();
        expect(record).toMatchObject({
          type: "CNAME",
          name: HOSTNAME,
          content: reachTunnelTarget(tunnel!.id),
          proxied: true,
          comment: `loom-reach:${STUDIO}`,
        });
        expect(yield* recordOf(fixture.store)).toMatchObject({
          seq: 1,
          keyFingerprint: fixture.studio.fingerprint,
          hostname: HOSTNAME,
          tunnelId: tunnel!.id,
          dnsRecordId: record!.id,
          origin: ORIGIN,
          state: "ready",
          publisherSessionId: "session-studio",
          identity: { resource: RESOURCE, state: "ready", lastError: null },
        });
      }),
    ),
  );

  it.effect("rotates the secret and clears connections on every ensure", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        const first = yield* ensure(fixture, 1);
        const [tunnel] = liveTunnels(fixture);
        fixture.apis.connect(tunnel!.id, "connector-elsewhere");
        fixture.apis.clearCalls();

        const second = yield* ensure(fixture, 2);
        expect(fixture.apis.steps).toEqual([
          "tunnel.get",
          "dns.find",
          "tunnel.rotate",
          "connections.clear",
          "token.get",
          "grant.put",
        ]);
        expect(second.connectorToken).not.toBe(first.connectorToken);
        expect(second.connectorToken).toBe(fixture.apis.tokenOf(tunnel!));
        expect(tunnel?.connections).toEqual([]);
      }),
    ),
  );

  it.effect("rewrites the ingress exactly once when the computer's port changes", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        fixture.apis.clearCalls();
        yield* ensure(fixture, 2, { origin: "http://127.0.0.1:4888" });
        yield* ensure(fixture, 3, { origin: "http://127.0.0.1:4888" });
        expect(count(fixture.apis.steps, "ingress.put")).toBe(1);
        expect(liveTunnels(fixture)[0]?.config).toEqual({
          ingress: [
            { hostname: HOSTNAME, service: "http://127.0.0.1:4888" },
            { service: "http_status:404" },
          ],
        });
      }),
    ),
  );

  it.effect("finds its tunnel and DNS record again by name after the store is lost", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [tunnel] = liveTunnels(fixture);
        const [record] = fixture.apis.dns.values();
        const path = yield* Path.Path;
        const restarted = yield* fixture.rebuild({
          storeFile: path.join(path.dirname(fixture.storeFile), "replacement.json"),
        });
        fixture.apis.clearCalls();

        const reply = yield* ensure({ ...fixture, ...restarted }, 1);
        expect(reply.hostname).toBe(HOSTNAME);
        expect(fixture.apis.steps).not.toContain("tunnel.create");
        expect(fixture.apis.steps).not.toContain("dns.create");
        expect(liveTunnels(fixture)).toHaveLength(1);
        expect(fixture.apis.dns.size).toBe(1);
        expect(fixture.apis.apis.size).toBe(1);
        expect(yield* recordOf(restarted.store)).toMatchObject({
          tunnelId: tunnel!.id,
          dnsRecordId: record!.id,
          state: "ready",
        });
      }),
    ),
  );

  it.effect("ignores a stored tunnel id that names another tunnel", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [own] = liveTunnels(fixture);
        const foreign = fixture.apis.addTunnel("operator-tunnel");
        yield* fixture.store
          .update((state) => ({
            ...state,
            computers: {
              ...state.computers,
              [STUDIO]: { ...state.computers[STUDIO]!, tunnelId: foreign.id },
            },
          }))
          .pipe(Effect.orDie);
        fixture.apis.clearCalls();

        yield* ensure(fixture, 2);
        expect(foreign).toMatchObject({ deletedAt: null, rotations: 0, config: null });
        expect((yield* recordOf(fixture.store))?.tunnelId).toBe(own!.id);
        expect(fixture.apis.steps).not.toContain("tunnel.create");
        const writes = fixture.apis.calls.filter((call) =>
          ["ingress.put", "tunnel.rotate", "connections.clear", "token.get"].includes(call.step),
        );
        expect(writes.every((call) => call.path.includes(own!.id))).toBe(true);
      }),
    ),
  );

  it.effect("stops before any tunnel or DNS record when the allowlist cannot be created", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        fixture.apis.script(
          "allowlist.put",
          cloudflareError(400, 20_120, "expression not allowed on this plan"),
        );
        expect(yield* refusal(ensure(fixture, 1))).toBe("edge-failed");
        expect(fixture.apis.steps).toEqual(["zone", "allowlist.get", "allowlist.put"]);
        expect(fixture.apis.tunnels.size).toBe(0);
        expect(fixture.apis.dns.size).toBe(0);
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "failed",
          lastError: "edge-failed",
          tunnelId: null,
        });
        expect((yield* fixture.store.read.pipe(Effect.orDie)).edge).toMatchObject({
          allowlist: "failed",
        });

        // A failed check is not remembered as done, so the next ensure tries again.
        const reply = yield* ensure(fixture, 2);
        expect(reply.edge.allowlist).toBe("ready");
      }),
    ),
  );

  it.effect("leaves a foreign rate-limit rule alone and reports the slot occupied", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        const foreign = fixture.apis.addRule(RATE_LIMIT_PHASE, {
          description: "operator rate limit",
          expression: "true",
          action: "block",
          enabled: true,
        });
        const reply = yield* ensure(fixture, 1);
        expect(reply.edge).toEqual({ allowlist: "ready", rateLimit: "occupied" });
        expect(fixture.apis.rulesets.get(RATE_LIMIT_PHASE)?.rules).toEqual([foreign]);
        expect((yield* fixture.store.read.pipe(Effect.orDie)).edge?.rateLimit).toBe("occupied");
      }),
    ),
  );

  it.effect("refuses a stored hostname a foreign DNS record now holds", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [own] = fixture.apis.dns.values();
        fixture.apis.dns.delete(own!.id);
        fixture.apis.addDns({
          type: "A",
          name: HOSTNAME,
          content: "192.0.2.10",
          proxied: false,
          comment: null,
        });
        fixture.apis.clearCalls();

        expect(yield* refusal(ensure(fixture, 2))).toBe("hostname-unavailable");
        expect(fixture.apis.steps).not.toContain("dns.create");
        expect(fixture.apis.steps).not.toContain("dns.patch");
        expect(fixture.apis.steps).not.toContain("token.get");
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "failed",
          lastError: "hostname-unavailable",
          hostname: HOSTNAME,
        });
      }),
    ),
  );

  it.effect("allocates the next hostname when a foreign record holds the first", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        fixture.apis.addDns({
          type: "CNAME",
          name: HOSTNAME,
          content: "elsewhere.example.test",
          proxied: true,
          comment: null,
        });
        const reply = yield* ensure(fixture, 1);
        expect(reply.hostname).toBe("studio-2-loom.reach.example.test");
      }),
    ),
  );

  it.effect("never hands a removed computer's hostname to another computer", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        yield* remove(fixture, 2);
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "removed",
          hostname: HOSTNAME,
        });

        const laptop = reachKey();
        fixture.pins.set(LAPTOP, pinOf(laptop, "Studio"));
        const reply = yield* ensure(fixture, 1, { environmentId: LAPTOP, key: laptop });
        expect(reply.hostname).toBe("studio-2-loom.reach.example.test");

        const again = yield* ensure(fixture, 3);
        expect(again.hostname).toBe(HOSTNAME);
      }),
    ),
  );

  it.effect("refuses to provision the Library's own environment", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        const own = reachKey();
        fixture.pins.set(LIBRARY_ID, pinOf(own, "Library"));
        expect(yield* refusal(ensure(fixture, 1, { environmentId: LIBRARY_ID, key: own }))).toBe(
          "is-library",
        );
        expect(fixture.apis.calls).toEqual([]);
        expect(yield* recordOf(fixture.store, LIBRARY_ID)).toBeUndefined();
      }),
    ),
  );

  it.effect("refuses a computer the directory does not list", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        fixture.pins.delete(STUDIO);
        expect(yield* refusal(ensure(fixture, 1))).toBe("not-in-directory");
        expect(fixture.apis.calls).toEqual([]);
      }),
    ),
  );

  it.effect("pins the first key and refuses another until an admin retires the computer", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const replacement = reachKey();
        fixture.pins.set(STUDIO, pinOf(replacement, "Studio"));
        fixture.apis.clearCalls();

        expect(yield* refusal(ensure(fixture, 2, { key: replacement }))).toBe("key-changed");
        expect(yield* refusal(remove(fixture, 2, { key: replacement }))).toBe("key-changed");
        expect(fixture.apis.calls).toEqual([]);
        expect(yield* recordOf(fixture.store)).toMatchObject({
          seq: 1,
          keyFingerprint: fixture.studio.fingerprint,
          state: "ready",
        });

        yield* fixture.provisioner.retire({ environmentId: STUDIO, endIdentity: false });
        const reply = yield* ensure(fixture, 2, { key: replacement });
        expect(reply.hostname).toBe(HOSTNAME);
        expect((yield* recordOf(fixture.store))?.keyFingerprint).toBe(replacement.fingerprint);
      }),
    ),
  );

  it.effect("persists seq and the key pin before its first outside call", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        fixture.apis.script("*", cloudflareError(503, 0, "Service unavailable"));
        expect(yield* refusal(ensure(fixture, 1))).toBe("cloudflare-unavailable");
        expect(fixture.apis.steps).toEqual(["zone"]);
        expect(yield* recordOf(fixture.store)).toMatchObject({
          seq: 1,
          keyFingerprint: fixture.studio.fingerprint,
          state: "failed",
          lastError: "cloudflare-unavailable",
        });

        fixture.apis.clearCalls();
        expect(yield* refusal(ensure(fixture, 1))).toBe("stale-request");
        expect(fixture.apis.calls).toEqual([]);
      }),
    ),
  );

  it.effect("limits each computer to ten requests in ten minutes", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        for (let seq = 1; seq <= 10; seq += 1) yield* ensure(fixture, seq);
        fixture.apis.clearCalls();

        const limited = yield* ensure(fixture, 11).pipe(Effect.flip);
        expect(limited).toMatchObject({ reason: "too-many-requests", retryAfterSeconds: 600 });
        expect(fixture.apis.calls).toEqual([]);

        // Another computer keeps its own budget.
        const laptop = reachKey();
        fixture.pins.set(LAPTOP, pinOf(laptop, "Laptop"));
        yield* ensure(fixture, 1, { environmentId: LAPTOP, key: laptop });

        yield* TestClock.adjust("5 minutes");
        expect(yield* ensure(fixture, 12).pipe(Effect.flip)).toMatchObject({
          reason: "too-many-requests",
          retryAfterSeconds: 300,
        });
        yield* TestClock.adjust("5 minutes");
        yield* TestClock.adjust("1 second");
        expect((yield* ensure(fixture, 13)).hostname).toBe(HOSTNAME);
      }),
    ),
  );
});

describe("ReachProvisioner Loom Identity", () => {
  it.effect("adopts the API Pocket ID already holds for the exact resource", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        fixture.apis.addApi("Loom decoy", `${RESOURCE}-old`);
        const existing = fixture.apis.addApi("Loom Studio", RESOURCE);
        const reply = yield* ensure(fixture, 1);
        expect(reply.identity).toMatchObject({ state: "ready", resource: RESOURCE });
        expect(fixture.apis.steps.slice(-3)).toEqual(["api.create", "api.search", "grant.put"]);
        expect((yield* recordOf(fixture.store))?.identity?.apiId).toBe(existing.id);
      }),
    ),
  );

  it.effect(
    "answers not-configured without a key file, and keeps an existing resource usable",
    () =>
      withReach((fixture) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const missingKey = { LOOM_IDENTITY_ADMIN_API_KEY_FILE: "/nonexistent/loom-reach-key" };
          const withoutKey = yield* fixture.rebuild({
            env: missingKey,
            storeFile: path.join(path.dirname(fixture.storeFile), "without-key.json"),
          });
          const fresh = yield* ensure({ ...fixture, ...withoutKey }, 1);
          expect(fresh.identity).toEqual({ state: "not-configured" });
          expect(fresh.connectorToken.startsWith(CONNECTOR_TOKEN_PREFIX)).toBe(true);
          expect(yield* recordOf(withoutKey.store)).toMatchObject({
            state: "ready",
            identity: null,
          });
          expect(fixture.apis.steps.some((step) => step.startsWith("api."))).toBe(false);

          // The on-demand key was present for this ensure and is gone when the Library restarts.
          yield* ensure(fixture, 1);
          const restarted = yield* fixture.rebuild({ env: missingKey });
          const later = yield* ensure({ ...fixture, ...restarted }, 2);
          expect(later.identity).toMatchObject({ state: "ready", resource: RESOURCE });
          expect(fixture.apis.apis.size).toBe(1);
        }),
      ),
  );

  it.effect("keeps reach ready when Pocket ID fails", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        fixture.apis.script("api.create", { status: 503, body: { error: "unavailable" } });
        const reply = yield* ensure(fixture, 1);
        expect(reply.identity).toEqual({ state: "failed", reason: "unavailable" });
        expect(reply.connectorToken.startsWith(CONNECTOR_TOKEN_PREFIX)).toBe(true);
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "ready",
          identity: { apiId: null, resource: RESOURCE, state: "failed", lastError: "unavailable" },
        });
        const listing = yield* fixture.provisioner.list;
        expect(listing.setup.identity).toBe("unavailable");

        // A conflict came from Pocket ID with a working key, so the key reads ready again.
        fixture.apis.script("api.create", { status: 400, body: { error: "name is too long" } });
        expect((yield* ensure(fixture, 2)).identity).toEqual({
          state: "failed",
          reason: "conflict",
        });
        expect((yield* fixture.provisioner.list).setup.identity).toBe("ready");
      }),
    ),
  );
});

describe("ReachProvisioner.remove", () => {
  it.effect("rotates, clears and deletes the tunnel before its DNS record", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [tunnel] = liveTunnels(fixture);
        fixture.apis.connect(tunnel!.id, "connector-a");
        fixture.apis.clearCalls();

        expect(yield* remove(fixture, 2)).toEqual({ removed: true });
        expect(fixture.apis.steps).toEqual([
          "tunnel.get",
          "tunnel.rotate",
          "connections.clear",
          "tunnel.delete",
          "dns.get",
          "dns.delete",
        ]);
        expect(tunnel?.deletedAt).not.toBeNull();
        expect(fixture.apis.dns.size).toBe(0);
        expect(fixture.apis.apis.size).toBe(1);
        expect(yield* recordOf(fixture.store)).toMatchObject({
          seq: 2,
          state: "removed",
          hostname: HOSTNAME,
          tunnelId: null,
          dnsRecordId: null,
          origin: null,
          identity: { state: "ready" },
        });
      }),
    ),
  );

  it.effect("answers tunnel-busy after one retry, and finishes on a later remove", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const busy = cloudflareError(
          400,
          1022,
          "Cannot delete tunnel because it has active connections",
        );
        fixture.apis.script("tunnel.delete", busy, 2);
        fixture.apis.clearCalls();

        expect(yield* refusal(remove(fixture, 2))).toBe("tunnel-busy");
        expect(count(fixture.apis.steps, "tunnel.delete")).toBe(2);
        expect(count(fixture.apis.steps, "connections.clear")).toBe(2);
        expect(fixture.apis.steps).not.toContain("dns.delete");
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "removing",
          lastError: "tunnel-busy",
        });

        fixture.apis.script("tunnel.delete", busy, 1);
        yield* remove(fixture, 3);
        expect(yield* recordOf(fixture.store)).toMatchObject({ state: "removed", lastError: null });
        expect(liveTunnels(fixture)).toEqual([]);
      }),
    ),
  );

  it.effect("leaves a DNS record that no longer names its tunnel and reports it", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [record] = fixture.apis.dns.values();
        record!.content = "operator-target.example.test";

        yield* remove(fixture, 2);
        expect(fixture.apis.dns.get(record!.id)).toBeDefined();
        expect(fixture.apis.steps).not.toContain("dns.delete");
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "removed-with-leftover",
          leftoverDnsRecordId: record!.id,
        });

        // A later Retire keeps reporting it while it exists, even untagged.
        record!.comment = null;
        yield* fixture.provisioner.retire({ environmentId: STUDIO, endIdentity: false });
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "removed-with-leftover",
          leftoverDnsRecordId: record!.id,
        });
        fixture.apis.dns.delete(record!.id);
        yield* fixture.provisioner.retire({ environmentId: STUDIO, endIdentity: false });
        expect(yield* recordOf(fixture.store)).toMatchObject({
          state: "removed",
          leftoverDnsRecordId: null,
        });
      }),
    ),
  );

  it.effect("deletes the tagged record when the stored id no longer exists", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [tunnel] = liveTunnels(fixture);
        // An ensure created a replacement record but failed before storing its id.
        const [created] = fixture.apis.dns.values();
        fixture.apis.dns.delete(created!.id);
        const replacement = fixture.apis.addDns({
          type: "CNAME",
          name: HOSTNAME,
          content: reachTunnelTarget(tunnel!.id),
          proxied: true,
          comment: `loom-reach:${STUDIO}`,
        });
        fixture.apis.clearCalls();

        yield* remove(fixture, 2);
        expect(fixture.apis.steps.slice(-3)).toEqual(["dns.get", "dns.find", "dns.delete"]);
        expect(fixture.apis.dns.has(replacement.id)).toBe(false);
        expect(yield* recordOf(fixture.store)).toMatchObject({ state: "removed" });
      }),
    ),
  );

  it.effect("answers a computer with nothing set up without recording it", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        expect(yield* remove(fixture, 1)).toEqual({ removed: true });
        expect(fixture.apis.calls).toEqual([]);
        expect(yield* recordOf(fixture.store)).toBeUndefined();
      }),
    ),
  );
});

describe("ReachProvisioner admin", () => {
  it.effect("retires without the computer and keeps Loom Identity unless asked", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        fixture.apis.clearCalls();
        const retired = yield* fixture.provisioner.retire({
          environmentId: STUDIO,
          endIdentity: false,
        });
        expect(retired).toMatchObject({
          environmentId: STUDIO,
          state: "removed",
          connection: "down",
          identity: { resource: RESOURCE, state: "ready" },
        });
        expect(fixture.apis.steps).not.toContain("api.delete");
        expect(fixture.apis.apis.size).toBe(1);
        expect(liveTunnels(fixture)).toEqual([]);
        expect((yield* recordOf(fixture.store))?.keyFingerprint).toBeNull();

        const ended = yield* fixture.provisioner.retire({
          environmentId: STUDIO,
          endIdentity: true,
        });
        expect(ended.identity).toBeNull();
        expect(count(fixture.apis.steps, "api.delete")).toBe(1);
        expect(fixture.apis.apis.size).toBe(0);
        expect((yield* recordOf(fixture.store))?.identity).toBeNull();
      }),
    ),
  );

  it.effect("keeps a resource Pocket ID would not delete for a later Retire", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        fixture.apis.script("api.delete", { status: 503, body: { error: "unavailable" } });
        const retired = yield* fixture.provisioner.retire({
          environmentId: STUDIO,
          endIdentity: true,
        });
        expect(retired.identity).toEqual({
          resource: RESOURCE,
          state: "failed",
          lastError: "unavailable",
        });
        expect((yield* recordOf(fixture.store))?.identity?.apiId).not.toBeNull();
        expect((yield* fixture.provisioner.list).setup.identity).toBe("unavailable");

        const again = yield* fixture.provisioner.retire({
          environmentId: STUDIO,
          endIdentity: true,
        });
        expect(again.identity).toBeNull();
        expect(fixture.apis.apis.size).toBe(0);
        expect((yield* fixture.provisioner.list).setup.identity).toBe("ready");
      }),
    ),
  );

  it.effect("refuses to end Loom sign-in without its admin key before any Cloudflare call", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const keyFile = fixture.env.LOOM_IDENTITY_ADMIN_API_KEY_FILE!;
        const endSignIn = fixture.provisioner.retire({ environmentId: STUDIO, endIdentity: true });
        yield* ensure(fixture, 1);
        const before = yield* recordOf(fixture.store);
        yield* fs.remove(keyFile);
        fixture.apis.clearCalls();

        expect(yield* refusal(endSignIn)).toBe("identity-key-missing");
        expect(fixture.apis.calls).toEqual([]);
        expect(yield* recordOf(fixture.store)).toEqual(before);
        expect(liveTunnels(fixture)).toHaveLength(1);
        expect((yield* fixture.provisioner.list).setup.identity).toBe("missing");

        // A key file the Library would refuse to read cannot end sign-in either.
        yield* fs.writeFileString(keyFile, POCKET_ID_KEY);
        yield* fs.chmod(keyFile, 0o644);
        fixture.apis.clearCalls();
        expect(yield* refusal(endSignIn)).toBe("identity-key-missing");
        expect(fixture.apis.calls).toEqual([]);

        yield* fs.chmod(keyFile, 0o600);
        expect(yield* endSignIn).toMatchObject({ state: "removed", identity: null });
        expect(fixture.apis.apis.size).toBe(0);
      }),
    ),
  );

  it.effect("ends sign-in without the admin key when Pocket ID holds nothing to delete", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(fixture.env.LOOM_IDENTITY_ADMIN_API_KEY_FILE!);
        yield* ensure(fixture, 1);
        expect((yield* recordOf(fixture.store))?.identity).toBeNull();

        const retired = yield* fixture.provisioner.retire({
          environmentId: STUDIO,
          endIdentity: true,
        });
        expect(retired).toMatchObject({ state: "removed", identity: null });
        expect(fixture.apis.steps).not.toContain("api.delete");
      }),
    ),
  );

  it.effect("ends a sign-in Pocket ID never created without the admin key", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        fixture.apis.script("api.create", { status: 503, body: { error: "unavailable" } });
        yield* ensure(fixture, 1);
        expect((yield* recordOf(fixture.store))?.identity).toMatchObject({
          apiId: null,
          state: "failed",
        });
        yield* fs.remove(fixture.env.LOOM_IDENTITY_ADMIN_API_KEY_FILE!);

        const retired = yield* fixture.provisioner.retire({
          environmentId: STUDIO,
          endIdentity: true,
        });
        expect(retired).toMatchObject({ state: "removed", identity: null });
        expect(fixture.apis.steps).not.toContain("api.delete");
      }),
    ),
  );

  it.effect("refuses to retire a computer it never provisioned", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        expect(
          yield* refusal(fixture.provisioner.retire({ environmentId: STUDIO, endIdentity: true })),
        ).toBe("not-found");
      }),
    ),
  );

  it.effect("lists each computer's connection, connectors and sign-in with one tunnel call", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [tunnel] = liveTunnels(fixture);
        fixture.apis.connect(tunnel!.id, "connector-a");
        fixture.apis.connect(tunnel!.id, "connector-a");
        fixture.apis.connect(tunnel!.id, "connector-b");
        fixture.apis.clearCalls();

        const listing = yield* fixture.provisioner.list;
        expect(fixture.apis.steps).toEqual(["tunnel.list"]);
        expect(listing.setup).toMatchObject({
          zone: "reach.example.test",
          cloudflare: "ready",
          identity: "ready",
          edge: { allowlist: "ready", rateLimit: "ready" },
        });
        const [computer] = listing.computers;
        expect(computer).toMatchObject({
          environmentId: STUDIO,
          label: "Studio",
          hostname: HOSTNAME,
          state: "ready",
          connection: "connected",
          connectors: 2,
          signIn: "active",
        });
        expect(hasExtraReachConnector(computer!)).toBe(true);

        fixture.sessions.set("session-studio", sessionRecord("session-studio", "revoked"));
        fixture.apis.script("tunnel.list", cloudflareError(403, 10_000, "Authentication error"));
        const later = yield* fixture.provisioner.list;
        expect(later.computers[0]).toMatchObject({ connection: "unknown", signIn: "ended" });
        expect(later.setup.cloudflare).toBe("refused");
      }),
    ),
  );

  it.effect("still counts connectors once Cloudflare empties the deprecated list", () =>
    withReach((fixture) =>
      Effect.gen(function* () {
        yield* ensure(fixture, 1);
        const [tunnel] = liveTunnels(fixture);
        fixture.apis.connect(tunnel!.id, "connector-a");
        fixture.apis.connect(tunnel!.id, "connector-b");
        fixture.apis.deprecatedConnectionsEmpty = true;
        fixture.apis.clearCalls();

        const [computer] = (yield* fixture.provisioner.list).computers;
        expect(fixture.apis.steps).toEqual(["tunnel.list", "connections.list"]);
        expect(computer).toMatchObject({ connection: "connected", connectors: 2 });
        expect(hasExtraReachConnector(computer!)).toBe(true);

        // A count it cannot get is unknown, never zero.
        fixture.apis.script("connections.list", cloudflareError(503, 0, "unavailable"));
        const [unknown] = (yield* fixture.provisioner.list).computers;
        expect(unknown).toMatchObject({ connection: "connected", connectors: null });

        // A tunnel that is down is not asked about.
        tunnel!.status = "down";
        fixture.apis.clearCalls();
        yield* fixture.provisioner.list;
        expect(fixture.apis.steps).toEqual(["tunnel.list"]);
      }),
    ),
  );

  it.effect("answers not-authority off the Library authority", () =>
    withReach(
      (fixture) =>
        Effect.gen(function* () {
          expect(yield* refusal(fixture.provisioner.list)).toBe("not-authority");
          expect(
            yield* refusal(
              fixture.provisioner.retire({ environmentId: STUDIO, endIdentity: false }),
            ),
          ).toBe("not-authority");
          expect(yield* refusal(ensure(fixture, 1))).toBe("not-authority");
        }),
      { env: { LOOM_LIBRARY_AUTHORITY: "false" } },
    ),
  );
});
