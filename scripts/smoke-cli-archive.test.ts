// @effect-diagnostics nodeBuiltinImport:off
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { smokeCliArchive } from "./smoke-cli-archive.ts";

it.live("concurrent archive smoke runs bind separate kernel-assigned ports", (ctx) =>
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "win32")
      return ctx.skip("The fixture uses a POSIX executable script.");
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "t3-smoke-regression-" });
    const root = path.join(scratch, "t3-fixture");
    const report = path.join(scratch, "ports.jsonl");
    yield* fs.makeDirectory(path.join(root, "client"), { recursive: true });
    yield* fs.writeFileString(path.join(root, "client/index.html"), "fixture");
    yield* fs.writeFileString(
      path.join(root, "t3"),
      `#!${process.execPath}
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
if (process.argv.includes('--version')) { console.log('1.2.3'); process.exit(0); }
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const server = http.createServer((_req, res) => { res.end('fixture'); });
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  fs.appendFileSync(${JSON.stringify(report)}, JSON.stringify({ requested: port, actual: actualPort }) + '\\n');
  const userdata = path.join(process.env.T3CODE_HOME, 'userdata');
  fs.mkdirSync(userdata, { recursive: true });
  fs.writeFileSync(path.join(userdata, 'server-runtime.json'), JSON.stringify({ version: 1, pid: process.pid, port: actualPort, origin: 'http://127.0.0.1:' + actualPort, startedAt: new Date().toISOString() }));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
    );
    yield* fs.chmod(path.join(root, "t3"), 0o755);
    const archive = path.join(scratch, "fixture.tar.gz");
    const tar = yield* spawner.spawn(
      ChildProcess.make("tar", ["-czf", archive, "-C", scratch, "t3-fixture"]),
    );
    expect(Number(yield* tar.exitCode)).toBe(0);
    // The script fixture cannot link the bundled libatomic that Linux archives are checked for.
    yield* Effect.all(
      [
        smokeCliArchive({ archive, expectVersion: "1.2.3" }),
        smokeCliArchive({ archive, expectVersion: "1.2.3" }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.provideService(HostProcess.Platform, "darwin"));
    const records = (yield* fs.readFileString(report))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { requested: number; actual: number });
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.requested === 0 && record.actual > 0)).toBe(true);
    expect(new Set(records.map((record) => record.actual)).size).toBe(2);
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)), Effect.scoped),
);
