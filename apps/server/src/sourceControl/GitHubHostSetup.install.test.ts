// @effect-diagnostics nodeBuiltinImport:off -- Fixture archives exercise actual hashing and extraction without network access.
import * as NodeCrypto from "node:crypto";
import * as NodeZlib from "node:zlib";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Setup from "./GitHubHostSetup.ts";
import * as ProcessRunner from "../processRunner.ts";

const PAYLOAD = "fixture GitHub executable\n";
const VERSION = "2.102.0";
const targets = [
  { platform: "linux", arch: "arm64", target: "linux_arm64.tar.gz" },
  { platform: "linux", arch: "x64", target: "linux_amd64.tar.gz" },
  { platform: "darwin", arch: "arm64", target: "macOS_arm64.zip" },
  { platform: "darwin", arch: "x64", target: "macOS_amd64.zip" },
  { platform: "win32", arch: "arm64", target: "windows_arm64.zip" },
  { platform: "win32", arch: "x64", target: "windows_amd64.zip" },
] as const;

/** Stored ZIP entries use the same standard headers and Unix modes as official archives. */
const zip = (names: ReadonlyArray<string>) => {
  const records: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name);
    const data = Buffer.from(PAYLOAD);
    const crc = NodeZlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((0o100755 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    records.push(local, filename, data);
    directory.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, central, end]);
};

const tar = (name: string) => {
  const data = Buffer.from(PAYLOAD);
  const header = Buffer.alloc(512);
  header.write(name, 0);
  header.write("0000755\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
  header.write("00000000000\0", 136);
  header.fill(0x20, 148, 156);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  header.write(
    header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148,
  );
  return NodeZlib.gzipSync(
    Buffer.concat([header, data, Buffer.alloc(512 - data.length), Buffer.alloc(1024)]),
  );
};

const fixture = Effect.fn("test.githubInstaller")(function* (
  target: (typeof targets)[number] = targets[2],
  options: {
    readonly archive?: Buffer;
    readonly beforeResponse?: Effect.Effect<void>;
    readonly body?: Stream.Stream<Uint8Array, Setup.GitHubHostSetupError>;
    readonly version?: string;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped();
  const executableName = target.platform === "win32" ? "gh.exe" : "gh";
  const archive =
    options.archive ??
    (target.platform === "linux"
      ? tar(`gh_${VERSION}_${target.target.slice(0, -7)}/bin/gh`)
      : zip([
          target.platform === "win32" ? "bin/gh.exe" : `gh_${VERSION}_macOS_${target.arch}/bin/gh`,
        ]));
  const requests: string[] = [];
  const calls: string[][] = [];
  const responseEntered = yield* Deferred.make<void>();
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(request.url);
      yield* Deferred.succeed(responseEntered, undefined);
      if (options.beforeResponse) yield* options.beforeResponse;
      const response = HttpClientResponse.fromWeb(request, new Response(null));
      return Object.defineProperty(response, "stream", {
        value: options.body ?? Stream.make(archive.subarray(0, 40), archive.subarray(40)),
      });
    }),
  );
  const service = yield* Setup.make({
    [`${target.platform}-${target.arch}`]: {
      target: target.target,
      sha256: NodeCrypto.createHash("sha256").update(archive).digest("hex"),
    },
  }).pipe(
    Effect.provideService(HostProcess.HomeDirectory, home),
    Effect.provideService(HostProcess.Environment, { PATH: `${home}/empty` }),
    Effect.provideService(HostProcess.Platform, target.platform),
    Effect.provideService(HostProcess.Architecture, target.arch),
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: (input) =>
          Effect.sync(() => {
            calls.push([...input.args]);
            return {
              code: ChildProcessSpawner.ExitCode(0),
              stdout:
                input.args[0] === "--version"
                  ? `gh version ${options.version ?? VERSION} (fixture)\n`
                  : "",
              stderr: "",
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            };
          }),
      }),
    ),
  );
  const directory = `${home}/.local/share/loom/tools/github-cli/bin`;
  const executable = `${directory}/${executableName}`;
  return { service, fs, home, directory, executable, requests, calls, responseEntered };
});

