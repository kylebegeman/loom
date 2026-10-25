import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ServerConfig, ServerDirectEndpoint } from "../server.ts";
import { DirectoryEnvironment, DirectoryEnvironmentReport, DirectoryError } from "./directory.ts";
import {
  ReachEnsureReply,
  ReachError,
  ReachFailureReply,
  ReachLibraryComputer,
  ReachLibraryError,
  ReachLoopbackOrigin,
  ReachRequestClaims,
  ReachStatus,
  hasExtraReachConnector,
} from "./reach.ts";

const decodeEndpoint = Schema.decodeUnknownSync(ServerDirectEndpoint);
const decodeEndpoints = Schema.decodeUnknownSync(
  Schema.Struct({ directEndpoints: ServerConfig.fields.directEndpoints }),
);
const decodeEnvironment = Schema.decodeUnknownSync(DirectoryEnvironment);
const decodeReport = Schema.decodeUnknownSync(DirectoryEnvironmentReport);
const decodeStatus = Schema.decodeUnknownSync(ReachStatus);
const decodeEnsureReply = Schema.decodeUnknownSync(ReachEnsureReply);
const decodeClaims = Schema.decodeUnknownSync(ReachRequestClaims);
const decodeFailure = Schema.decodeUnknownSync(ReachFailureReply);
const decodeLibraryComputer = Schema.decodeUnknownSync(ReachLibraryComputer);
const isLoopbackOrigin = Schema.is(ReachLoopbackOrigin);

const environment = {
  environmentId: "environment-a",
  label: "Studio",
  serverVersion: "0.0.0-test",
  platform: { os: "darwin", arch: "arm64" },
  supportsExecution: true,
  loomFeatures: ["reach"],
  routes: [{ kind: "public", url: "https://studio-loom.begam.in/" }],
  providers: [],
  sequence: 1,
  reportedAt: "2026-10-24T00:00:00.000Z",
  keyFingerprint: "a".repeat(64),
  firstSeenAt: "2026-10-24T00:00:00.000Z",
  receivedAt: "2026-10-24T00:00:00.000Z",
};

const status = {
  state: "connected",
  enabled: true,
  blocked: null,
  url: "https://studio-loom.begam.in/",
  message: null,
  warnings: ["passkey-not-required"],
  prepared: null,
};

const ensureReply = {
  hostname: "studio-loom.begam.in",
  url: "https://studio-loom.begam.in/",
  origin: "http://127.0.0.1:3773",
  connectorToken: "eyJhIjoiYWNjb3VudCJ9",
  edge: { allowlist: "ready", rateLimit: "occupied" },
  identity: {
    state: "ready",
    issuer: "https://id.loom.begam.in",
    nativeClientId: "loom-library-native",
    resource: "https://loom.begam.in/computers/environment-a",
  },
};

describe("direct endpoints", () => {
  it("decodes a public reach address", () => {
    expect(
      decodeEndpoint({ kind: "public", httpBaseUrl: "https://studio-loom.begam.in" }).kind,
    ).toBe("public");
  });

  it("drops an endpoint kind this client does not know instead of failing the config", () => {
    const decoded = decodeEndpoints({
      directEndpoints: [
        { kind: "tailnet", httpBaseUrl: "https://studio.example.ts.net" },
        { kind: "satellite", httpBaseUrl: "https://studio.example.com" },
        { kind: "public", httpBaseUrl: "https://studio-loom.begam.in" },
      ],
    });
    expect(decoded.directEndpoints?.map((endpoint) => endpoint.kind)).toEqual([
      "tailnet",
      "public",
    ]);
  });
});

describe("directory attestation", () => {
  it("decodes listings from Libraries with and without an attested resource", () => {
    expect(decodeEnvironment(environment)).not.toHaveProperty("identityResource");
    const resource = "https://loom.begam.in/computers/environment-a";
    expect(decodeEnvironment({ ...environment, identityResource: resource }).identityResource).toBe(
      resource,
    );
  });

  it("never takes the resource from a computer's own report", () => {
    const { keyFingerprint: _k, firstSeenAt: _f, receivedAt: _r, ...report } = environment;
    const decoded = decodeReport({ ...report, identityResource: "https://attacker.example.com" });
    expect(decoded).not.toHaveProperty("identityResource");
  });

  it("explains a forget refused while reach is active", () => {
    const message = new DirectoryError({ reason: "reach-active" }).message;
    expect(message).toContain("Retire");
    expect(message).not.toContain("—");
  });
});

