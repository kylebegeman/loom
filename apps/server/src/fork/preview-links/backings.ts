// @effect-diagnostics nodeBuiltinImport:off - Folder links open files with O_NOFOLLOW and stream them, and port probes need raw loopback sockets.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeStreamPromises from "node:stream/promises";
import { PreviewLinksError, type PreviewContainerShareInput } from "@t3tools/contracts/fork";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { guardHttpResponseWriteErrors } from "../../httpResponseErrorGuard.ts";
import { ProcessRunner, type ProcessRunOutput } from "../../processRunner.ts";
import { isContained } from "../model-preview-3d/signedFiles.ts";
import { DOCKER_LABEL, dockerCandidates, makeDockerLocator } from "../project-lifecycle/leases.ts";
import { PreviewFolderListenError, type ServePreviewFolder } from "./types.ts";

/** Marks the container of a link, so one whose id Loom never learned can still be removed. */
export const PREVIEW_LINK_LABEL = "loom.preview-link";

const FOLDER_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
} as const;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

const STATUS_TEXT: Readonly<Record<number, string>> = {
  301: "Moved permanently",
  400: "Bad request",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  416: "Range not satisfiable",
  500: "Something went wrong",
};

export const previewContentType = (file: string) =>
  CONTENT_TYPES[NodePath.extname(file).toLowerCase()] ?? "application/octet-stream";

// O_NONBLOCK keeps a FIFO named index.html from holding a libuv thread in open() until a writer
// comes. On Windows both flags are undefined, which a bitwise or treats as 0.
const OPEN_FLAGS =
  NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK;

export type FolderRequestResolution =
  | { readonly _tag: "File"; readonly path: string }
  | { readonly _tag: "Redirect"; readonly location: string }
  | { readonly _tag: "Status"; readonly status: 400 | 404 };

const statusOf = (status: 400 | 404): FolderRequestResolution => ({ _tag: "Status", status });

// Dotfiles such as .env and .git are never what a built site serves, so they stay private.
const isHiddenSegment = (segment: string) => segment.startsWith(".") && segment !== ".well-known";

const realpathInside = async (root: string, target: string) => {
  const real = await NodeFSP.realpath(target).catch(() => null);
  return real !== null && isContained(root, real) ? real : null;
};

