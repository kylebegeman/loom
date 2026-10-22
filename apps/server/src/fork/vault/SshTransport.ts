// @effect-diagnostics nodeBuiltinImport:off -- Scoped Node SSH adapter owns its agent socket, temporary public files and child process.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeChildProcess from "node:child_process";
import {
  VaultError,
  VaultConnectionError,
  VaultSshError,
  VaultWorkloadError,
  type VaultSshTarget,
  type VaultSshCommand,
  type VaultGitCommand,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SshCrypto from "./SshCrypto.ts";

type Failure = VaultError | VaultSshError | VaultWorkloadError | VaultConnectionError;
export class SshTransport extends Context.Service<
  SshTransport,
  {
    readonly execute: (input: {
      target: VaultSshTarget;
      publicKey: string;
      privateKey: Redacted.Redacted<string>;
      command: VaultSshCommand | VaultGitCommand;
      // Repository verification must not inherit local executable or URL configuration.
      isolatedGit?: boolean;
      authorize: Effect.Effect<void, Failure>;
    }) => Effect.Effect<{ exitCode: number; stdout: string }, Failure>;
  }
>()("t3/fork/vault/SshTransport") {}
const failed = () => new VaultSshError({ reason: "failed" });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const make = Effect.gen(function* () {
  const crypto = yield* SshCrypto.SshCrypto,
    platform = yield* HostProcess.Platform;
  return SshTransport.of({
    execute: Effect.fn("SshTransport.execute")(function* (input) {
      if (platform !== "darwin" && platform !== "linux")
        return yield* new VaultSshError({ reason: "unsupported" });
      if (!input.target.hostKey) return yield* new VaultSshError({ reason: "untrusted-host" });
      return yield* Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              NodeFSP.mkdtemp(
                NodePath.join(
                  platform === "darwin" ? "/private/tmp" : NodeOS.tmpdir(),
                  "loom-ssh-",
                ),
              ),
            catch: failed,
          }),
          (path) =>
            Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })).pipe(
              Effect.ignore,
            ),
        );
        const socketPath = NodePath.join(directory, "agent"),
          identityFile = NodePath.join(directory, "identity.pub"),
          knownFile = NodePath.join(directory, "known_hosts");
        yield* Effect.tryPromise({
          try: async () => {
            await NodeFSP.chmod(directory, 0o700);
            await NodeFSP.writeFile(identityFile, input.publicKey + "\n", { mode: 0o600 });
            await NodeFSP.writeFile(
              knownFile,
              `[${input.target.hostname}]:${input.target.port} ${input.target.hostKey}\n${input.target.hostname} ${input.target.hostKey}\n`,
              { mode: 0o600 },
            );
          },
          catch: failed,
        });
        const queue = yield* Queue.bounded<{ socket: NodeNet.Socket; frame: Buffer }>(8);
        const denial = yield* Deferred.make<never, Failure>();
        const sockets = new Set<NodeNet.Socket>(),
          bindings = new Map<NodeNet.Socket, SshCrypto.SshBinding>();
        let signed = false;
        yield* Effect.acquireRelease(
          Effect.callback<NodeNet.Server, VaultSshError>((resume) => {
            const server = NodeNet.createServer((socket) => {
              if (sockets.size >= 4) {
                socket.destroy();
                return;
              }
              sockets.add(socket);
              let buffer = Buffer.alloc(0);
              socket.setTimeout(3000, () => socket.destroy());
              socket.on("error", () => socket.destroy());
              socket.on("close", () => {
                sockets.delete(socket);
                bindings.delete(socket);
              });
              socket.on("data", (chunk: Buffer) => {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > 16388) {
                  socket.destroy();
                  return;
                }
                while (buffer.length >= 4) {
                  const length = buffer.readUInt32BE(0);
                  if (length < 1 || length > 16384) {
                    socket.destroy();
                    return;
                  }
                  if (buffer.length < length + 4) break;
                  const frame = buffer.subarray(4, length + 4);
                  buffer = buffer.subarray(length + 4);
                  if (!Queue.offerUnsafe(queue, { socket, frame })) {
                    socket.destroy();
                    return;
                  }
                }
              });
            });
            server.on("error", () => resume(Effect.fail(failed())));
            server.listen(socketPath, () => resume(Effect.succeed(server)));
            return Effect.sync(() => {
              if (!server.listening) server.close();
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
          const { socket, frame } = yield* Queue.take(queue);
          if (socket.destroyed) return;
          yield* input.authorize;
          if (frame[0] === 13 && signed) return yield* failed();
          const result = yield* crypto.respond({
            ...input,
            frame,
            binding: bindings.get(socket) ?? null,
          });
          if (result.binding) bindings.set(socket, result.binding);
          if (result.signed) signed = true;
          socket.write(
            Buffer.concat([SshCrypto.sshUint32(result.response.length), result.response]),
          );
        }).pipe(
          Effect.catch((error) => Deferred.fail(denial, error).pipe(Effect.asVoid)),
          Effect.forever,
          Effect.forkScoped,
        );
        yield* input.authorize;
        const options = [
          "BatchMode=yes",
          "IdentitiesOnly=yes",
          `IdentityAgent=${socketPath}`,
          `IdentityFile=${identityFile}`,
          "AddKeysToAgent=no",
          "PasswordAuthentication=no",
          "KbdInteractiveAuthentication=no",
          "PreferredAuthentications=publickey",
          "PubkeyAuthentication=host-bound",
          "HostKeyAlgorithms=ssh-ed25519",
          `UserKnownHostsFile=${knownFile}`,
          "GlobalKnownHostsFile=/dev/null",
          "StrictHostKeyChecking=yes",
          "UpdateHostKeys=no",
          "VerifyHostKeyDNS=no",
          "CanonicalizeHostname=no",
          "ProxyCommand=none",
          "ProxyJump=none",
          "ForwardAgent=no",
          "ClearAllForwardings=yes",
          "RequestTTY=no",
          "ControlMaster=no",
          "ControlPath=none",
          "ControlPersist=no",
          "EscapeChar=none",
          "PermitLocalCommand=no",
          "ConnectionAttempts=1",
          "ConnectTimeout=3",
        ];
        const git = "kind" in input.command ? input.command : null;
        const sshArgs = [
          "-F",
          "none",
          ...options.flatMap((option) => ["-o", option]),
          "-T",
          "-p",
          String(input.target.port),
          "-l",
          input.target.username,
        ];
        const gitUrl = `ssh://${input.target.username}@${input.target.hostname}:${input.target.port}/${git?.repository ?? ""}`;
        const sshCommand = ["/usr/bin/ssh", ...sshArgs].map(quote).join(" ");
        const args = git
          ? [
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "credential.helper=",
              "-c",
              "protocol.allow=never",
              "-c",
              "protocol.ssh.allow=always",
              "-c",
              `core.sshCommand=${sshCommand}`,
              ...(git.action === "fetch"
                ? [
                    "fetch",
                    "--no-tags",
                    "--no-recurse-submodules",
                    "--no-auto-maintenance",
                    "--",
                    gitUrl,
                  ]
                : ["ls-remote", "--refs", "--", gitUrl]),
            ]
          : [
              ...sshArgs,
              "--",
              input.target.hostname,
              ("kind" in input.command ? [] : input.command.argv).map(quote).join(" "),
            ];
        const run = Effect.callback<{ exitCode: number; stdout: string }, VaultSshError>(
          (resume) => {
            const child = NodeChildProcess.spawn(git ? "/usr/bin/git" : "/usr/bin/ssh", args, {
              ...(git ? { cwd: input.isolatedGit ? directory : git.cwd } : {}),
              detached: true,
              env: {
                PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
                LC_ALL: "C",
                HOME: directory,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
                GIT_TERMINAL_PROMPT: "0",
                GIT_SSH_VARIANT: "ssh",
              },
              stdio: ["ignore", "pipe", "pipe"],
            });
            let bytes = 0,
              closed = false,
              finished = false;
            const chunks: Buffer[] = [];
            const finish = (
              value: Effect.Effect<{ exitCode: number; stdout: string }, VaultSshError>,
            ) => {
              if (finished) return;
              finished = true;
              resume(value);
            };
            child.on("error", () => finish(Effect.fail(failed())));
            child.stderr.resume();
            child.stdout.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > (git ? 65536 : 2048))
                finish(Effect.fail(new VaultSshError({ reason: "output-limit" })));
              else chunks.push(chunk);
            });
            child.on("close", (code) => {
              closed = true;
              finish(
                code === null || code === 255 || !signed
                  ? Effect.fail(failed())
                  : Effect.succeed({
                      exitCode: code,
                      stdout: Buffer.concat(chunks).toString("utf8"),
                    }),
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
          },
        );
        return yield* Effect.raceFirst(run, Deferred.await(denial));
      }).pipe(
        Effect.scoped,
        Effect.timeout(input.command.timeoutMs),
        Effect.catchTags({
          TimeoutError: () => Effect.fail(new VaultSshError({ reason: "timeout" })),
        }),
      );
    }),
  });
});
export const layer = Layer.effect(SshTransport, make);
