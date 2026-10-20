// @effect-diagnostics nodeBuiltinImport:off - Binary SSH stdin adapter owns its subprocess and file stream.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import type { MiniWorker } from "@t3tools/contracts/fork";
import { MiniOffloadError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";

export class MiniSshTransport extends Context.Service<
  MiniSshTransport,
  {
    readonly request: (
      worker: MiniWorker,
      operation: "receive" | "rpc",
      header: object,
      archive?: string,
    ) => Effect.Effect<unknown, MiniOffloadError>;
  }
>()("t3/fork/mini-offload/MiniSshTransport") {}

const MIB = 1024 * 1024;
// Enough of stderr to find OpenSSH's verdict line. It stays in memory and is never returned.
const STDERR_TAIL_BYTES = 4096;
// OpenSSH exits 255 for its own failures, and prints this line when the known host key differs or is missing.
const SSH_FAILURE_EXIT = 255;
const HOST_KEY_FAILED = /^Host key verification failed\.\r?$/m;

/** The cause of a transfer failure where SSH refused the worker's host key. Carries no SSH output. */
export class HostKeyRejected extends Error {
  constructor() {
    super("SSH refused the worker's host key.");
    this.name = "HostKeyRejected";
  }
}
export const isHostKeyRejected = (error: MiniOffloadError) =>
  error.cause instanceof HostKeyRejected;
const RPC_DEADLINE = Duration.seconds(120);
// LoomOS gives a snapshot upload 1800 s, so wait a little longer to hear whether it accepted the job.
// ServerAlive still ends a dead connection within a minute.
const RECEIVE_DEADLINE = Duration.seconds(1800 + 120);

/** Nothing from the job is interpolated into the SSH command. Host configuration is administrator owned. */
const sshArguments = (worker: MiniWorker, operation: "receive" | "rpc") => [
  ...(worker.sshConfig === null ? [] : ["-F", worker.sshConfig]),
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=8",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=2",
  "--",
  worker.target,
  `/usr/local/bin/loom-mini jobs ${operation}`,
];

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeHeader = (header: object) => encodeJson(header) + "\n";
const parseResponse = (data: Buffer) => decodeJson(data.toString("utf8"));

const request: MiniSshTransport["Service"]["request"] = (worker, operation, header, archive) =>
  Effect.callback<unknown, MiniOffloadError>((resume) => {
    const child = NodeChildProcess.spawn("ssh", sshArguments(worker, operation), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    // JSON base64 of a 64 MiB result plus bounded metadata.
    const maxBytes =
      operation === "rpc" &&
      "action" in header &&
      (header.action === "patch" || header.action === "artifacts")
        ? 90 * MIB
        : operation === "rpc" && "action" in header && header.action === "logs"
          ? // JSON escapes can expand a 1 MiB log tail to 6 MiB.
            7 * MIB
          : 2 * MIB;
    let bytes = 0;
    let stderrTail = Buffer.alloc(0);
    let stdinFailed = false;
    let done = false;
    let source: NodeFS.ReadStream | undefined;
    const finish = (value: Effect.Effect<unknown, MiniOffloadError>) => {
      if (done) return;
      done = true;
      source?.destroy();
      child.stdin.destroy();
      if (child.exitCode === null) child.kill("SIGKILL");
      resume(value);
    };
    const fail = () => finish(Effect.fail(new MiniOffloadError({ reason: "transfer" })));
    child.on("error", fail);
    // SSH that refuses the host key exits before reading stdin, so the write fails with EPIPE first.
    // Let the exit decide the failure instead.
    child.stdin.on("error", () => {
      stdinFailed = true;
      source?.destroy();
    });
    // Never return SSH output containing local configuration or credentials.
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-STDERR_TAIL_BYTES);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail();
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (code === SSH_FAILURE_EXIT && bytes === 0 && HOST_KEY_FAILED.test(stderrTail.toString()))
        return finish(
          Effect.fail(new MiniOffloadError({ reason: "transfer", cause: new HostKeyRejected() })),
        );
      if (code !== 0 || stdinFailed) return fail();
      try {
        finish(Effect.succeed(parseResponse(Buffer.concat(chunks))));
      } catch {
        finish(Effect.fail(new MiniOffloadError({ reason: "response" })));
      }
    });
    child.stdin.write(encodeHeader(header));
    if (archive) {
      source = NodeFS.createReadStream(archive);
      source.on("error", fail);
      source.pipe(child.stdin);
    } else child.stdin.end();
    return Effect.sync(() => {
      done = true;
      source?.destroy();
      child.stdin.destroy();
      if (child.exitCode === null) child.kill("SIGKILL");
    });
  }).pipe(
    Effect.timeout(operation === "receive" ? RECEIVE_DEADLINE : RPC_DEADLINE),
    Effect.mapError((cause) =>
      cause._tag === "MiniOffloadError"
        ? cause
        : new MiniOffloadError({ reason: "transfer", cause }),
    ),
  );
export const layer = Layer.succeed(MiniSshTransport, { request });
