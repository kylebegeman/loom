import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DirectoryEnvironmentReport, DirectoryError, LoomOsIdentityPayload } from "./directory.ts";

const decodeReport = Schema.decodeUnknownSync(DirectoryEnvironmentReport);
const decodeIdentity = Schema.decodeUnknownSync(LoomOsIdentityPayload);

const report = {
  environmentId: "environment-a",
  label: "Studio",
  serverVersion: "0.0.0-test",
  platform: { os: "darwin", arch: "arm64" },
  supportsExecution: true,
  loomFeatures: ["core"],
  routes: [{ kind: "public", url: "https://loom.example.com/" }],
  providers: [{ id: "codex", status: "ready" }],
  sequence: 1,
  reportedAt: "2026-10-18T00:00:00.000Z",
};

const identity = {
  schema_version: 1,
  release: { version: "0.1.7", roles: ["worker"] },
  installation_id: null,
  boot_id: null,
  hostname: "loom-worker",
  machine_key: { algorithm: "ed25519", public_key: "placeholder", fingerprint: "a".repeat(64) },
  issued_at: "2026-10-18T12:00:00Z",
};

describe("DirectoryEnvironmentReport", () => {
  it("decodes a report from a newer computer and drops what it does not know", () => {
    const decoded = decodeReport({ ...report, uptimeSeconds: 12, workers: [] });
    expect(decoded).not.toHaveProperty("uptimeSeconds");
    expect(decoded.workers).toEqual([]);
  });

  it("bounds what one report can carry", () => {
    const route = report.routes[0];
    const provider = report.providers[0];
    expect(() =>
      decodeReport({ ...report, routes: Array.from({ length: 9 }, () => route) }),
    ).toThrow();
    expect(() =>
      decodeReport({ ...report, providers: Array.from({ length: 17 }, () => provider) }),
    ).toThrow();
    const worker = { payload: "{}", signature: "sig", public_key: "key" };
    expect(() =>
      decodeReport({ ...report, workers: Array.from({ length: 9 }, () => worker) }),
    ).toThrow();
    expect(() => decodeReport({ ...report, sequence: -1 })).toThrow();
    expect(() =>
      decodeReport({ ...report, routes: [{ kind: "lan", url: "https://a.b/" }] }),
    ).toThrow();
  });
});

describe("LoomOsIdentityPayload", () => {
  it("ignores unknown LoomOS keys and treats optional ones as absent", () => {
    const decoded = decodeIdentity({ ...identity, kernel: "6.1.0" });
    expect(decoded).not.toHaveProperty("kernel");
    expect(decoded.tailnet_name).toBeUndefined();
  });

  it("refuses other schema versions and fingerprints that are not SHA-256 hex", () => {
    expect(() => decodeIdentity({ ...identity, schema_version: 2 })).toThrow();
    const machineKey = { ...identity.machine_key, fingerprint: "A".repeat(64) };
    expect(() => decodeIdentity({ ...identity, machine_key: machineKey })).toThrow();
  });
});

describe("DirectoryError", () => {
  it("explains a changed key without repeating the cause", () => {
    const error = new DirectoryError({ reason: "key-changed", cause: "token detail" });
    expect(error.message).toContain("Forget the computer");
    expect(error.message).not.toContain("token detail");
  });
});
