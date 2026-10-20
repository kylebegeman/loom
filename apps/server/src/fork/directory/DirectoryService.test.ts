// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no Ed25519 key generation.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  DirectoryEnvironmentReport,
  type DirectoryError,
  type DirectoryListing,
  type LoomOsSignedIdentity,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { directoryPublicKeyFromPem, signDirectoryReport } from "@t3tools/shared/fork/directory";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import {
  ServerEnvironment,
  ServerEnvironmentIdentity,
} from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLibraryMigrations } from "../project-library/migrations.ts";
import * as Directory from "./DirectoryService.ts";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const LIBRARY = "https://library.example.com";
const AUTHORITY = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_REDIRECT_URI: `${LIBRARY}/api/auth/identity/callback`,
};
const STUDIO = EnvironmentId.make("environment-studio");
const LAPTOP = EnvironmentId.make("environment-laptop");
const LIBRARY_ID = EnvironmentId.make("environment-library");

/** Signed the LoomOS way with OpenSSL; copied from the shared directory tests. */
const WORKER: LoomOsSignedIdentity = {
  payload:
    '{"boot_id": "00000000-0000-4000-8000-000000000000", "hostname": "loom-worker", "installation_id": "fdd89fe94a7d2b2f6c8001d393810fb363bfa958f87e755d73186f3b91c4dfe7", "issued_at": "2026-10-18T12:00:00Z", "machine_key": {"algorithm": "ed25519", "fingerprint": "4f9b610da2f63797e91ca40cc68ec3405f055398c7fba8453ba5f8606113ea02", "public_key": "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng="}, "release": {"roles": ["worker"], "runtime_sha256": "1111111111111111111111111111111111111111111111111111111111111111", "runtime_version": "0.1.7", "schema_version": 1, "source_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000", "target": "orangepi5pro", "version": "0.1.7"}, "schema_version": 1, "ssh_host_key_fingerprints": ["SHA256:w4x0WyTLW4nOnsWeMLTOBCl3KFlC8AWI+p1Rj6+Ifzo"], "tailnet_name": "worker.example.ts.net"}\n',
  signature:
    "e0QDlRdh0LU/UGN35Y+llNRK5maJ4rvNGkv8i3fLkZ7RbkoojK+d6hxdec+g9wutzPYIljoxJlN9+FHssVFoDQ==",
  public_key: "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=",
};
const WORKER_FINGERPRINT = "4f9b610da2f63797e91ca40cc68ec3405f055398c7fba8453ba5f8606113ea02";

const keyPair = () => {
  const pair = NodeCrypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const publicKey = directoryPublicKeyFromPem(pair.publicKey);
  if (publicKey === null) throw new Error("Expected an Ed25519 public key.");
  return { privateKey: pair.privateKey, publicKey };
};
const studioKey = keyPair();
const laptopKey = keyPair();
const machineKey = keyPair();
const MACHINE_FINGERPRINT = NodeCrypto.createHash("sha256")
  .update(Buffer.from(machineKey.publicKey, "base64"))
  .digest("hex");

/** A LoomOS identity for `machineKey`, signed over the payload bytes as LoomOS does. */
const identityOf = (hostname: string, issuedAt: string): LoomOsSignedIdentity => {
  const payload = JSON.stringify({
    schema_version: 1,
    release: null,
    installation_id: "installation-1",
    boot_id: null,
    hostname,
    machine_key: {
      algorithm: "ed25519",
      public_key: machineKey.publicKey,
      fingerprint: MACHINE_FINGERPRINT,
    },
    issued_at: issuedAt,
  });
  return {
    payload,
    signature: NodeCrypto.sign(null, Buffer.from(payload), machineKey.privateKey).toString(
      "base64",
    ),
    public_key: machineKey.publicKey,
  };
};

const decodeReport = Schema.decodeSync(DirectoryEnvironmentReport);
const reportOf = (
  overrides: Partial<DirectoryEnvironmentReport> = {},
): DirectoryEnvironmentReport =>
  decodeReport({
    environmentId: STUDIO,
    label: "Studio",
    serverVersion: "0.0.0-test",
    platform: { os: "darwin", arch: "arm64" },
    supportsExecution: true,
    loomFeatures: ["core"],
    routes: [{ kind: "tailnet", url: "https://computer.example.ts.net/" }],
    providers: [{ id: "codex", status: "ready" }],
    sequence: NOW,
    reportedAt: "2026-10-20T12:00:00.000Z",
    ...overrides,
  });

