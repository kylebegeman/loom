// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no Ed25519 key generation or signing.
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import { DirectoryEnvironmentReport, type ReachRequestClaims } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { signRelayJwt } from "../relayJwt.ts";
import {
  directoryPublicKeyFromPem,
  isDirectoryRouteUrl,
  signDirectoryReport,
  verifyDirectoryReport,
} from "./directory.ts";
import {
  REACH_ALLOWED_METHODS,
  REACH_ALLOWED_PATHS,
  REACH_ALLOWED_PREFIXES,
  REACH_HOSTNAME_MAX_ATTEMPTS,
  REACH_RATE_LIMIT_RULE,
  REACH_RATE_LIMITED_PATHS,
  REACH_REQUEST_TYP,
  REACH_RESERVED_SLUGS,
  isReachHostname,
  isReachSlug,
  isReachZone,
  isUnsafeReachPath,
  reachAllowsRequest,
  reachHostname,
  reachIngressConfiguration,
  reachResource,
  reachSlug,
  reachWafRule,
  renderReachWafExpression,
  signReachRequest,
  verifyReachRequest,
} from "./reach.ts";

const NOW = 1_792_281_600;
const LIBRARY_URL = "https://library.example.com";
const ENVIRONMENT_ID = "4f1c2b9e-7d3a-4c5e-9b8f-1a2b3c4d5e6f";
const ZONE = "begam.in";

function generateKeyPair() {
  const pair = NodeCrypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const publicKey = directoryPublicKeyFromPem(pair.publicKey);
  if (publicKey === null) throw new Error("Expected an Ed25519 public key.");
  return { privateKeyPem: pair.privateKey, publicKey };
}

const environmentKey = generateKeyPair();

const report = Schema.decodeSync(DirectoryEnvironmentReport)({
  environmentId: ENVIRONMENT_ID,
  label: "Studio",
  serverVersion: "0.0.0-test",
  platform: { os: "darwin", arch: "arm64" },
  supportsExecution: true,
  loomFeatures: [],
  routes: [],
  providers: [],
  sequence: NOW * 1_000,
  reportedAt: "2026-10-18T00:00:00.000Z",
});

const ensureClaims: ReachRequestClaims = {
  action: "ensure",
  seq: NOW * 1_000,
  origin: "http://127.0.0.1:3773",
};

const sign = (input: { claims?: ReachRequestClaims; nowEpochSeconds?: number } = {}) =>
  signReachRequest({
    privateKey: environmentKey.privateKeyPem,
    environmentId: ENVIRONMENT_ID,
    audience: LIBRARY_URL,
    claims: input.claims ?? ensureClaims,
    nowEpochSeconds: input.nowEpochSeconds ?? NOW,
  });

const verify = (
  token: string,
  input: {
    action?: "ensure" | "remove";
    audience?: string;
    environmentId?: string;
    publicKey?: string;
    nowEpochSeconds?: number;
  } = {},
) =>
  verifyReachRequest({
    publicKey: input.publicKey ?? environmentKey.publicKey,
    token,
    environmentId: input.environmentId ?? ENVIRONMENT_ID,
    audience: input.audience ?? LIBRARY_URL,
    action: input.action ?? "ensure",
    nowEpochSeconds: input.nowEpochSeconds ?? NOW,
  });

/** Signs arbitrary claims with the environment key, as a forger holding that key could. */
const signClaims = (payload: Record<string, unknown>, typ = REACH_REQUEST_TYP) =>
  signRelayJwt({ privateKey: environmentKey.privateKeyPem, typ, payload });

const baseClaims = {
  iss: `loom-env:${ENVIRONMENT_ID}`,
  sub: ENVIRONMENT_ID,
  aud: LIBRARY_URL,
  iat: NOW,
  exp: NOW + 60,
};

