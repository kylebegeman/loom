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
function childWith(output: string, closes = true) {
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
      child.stdout.write(output);
      if (closes) {
        child.exitCode = 0;
        child.emit("close", 0);
      }
    });
    return child as unknown as ReturnType<typeof NodeChildProcess.spawn>;
  });
  return child;
}
describe("Mini SSH transport", () => {
  it.effect("accepts a full log tail even when JSON escaping expands its wire size", () =>
    Effect.gen(function* () {
      const logs = { job_id: "a".repeat(32), text: "\0".repeat(1024 * 1024), truncated: true };
      childWith(JSON.stringify(logs));
      const ssh = yield* Ssh.MiniSshTransport;
      expect(
        yield* ssh.request(worker, "rpc", {
          schema_version: 1,
          action: "logs",
          job_id: logs.job_id,
        }),
      ).toEqual(logs);
    }).pipe(Effect.provide(Ssh.layer)),
  );
  it.effect("accepts output bundles above the small metadata response limit", () =>
    Effect.gen(function* () {
      const bundle = { artifacts_base64: Buffer.alloc(3 * 1024 * 1024).toString("base64") };
      childWith(JSON.stringify(bundle));
      const ssh = yield* Ssh.MiniSshTransport;
      expect(yield* ssh.request(worker, "rpc", { action: "artifacts" })).toEqual(bundle);
    }).pipe(Effect.provide(Ssh.layer)),
  );
  it.effect("refuses oversized output and terminates the owned SSH process", () =>
    Effect.gen(function* () {
      const child = childWith("x".repeat(8 * 1024 * 1024), false);
      const ssh = yield* Ssh.MiniSshTransport;
      expect(
        (yield* ssh.request(worker, "rpc", { action: "logs" }).pipe(Effect.asVoid, Effect.flip))
          .reason,
      ).toBe("transfer");
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(child.stdin.destroyed).toBe(true);
    }).pipe(Effect.provide(Ssh.layer)),
  );
  it.effect("refuses malformed JSON without exposing remote stderr", () =>
    Effect.gen(function* () {
      childWith("not JSON");
      const ssh = yield* Ssh.MiniSshTransport;
      const error = yield* ssh
        .request(worker, "rpc", { action: "show" })
        .pipe(Effect.asVoid, Effect.flip);
      expect(error.reason).toBe("response");
      expect(error.message).not.toContain("not JSON");
    }).pipe(Effect.provide(Ssh.layer)),
  );
});