const signed = (
  report: DirectoryEnvironmentReport,
  options: { readonly key?: ReturnType<typeof keyPair>; readonly audience?: string } = {},
) =>
  Effect.gen(function* () {
    const key = options.key ?? studioKey;
    const now = yield* Clock.currentTimeMillis;
    const token = yield* signDirectoryReport({
      privateKey: key.privateKey,
      report,
      audience: options.audience ?? LIBRARY,
      nowEpochSeconds: now / 1000,
    });
    return { token, publicKey: key.publicKey };
  });

const reasonOf = <A>(effect: Effect.Effect<A, DirectoryError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

interface Options {
  readonly env?: Record<string, string>;
  /** Answers the Library's list route for a computer that forwards. */
  readonly library?: (url: string) => Response;
  /** Describes this computer, so the authority lists itself. */
  readonly describe?: boolean;
}

const run = <A, E>(
  options: Options,
  use: (
    directory: Directory.DirectoryService["Service"],
    logs: ReadonlyArray<string>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const logs: Array<string> = [];
    const logger = Logger.make(({ message }) => {
      logs.push(JSON.stringify(message));
    });
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        expect(request.headers.authorization).toBe("Bearer computer-token");
        const answer = options.library?.(request.url) ?? new Response(null, { status: 404 });
        return HttpClientResponse.fromWeb(request, answer);
      }),
    );
    const descriptor = Layer.mock(ServerEnvironment)({
      getDescriptor: Effect.succeed({
        environmentId: LIBRARY_ID,
        label: "Library",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.0.0-test",
        capabilities: {
          repositoryIdentity: true,
          supportsExecution: false,
          loomFeatures: ["core", "directory"],
        },
      }),
    });
    const context = yield* Layer.build(
      Directory.layer.pipe(
        Layer.provide(options.describe === true ? descriptor : Layer.empty),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env ?? AUTHORITY })),
        ),
        Layer.provide(Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
    return yield* use(Context.get(context, Directory.DirectoryService), logs).pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
    );
  }).pipe(
    Effect.provideService(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(STUDIO) }),
    Effect.provide(ServerSecretStore.layer),
    // No enrolled computer lives here, so a forwarding computer reads its Library from the env.
    Effect.provideServiceEffect(
      HostProcess.HomeDirectory,
      Effect.map(ServerConfig.ServerConfig, (config) => config.baseDir),
    ),
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "directory-service-test-" }),
        layerMemory,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.scoped,
  );