describe("reach status", () => {
  it("drops warnings a newer computer adds", () => {
    const decoded = decodeStatus({
      ...status,
      warnings: ["passkey-not-required", "some-future-warning"],
    });
    expect(decoded.warnings).toEqual(["passkey-not-required"]);
  });

  it("has nowhere to carry a connector token", () => {
    const decoded = decodeStatus({ ...status, connectorToken: "secret" });
    expect(decoded).not.toHaveProperty("connectorToken");
  });

  it("writes every error line without an em dash", () => {
    const reasons = ["unavailable", "library-not-ready", "library", "busy", "storage"] as const;
    for (const reason of reasons) {
      expect(new ReachError({ reason }).message).not.toContain("—");
    }
    const libraryReasons = [
      "not-authority",
      "not-configured",
      "not-found",
      "cloudflare-denied",
      "cloudflare-limited",
      "cloudflare-unavailable",
      "tunnel-busy",
      "io",
    ] as const;
    for (const reason of libraryReasons) {
      expect(new ReachLibraryError({ reason }).message).not.toContain("—");
    }
  });
});

describe("Library wire", () => {
  it("accepts only loopback ingress origins", () => {
    for (const origin of ["http://127.0.0.1:3773", "http://[::1]:1", "http://127.0.0.1:65535"]) {
      expect(isLoopbackOrigin(origin)).toBe(true);
    }
    for (const origin of [
      "http://127.0.0.1:65536",
      "http://127.0.0.1:0",
      "http://127.0.0.1:03773",
      "http://localhost:3773",
      "http://10.0.0.2:3773",
      "https://127.0.0.1:3773",
      "http://127.0.0.1:3773/",
      "http://127.0.0.1",
      "unix:/var/run/docker.sock",
    ]) {
      expect(isLoopbackOrigin(origin)).toBe(false);
    }
  });

  it("requires an integer sequence", () => {
    expect(decodeClaims({ action: "remove", seq: 12 })).toEqual({ action: "remove", seq: 12 });
    expect(() => decodeClaims({ action: "remove", seq: 1.5 })).toThrow();
    expect(() => decodeClaims({ action: "remove", seq: 0 })).toThrow();
    expect(() => decodeClaims({ action: "rotate", seq: 1 })).toThrow();
  });

  it("decodes each identity outcome of an ensure", () => {
    expect(decodeEnsureReply(ensureReply).identity.state).toBe("ready");
    expect(
      decodeEnsureReply({ ...ensureReply, identity: { state: "not-configured" } }).identity,
    ).toEqual({ state: "not-configured" });
    expect(
      decodeEnsureReply({ ...ensureReply, identity: { state: "failed", reason: "denied" } })
        .identity,
    ).toEqual({ state: "failed", reason: "denied" });
    expect(() =>
      decodeEnsureReply({ ...ensureReply, edge: { allowlist: "failed", rateLimit: "ready" } }),
    ).toThrow();
    expect(() => decodeEnsureReply({ ...ensureReply, origin: "http://10.0.0.2:3773" })).toThrow();
  });

  it("decodes a failure with and without a retry hint", () => {
    expect(decodeFailure({ reason: "key-changed" })).toEqual({ reason: "key-changed" });
    expect(decodeFailure({ reason: "too-many-requests", retryAfterSeconds: 60 })).toEqual({
      reason: "too-many-requests",
      retryAfterSeconds: 60,
    });
  });
});

describe("Library admin listing", () => {
  const computer = decodeLibraryComputer({
    environmentId: "environment-a",
    label: "Studio",
    hostname: "studio-loom.begam.in",
    state: "removed-with-leftover",
    lastError: null,
    connection: "down",
    connectors: 2,
    leftoverDnsRecordId: "372e67954025e0ba6aaa6d586b9e0b59",
    identity: null,
    signIn: "ended",
    updatedAt: "2026-10-24T00:00:00.000Z",
    lastEnsuredAt: null,
  });

  it("keeps a leftover record for the operator", () => {
    expect(computer.state).toBe("removed-with-leftover");
    expect(computer.leftoverDnsRecordId).toBe("372e67954025e0ba6aaa6d586b9e0b59");
  });

  it("flags more than one connector as extra", () => {
    expect(hasExtraReachConnector(computer)).toBe(true);
    expect(hasExtraReachConnector({ connectors: 1 })).toBe(false);
    expect(hasExtraReachConnector({ connectors: null })).toBe(false);
  });
});
