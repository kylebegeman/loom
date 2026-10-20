// @effect-diagnostics nodeBuiltinImport:off - The folder server is checked with raw requests whose paths no client normalizes.
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../../processRunner.ts";
import {
  makePreviewContainerOps,
  previewByteRange,
  previewContainerRunArgs,
  previewContentType,
  type PreviewContainerOps,
  previewPortFree,
  resolveFolderRequest,
  servePreviewFolder,
} from "./backings.ts";

const SITE_INDEX = "<h1>site</h1>";
const APP_JS = "console.log('app');";

/**
 * A built site with a secret beside it, links that point out of it and one that stays inside.
 * Returns the site's realpath, as the service hands it to the server.
 */
const makeSite = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outside = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const site = path.join(outside, "site");
  yield* fs.writeFileString(path.join(outside, "secret.txt"), "secret");
  yield* fs.makeDirectory(path.join(site, "docs"), { recursive: true });
  yield* fs.makeDirectory(path.join(site, "empty"));
  yield* fs.makeDirectory(path.join(site, ".well-known"));
  yield* fs.writeFileString(path.join(site, "index.html"), SITE_INDEX);
  yield* fs.writeFileString(path.join(site, "app.js"), APP_JS);
  yield* fs.writeFileString(path.join(site, "data.bin"), "bytes");
  yield* fs.writeFileString(path.join(site, ".env"), "TOKEN=1");
  yield* fs.writeFileString(path.join(site, ".well-known", "security.txt"), "contact");
  yield* fs.writeFileString(path.join(site, "docs", "index.html"), "<h1>docs</h1>");
  yield* fs.symlink(path.join(outside, "secret.txt"), path.join(site, "escape"));
  yield* fs.symlink(outside, path.join(site, "escape-dir"));
  yield* fs.symlink(path.join(site, "app.js"), path.join(site, "inner"));
  return site;
});

interface Reply {
  readonly status: number;
  readonly headers: NodeHttp.IncomingHttpHeaders;
  readonly body: string;
}

/** Sends `path` exactly as given, which a fetch client would normalize first. */
const request = (
  port: number,
  options: {
    readonly path: string;
    readonly method?: string;
    readonly host?: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
) =>
  Effect.promise(
    () =>
      new Promise<Reply>((resolve, reject) => {
        const outgoing = NodeHttp.request(
          {
            host: "127.0.0.1",
            port,
            method: options.method ?? "GET",
            path: options.path,
            headers: { ...options.headers, host: options.host ?? `localhost:${port}` },
            agent: false,
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => (body += chunk));
            response.on("end", () =>
              resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
            );
          },
        );
        outgoing.on("error", reject);
        outgoing.end();
      }),
  );

type DockerReply =
  | { readonly code: number; readonly stdout?: string; readonly stderr?: string }
  | ProcessRunner.ProcessRunError;

/** Records each docker command line and answers from `respond`; no docker ever runs. */
const scriptedDocker = (respond: (line: string) => DockerReply) => {
  const calls: Array<ProcessRunner.ProcessRunInput> = [];
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.suspend(() => {
        calls.push(input);
        const reply = respond([input.command, ...input.args].join(" "));
        if ("_tag" in reply) return Effect.fail(reply);
        return Effect.succeed({
          stdout: reply.stdout ?? "",
          stderr: reply.stderr ?? "",
          code: ChildProcessSpawner.ExitCode(reply.code),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        });
      }),
  });
  const lines = () => calls.map((input) => [input.command, ...input.args].join(" "));
  return {
    calls,
    lines,
    ops: makePreviewContainerOps.pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner)),
  };
};

const DOCKER = "/usr/local/bin/docker";
const FULL_ID = "0123456789ab".padEnd(64, "c");
const DAEMON_DOWN =
  "docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?";

