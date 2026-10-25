import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  REACH_RATE_LIMIT_RULE,
  REACH_WAF_RULE_DESCRIPTION,
  reachWafRule,
} from "@t3tools/shared/fork/reach";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as ReachCloudflare from "./ReachCloudflare.ts";
import {
  ACCOUNT_ID,
  CLOUDFLARE_TOKEN,
  FakeReachApis,
  ZONE,
  ZONE_ID,
  cloudflareError,
} from "./testing.ts";

const WAF = reachWafRule(ZONE)!;

const run = <A, E>(
  use: (fixture: {
    readonly cloudflare: ReachCloudflare.ReachCloudflare["Service"];
    readonly apis: FakeReachApis;
    readonly tokenFile: string;
    readonly logs: ReadonlyArray<string>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "loom-reach-cloudflare-" });
    const tokenFile = `${directory}/token`;
    yield* fs.writeFileString(tokenFile, CLOUDFLARE_TOKEN);
    yield* fs.chmod(tokenFile, 0o600);
    const apis = new FakeReachApis();
    const logs: Array<string> = [];
    const logger = Logger.make(({ message }) => {
      logs.push(JSON.stringify(message));
    });
    const cloudflare = yield* ReachCloudflare.ReachCloudflare.pipe(
      Effect.provide(ReachCloudflare.layer),
      Effect.provideService(HttpClient.HttpClient, apis.client),
      Effect.provideService(HostProcess.Environment, {
        LOOM_REACH_CLOUDFLARE_TOKEN_FILE: tokenFile,
      }),
    );
    return yield* use({ cloudflare, apis, tokenFile, logs }).pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const reasonOf = <A>(effect: Effect.Effect<A, ReachCloudflare.ReachCloudflareError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => ({ reason: error.reason, retryAfterSeconds: error.retryAfterSeconds })),
  );

