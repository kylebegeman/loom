// @effect-diagnostics nodeBuiltinImport:off - Native stream events exercise the SSH boundary without contacting a destination.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Ssh from "./MiniSshTransport.ts";
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const worker = { id: "pi", name: "Pi", target: "pi", sshConfig: null, enabled: true };
const REFUSED = [
  "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
  "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
  "Offending ECDSA key in /home/admin/.ssh/known_hosts:7",
  "Host key verification failed.",
  "",
].join("\r\n");
/** An SSH child that writes `stderr`, optionally `stdout`, then exits with `code`. */
function sshExits(code: number, stderr: string, stdout = "", stdinBreaks = false) {
  const child = Object.assign(new NodeEvents.EventEmitter(), {
    stdin: new NodeStream.PassThrough(),
    stdout: new NodeStream.PassThrough(),
    stderr: new NodeStream.PassThrough(),
    exitCode: null as number | null,
    kill: vi.fn(() => true),
  });
  child.stdin.resume();
  vi.mocked(NodeChildProcess.spawn).mockImplementationOnce(() => {
    queueMicrotask(() => {
      // SSH that refuses the key exits before reading stdin, so writing the header breaks first.
      if (stdinBreaks)
        child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      child.stderr.write(stderr);
      if (stdout) child.stdout.write(stdout);
      setImmediate(() => {
        child.exitCode = code;
        child.emit("close", code);
      });
    });
    return child as unknown as ReturnType<typeof NodeChildProcess.spawn>;
  });
  return child;
}
const capabilities = Effect.gen(function* () {
  const ssh = yield* Ssh.MiniSshTransport;
  return yield* ssh
    .request(worker, "rpc", { schema_version: 1, action: "capabilities" })
    .pipe(Effect.asVoid, Effect.flip);
}).pipe(Effect.provide(Ssh.layer));
describe("Mini SSH host key failures", () => {
  it.effect("names a refused host key even when the request header could not be written", () =>
    Effect.gen(function* () {
      sshExits(255, REFUSED, "", true);
      const error = yield* capabilities;
      expect(error.reason).toBe("transfer");
      expect(Ssh.isHostKeyRejected(error)).toBe(true);
      // SSH output can name local paths and accounts; none of it leaves the transport.
      expect(JSON.stringify({ message: error.message, cause: String(error.cause) })).not.toContain(
        "known_hosts",
      );
    }),
  );
  it.effect("keeps other SSH failures as plain transfer failures", () =>
    Effect.gen(function* () {
      sshExits(255, "ssh: connect to host pi port 22: Connection refused\r\n");
      expect(Ssh.isHostKeyRejected(yield* capabilities)).toBe(false);
      // The worker's own command printing the phrase is not SSH refusing the key.
      sshExits(1, REFUSED);
      expect(Ssh.isHostKeyRejected(yield* capabilities)).toBe(false);
      sshExits(255, REFUSED, '{"partial":');
      expect(Ssh.isHostKeyRejected(yield* capabilities)).toBe(false);
    }),
  );
  it.effect("fails a request whose header broke even if SSH then exits cleanly", () =>
    Effect.gen(function* () {
      sshExits(0, "", "{}", true);
      const error = yield* capabilities;
      expect(error.reason).toBe("transfer");
      expect(Ssh.isHostKeyRejected(error)).toBe(false);
    }),
  );
});