describe("preview backing helpers", () => {
  it("types files by extension and defaults to octet-stream", () => {
    expect(previewContentType("/site/STYLE.CSS")).toBe("text/css; charset=utf-8");
    expect(previewContentType("/site/model.glb")).toBe("model/gltf-binary");
    expect(previewContentType("/site/Makefile")).toBe("application/octet-stream");
  });

  it("runs the image detached, labelled for its lane and link, on loopback only", () => {
    expect(
      previewContainerRunArgs({
        laneId: "lane-a",
        linkId: "link1",
        port: 41003,
        input: {
          image: "nginx:1.27",
          containerPort: 80,
          env: { MODE: "demo", GREETING: "hi there" },
          command: ["nginx", "-g", "daemon off;"],
        },
      }),
    ).toEqual([
      "run",
      "-d",
      "--pull",
      "never",
      "--label",
      "loom.lane=lane-a",
      "--label",
      "loom.preview-link=link1",
      "-p",
      "127.0.0.1:41003:80",
      "-e",
      "MODE=demo",
      "-e",
      "GREETING=hi there",
      "nginx:1.27",
      "nginx",
      "-g",
      "daemon off;",
    ]);
  });
});

it.layer(NodeServices.layer)("preview folder backing", (it) => {
  it.effect("keeps requests inside the folder, its realpath included", () =>
    Effect.gen(function* () {
      const site = yield* makeSite;
      const resolve = (target: string) => Effect.promise(() => resolveFolderRequest(site, target));
      const notFound = { _tag: "Status", status: 404 };
      const badRequest = { _tag: "Status", status: 400 };

      for (const target of [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/%2E%2E%2Fsecret.txt",
        "/docs/..%2f..%2fsecret.txt",
        "/escape",
        "/escape-dir/secret.txt",
        "/.env",
        "/missing.html",
      ]) {
        expect(yield* resolve(target), target).toEqual(notFound);
      }
      for (const target of ["/index.html%00.js", "/%E0%A4%A", "*", "secret.txt"]) {
        expect(yield* resolve(target), target).toEqual(badRequest);
      }
      // A link that stays inside is fine, and is served as the file it points at.
      expect(yield* resolve("/inner")).toEqual({ _tag: "File", path: `${site}/app.js` });
      expect(yield* resolve("/.well-known/security.txt")).toEqual({
        _tag: "File",
        path: `${site}/.well-known/security.txt`,
      });
    }),
  );

  it.effect("serves a folder's index.html, never a listing", () =>
    Effect.gen(function* () {
      const site = yield* makeSite;
      const resolve = (target: string) => Effect.promise(() => resolveFolderRequest(site, target));
      expect(yield* resolve("/")).toEqual({ _tag: "File", path: `${site}/index.html` });
      expect(yield* resolve("/docs/")).toEqual({ _tag: "File", path: `${site}/docs/index.html` });
      expect(yield* resolve("/docs?tab=1#top")).toEqual({
        _tag: "Redirect",
        location: "/docs/?tab=1",
      });
      expect(yield* resolve("/empty/")).toEqual({ _tag: "Status", status: 404 });
      expect(yield* resolve("/app.js/")).toEqual({ _tag: "Status", status: 404 });
      expect(yield* resolve("/app.js?v=2")).toEqual({ _tag: "File", path: `${site}/app.js` });
    }),
  );

  it.effect("answers GET and HEAD on loopback with safe headers and nothing else", () =>
    Effect.gen(function* () {
      const site = yield* makeSite;
      const { port } = yield* servePreviewFolder({ root: site, port: 0 });

      const index = yield* request(port, { path: "/" });
      expect(index).toMatchObject({ status: 200, body: SITE_INDEX });
      expect(index.headers).toMatchObject({
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      });
      const head = yield* request(port, { path: "/app.js", method: "HEAD" });
      expect(head).toMatchObject({ status: 200, body: "" });
      expect(head.headers).toMatchObject({
        "content-type": "text/javascript; charset=utf-8",
        "content-length": String(Buffer.byteLength(APP_JS)),
      });
      expect((yield* request(port, { path: "/data.bin" })).headers["content-type"]).toBe(
        "application/octet-stream",
      );
      expect((yield* request(port, { path: "/", host: `127.0.0.1:${port}` })).status).toBe(200);

      const redirect = yield* request(port, { path: "/docs" });
      expect(redirect).toMatchObject({ status: 301, headers: { location: "/docs/" } });
      const empty = yield* request(port, { path: "/empty/" });
      expect(empty).toMatchObject({ status: 404, body: "Not found\n" });
      for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/escape", "/.env"]) {
        expect((yield* request(port, { path })).status, path).toBe(404);
      }
      expect((yield* request(port, { path: "/%00" })).status).toBe(400);
      const post = yield* request(port, { path: "/", method: "POST" });
      expect(post).toMatchObject({ status: 405, headers: { allow: "GET, HEAD" } });
      // A page that points its own name at 127.0.0.1 must not read the folder.
      expect((yield* request(port, { path: "/", host: "evil.example" })).status).toBe(403);
      expect((yield* request(port, { path: "/", host: `evil.example:${port}` })).status).toBe(403);
    }),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "answers an empty file and never waits on a FIFO in place of a file",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const site = yield* makeSite;
        yield* fs.writeFileString(path.join(site, "empty.txt"), "");
        yield* fs.makeDirectory(path.join(site, "pipe"));
        // Opening a FIFO for reading blocks until a writer comes, which none ever does here.
        NodeChildProcess.execFileSync("mkfifo", [path.join(site, "pipe", "index.html")]);
        const { port } = yield* servePreviewFolder({ root: site, port: 0 });

        const empty = yield* request(port, { path: "/empty.txt" });
        expect(empty).toMatchObject({ status: 200, body: "", headers: { "content-length": "0" } });
        expect((yield* request(port, { path: "/pipe/" })).status).toBe(404);
        expect((yield* request(port, { path: "/" })).body).toBe(SITE_INDEX);
      }),
  );

  it("reads one byte range of a file and leaves anything else to the whole file", () => {
    const cases: ReadonlyArray<readonly [string | undefined, number, unknown]> = [
      [undefined, 5, null],
      ["bytes=0-", 5, { start: 0, end: 4 }],
      ["bytes=1-99", 5, { start: 1, end: 4 }],
      [" BYTES=1-2 ", 5, { start: 1, end: 2 }],
      ["bytes=-2", 5, { start: 3, end: 4 }],
      ["bytes=-99", 5, { start: 0, end: 4 }],
      ["bytes=5-", 5, "unsatisfiable"],
      ["bytes=-0", 5, "unsatisfiable"],
      ["bytes=0-", 0, "unsatisfiable"],
      ["bytes=-1", 0, "unsatisfiable"],
      ["bytes=3-1", 5, null],
      ["bytes=0-1,3-4", 5, null],
      ["bytes=-", 5, null],
      ["items=0-1", 5, null],
    ];
    for (const [header, size, range] of cases) {
      expect(previewByteRange(header, size), `${header} of ${size}`).toEqual(range);
    }
  });

  it.effect("answers a byte range so media can seek", () =>
    Effect.gen(function* () {
      const site = yield* makeSite;
      const { port } = yield* servePreviewFolder({ root: site, port: 0 });
      const ranged = (range: string, extra: Readonly<Record<string, string>> = {}) =>
        request(port, { path: "/data.bin", headers: { range, ...extra } });

      const whole = yield* request(port, { path: "/data.bin" });
      expect(whole).toMatchObject({ status: 200, body: "bytes" });
      expect(whole.headers["accept-ranges"]).toBe("bytes");

      const middle = yield* ranged("bytes=1-3");
      expect(middle).toMatchObject({ status: 206, body: "yte" });
      expect(middle.headers).toMatchObject({
        "accept-ranges": "bytes",
        "content-range": "bytes 1-3/5",
        "content-length": "3",
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      });
      expect(yield* ranged("bytes=2-")).toMatchObject({ status: 206, body: "tes" });
      expect(yield* ranged("bytes=-2")).toMatchObject({ status: 206, body: "es" });

      const past = yield* ranged("bytes=9-");
      expect(past.status).toBe(416);
      expect(past.headers).toMatchObject({
        "content-range": "bytes */5",
        "accept-ranges": "bytes",
      });

      // Several ranges would take a multipart body, and an If-Range never matches without a
      // validator, so both get the whole file.
      expect(yield* ranged("bytes=0-0,2-3")).toMatchObject({ status: 200, body: "bytes" });
      expect(yield* ranged("bytes=1-3", { "if-range": '"abc"' })).toMatchObject({
        status: 200,
        body: "bytes",
      });

      const head = yield* request(port, {
        path: "/data.bin",
        method: "HEAD",
        headers: { range: "bytes=1-3" },
      });
      expect(head).toMatchObject({ status: 206, body: "" });
      expect(head.headers["content-length"]).toBe("3");
      // A range reaches nothing the folder keeps private.
      const hidden = yield* request(port, { path: "/.env", headers: { range: "bytes=0-1" } });
      expect(hidden.status).toBe(404);
    }),
  );

  it.effect("reports a taken port and frees its port when its scope closes", () =>
    Effect.gen(function* () {
      const site = yield* makeSite;
      const scope = yield* Scope.make();
      const { port } = yield* servePreviewFolder({ root: site, port: 0 }).pipe(
        Scope.provide(scope),
      );
      expect(yield* previewPortFree(port)).toBe(false);
      const taken = yield* Effect.flip(servePreviewFolder({ root: site, port }));
      expect(taken).toMatchObject({
        _tag: "PreviewFolderListenError",
        port,
        message: `Port ${port} is already in use on this computer.`,
      });

      yield* Scope.close(scope, Exit.void);
      expect(yield* previewPortFree(port)).toBe(true);
    }),
  );
});

