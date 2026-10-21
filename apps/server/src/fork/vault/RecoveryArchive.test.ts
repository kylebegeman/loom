// @effect-diagnostics nodeBuiltinImport:off -- Real disposable files and crypto verify the operator archive boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as RecoveryArchive from "./RecoveryArchive.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => NodeFSP.rm(path, { recursive: true, force: true })),
  );
});
const io = Effect.promise;
const cli = (root: string, args: string[], timeout = 30000) =>
  io(
    () =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = NodeChildProcess.spawn(
          process.execPath,
          [
            NodeURL.fileURLToPath(new URL("../../bin.ts", import.meta.url)),
            "vault",
            "recovery",
            ...args,
          ],
          {
            cwd: root,
            env: { PATH: "/usr/bin:/bin", NO_COLOR: "1", HOME: root },
            stdio: ["ignore", "pipe", "pipe"],
            timeout,
            killSignal: "SIGKILL",
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (part) => {
          stdout += part;
        });
        child.stderr.on("data", (part) => {
          stderr += part;
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr }));
      }),
  );

const run = <A>(
  use: (
    service: RecoveryArchive.RecoveryArchive["Service"],
  ) => Effect.Effect<A, RecoveryArchive.RecoveryArchiveError>,
) =>
  Effect.flatMap(RecoveryArchive.RecoveryArchive, use).pipe(Effect.provide(RecoveryArchive.layer));