describe("ReachCloudflare", () => {
  it.effect("reads the token file on every call and maps refusals without the token", () =>
    run(({ cloudflare, apis, tokenFile, logs }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        expect(yield* cloudflare.findZone(ZONE)).toEqual({
          zoneId: ZONE_ID,
          accountId: ACCOUNT_ID,
        });

        apis.script(
          "zone",
          cloudflareError(403, 9109, "Unauthorized to access requested resource"),
        );
        expect(yield* reasonOf(cloudflare.findZone(ZONE))).toEqual({
          reason: "denied",
          retryAfterSeconds: undefined,
        });
        apis.script("zone", {
          ...cloudflareError(429, 971, "Please wait"),
          headers: { "retry-after": "120" },
        });
        expect(yield* reasonOf(cloudflare.findZone(ZONE))).toEqual({
          reason: "limited",
          retryAfterSeconds: 120,
        });
        apis.script("zone", cloudflareError(429, 971, "Please wait"));
        expect((yield* reasonOf(cloudflare.findZone(ZONE))).retryAfterSeconds).toBe(300);
        apis.script("zone", cloudflareError(502, 0, "Bad gateway"));
        expect((yield* reasonOf(cloudflare.findZone(ZONE))).reason).toBe("unavailable");
        apis.script("zone", { status: 200, body: { success: true, result: [] } });
        expect((yield* reasonOf(cloudflare.findZone(ZONE))).reason).toBe("not-found");

        // A rotated token is used by the next call with no restart.
        yield* fs.writeFileString(tokenFile, "cf-token-rotated");
        expect((yield* reasonOf(cloudflare.findZone(ZONE))).reason).toBe("denied");
        yield* fs.writeFileString(tokenFile, CLOUDFLARE_TOKEN);
        yield* fs.chmod(tokenFile, 0o644);
        const callsBefore = apis.calls.length;
        expect((yield* reasonOf(cloudflare.findZone(ZONE))).reason).toBe("credential");
        expect(apis.calls.length).toBe(callsBefore);

        const refusals = logs.filter((line) => line.includes("Cloudflare refused"));
        expect(refusals.length).toBeGreaterThan(0);
        expect(logs.some((line) => line.includes(CLOUDFLARE_TOKEN))).toBe(false);
      }),
    ),
  );

  it.effect("finds a tunnel by its exact name although the filter is loose", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        apis.addTunnel("loom-reach-studio-old");
        apis.addTunnel("x-loom-reach-studio");
        expect(yield* cloudflare.findTunnel(ACCOUNT_ID, "loom-reach-studio")).toBeNull();
        const own = apis.addTunnel("loom-reach-studio");
        apis.connect(own.id, "client-a");
        apis.connect(own.id, "client-a");
        apis.connect(own.id, "client-b");
        expect(yield* cloudflare.findTunnel(ACCOUNT_ID, "loom-reach-studio")).toMatchObject({
          id: own.id,
          status: "healthy",
          connectors: 2,
        });
        const token = yield* cloudflare.tunnelToken(ACCOUNT_ID, own.id);
        expect(Redacted.value(token)).toBe(apis.tokenOf(own));
        expect(String(token)).not.toContain(apis.tokenOf(own));
      }),
    ),
  );

  it.effect(
    "refuses to delete a tunnel with connectors as busy and treats a gone one as deleted",
    () =>
      run(({ cloudflare, apis }) =>
        Effect.gen(function* () {
          const tunnel = apis.addTunnel("loom-reach-studio");
          apis.connect(tunnel.id, "client-a");
          expect((yield* reasonOf(cloudflare.deleteTunnel(ACCOUNT_ID, tunnel.id))).reason).toBe(
            "busy",
          );
          yield* cloudflare.clearConnections(ACCOUNT_ID, tunnel.id);
          yield* cloudflare.deleteTunnel(ACCOUNT_ID, tunnel.id);
          yield* cloudflare.deleteTunnel(ACCOUNT_ID, "tunnel-missing");
          yield* cloudflare.deleteDns(ZONE_ID, "dns-missing");
          expect(yield* cloudflare.getTunnel(ACCOUNT_ID, "tunnel-missing")).toBeNull();
        }),
      ),
  );

  it.effect("creates edge rules with one PUT when the phases have no entrypoint", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        const rules = yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(rules).toMatchObject({ allowlist: "ready", rateLimit: "ready" });
        expect(apis.steps).toEqual([
          "allowlist.get",
          "allowlist.put",
          "ratelimit.get",
          "ratelimit.put",
        ]);
        expect(apis.rulesets.get(ReachCloudflare.WAF_PHASE)?.rules[0]?.expression).toBe(
          WAF.expression,
        );

        apis.clearCalls();
        yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(apis.steps).toEqual(["allowlist.get", "ratelimit.get"]);
      }),
    ),
  );

  it.effect("adds the allowlist first beside foreign rules and never edits them", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        const foreign = apis.addRule(ReachCloudflare.WAF_PHASE, {
          description: "operator rule",
          expression: '(http.host eq "other.example.test")',
          action: "skip",
          enabled: true,
        });
        apis.addRule(ReachCloudflare.RATE_LIMIT_PHASE, {
          description: "operator rate limit",
          expression: "true",
          action: "block",
          enabled: true,
        });
        const rules = yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(rules).toMatchObject({ allowlist: "ready", rateLimit: "occupied" });
        const waf = apis.rulesets.get(ReachCloudflare.WAF_PHASE)!.rules;
        expect(waf.map((rule) => rule.description)).toEqual([
          REACH_WAF_RULE_DESCRIPTION,
          "operator rule",
        ]);
        expect(waf[1]).toEqual(foreign);
        expect(apis.calls.find((call) => call.step === "allowlist.create")?.body).toMatchObject({
          position: { index: 1 },
        });
        expect(apis.steps).not.toContain("ratelimit.create");
      }),
    ),
  );

  it.effect("counts a foreign rule of an unknown shape without failing on it", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        const odd = { description: null, expression: "true", action: "log", enabled: true };
        apis.addRule(ReachCloudflare.WAF_PHASE, odd);
        apis.addRule(ReachCloudflare.RATE_LIMIT_PHASE, odd);
        const rules = yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(rules).toMatchObject({ allowlist: "ready", rateLimit: "occupied" });
        expect(apis.rulesets.get(ReachCloudflare.WAF_PHASE)?.rules).toHaveLength(2);
      }),
    ),
  );

  it.effect("updates its own rule of an unknown shape instead of adding another", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        apis.addRule(ReachCloudflare.WAF_PHASE, { ...WAF, ratelimit: { period: "ten" } });
        const rules = yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(rules).toMatchObject({ allowlist: "ready" });
        expect(apis.steps.slice(0, 2)).toEqual(["allowlist.get", "allowlist.update"]);
        expect(apis.rulesets.get(ReachCloudflare.WAF_PHASE)?.rules).toHaveLength(1);
      }),
    ),
  );

  it.effect("reports an empty deprecated connection list on a live tunnel as unknown", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        const own = apis.addTunnel("loom-reach-studio");
        apis.connect(own.id, "client-a");
        apis.connect(own.id, "client-a");
        apis.connect(own.id, "client-b");
        apis.deprecatedConnectionsEmpty = true;
        expect(yield* cloudflare.findTunnel(ACCOUNT_ID, "loom-reach-studio")).toMatchObject({
          status: "healthy",
          connectors: null,
        });
        expect(yield* cloudflare.countConnectors(ACCOUNT_ID, own.id)).toBe(2);
        yield* cloudflare.clearConnections(ACCOUNT_ID, own.id);
        expect(yield* cloudflare.countConnectors(ACCOUNT_ID, own.id)).toBe(0);
        expect(yield* cloudflare.getTunnel(ACCOUNT_ID, own.id)).toMatchObject({
          status: "down",
          connectors: 0,
        });
      }),
    ),
  );

  it.effect("updates its own drifted rules and keeps the old allowlist when PATCH fails", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        apis.addRule(ReachCloudflare.WAF_PHASE, { ...WAF, expression: "(older expression)" });
        apis.addRule(ReachCloudflare.RATE_LIMIT_PHASE, {
          ...REACH_RATE_LIMIT_RULE,
          expression: "old",
        });
        apis.script("allowlist.update", cloudflareError(400, 20_021, "unsupported"));
        apis.script("ratelimit.update", cloudflareError(400, 20_021, "unsupported"));
        const stale = yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(stale).toMatchObject({ allowlist: "stale", rateLimit: "ready" });
        expect(apis.rulesets.get(ReachCloudflare.WAF_PHASE)?.rules[0]?.expression).toBe(
          "(older expression)",
        );

        const updated = yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(updated).toMatchObject({ allowlist: "ready", rateLimit: "ready" });
        expect(apis.rulesets.get(ReachCloudflare.WAF_PHASE)?.rules[0]?.expression).toBe(
          WAF.expression,
        );
      }),
    ),
  );

  it.effect("reports a refused allowlist create as failed and skips the rate limit", () =>
    run(({ cloudflare, apis }) =>
      Effect.gen(function* () {
        apis.script(
          "allowlist.put",
          cloudflareError(400, 20_120, "expression not allowed on this plan"),
        );
        const rules = yield* cloudflare.ensureEdgeRules({ zoneId: ZONE_ID, zone: ZONE });
        expect(rules).toMatchObject({ allowlist: "failed", rateLimit: "failed" });
        expect(apis.steps).toEqual(["allowlist.get", "allowlist.put"]);
      }),
    ),
  );
});