const startInput = (image: string) => ({
  laneId: "lane-a",
  linkId: "link1",
  port: 41003,
  input: { image, containerPort: 80 },
});

const pullAndRun = (ops: PreviewContainerOps, image: string) =>
  ops.pull(DOCKER, startInput(image)).pipe(Effect.andThen(ops.run(DOCKER, startInput(image))));

it.layer(NodeServices.layer)("preview container backing", (it) => {
  it.effect("pulls an image only when it is not here, then starts it and keeps its short id", () =>
    Effect.gen(function* () {
      const images = new Set(["nginx"]);
      const docker = scriptedDocker((line) => {
        const image = line.split(" ").at(-1) ?? "";
        if (line.includes(" image inspect ")) {
          return images.has(image)
            ? { code: 0, stdout: "sha256:1\n" }
            : { code: 1, stderr: `Error response from daemon: No such image: ${image}` };
        }
        if (line.includes(" pull ")) {
          images.add(image);
          return { code: 0, stdout: `Pulling from library/${image}\n` };
        }
        return { code: 0, stdout: `${FULL_ID}\n` };
      });
      const ops = yield* docker.ops;
      const subcommands = () => docker.calls.map((call) => call.args.slice(0, 2).join(" "));

      expect(yield* pullAndRun(ops, "nginx")).toBe("0123456789ab");
      expect(subcommands()).toEqual(["image inspect", "run -d"]);
      expect(docker.calls[1]).toMatchObject({ command: DOCKER, timeout: "2 minutes" });
      expect(docker.calls[1]?.args.slice(2, 4)).toEqual(["--pull", "never"]);
      expect(docker.calls[1]?.env?.LC_ALL).toBe("C");

      docker.calls.length = 0;
      expect(yield* pullAndRun(ops, "redis")).toBe("0123456789ab");
      expect(subcommands()).toEqual(["image inspect", "pull redis", "run -d"]);
      expect(docker.calls[1]).toMatchObject({ timeout: "10 minutes" });
    }),
  );

  it.effect("explains why Docker could not pull or start a container", () =>
    Effect.gen(function* () {
      const notHere = { code: 1, stderr: "Error response from daemon: No such image: nope" };
      const pulled = { code: 0, stdout: "Status: Downloaded newer image for nope\n" };
      const registryDown =
        'Error response from daemon: Get "https://registry-1.docker.io/v2/": net/http: TLS handshake timeout';
      // Each case is the pull's reply, the run's reply and the message the agent gets.
      const cases: ReadonlyArray<readonly [DockerReply, DockerReply, string]> = [
        [
          { code: 1, stderr: DAEMON_DOWN },
          { code: 125, stderr: DAEMON_DOWN },
          "Docker is not running. Start Docker Desktop or OrbStack, then share the container again.",
        ],
        [
          {
            code: 1,
            stderr:
              "Error response from daemon: pull access denied for nope, repository does not exist or may require 'docker login'",
          },
          { code: 0 },
          "Docker could not find the image nope. Check its name and tag.",
        ],
        [
          { code: 1, stderr: registryDown },
          { code: 0 },
          `Docker could not pull the image nope: ${registryDown}`,
        ],
        [
          new ProcessRunner.ProcessTimeoutError({
            command: DOCKER,
            argumentCount: 2,
            timeoutMs: 600_000,
          }),
          { code: 0 },
          "Docker took more than 10 minutes to pull the image nope. Check the image name and the network, then try again.",
        ],
        [
          pulled,
          {
            code: 125,
            stderr:
              "docker: Error response from daemon: driver failed programming external connectivity: Bind for 127.0.0.1:41003 failed: port is already allocated.",
          },
          "Port 41003 was taken before the container could use it. Share the container again.",
        ],
        [
          pulled,
          { code: 125, stderr: "docker: Error response from daemon: No such image: nope\n" },
          "Docker could not find the image nope. Check its name and tag.",
        ],
        [
          pulled,
          { code: 125, stderr: "docker: invalid reference format.\n" },
          "Docker could not start the container: invalid reference format.",
        ],
        [pulled, { code: 0, stdout: "" }, "Docker started the container without reporting its id."],
        [
          new ProcessRunner.ProcessSpawnError({
            command: DOCKER,
            argumentCount: 2,
            cause: new Error("ENOENT"),
          }),
          { code: 0 },
          "Docker could not be started on this computer.",
        ],
        [
          pulled,
          new ProcessRunner.ProcessTimeoutError({
            command: DOCKER,
            argumentCount: 12,
            timeoutMs: 120_000,
          }),
          "Docker took more than 2 minutes to start the container. Try again.",
        ],
      ];
      for (const [pull, run, message] of cases) {
        const ops = yield* scriptedDocker((line) =>
          line.includes(" image inspect ") ? notHere : line.includes(" pull ") ? pull : run,
        ).ops;
        const error = yield* Effect.flip(pullAndRun(ops, "nope"));
        expect(error, message).toMatchObject({ reason: "invalid", message });
      }
    }),
  );

  it.effect("reads a container's state and removes it, treating a missing one as gone", () =>
    Effect.gen(function* () {
      const docker = scriptedDocker((line) => {
        if (line.endsWith("inspect -f {{.State.Running}} up")) return { code: 0, stdout: "true\n" };
        if (line.endsWith("inspect -f {{.State.Running}} exited")) {
          return { code: 0, stdout: "false\n" };
        }
        if (line.endsWith("inspect -f {{.State.Running}} gone")) {
          return { code: 1, stderr: "Error: No such object: gone" };
        }
        if (line.includes("rm -f gone"))
          return { code: 1, stderr: "Error: No such container: gone" };
        if (line.includes("rm -f")) return { code: 0, stdout: "up\n" };
        return { code: 1, stderr: DAEMON_DOWN };
      });
      const ops = yield* docker.ops;
      expect(yield* ops.running(DOCKER, "up")).toBe(true);
      expect(yield* ops.running(DOCKER, "exited")).toBe(false);
      expect(yield* ops.running(DOCKER, "gone")).toBe(false);
      // Docker being down says nothing about the container, so the link stays as it is.
      expect(yield* ops.running(DOCKER, "unknown")).toBeNull();
      expect(yield* ops.remove(DOCKER, "up")).toBe(true);
      expect(yield* ops.remove(DOCKER, "gone")).toBe(true);
      expect(docker.lines()).toContain(`${DOCKER} rm -f up`);
    }),
  );

  it.effect("removes a link's containers by label when no id came back", () =>
    Effect.gen(function* () {
      const docker = scriptedDocker((line) =>
        line.includes(" ps ") ? { code: 0, stdout: "aaa111\nbbb222\n" } : { code: 0 },
      );
      const ops = yield* docker.ops;
      expect(yield* ops.removeLabelled(DOCKER, "link1")).toBe(true);
      expect(docker.lines()).toEqual([
        `${DOCKER} ps -aq --filter label=loom.preview-link=link1`,
        `${DOCKER} rm -f aaa111`,
        `${DOCKER} rm -f bbb222`,
      ]);
    }),
  );
});