const setup = Effect.gen(function* () {
  const f = yield* io(async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-vault-recovery-"));
    directories.push(root);
    const keyFile = NodePath.join(root, "recovery.key"),
      snapshotFile = NodePath.join(root, "snapshot.bin"),
      archiveFile = NodePath.join(root, "vault.archive");
    const bytes = Buffer.concat([
      Buffer.from("synthetic-snapshot-secret-canary"),
      NodeCrypto.randomBytes(3 * 1024 * 1024),
    ]);
    await NodeFSP.writeFile(snapshotFile, bytes, { mode: 0o600 });
    return {
      root,
      keyFile,
      snapshotFile,
      archiveFile,
      bytes,
      input: { keyFile, archiveFile, environmentId: "isolated-proof" },
    };
  });
  yield* run((service) => service.createKey(f.keyFile));
  return f;
});
const refused = <A>(effect: Effect.Effect<A, RecoveryArchive.RecoveryArchiveError>) =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(effect);
    expect(error.message).toContain("Vault archive operation refused");
    expect(JSON.stringify(error)).not.toContain("secret-canary");
  });

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("POSIX archive boundary", () => {
  it.live(
    "authenticates a streaming snapshot and recovers exact bytes without claiming backend restore or promotion",
    () =>
      Effect.gen(function* () {
        const f = yield* setup;
        const sealed = yield* run((service) =>
          service.seal({ ...f.input, snapshotFile: f.snapshotFile }),
        );
        expect(sealed).toMatchObject({
          version: 1,
          environmentId: "isolated-proof",
          snapshotBytes: f.bytes.length,
          snapshotSha256: NodeCrypto.createHash("sha256").update(f.bytes).digest("hex"),
          authenticated: true,
          backendRestoreVerified: false,
          canPromote: false,
        });
        const archive = yield* io(() => NodeFSP.readFile(f.archiveFile));
        expect(archive.includes(Buffer.from("secret-canary"))).toBe(false);
        expect(archive.includes(Buffer.from("isolated-proof"))).toBe(false);
        expect(archive.includes(Buffer.from(sealed.snapshotSha256))).toBe(false);
        expect(yield* run((service) => service.verify(f.input))).toEqual(sealed);
        const restored = NodePath.join(f.root, "recovered.snapshot");
        expect(
          yield* run((service) => service.unseal({ ...f.input, snapshotFile: restored })),
        ).toEqual(sealed);
        expect(yield* io(() => NodeFSP.readFile(restored))).toEqual(f.bytes);
        for (const path of [restored, f.archiveFile, f.keyFile])
          expect((yield* io(() => NodeFSP.stat(path))).mode & 0o777).toBe(0o600);
      }),
  );

  it.live.each([0, 12, 50, 80, 8192, -1])(
    "refuses tampering at byte %s without publishing plaintext",
    (at) =>
      Effect.gen(function* () {
        const f = yield* setup;
        yield* run((service) => service.seal({ ...f.input, snapshotFile: f.snapshotFile }));
        yield* io(async () => {
          const bytes = await NodeFSP.readFile(f.archiveFile);
          const offset = at < 0 ? bytes.length + at : at;
          bytes[offset] = bytes[offset]! ^ 1;
          await NodeFSP.writeFile(f.archiveFile, bytes);
        });
        yield* refused(
          run((service) =>
            service.unseal({ ...f.input, snapshotFile: NodePath.join(f.root, "must-not-exist") }),
          ),
        );
        expect((yield* io(() => NodeFSP.readdir(f.root))).sort()).toEqual([
          "recovery.key",
          "snapshot.bin",
          "vault.archive",
        ]);
      }),
  );

  it.live("refuses wrong keys/environments and never overwrites existing files", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      yield* run((service) => service.seal({ ...f.input, snapshotFile: f.snapshotFile }));
      const other = NodePath.join(f.root, "other.key");
      yield* run((service) => service.createKey(other));
      yield* refused(run((service) => service.verify({ ...f.input, keyFile: other })));
      yield* refused(
        run((service) => service.verify({ ...f.input, environmentId: "another-environment" })),
      );
      yield* refused(
        run((service) => service.unseal({ ...f.input, snapshotFile: f.snapshotFile })),
      );
      expect(yield* io(() => NodeFSP.readFile(f.snapshotFile))).toEqual(f.bytes);
      yield* refused(run((service) => service.createKey(f.keyFile)));
      expect((yield* io(() => NodeFSP.stat(f.keyFile))).size).toBe(32);
      expect((yield* io(() => NodeFSP.readdir(f.root))).some((name) => name.endsWith(".tmp"))).toBe(
        false,
      );
    }),
  );

  it.live("refuses truncated archives and appended bytes", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      yield* run((service) => service.seal({ ...f.input, snapshotFile: f.snapshotFile }));
      const original = yield* io(() => NodeFSP.readFile(f.archiveFile));
      for (const changed of [
        original.subarray(0, 8),
        original.subarray(0, original.length - 1),
        Buffer.concat([original, Buffer.from("extra")]),
      ]) {
        yield* io(() => NodeFSP.writeFile(f.archiveFile, changed));
        yield* refused(run((service) => service.verify(f.input)));
      }
    }),
  );

  it.live("requires an owner-only 32-byte key and private snapshot; refuses symlinks", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      for (const path of [f.keyFile, f.snapshotFile]) {
        yield* io(() => NodeFSP.chmod(path, 0o644));
        yield* refused(
          run((service) => service.seal({ ...f.input, snapshotFile: f.snapshotFile })),
        );
        yield* io(() => NodeFSP.chmod(path, 0o600));
        const link = NodePath.join(f.root, "input-link");
        yield* io(() => NodeFSP.symlink(path, link));
        yield* refused(
          run((service) =>
            service.seal({
              ...f.input,
              keyFile: path === f.keyFile ? link : f.keyFile,
              snapshotFile: path === f.snapshotFile ? link : f.snapshotFile,
            }),
          ),
        );
        yield* io(() => NodeFSP.unlink(link));
      }
      for (const length of [0, 31, 33, 4096]) {
        yield* io(() => NodeFSP.writeFile(f.keyFile, Buffer.alloc(length)));
        yield* refused(
          run((service) => service.seal({ ...f.input, snapshotFile: f.snapshotFile })),
        );
      }
      expect((yield* io(() => NodeFSP.readdir(f.root))).some((name) => name.endsWith(".tmp"))).toBe(
        false,
      );
    }),
  );

  it.live("refuses a symlink output without touching its target", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      yield* io(() => NodeFSP.symlink(f.snapshotFile, f.archiveFile));
      yield* refused(run((service) => service.seal({ ...f.input, snapshotFile: f.snapshotFile })));
      expect(yield* io(() => NodeFSP.readFile(f.snapshotFile))).toEqual(f.bytes);
      expect((yield* io(() => NodeFSP.lstat(f.archiveFile))).isSymbolicLink()).toBe(true);
      expect((yield* io(() => NodeFSP.readdir(f.root))).some((name) => name.endsWith(".tmp"))).toBe(
        false,
      );
    }),
  );

  it.live("refuses empty snapshots and invalid environment ids", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      yield* io(() => NodeFSP.writeFile(f.snapshotFile, Buffer.alloc(0)));
      yield* refused(run((service) => service.seal({ ...f.input, snapshotFile: f.snapshotFile })));
      yield* refused(
        run((service) =>
          service.seal({ ...f.input, environmentId: "bad\nid", snapshotFile: f.snapshotFile }),
        ),
      );
    }),
  );

  // Independently construct authenticated malformed archives to exercise the decoder, not just GCM.
  it.live("refuses authenticated invalid manifests and snapshot-length/hash mismatches", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      const manifest = {
        version: 1,
        environmentId: f.input.environmentId,
        createdAt: "2026-10-20T00:00:00.000Z",
        snapshotBytes: f.bytes.length,
        snapshotSha256: NodeCrypto.createHash("sha256").update(f.bytes).digest("hex"),
      };
      const variants = [
        Buffer.from("not-json"),
        Buffer.from(JSON.stringify({ ...manifest, version: 2 })),
        Buffer.from(JSON.stringify({ ...manifest, createdAt: "invalid" })),
        Buffer.from(JSON.stringify({ ...manifest, snapshotBytes: 0 })),
        Buffer.from(JSON.stringify({ ...manifest, snapshotBytes: Number.MAX_SAFE_INTEGER + 1 })),
        Buffer.from(JSON.stringify({ ...manifest, snapshotBytes: f.bytes.length + 1 })),
        Buffer.from(JSON.stringify({ ...manifest, snapshotBytes: f.bytes.length - 1 })),
        Buffer.from(JSON.stringify({ ...manifest, snapshotSha256: "a".repeat(64) })),
        Buffer.alloc(4097, 0x20),
        Buffer.alloc(0),
      ];
      for (const metadata of variants) {
        yield* io(async () => {
          const key = await NodeFSP.readFile(f.keyFile);
          const salt = NodeCrypto.randomBytes(32),
            nonce = NodeCrypto.randomBytes(12);
          const header = Buffer.concat([Buffer.from("LOOMVAULT1\n"), salt, nonce]);
          const derived = Buffer.from(
            NodeCrypto.hkdfSync(
              "sha256",
              key,
              salt,
              Buffer.from("Loom Vault recovery archive v1"),
              32,
            ),
          );
          const cipher = NodeCrypto.createCipheriv("aes-256-gcm", derived, nonce);
          cipher.setAAD(header);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(metadata.length);
          await NodeFSP.writeFile(
            f.archiveFile,
            Buffer.concat([
              header,
              cipher.update(Buffer.concat([length, metadata, f.bytes])),
              cipher.final(),
              cipher.getAuthTag(),
            ]),
            { mode: 0o600 },
          );
          key.fill(0);
          derived.fill(0);
        });
        yield* refused(
          run((service) =>
            service.unseal({ ...f.input, snapshotFile: NodePath.join(f.root, "must-not-exist") }),
          ),
        );
        expect((yield* io(() => NodeFSP.readdir(f.root))).sort()).toEqual([
          "recovery.key",
          "snapshot.bin",
          "vault.archive",
        ]);
      }
    }),
  );

  it.live("runs recovery offline through the CLI from outside the repository", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      const key = NodePath.join(f.root, "cli.key");
      expect((yield* cli(f.root, ["key-create", key])).code).toBe(0);
      const flags = ["--key-file", key, "--environment-id", f.input.environmentId];
      const sealed = yield* cli(f.root, ["seal", f.snapshotFile, f.archiveFile, ...flags]);
      expect(sealed.code).toBe(0);
      const summary = JSON.parse(sealed.stdout);
      expect(summary).toMatchObject({
        authenticated: true,
        canPromote: false,
        backendRestoreVerified: false,
      });
      const verified = yield* cli(f.root, ["verify", f.archiveFile, ...flags]);
      expect(verified.code).toBe(0);
      expect(JSON.parse(verified.stdout)).toEqual(summary);
      const recovered = NodePath.join(f.root, "cli.snapshot");
      expect((yield* cli(f.root, ["unseal", f.archiveFile, recovered, ...flags])).code).toBe(0);
      expect(yield* io(() => NodeFSP.readFile(recovered))).toEqual(f.bytes);
      yield* io(async () => {
        const bytes = await NodeFSP.readFile(f.archiveFile);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
        await NodeFSP.writeFile(f.archiveFile, bytes);
      });
      const failed = yield* cli(f.root, [
        "unseal",
        f.archiveFile,
        NodePath.join(f.root, "refused.snapshot"),
        ...flags,
      ]);
      expect(failed.code).toBe(1);
      expect(failed.stdout + failed.stderr).not.toContain("secret-canary");
      expect(
        (yield* io(() => NodeFSP.readdir(f.root))).some(
          (name) => name === "refused.snapshot" || name.endsWith(".tmp"),
        ),
      ).toBe(false);
    }),
  );

  it.live("refuses a FIFO key without blocking on a writer or publishing output", () =>
    Effect.gen(function* () {
      const f = yield* setup;
      const fifo = NodePath.join(f.root, "not-a-key");
      yield* io(
        () =>
          new Promise<void>((resolve, reject) => {
            NodeChildProcess.execFile(
              "mkfifo",
              ["-m", "600", fifo],
              { env: { PATH: "/usr/bin:/bin" } },
              (error) => (error ? reject(error) : resolve()),
            );
          }),
      );
      const result = yield* cli(
        f.root,
        [
          "seal",
          f.snapshotFile,
          f.archiveFile,
          "--key-file",
          fifo,
          "--environment-id",
          f.input.environmentId,
        ],
        5000,
      );
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).toContain("Vault archive operation refused");
      expect(
        (yield* io(() => NodeFSP.readdir(f.root))).some(
          (name) => name === "vault.archive" || name.endsWith(".tmp"),
        ),
      ).toBe(false);
    }),
  );
});
it.live("refuses unsupported platforms before any filesystem operation", () =>
  refused(
    run((service) =>
      service.verify({
        keyFile: "not-opened",
        archiveFile: "not-opened",
        environmentId: "isolated-proof",
      }),
    ).pipe(Effect.provideService(HostProcess.Platform, "win32")),
  ),
);
