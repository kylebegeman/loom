// @effect-diagnostics nodeBuiltinImport:off -- This POSIX terminal adapter owns its child process, local socket and public temporary files.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { VaultSshAgentRunInput } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as SshAgentClient from "./SshAgentClient.ts";
import { renderAgentSshLauncher } from "./ssh-agent-launcher.ts";

export class SshAgentTerminalError extends Schema.TaggedError<SshAgentTerminalError>()(
  "SshAgentTerminalError",
  {
    reason: Schema.Literals(["unsupported", "configuration", "failed", "timeout"]),
  },
) {
  override get message() {
    return this.reason === "unsupported"
      ? "Vault terminal SSH agents require macOS or Linux and host-bound OpenSSH."
      : this.reason === "configuration"
        ? "The SSH agent selection is invalid, expired or differs from the requested item version."
        : this.reason === "timeout"
          ? "The Vault terminal activation expired. Remote effects may already have occurred."
          : "The Vault terminal agent or child command could not complete.";
  }
}
type Failure =
  | SshAgentTerminalError
  | Effect.Error<ReturnType<SshAgentClient.SshAgentClient["Service"]["open"]>>;
export class SshAgentTerminal extends Context.Service<
  SshAgentTerminal,
  {
    readonly execute: (input: VaultSshAgentRunInput) => Effect.Effect<number, Failure>;
  }