it.layer(NodeServices.layer)("GitHub CLI installation", (it) => {
  it.effect.each(targets)("installs and reuses the $platform/$arch archive", (target) =>
    Effect.gen(function* () {
      const f = yield* fixture(target);
      assert.equal((yield* f.service.setup({ interactive: false })).state, "git-ready");
      assert.equal(yield* f.fs.readFileString(f.executable), PAYLOAD);
      assert.deepEqual(yield* f.fs.readDirectory(f.directory), [
        target.platform === "win32" ? "gh.exe" : "gh",
      ]);
      yield* f.service.setup({ interactive: false });
      assert.equal(f.requests.length, 1);
      assert.isTrue(f.requests[0]!.endsWith(`/gh_${VERSION}_${target.target}`));
      assert.isFalse(f.calls.some((args) => args.includes("login")));
    }),
  );
  it.effect("removes an interrupted download and can retry", () =>
    Effect.gen(function* () {
      let pulls = 0;
      const archive = zip(["bin/gh"]);
      let first = true;
      const body = Stream.suspend(() => {
        if (!first) return Stream.make(archive);
        first = false;
        return Stream.fromReadableStream({
          evaluate: () =>
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (pulls++ === 0) controller.enqueue(archive.subarray(0, 40));
                else controller.error(new Error("download interrupted"));
              },
            }),
          onError: () => new Setup.GitHubHostSetupError({ reason: "installation-failed" }),
        });
      });
      const f = yield* fixture(targets[2], { archive, body });
      assert.equal(
        (yield* f.service.setup({ interactive: false }).pipe(Effect.flip)).reason,
        "installation-failed",
      );
      assert.deepEqual(yield* f.fs.readDirectory(f.directory), []);
      assert.equal((yield* f.service.setup({ interactive: false })).state, "git-ready");
      assert.equal(f.requests.length, 2);
      assert.equal(yield* f.fs.readFileString(f.executable), PAYLOAD);
    }),
  );
  it.effect("cancels a blocked download and removes its staging directory", () =>
    Effect.gen(function* () {
      const f = yield* fixture(targets[2], { beforeResponse: Effect.never });
      const installing = yield* f.service.setup({ interactive: false }).pipe(Effect.forkScoped);
      yield* Deferred.await(f.responseEntered);
      yield* Fiber.interrupt(installing);
      assert.isFalse(yield* f.fs.exists(f.executable));
      assert.deepEqual(yield* f.fs.readDirectory(f.directory), []);
    }),
  );
  it.effect.each(["response", "body"] as const)(
    "bounds a stalled HTTP %s and removes staging",
    (phase) =>
      Effect.gen(function* () {
        const f = yield* fixture(
          targets[2],
          phase === "response" ? { beforeResponse: Effect.never } : { body: Stream.never },
        );
        const installing = yield* f.service
          .setup({ interactive: false })
          .pipe(Effect.flip, Effect.forkScoped);
        yield* Deferred.await(f.responseEntered);
        yield* TestClock.adjust("5 minutes");
        assert.equal((yield* Fiber.join(installing)).reason, "installation-failed");
        assert.deepEqual(yield* f.fs.readDirectory(f.directory), []);
      }),
  );
  it.effect("rejects missing or duplicate executables", () =>
    Effect.gen(function* () {
      for (const names of [["bin/other"], ["bin/gh", "nested/bin/gh"]]) {
        const f = yield* fixture(targets[2], { archive: zip(names) });
        assert.equal(
          (yield* f.service.setup({ interactive: false }).pipe(Effect.flip)).reason,
          "installation-failed",
        );
        assert.deepEqual(yield* f.fs.readDirectory(f.directory), []);
      }
    }),
  );
  it.effect("rejects an executable with the wrong version before publication", () =>
    Effect.gen(function* () {
      const f = yield* fixture(targets[2], { version: "0.0.0" });
      assert.equal(
        (yield* f.service.setup({ interactive: false }).pipe(Effect.flip)).reason,
        "installation-failed",
      );
      assert.isFalse(yield* f.fs.exists(f.executable));
      assert.deepEqual(yield* f.fs.readDirectory(f.directory), []);
    }),
  );
  it.effect("concurrent setup publishes one executable without replacing the winner", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let downloads = 0;
      const f = yield* fixture(targets[2], {
        beforeResponse: Effect.gen(function* () {
          if (++downloads === 2) yield* Deferred.succeed(ready, undefined);
          yield* Deferred.await(release);
        }),
      });
      const first = yield* f.service.setup({ interactive: false }).pipe(Effect.forkScoped);
      const second = yield* f.service.setup({ interactive: false }).pipe(Effect.forkScoped);
      yield* Deferred.await(ready);
      yield* Deferred.succeed(release, undefined);
      assert.equal((yield* Fiber.join(first)).state, "git-ready");
      assert.equal((yield* Fiber.join(second)).state, "git-ready");
      assert.equal(yield* f.fs.readFileString(f.executable), PAYLOAD);
      assert.deepEqual(yield* f.fs.readDirectory(f.directory), ["gh"]);
    }),
  );
});