/** Maps a request target to a file under `root`, which must already be a realpath. */
export async function resolveFolderRequest(
  root: string,
  target: string,
): Promise<FolderRequestResolution> {
  const split = target.search(/[?#]/);
  const rawPath = split === -1 ? target : target.slice(0, split);
  const query = split === -1 ? "" : target.slice(split).replace(/#.*$/s, "");
  if (!rawPath.startsWith("/")) return statusOf(400);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return statusOf(400);
  }
  if (decoded.includes("\0")) return statusOf(400);
  // Splitting after decoding makes an encoded slash a separator too, so `..%2F` is still caught.
  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (segments.some(isHiddenSegment)) return statusOf(404);
  const joined = NodePath.join(root, ...segments);
  if (!isContained(root, joined)) return statusOf(404);
  // Symlinks anywhere on the way may point out of the tree, so containment is checked on the realpath.
  const real = await realpathInside(root, joined);
  if (real === null) return statusOf(404);
  const info = await NodeFSP.stat(real).catch(() => null);
  if (info === null) return statusOf(404);
  const wantsDirectory = decoded.endsWith("/");
  if (info.isDirectory()) {
    // Relative URLs in the index resolve against the directory only with a trailing slash. Each
    // segment is non-empty and re-encoded, so the location can never start with `//`.
    if (!wantsDirectory) {
      return {
        _tag: "Redirect",
        location: `/${segments.map(encodeURIComponent).join("/")}/${query}`,
      };
    }
    const index = await realpathInside(root, NodePath.join(real, "index.html"));
    return index === null ? statusOf(404) : { _tag: "File", path: index };
  }
  return info.isFile() && !wantsDirectory ? { _tag: "File", path: real } : statusOf(404);
}

const sendStatus = (
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
  status: number,
  headers: Readonly<Record<string, string>> = {},
) => {
  const body = `${STATUS_TEXT[status] ?? "Error"}\n`;
  response.writeHead(status, {
    ...FOLDER_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    ...headers,
  });
  response.end(request.method === "HEAD" ? undefined : body);
};

export type PreviewByteRange =
  | { readonly start: number; readonly end: number }
  | "unsatisfiable"
  | null;

/**
 * The single byte range a `Range` header asks for, clamped to the file. Null serves the whole
 * file: no header, another unit, a malformed or backwards range, or several ranges, which media
 * seeking never needs and which would take a multipart body.
 */
export function previewByteRange(header: string | undefined, size: number): PreviewByteRange {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (match === null) return null;
  const [, first = "", last = ""] = match;
  if (first === "") {
    if (last === "") return null;
    const suffix = Number(last);
    return suffix === 0 || size === 0
      ? "unsatisfiable"
      : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? Infinity : Number(last);
  if (end < start) return null;
  return start >= size ? "unsatisfiable" : { start, end: Math.min(end, size - 1) };
}

const sendFile = async (
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
  file: string,
) => {
  // The realpath was checked, but the file can be swapped for a symlink before it opens.
  const handle = await NodeFSP.open(file, OPEN_FLAGS).catch(() => null);
  if (handle === null) return sendStatus(request, response, 404);
  let streaming = false;
  try {
    const info = await handle.stat();
    if (!info.isFile()) return sendStatus(request, response, 404);
    // Answers carry no validator, so an If-Range can never match and the whole file goes out.
    const range =
      request.headers["if-range"] === undefined
        ? previewByteRange(request.headers.range, info.size)
        : null;
    if (range === "unsatisfiable") {
      return sendStatus(request, response, 416, {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${info.size}`,
      });
    }
    const start = range?.start ?? 0;
    const length = range === null ? info.size : range.end - range.start + 1;
    response.writeHead(range === null ? 200 : 206, {
      ...FOLDER_HEADERS,
      "Content-Type": previewContentType(file),
      "Content-Length": String(length),
      "Accept-Ranges": "bytes",
      ...(range === null ? {} : { "Content-Range": `bytes ${start}-${range.end}/${info.size}` }),
    });
    if (request.method === "HEAD" || length === 0) return void response.end();
    streaming = true;
    // The stream closes the handle when it ends or either side fails. A build can rewrite the file
    // meanwhile: bytes past the stated length would read as the next response on a kept-alive
    // connection, and a short read must not end as if it were complete.
    const stream = handle.createReadStream({ start, end: start + length - 1 });
    await NodeStreamPromises.pipeline(stream, response, { end: false });
    if (stream.bytesRead === length) response.end();
    else response.destroy();
  } finally {
    if (!streaming) await handle.close().catch(() => undefined);
  }
};

/**
 * Only the gateway, which always asks for `localhost:<port>`, and local tools should reach this.
 * Any other Host is a page that rebound its own name to 127.0.0.1 to read the folder.
 */
const isLoopbackHost = (request: NodeHttp.IncomingMessage) => {
  const host = request.headers.host?.toLowerCase();
  const port = request.socket.localPort;
  return port !== undefined && (host === `localhost:${port}` || host === `127.0.0.1:${port}`);
};

async function handleFolderRequest(
  root: string,
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendStatus(request, response, 405, { Allow: "GET, HEAD" });
  }
  if (!isLoopbackHost(request)) return sendStatus(request, response, 403);
  const resolved = await resolveFolderRequest(root, request.url ?? "/");
  switch (resolved._tag) {
    case "Status":
      return sendStatus(request, response, resolved.status);
    case "Redirect":
      return sendStatus(request, response, 301, { Location: resolved.location });
    case "File":
      return sendFile(request, response, resolved.path);
  }
}

const listenErrorMessage = (port: number, error: NodeJS.ErrnoException) =>
  error.code === "EADDRINUSE"
    ? `Port ${port} is already in use on this computer.`
    : `Could not listen on port ${port}.`;

/** Binds loopback only: the gateway is the one way in from outside this computer. */
export const servePreviewFolder: ServePreviewFolder = ({ root, port }) =>
  Effect.acquireRelease(
    Effect.callback<NodeHttp.Server, PreviewFolderListenError>((resume) => {
      const server = guardHttpResponseWriteErrors(NodeHttp.createServer());
      server.on("request", (request, response) => {
        void handleFolderRequest(root, request, response).catch(() => {
          // A throw here would be an unhandled rejection, which ends the whole server process.
          try {
            if (response.headersSent) response.destroy();
            else sendStatus(request, response, 500);
          } catch {
            response.destroy();
          }
        });
      });
      const onListenError = (error: NodeJS.ErrnoException) =>
        resume(Effect.fail(new PreviewFolderListenError(port, listenErrorMessage(port, error))));
      server.once("error", onListenError);
      server.listen({ host: "127.0.0.1", port }, () => {
        server.off("error", onListenError);
        // A listening server reports nothing useful here, and an unhandled "error" would crash.
        server.on("error", () => {});
        resume(Effect.succeed(server));
      });
    }),
    (server) =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections();
        server.close(() => resume(Effect.void));
      }),
  ).pipe(
    Effect.map((server) => {
      const address = server.address();
      return { port: typeof address === "object" && address !== null ? address.port : port };
    }),
  );

const PROBE_TIMEOUT_MS = 500;

const accepts = (host: string, port: number) =>
  Effect.callback<boolean>((resume) => {
    const socket = NodeNet.connect({ host, port });
    const settle = (answered: boolean) => {
      socket.destroy();
      resume(Effect.succeed(answered));
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    // Loopback answers or refuses at once, so silence means something is there and stuck.
    socket.setTimeout(PROBE_TIMEOUT_MS, () => settle(true));
    return Effect.sync(() => socket.destroy());
  });

const binds = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const server = NodeNet.createServer();
    server.once("error", () => resume(Effect.succeed(false)));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resume(Effect.succeed(true)));
    });
    return Effect.sync(() => server.close());
  });

/**
 * Whether a backing could take `port` now. Binding 127.0.0.1 alone is not enough: macOS lets it
 * succeed beside a listener on every address, and a listener on ::1 would win the gateway's
 * connection, which tries ::1 first.
 */
export const previewPortFree = (port: number): Effect.Effect<boolean> =>
  Effect.all([accepts("127.0.0.1", port), accepts("::1", port)], { concurrency: 2 }).pipe(
    Effect.flatMap(([v4, v6]) => (v4 || v6 ? Effect.succeed(false) : binds(port))),
  );

/** The docker binary, found the way lane leases find it. */
export const makePreviewDockerLocator = () =>
  makeDockerLocator(() => dockerCandidates(NodeOS.homedir()));

export const DOCKER_MISSING_MESSAGE =
  "Docker was not found on this computer. Install and start Docker Desktop or OrbStack, then share the container again.";
const DOCKER_NOT_RUNNING_MESSAGE =
  "Docker is not running. Start Docker Desktop or OrbStack, then share the container again.";

export interface PreviewContainerStart {
  readonly laneId: string;
  readonly linkId: string;
  readonly port: number;
  readonly input: PreviewContainerShareInput;
}

/**
 * Argv for `docker run`, never a shell line, so nothing in the input is interpreted. The image is
 * pulled beforehand, so a share cancelled during a slow pull has created nothing yet.
 */
export const previewContainerRunArgs = (options: PreviewContainerStart): ReadonlyArray<string> => [
  "run",
  "-d",
  "--pull",
  "never",
  "--label",
  `${DOCKER_LABEL}=${options.laneId}`,
  "--label",
  `${PREVIEW_LINK_LABEL}=${options.linkId}`,
  "-p",
  `127.0.0.1:${options.port}:${options.input.containerPort}`,
  ...Object.entries(options.input.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
  options.input.image,
  ...(options.input.command ?? []),
];

// Pulls are slow on a cold cache. Starting a container whose image is already here is not.
const DOCKER_PULL_TIMEOUT = "10 minutes";
const DOCKER_RUN_TIMEOUT = "2 minutes";
const DOCKER_QUERY_TIMEOUT = "30 seconds";
const MAX_DOCKER_OUTPUT_BYTES = 1024 * 1024;
const MAX_DOCKER_MESSAGE_LENGTH = 300;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/;
const CONTAINER_ID_LENGTH = 12;

const DAEMON_DOWN =
  /cannot connect to the docker daemon|is the docker daemon running|docker daemon is not running|error during connect/i;
const IMAGE_MISSING =
  /pull access denied|manifest unknown|repository does not exist|failed to resolve reference|no such image|manifest for \S+ not found/i;
const PORT_TAKEN = /port is already allocated|address already in use/i;
const NO_SUCH_CONTAINER = /no such (object|container)/i;

const lastLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.length > 0) ?? "";

const invalid = (message: string) => new PreviewLinksError({ reason: "invalid", message });

const startFailure = (
  output: ProcessRunOutput,
  options: { readonly image: string; readonly port: number; readonly step: "pull" | "run" },
) => {
  if (DAEMON_DOWN.test(output.stderr)) return invalid(DOCKER_NOT_RUNNING_MESSAGE);
  if (IMAGE_MISSING.test(output.stderr)) {
    return invalid(`Docker could not find the image ${options.image}. Check its name and tag.`);
  }
  if (PORT_TAKEN.test(output.stderr)) {
    return invalid(
      `Port ${options.port} was taken before the container could use it. Share the container again.`,
    );
  }
  const detail = lastLine(output.stderr)
    .replace(/^docker: /i, "")
    .slice(0, MAX_DOCKER_MESSAGE_LENGTH);
  const failed =
    options.step === "pull"
      ? `Docker could not pull the image ${options.image}`
      : "Docker could not start the container";
  return invalid(detail.length > 0 ? `${failed}: ${detail}` : `${failed}.`);
};

/** Docker commands for container links. Queries degrade to "unknown" rather than failing. */
export const makePreviewContainerOps = Effect.gen(function* () {
  const runner = yield* ProcessRunner;
  const env = { ...process.env, LC_ALL: "C" };

  const query = (docker: string, args: ReadonlyArray<string>) =>
    runner
      .run({
        command: docker,
        args,
        timeout: DOCKER_QUERY_TIMEOUT,
        maxOutputBytes: MAX_DOCKER_OUTPUT_BYTES,
        outputMode: "truncate",
        env,
      })
      .pipe(Effect.option, Effect.map(Option.getOrNull));

  const command = (
    docker: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Input,
    timeoutMessage: string,
  ) =>
    runner
      .run({
        command: docker,
        args,
        timeout,
        maxOutputBytes: MAX_DOCKER_OUTPUT_BYTES,
        outputMode: "truncate",
        env,
      })
      .pipe(
        Effect.mapError((error) =>
          invalid(
            error._tag === "ProcessTimeoutError"
              ? timeoutMessage
              : "Docker could not be started on this computer.",
          ),
        ),
      );

  /** Pulls the image if it is not here yet, then starts the container detached. */
  const run = (docker: string, start: PreviewContainerStart) =>
    Effect.gen(function* () {
      const { image } = start.input;
      const local = yield* query(docker, ["image", "inspect", "--format", "{{.Id}}", image]);
      if (local?.code !== 0) {
        // Cancelling here stops the pull, and no container exists yet to clean up.
        const pulled = yield* command(
          docker,
          ["pull", image],
          DOCKER_PULL_TIMEOUT,
          `Docker took more than 10 minutes to pull the image ${image}. Check the image name and the network, then try again.`,
        );
        if (pulled.code !== 0) {
          return yield* startFailure(pulled, { image, port: start.port, step: "pull" });
        }
      }
      const output = yield* command(
        docker,
        previewContainerRunArgs(start),
        DOCKER_RUN_TIMEOUT,
        "Docker took more than 2 minutes to start the container. Try again.",
      );
      if (output.code !== 0) {
        return yield* startFailure(output, { image, port: start.port, step: "run" });
      }
      const id = lastLine(output.stdout);
      if (!CONTAINER_ID_PATTERN.test(id)) {
        return yield* invalid("Docker started the container without reporting its id.");
      }
      return id.slice(0, CONTAINER_ID_LENGTH);
    });

  /** Null when Docker cannot say, such as while it is not running. */
  const running = (docker: string, containerId: string) =>
    query(docker, ["inspect", "-f", "{{.State.Running}}", containerId]).pipe(
      Effect.map((output) => {
        if (output === null) return null;
        if (output.code === 0) {
          const state = output.stdout.trim();
          return state === "true" ? true : state === "false" ? false : null;
        }
        return NO_SUCH_CONTAINER.test(output.stderr) ? false : null;
      }),
    );

  /** Whether the container is gone now, including when it already was. */
  const remove = (docker: string, containerId: string) =>
    query(docker, ["rm", "-f", containerId]).pipe(
      Effect.map(
        (output) => output !== null && (output.code === 0 || NO_SUCH_CONTAINER.test(output.stderr)),
      ),
    );

  /** Removes a link's containers by label, for a start that failed before reporting an id. */
  const removeLabelled = (docker: string, linkId: string) =>
    query(docker, ["ps", "-aq", "--filter", `label=${PREVIEW_LINK_LABEL}=${linkId}`]).pipe(
      Effect.flatMap((output) => {
        if (output === null || output.code !== 0) return Effect.succeed(false);
        const ids = output.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        return Effect.forEach(ids, (id) => remove(docker, id)).pipe(
          Effect.map((removed) => removed.every(Boolean)),
        );
      }),
    );

  return { run, running, remove, removeLabelled };
});

export type PreviewContainerOps = Effect.Success<typeof makePreviewContainerOps>;