>()("t3/fork/vault/SshAgentTerminal") {}
const isRun = Schema.is(VaultSshAgentRunInput);
const failed = () => new SshAgentTerminalError({ reason: "failed" });
// Bounds how long a child may leave its agent connection silent. Each frame waits on the Loom
// server's live Vault authorization, and on other sockets' frames ahead of it, so the timer is
// paused while a socket has a frame queued or being relayed. The client request timeout and the
// activation lifetime still bound that wait.
const AGENT_IDLE_MS = 15_000;
const make = Effect.gen(function* () {
  const client = yield* SshAgentClient.SshAgentClient,
    platform = yield* HostProcess.Platform,
    cwd = yield* HostProcess.WorkingDirectory,
    environment = yield* HostProcess.Environment;
  const execute = Effect.fn("SshAgentTerminal.execute")(function* (input: VaultSshAgentRunInput) {
    if (platform !== "darwin" && platform !== "linux")
      return yield* new SshAgentTerminalError({ reason: "unsupported" });
    if (!isRun(input)) return yield* new SshAgentTerminalError({ reason: "configuration" });
    return yield* Effect.gen(function* () {
      const selection =
        "connection" in input
          ? { connection: input.connection }
          : { id: input.id, expectedVersion: input.expectedVersion };
      const pin = "connection" in input ? input.connection : input;
      const session = yield* Effect.acquireRelease(client.open(selection), (s) =>
        client.close(s.sessionId).pipe(Effect.ignore),
      );
      const lifetime = Math.min(
        input.timeoutMs,
        session.expiresAt - (yield* Clock.currentTimeMillis),
      );
      if (
        ("id" in pin && (session.id !== pin.id || session.version !== pin.expectedVersion)) ||
        !session.target.hostKey ||
        lifetime <= 0 ||
        lifetime > 300_000
      )
        return yield* new SshAgentTerminalError({ reason: "configuration" });
      const directory = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            NodeFSP.mkdtemp(
              NodePath.join(
                platform === "darwin" ? "/private/tmp" : NodeOS.tmpdir(),
                "loom-vault-agent-",
              ),
            ),
          catch: failed,
        }),
        (p) =>
          Effect.promise(() => NodeFSP.rm(p, { recursive: true, force: true })).pipe(Effect.ignore),
      );
      const socketPath = NodePath.join(directory, "agent"),
        identity = NodePath.join(directory, "identity.pub"),
        knownHosts = NodePath.join(directory, "known_hosts"),
        launcher = NodePath.join(directory, "ssh");
      yield* Effect.tryPromise({
        try: async () => {
          await NodeFSP.chmod(directory, 0o700);
          await NodeFSP.writeFile(identity, session.publicKey + "\n", { mode: 0o600 });
          await NodeFSP.writeFile(
            knownHosts,
            `[${session.target.hostname}]:${session.target.port} ${session.target.hostKey}\n${session.target.hostname} ${session.target.hostKey}\n`,
            { mode: 0o600 },
          );
          await NodeFSP.writeFile(
            launcher,
            renderAgentSshLauncher(
              session,
              { socket: socketPath, identity, knownHosts },
              "connection" in input && "resource" in input.connection
                ? [input.connection.resource]
                : [],
            ),
            { mode: 0o700 },
          );
        },
        catch: failed,
      });
      const queue = yield* Queue.bounded<{
        socket: NodeNet.Socket;
        channelId: string;
        sequence: number;
        frame: Buffer;
        settle: () => void;
      }>(8);
      const denied = yield* Deferred.make<never, Failure>();
      const sockets = new Set<NodeNet.Socket>();
      yield* Effect.acquireRelease(
        Effect.callback<NodeNet.Server, SshAgentTerminalError>((resume) => {
          let accepted = false;
          const server = NodeNet.createServer((socket) => {
            if (sockets.size >= 4) {
              socket.destroy();
              return;
            }
            const channelId = NodeCrypto.randomBytes(16).toString("hex");
            let buffer = Buffer.alloc(0),
              sequence = 0,
              inFlight = 0;
            const settle = () => {
              if (--inFlight === 0 && !socket.destroyed) socket.setTimeout(AGENT_IDLE_MS);
            };
            sockets.add(socket);
            socket.setTimeout(AGENT_IDLE_MS);
            socket.on("timeout", () => socket.destroy());
            socket.on("error", () => socket.destroy());
            socket.on("close", () => sockets.delete(socket));
            socket.on("data", (chunk: Buffer) => {
              buffer = Buffer.concat([buffer, chunk]);
              if (buffer.length > 16_388) {
                socket.destroy();
                return;
              }
              while (buffer.length >= 4) {
                const size = buffer.readUInt32BE(0);
                if (size < 1 || size > 16_384 || sequence > 64) {
                  socket.destroy();
                  return;
                }
                if (buffer.length < size + 4) break;
                const frame = buffer.subarray(4, size + 4);
                buffer = buffer.subarray(size + 4);
                if (inFlight++ === 0) socket.setTimeout(0);
                if (
                  !Queue.offerUnsafe(queue, {
                    socket,
                    frame,
                    channelId,
                    sequence: sequence++,
                    settle,
                  })
                ) {
                  socket.destroy();
                  return;
                }
              }
            });
          });
          server.on("error", () => {
            if (!accepted) resume(Effect.fail(failed()));
          });
          server.listen(socketPath, () => {
            accepted = true;
            resume(Effect.succeed(server));
          });
          return Effect.sync(() => {
            if (!accepted) server.close();
          });
        }),
        (server) =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                for (const socket of sockets) socket.destroy();
                server.close(() => resolve());
              }),
          ),
      );
      yield* Effect.tryPromise({ try: () => NodeFSP.chmod(socketPath, 0o600), catch: failed });
      yield* Effect.gen(function* () {
        const request = yield* Queue.take(queue);
        yield* Effect.gen(function* () {
          if (request.socket.destroyed) return;
          const result = yield* client.frame({
            sessionId: session.sessionId,
            channelId: request.channelId,
            sequence: request.sequence,
            frame: request.frame.toString("base64"),
          });
          const response = Buffer.from(result.response, "base64");
          if (
            !response.length ||
            response.length > 16_384 ||
            response.toString("base64") !== result.response
          )
            return yield* failed();
          if (!request.socket.destroyed) {
            const length = Buffer.alloc(4);
            length.writeUInt32BE(response.length);
            request.socket.write(Buffer.concat([length, response]));
          }
        }).pipe(Effect.ensuring(Effect.sync(request.settle)));
      }).pipe(
        Effect.catch((e) => Deferred.fail(denied, e).pipe(Effect.asVoid)),
        Effect.forever,
        Effect.forkScoped,
      );
      // Child configuration deliberately excludes MCP bearer credentials and personal SSH/Git settings.
      const childEnvironment: NodeJS.ProcessEnv = {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        SSH_AUTH_SOCK: socketPath,
        SSH_ASKPASS_REQUIRE: "never",
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_SSH: launcher,
        GIT_SSH_VARIANT: "ssh",
        LC_ALL: "C",
        ...(environment.TERM ? { TERM: environment.TERM } : {}),
      };
      const git = input.command.tool === "git";
      const argv = git
        ? [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "credential.helper=",
            "-c",
            "protocol.allow=never",
            "-c",
            "protocol.ssh.allow=always",
            ...input.command.argv,
          ]
        : input.command.argv;
      const run = Effect.callback<number, SshAgentTerminalError>((resume) => {
        const child = NodeChildProcess.spawn(git ? "/usr/bin/git" : launcher, argv, {
          cwd,
          env: childEnvironment,
          detached: true,
          stdio: "inherit",
        });
        let closed = false;
        child.on("error", () => resume(Effect.fail(failed())));
        child.on("close", (code, signal) => {
          closed = true;
          resume(
            Effect.succeed(code ?? (signal ? 128 + (NodeOS.constants.signals[signal] ?? 1) : 1)),
          );
        });
        return Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              if (closed) {
                resolve();
                return;
              }
              child.once("close", () => resolve());
              if (child.pid !== undefined) {
                try {
                  NodeProcess.kill(-child.pid, "SIGKILL");
                } catch {
                  if (child.exitCode === null) child.kill("SIGKILL");
                }
              }
            }),
        );
      });
      return yield* Effect.raceFirst(run, Deferred.await(denied)).pipe(
        Effect.timeout(lifetime),
        Effect.catchTags({
          TimeoutError: () => Effect.fail(new SshAgentTerminalError({ reason: "timeout" })),
        }),
      );
    }).pipe(Effect.scoped);
  });
  return SshAgentTerminal.of({ execute });
});
export const layer = Layer.effect(SshAgentTerminal, make);