/** Everything a failure would print through the usual `Effect.logWarning(message, cause)`. */
const printedFailure = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.exit(effect).pipe(
    Effect.map((exit) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")),
  );

describe("reach requests", () => {
  it.effect("round trips an ensure and a remove", () =>
    Effect.gen(function* () {
      expect(yield* verify(yield* sign())).toEqual(ensureClaims);
      const remove = { action: "remove", seq: NOW * 1_000 + 1 } as const;
      expect(yield* verify(yield* sign({ claims: remove }), { action: "remove" })).toEqual(remove);
      // Both sides sign and compare only the Library's origin.
      expect(
        yield* verify(yield* sign(), { audience: `${LIBRARY_URL}/api/loom/reach/ensure` }),
      ).toEqual(ensureClaims);
      const ipv6 = { ...ensureClaims, origin: "http://[::1]:65535" };
      expect(yield* verify(yield* sign({ claims: ipv6 }))).toEqual(ipv6);
    }),
  );

  it.effect("keeps reach requests and directory reports apart", () =>
    Effect.gen(function* () {
      const reachToken = yield* sign();
      const asReport = yield* verifyDirectoryReport({
        publicKey: environmentKey.publicKey,
        token: reachToken,
        environmentId: ENVIRONMENT_ID,
        audience: LIBRARY_URL,
        nowEpochSeconds: NOW,
      }).pipe(Effect.flip);
      expect(asReport.reason).toBe("unverified");

      const reportToken = yield* signDirectoryReport({
        privateKey: environmentKey.privateKeyPem,
        report,
        audience: LIBRARY_URL,
        nowEpochSeconds: NOW,
      });
      const asReach = yield* verify(reportToken).pipe(Effect.flip);
      expect(asReach.reason).toBe("unverified");
      expect(asReach.diagnostic).toBe("ERR_JWT_CLAIM_VALIDATION_FAILED");
    }),
  );

  it.effect("refuses another Library's audience", () =>
    Effect.gen(function* () {
      const error = yield* verify(yield* sign(), { audience: "https://other.example.com" }).pipe(
        Effect.flip,
      );
      expect(error.reason).toBe("unverified");
    }),
  );

  it.effect("refuses a request older than its one-minute lifetime", () =>
    Effect.gen(function* () {
      const late = yield* verify(yield* sign(), { nowEpochSeconds: NOW + 200 }).pipe(Effect.flip);
      expect(late.reason).toBe("unverified");
      expect(late.diagnostic).toBe("ERR_JWT_EXPIRED");

      const longLived = yield* signClaims({
        ...baseClaims,
        ...ensureClaims,
        iat: NOW - 600,
        exp: NOW + 3_600,
      });
      expect((yield* verify(longLived).pipe(Effect.flip)).reason).toBe("unverified");
    }),
  );

  it.effect("refuses a request that names another environment", () =>
    Effect.gen(function* () {
      const otherSubject = yield* signClaims({ ...baseClaims, ...ensureClaims, sub: "other" });
      expect((yield* verify(otherSubject).pipe(Effect.flip)).reason).toBe("wrong-environment");

      const forOther = yield* verify(yield* sign(), { environmentId: "environment-b" }).pipe(
        Effect.flip,
      );
      expect(forOther.reason).toBe("wrong-environment");
    }),
  );

  it.effect("refuses a request signed by another key", () =>
    Effect.gen(function* () {
      const other = generateKeyPair();
      const error = yield* verify(yield* sign(), { publicKey: other.publicKey }).pipe(Effect.flip);
      expect(error.reason).toBe("unverified");
      expect(
        (yield* verify(yield* sign(), { publicKey: "not-a-key" }).pipe(Effect.flip)).reason,
      ).toBe("invalid-key");
    }),
  );

  it.effect("refuses claims outside the contract, whether signed by Loom or forged", () =>
    Effect.gen(function* () {
      const fractional = { ...ensureClaims, seq: 1.5 };
      expect((yield* sign({ claims: fractional }).pipe(Effect.flip)).reason).toBe(
        "invalid-request",
      );
      const forged: ReadonlyArray<Record<string, unknown>> = [
        { ...ensureClaims, seq: 1.5 },
        { ...ensureClaims, seq: "1" },
        { ...ensureClaims, seq: 0 },
        { ...ensureClaims, origin: "http://192.168.1.20:3773" },
        { ...ensureClaims, origin: "http://localhost:3773" },
        { ...ensureClaims, origin: "https://127.0.0.1:3773" },
        { ...ensureClaims, origin: "http://127.0.0.1:65536" },
        { ...ensureClaims, origin: "http://127.0.0.1:0" },
        { ...ensureClaims, origin: "http://127.0.0.1:3773/" },
      ];
      for (const claims of forged) {
        const token = yield* signClaims({ ...baseClaims, ...claims });
        expect((yield* verify(token).pipe(Effect.flip)).reason).toBe("invalid-request");
      }
    }),
  );

  it.effect("binds the action to the route and the origin to ensure", () =>
    Effect.gen(function* () {
      const ensureToken = yield* sign();
      expect((yield* verify(ensureToken, { action: "remove" }).pipe(Effect.flip)).reason).toBe(
        "invalid-request",
      );
      const ensureWithoutOrigin = { action: "ensure", seq: 5 } as const;
      expect((yield* sign({ claims: ensureWithoutOrigin }).pipe(Effect.flip)).reason).toBe(
        "invalid-request",
      );
      const removeWithOrigin = yield* signClaims({
        ...baseClaims,
        ...ensureClaims,
        action: "remove",
      });
      expect((yield* verify(removeWithOrigin, { action: "remove" }).pipe(Effect.flip)).reason).toBe(
        "invalid-request",
      );
    }),
  );

  it.effect("keeps a refused request's claims out of the error", () =>
    Effect.gen(function* () {
      const token = yield* signClaims({
        ...baseClaims,
        ...ensureClaims,
        origin: "http://private-host.example.ts.net:3773",
      });
      const printed = yield* printedFailure(verify(token));
      expect(printed).toContain("invalid-request");
      expect(printed).not.toContain("private-host");
    }),
  );
});

describe("reach allowlist", () => {
  it("admits every listed path and prefix with every allowed method", () => {
    for (const method of REACH_ALLOWED_METHODS) {
      for (const path of REACH_ALLOWED_PATHS) {
        expect(reachAllowsRequest(method, path)).toBe(true);
      }
      for (const prefix of REACH_ALLOWED_PREFIXES) {
        expect(reachAllowsRequest(method, `${prefix}token/file.png`)).toBe(true);
      }
    }
    expect(reachAllowsRequest("GET", "/ws?wsTicket=abc%2Fdef")).toBe(true);
    expect(reachAllowsRequest("POST", "/api/auth/clients/revoke")).toBe(true);
  });

  it("refuses other methods and every unlisted path", () => {
    expect(reachAllowsRequest("PUT", "/api/projects")).toBe(false);
    expect(reachAllowsRequest("DELETE", "/api/assets/t/a.png")).toBe(false);
    expect(reachAllowsRequest("PATCH", "/api/device-hub/x")).toBe(false);
    expect(reachAllowsRequest("get", "/ws")).toBe(false);
    for (const path of [
      "/",
      "/index.html",
      "/mcp",
      "/oauth/mcp/authorize",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/mcp",
      "/connect-agent",
      "/api/hooks/x",
      "/api/loom/library/x",
      "/api/loom/directory/report",
      "/api/loom/reach/ensure",
      "/api/loom/identity/login",
      "/api/loom/identity/callback",
      "/api/auth/pairing-token",
      "/api/auth/pairing-links",
      "/api/auth/browser-session",
      "/api/observability/v1/traces",
      "/api/connect/link-state",
      "/api/projectsx",
      "/ws/",
      "/api/assets",
    ]) {
      expect(reachAllowsRequest("GET", path)).toBe(false);
    }
  });

  it("refuses traversal and encoded separators in either case", () => {
    for (const path of [
      "/api/assets/../mcp",
      "/api/assets/t/..",
      "/api/assets/./x",
      "/api/assets/t/.",
      "/api/assets//x",
      "/api/assets/t\\..\\mcp",
      "/api/assets/%2e%2e/mcp",
      "/api/assets/%2E%2E/mcp",
      "/api/assets/.%2e/mcp",
      "/api/assets/%2E/x",
      "/api/assets/t%2fmcp",
      "/api/assets/t%2Fmcp",
      "/api/assets/t%5cmcp",
      "/api/assets/t%5Cmcp",
      "/api/assets/t%00.png",
      "/api/assets/t/%zz",
      "http://studio-loom.begam.in/mcp",
      "*",
    ]) {
      expect(isUnsafeReachPath(path)).toBe(true);
      expect(reachAllowsRequest("GET", path)).toBe(false);
    }
  });

  it("lets dots and escapes inside a segment through", () => {
    for (const path of [
      "/api/assets/t/a..b.png",
      "/api/assets/t/..a",
      "/api/assets/t/a%2epng",
      "/api/assets/t/My%20File.pdf",
      "/api/loom/pcb-preview/f/t/board.v2..svg",
      "/ws?next=%2F..%2Fmcp",
    ]) {
      expect(isUnsafeReachPath(path)).toBe(false);
      expect(reachAllowsRequest("GET", path)).toBe(true);
    }
  });

  it("renders the edge rule from the same constants, each entry once", () => {
    const expression = renderReachWafExpression(ZONE);
    if (expression === null) throw new Error("Expected an expression for a valid zone.");
    expect(expression.startsWith(`(lower(http.host) contains "-loom.${ZONE}") and not (`)).toBe(
      true,
    );
    expect(expression).not.toContain("ends_with");
    const count = (needle: string) => expression.split(needle).length - 1;
    for (const path of REACH_ALLOWED_PATHS) expect(count(`"${path}"`)).toBe(1);
    for (const prefix of REACH_ALLOWED_PREFIXES) {
      expect(count(`starts_with(http.request.uri.path, "${prefix}")`)).toBe(1);
    }
    for (const method of REACH_ALLOWED_METHODS) expect(count(`"${method}"`)).toBe(1);

    const quotedIn = (field: string) =>
      [
        ...(new RegExp(`${field} in \\{([^}]*)\\}`, "u").exec(expression)?.[1] ?? "").matchAll(
          /"([^"]+)"/gu,
        ),
      ].map((match) => match[1]);
    expect(quotedIn("http\\.request\\.uri\\.path")).toEqual([...REACH_ALLOWED_PATHS]);
    expect(quotedIn("http\\.request\\.method")).toEqual([...REACH_ALLOWED_METHODS]);
    const prefixes = [
      ...expression.matchAll(/starts_with\(http\.request\.uri\.path, "([^"]+)"\)/gu),
    ].map((match) => match[1]);
    expect(prefixes).toEqual([...REACH_ALLOWED_PREFIXES]);
    expect(reachWafRule(ZONE)).toMatchObject({ action: "block", expression });
  });

  it("renders no rule for a zone that could break the expression", () => {
    for (const zone of [
      "",
      "in",
      "Begam.in",
      'begam.in" or true or "',
      "begam.in.",
      "127.0.0.1",
      "begam.in:443",
      "begam.in/x",
    ]) {
      expect(isReachZone(zone)).toBe(false);
      expect(renderReachWafExpression(zone)).toBeNull();
      expect(reachWafRule(zone)).toBeNull();
    }
  });

  it("rate limits only the sign-in and ticket paths", () => {
    for (const path of REACH_RATE_LIMITED_PATHS) {
      expect(REACH_RATE_LIMIT_RULE.expression).toContain(`(http.request.uri.path eq "${path}")`);
    }
    expect(REACH_RATE_LIMIT_RULE.expression).not.toContain('"/ws"');
    expect(REACH_RATE_LIMIT_RULE.ratelimit).toEqual({
      characteristics: ["cf.colo.id", "ip.src"],
      period: 10,
      requests_per_period: 60,
      mitigation_timeout: 10,
    });
  });

  it("builds the tunnel ingress with a 404 catch-all and no origin overrides", () => {
    expect(reachIngressConfiguration("studio-loom.begam.in", "http://127.0.0.1:3773")).toEqual({
      config: {
        ingress: [
          { hostname: "studio-loom.begam.in", service: "http://127.0.0.1:3773" },
          { service: "http_status:404" },
        ],
      },
    });
  });
});