describe("DirectoryService", () => {
  it.effect("keeps one record per computer with its newest routes, dropping IP routes", () =>
    run({}, (directory) =>
      Effect.gen(function* () {
        const first = yield* directory.report({
          environmentId: STUDIO,
          request: yield* signed(reportOf()),
        });
        expect(first.firstSeenAt).toBe("2026-10-20T12:00:00.000Z");
        yield* TestClock.adjust("1 minute");
        const second = yield* directory.report({
          environmentId: STUDIO,
          request: yield* signed(
            reportOf({
              sequence: NOW + 60_000,
              routes: [
                { kind: "public", url: "https://studio.example.com/" },
                { kind: "tailnet", url: "https://100.64.0.7/" },
              ],
            }),
          ),
        });
        expect(second.routes).toEqual([{ kind: "public", url: "https://studio.example.com/" }]);
        const listing = yield* directory.list;
        expect(listing.environments).toHaveLength(1);
        expect(listing.environments[0]).toMatchObject({
          environmentId: STUDIO,
          routes: [{ kind: "public", url: "https://studio.example.com/" }],
          firstSeenAt: "2026-10-20T12:00:00.000Z",
          receivedAt: "2026-10-20T12:01:00.000Z",
        });
      }),
    ),
  );

  it.effect("refuses reports it cannot trust and never logs their tokens", () =>
    run({}, (directory, logs) =>
      Effect.gen(function* () {
        const request = yield* signed(reportOf());
        yield* directory.report({ environmentId: STUDIO, request });

        // Signed by Studio, sent on Laptop's publisher session.
        expect(yield* reasonOf(directory.report({ environmentId: LAPTOP, request }))).toBe(
          "wrong-environment",
        );
        expect(yield* reasonOf(directory.report({ environmentId: STUDIO, request }))).toBe(
          "stale-sequence",
        );
        const otherKey = keyPair();
        const rekeyed = yield* signed(reportOf({ sequence: NOW + 1 }), { key: otherKey });
        expect(yield* reasonOf(directory.report({ environmentId: STUDIO, request: rekeyed }))).toBe(
          "key-changed",
        );
        const elsewhere = yield* signed(reportOf({ sequence: NOW + 2 }), {
          audience: "https://other.example.com",
        });
        expect(
          yield* reasonOf(directory.report({ environmentId: STUDIO, request: elsewhere })),
        ).toBe("unverified");
        expect(
          yield* reasonOf(
            directory.report({
              environmentId: STUDIO,
              request: { token: request.token, publicKey: "not-a-key" },
            }),
          ),
        ).toBe("invalid");
        const late = yield* signed(reportOf({ sequence: NOW + 3 }));
        yield* TestClock.adjust("10 minutes");
        expect(yield* reasonOf(directory.report({ environmentId: STUDIO, request: late }))).toBe(
          "unverified",
        );

        expect(logs.filter((line) => line.includes("refused a report"))).toHaveLength(6);
        for (const token of [request.token, rekeyed.token, elsewhere.token, late.token])
          expect(logs.some((line) => line.includes(token))).toBe(false);
        expect((yield* directory.list).environments[0]?.sequence).toBe(NOW);
      }),
    ),
  );

  it.effect("pins a new key once the old record is forgotten", () =>
    run({}, (directory) =>
      Effect.gen(function* () {
        yield* directory.report({ environmentId: STUDIO, request: yield* signed(reportOf()) });
        const replacement = keyPair();
        const rekeyed = yield* signed(reportOf({ sequence: NOW + 1 }), { key: replacement });
        expect(yield* reasonOf(directory.report({ environmentId: STUDIO, request: rekeyed }))).toBe(
          "key-changed",
        );
        yield* directory.forget({ kind: "environment", environmentId: STUDIO });
        expect(
          yield* reasonOf(directory.forget({ kind: "environment", environmentId: STUDIO })),
        ).toBe("not-found");
        const stored = yield* directory.report({ environmentId: STUDIO, request: rekeyed });
        const listing = yield* directory.list;
        expect(listing.environments.map((environment) => environment.keyFingerprint)).toEqual([
          stored.keyFingerprint,
        ]);
      }),
    ),
  );

  it.effect("lists verified worker identities as machines and skips forged ones", () =>
    run({}, (directory, logs) =>
      Effect.gen(function* () {
        const forged = { ...WORKER, payload: WORKER.payload.replace("loom-worker", "loom-forged") };
        const stored = yield* directory.report({
          environmentId: STUDIO,
          request: yield* signed(reportOf({ workers: [WORKER, forged] })),
        });
        expect("workers" in stored).toBe(false);
        const listing: DirectoryListing = yield* directory.list;
        expect(listing.machines).toEqual([
          {
            keyFingerprint: WORKER_FINGERPRINT,
            installationId: "fdd89fe94a7d2b2f6c8001d393810fb363bfa958f87e755d73186f3b91c4dfe7",
            hostname: "loom-worker",
            tailnetName: "worker.example.ts.net",
            release: {
              roles: ["worker"],
              runtime_version: "0.1.7",
              target: "orangepi5pro",
              version: "0.1.7",
            },
            sshHostKeyFingerprints: ["SHA256:w4x0WyTLW4nOnsWeMLTOBCl3KFlC8AWI+p1Rj6+Ifzo"],
            reportedBy: STUDIO,
            firstSeenAt: "2026-10-18T12:00:00.000Z",
            lastSeenAt: "2026-10-18T12:00:00.000Z",
          },
        ]);
        expect(logs.filter((line) => line.includes("skipped a worker identity"))).toHaveLength(1);
        expect(logs.some((line) => line.includes("loom-forged"))).toBe(false);

        yield* directory.forget({ kind: "machine", keyFingerprint: WORKER_FINGERPRINT });
        expect((yield* directory.list).machines).toEqual([]);
      }),
    ),
  );

  it.effect("updates a known machine only from a newer identity, whoever reports it", () =>
    run({}, (directory, logs) =>
      Effect.gen(function* () {
        const older = identityOf("loom-old", "2026-10-20T11:00:00Z");
        yield* directory.report({
          environmentId: STUDIO,
          request: yield* signed(reportOf({ workers: [older] })),
        });
        yield* directory.report({
          environmentId: LAPTOP,
          request: yield* signed(
            reportOf({
              environmentId: LAPTOP,
              workers: [
                identityOf("loom-new", "2026-10-20T11:30:00Z"),
                identityOf("loom-garbled", "not-a-date"),
                identityOf("loom-ahead", "2026-10-20T13:00:00Z"),
              ],
            }),
            { key: laptopKey },
          ),
        });
        // A replay of the older identity changes nothing.
        yield* directory.report({
          environmentId: STUDIO,
          request: yield* signed(reportOf({ sequence: NOW + 1, workers: [older] })),
        });
        expect((yield* directory.list).machines).toEqual([
          {
            keyFingerprint: MACHINE_FINGERPRINT,
            installationId: "installation-1",
            hostname: "loom-new",
            release: null,
            reportedBy: LAPTOP,
            firstSeenAt: "2026-10-20T11:00:00.000Z",
            lastSeenAt: "2026-10-20T11:30:00.000Z",
          },
        ]);
        expect(logs.filter((line) => line.includes("skipped a worker identity"))).toHaveLength(2);
      }),
    ),
  );

  it.effect("lists the authority itself first", () =>
    run({ describe: true }, (directory) =>
      Effect.gen(function* () {
        yield* directory.report({ environmentId: STUDIO, request: yield* signed(reportOf()) });
        const listing = yield* directory.list;
        expect(listing.environments.map((environment) => environment.environmentId)).toEqual([
          LIBRARY_ID,
          STUDIO,
        ]);
        expect(listing.environments[0]).toMatchObject({
          label: "Library",
          supportsExecution: false,
          providers: [],
          routes: [{ kind: "public", url: LIBRARY }],
        });
      }),
    ),
  );

  it.effect("runs only on a Library authority with a public https identity callback", () =>
    Effect.gen(function* () {
      for (const env of [
        {},
        { LOOM_LIBRARY_AUTHORITY: "true" },
        {
          LOOM_LIBRARY_AUTHORITY: "true",
          LOOM_IDENTITY_REDIRECT_URI: "http://library.example.com/cb",
        },
      ]) {
        yield* run({ env }, (directory) =>
          Effect.gen(function* () {
            const request = yield* signed(reportOf());
            expect(yield* reasonOf(directory.report({ environmentId: STUDIO, request }))).toBe(
              "not-authority",
            );
            expect(yield* reasonOf(directory.list)).toBe("not-authority");
            expect(
              yield* reasonOf(directory.forget({ kind: "environment", environmentId: STUDIO })),
            ).toBe("not-authority");
            expect(yield* reasonOf(directory.computers)).toBe("not-authority");
          }),
        );
      }
    }),
  );

  it.effect("asks the Library for computers when this computer is not the authority", () => {
    const computer = { LOOM_LIBRARY_URL: LIBRARY, LOOM_LIBRARY_TOKEN: "computer-token" };
    const listing = {
      environments: [],
      machines: [],
      generatedAt: "2026-10-20T12:00:00.000Z",
    } satisfies DirectoryListing;
    return Effect.gen(function* () {
      const asked: Array<string> = [];
      yield* run(
        {
          env: computer,
          library: (url) => {
            asked.push(url);
            return Response.json(listing);
          },
        },
        (directory) =>
          Effect.gen(function* () {
            expect(yield* directory.computers).toEqual(listing);
            expect(yield* reasonOf(directory.list)).toBe("not-authority");
          }),
      );
      expect(asked).toEqual([`${LIBRARY}/api/loom/directory/list`]);
      yield* run(
        {
          env: computer,
          library: () =>
            new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
        },
        (directory) =>
          Effect.gen(function* () {
            expect(yield* reasonOf(directory.computers)).toBe("not-authority");
          }),
      );
      yield* run(
        { env: computer, library: () => Response.json({ reason: "io" }, { status: 503 }) },
        (directory) =>
          Effect.gen(function* () {
            expect(yield* reasonOf(directory.computers)).toBe("io");
          }),
      );
    });
  });
});