describe("reach hostnames", () => {
  it("slugs a computer's label", () => {
    expect(reachSlug("Kyle's MacBook Pro")).toBe("kyles-macbook-pro");
    expect(reachSlug("Kyle’s Mac")).toBe("kyles-mac");
    expect(reachSlug("Crème Brûlée")).toBe("creme-brulee");
    expect(reachSlug("  --Studio__Mac--  ")).toBe("studio-mac");
    expect(reachSlug("")).toBe("computer");
    expect(reachSlug("東京")).toBe("computer");
    expect(reachSlug("!!!")).toBe("computer");
    expect(reachSlug("a".repeat(50))).toBe("a".repeat(40));
    // A cap that lands on a separator drops it rather than ending the slug with `-`.
    expect(reachSlug(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
    // Runs collapse, so the IDNA prefix cannot come out of a label.
    expect(reachSlug("xn--studio")).toBe("xn-studio");
    expect(isReachSlug("xn--studio")).toBe(false);
    expect(isReachSlug("studio--mac")).toBe(false);
    expect(isReachSlug("-studio")).toBe(false);
    expect(isReachSlug("a".repeat(41))).toBe(false);
  });

  it("numbers collisions from 2 to 99 and holds reserved names back to attempt 2", () => {
    expect(reachHostname("studio", 1, ZONE)).toBe("studio-loom.begam.in");
    expect(reachHostname("studio", 2, ZONE)).toBe("studio-2-loom.begam.in");
    expect(reachHostname("studio", 99, ZONE)).toBe("studio-99-loom.begam.in");
    for (const attempt of [0, 100, 1.5, Number.NaN]) {
      expect(reachHostname("studio", attempt, ZONE)).toBeNull();
    }
    for (const slug of REACH_RESERVED_SLUGS) {
      expect(reachHostname(slug, 1, ZONE)).toBeNull();
      expect(reachHostname(slug, 2, ZONE)).toBe(`${slug}-2-loom.begam.in`);
    }
    expect(reachHostname("xn--studio", 1, ZONE)).toBeNull();
    expect(reachHostname("Studio", 1, ZONE)).toBeNull();
    expect(reachHostname("studio", 1, "Begam.in")).toBeNull();
  });

  it("only ever produces hostnames that pass the directory route rule", () => {
    const labels = ["Kyle's MacBook Pro", "東京", "a".repeat(80), "Library", "x", "9"];
    for (const label of labels) {
      for (let attempt = 1; attempt <= REACH_HOSTNAME_MAX_ATTEMPTS; attempt++) {
        for (const zone of [ZONE, "reach.example.co.uk"]) {
          const hostname = reachHostname(reachSlug(label), attempt, zone);
          if (hostname === null) continue;
          expect(isDirectoryRouteUrl(`https://${hostname}/`)).toBe(true);
          expect(isReachHostname(hostname)).toBe(true);
        }
      }
    }
  });

  it("recognizes only the hostnames a Library assigns, so the guard never takes another host", () => {
    expect(isReachHostname("studio-1-loom.begam.in")).toBe(true);
    for (const hostname of [
      "studio.tail1234.ts.net",
      "loom.begam.in",
      "studio-loom",
      "-loom.begam.in",
      "loom-loom.begam.in",
      "studio-loom.begam.in.",
      "Studio-loom.begam.in",
      "studio--loom.begam.in",
      "studio-loom.localhost",
      "studio-loom.127.0.0.1",
      // The guard compares Host without its port, so it would never match these.
      "studio-loom.begam.in:443",
      "studio-loom.begam.in/x",
      "",
    ]) {
      expect(isReachHostname(hostname), hostname).toBe(false);
    }
  });

  it("derives the Identity resource from the Library origin, lowercase with no trailing slash", () => {
    expect(reachResource("https://Loom.Begam.IN/", ENVIRONMENT_ID)).toBe(
      `https://loom.begam.in/computers/${ENVIRONMENT_ID}`,
    );
    expect(reachResource("https://loom.begam.in/api/loom/identity/callback", "env-1")).toBe(
      "https://loom.begam.in/computers/env-1",
    );
    expect(reachResource("https://loom.begam.in:8443", "env-1")).toBe(
      "https://loom.begam.in:8443/computers/env-1",
    );
    expect(reachResource("http://loom.begam.in", "env-1")).toBeNull();
    expect(reachResource("not a url", "env-1")).toBeNull();
    // Folding case would let one computer's id collide with another's.
    expect(reachResource(LIBRARY_URL, "Env-1")).toBeNull();
    expect(reachResource(LIBRARY_URL, "env/1")).toBeNull();
    expect(reachResource(LIBRARY_URL, "")).toBeNull();
  });
});
