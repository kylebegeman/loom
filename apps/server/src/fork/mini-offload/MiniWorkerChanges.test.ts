// @effect-diagnostics nodeBuiltinImport:off - Real Git snapshots and receipt persistence are exercised in an owned temporary directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import {
  MINI_HOST_KEY_MISMATCH,
  MiniOffloadError,
  type MiniSubmit,
  type MiniWorker,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Config from "../../config.ts";
import * as Projects from "../../orchestration-v2/ProjectStore.ts";
import * as Threads from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Ssh from "./MiniSshTransport.ts";
import * as Mini from "./MiniOffloadService.ts";

const tid = ThreadId.make("mini-changes");
const worker: MiniWorker = {
  id: "pi-01",
  name: "Test Pi",
  target: "pi-test",
  sshConfig: null,
  enabled: true,
};
const request: MiniSubmit = {
  threadId: tid,
  workerId: worker.id,
  requestId: "c".repeat(32),
  label: "Moved worker",
  argv: ["true"],
  memoryMiB: 1024,
  cpuPercent: 100,
  timeoutSeconds: 60,
  committedOnly: false,
};
const job = {
  id: "d".repeat(32),
  state: "queued" as const,
  label: request.label,
  exit_code: null,
  reason: null,
};
const caps = {
  architecture: "aarch64",
  cpu_count: 8,
  toolsets: [{ id: "repository", missing: [] }],
  loom: { service_active: true },
  command_jobs: {
    may_start: true,
    worker_active: true,
    storage_available: true,
    slots: 2,
    active: 0,
    waiting_reasons: [],
    output_bundles: { supported: true },
  },
};
function partial<A extends object>(value: Partial<A>): A {
  return new Proxy(value as A, {
    get: (target, key) => {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}
const setup = Effect.gen(function* () {
  const home = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-mini-changes-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
  );
  const cwd = NodePath.join(home, "repo");
  NodeFS.mkdirSync(cwd);
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args]);
  git("init", "--quiet");
  NodeFS.writeFileSync(NodePath.join(cwd, "source.txt"), "baseline\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "--quiet", "-m", "Base");
  const reached: { target: string; sshConfig: string | null; action: string }[] = [];
  let failure: MiniOffloadError | null = null;
  // Runs once when a submission looks up its checkout, after it first checked the worker.
  let atCheckout: Effect.Effect<unknown, MiniOffloadError> = Effect.void;
  const transport: Ssh.MiniSshTransport["Service"] = {
    request: (destination, operation, header) =>
      Effect.gen(function* () {
        const action = operation === "receive" ? "receive" : (header as { action: string }).action;
        reached.push({ target: destination.target, sshConfig: destination.sshConfig, action });
        if (failure) return yield* failure;
        if (operation === "receive") {
          const revision = NodeChildProcess.execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim();
          return { request_id: request.requestId, source_revision: revision, job };
        }
        if (action === "capabilities" || action === "prepare-worker") return caps;
        if (action === "show") return { ...job, state: "succeeded", exit_code: 0 };
        return { job_id: job.id, text: "Finished\n", truncated: false };
      }),
  };
  const service = yield* Mini.MiniOffloadService.pipe(
    Effect.provide(
      Mini.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Config.layerTest(home, NodePath.join(home, "state")),
            ProcessRunner.layer,
            Layer.succeed(Ssh.MiniSshTransport, transport),
            Layer.succeed(
              Threads.ProjectionStoreV2,
              partial<Threads.ProjectionStoreV2["Service"]>({
                getThread: (id) => {
                  const run = atCheckout;
                  atCheckout = Effect.void;
                  return run.pipe(
                    Effect.orDie,
                    Effect.as({
                      id,
                      projectId: ProjectId.make("test-project"),
                      worktreePath: null,
                    } as OrchestrationV2AppThread),
                  );
                },
              }),
            ),
            Layer.succeed(
              Projects.ProjectStoreV2,
              partial<Projects.ProjectStoreV2["Service"]>({
                get: () =>
                  Effect.succeed(
                    Option.some({
                      projectId: ProjectId.make("test-project"),
                      workspaceRoot: cwd,
                    } as Projects.ProjectRow),
                  ),
              }),
            ),
          ).pipe(Layer.provide(NodeServices.layer)),
        ),
      ),
    ),
  );
  yield* service.register(worker);
  return {
    service,
    reached,
    sshConfig: NodePath.join(home, "ssh_config"),
    registry: NodePath.join(home, "state", "userdata", "fork", "mini-offload", "workers.json"),
    atCheckout: (effect: Effect.Effect<unknown, MiniOffloadError>) => {
      atCheckout = effect;
    },
    failWith: (error: MiniOffloadError | null) => {
      failure = error;
    },
  };
});
const ref = { threadId: tid, requestId: request.requestId };
describe("changing a Mini worker's registration", () => {
  it.effect("reaches a moved worker's earlier jobs through its new connection", () =>
    Effect.gen(function* () {
      const { service, reached, sshConfig } = yield* setup;
      yield* service.submit(request);
      expect(reached.map((call) => call.target)).toEqual([worker.target]);
      expect(
        yield* service.updateWorker({ workerId: worker.id, target: "pi-moved", sshConfig }),
      ).toEqual({ id: worker.id, name: worker.name, enabled: true });
      reached.length = 0;
      expect((yield* service.inspect(ref)).receipt.job?.state).toBe("succeeded");
      expect(reached).toEqual([
        { target: "pi-moved", sshConfig, action: "show" },
        { target: "pi-moved", sshConfig, action: "logs" },
      ]);
    }),
  );
  it.effect("keeps a removed worker's jobs listed at its last connection", () =>
    Effect.gen(function* () {
      const { service, reached, sshConfig } = yield* setup;
      yield* service.submit(request);
      yield* service.updateWorker({ workerId: worker.id, target: "pi-moved", sshConfig });
      yield* service.removeWorker({ workerId: worker.id });
      expect(yield* service.workers).toEqual([]);
      expect((yield* service.list(tid)).map((receipt) => receipt.workerName)).toEqual([
        worker.name,
      ]);
      expect(
        (yield* Effect.flip(service.submit({ ...request, requestId: "e".repeat(32) }))).reason,
      ).toBe("worker");
      // Another computer cannot take the removed ID, and with it the earlier jobs.
      expect((yield* Effect.flip(service.register({ ...worker, target: "pi-other" }))).reason).toBe(
        "worker",
      );
      reached.length = 0;
      yield* service.inspect(ref);
      expect(reached.map((call) => [call.target, call.sshConfig])).toEqual([
        ["pi-moved", sshConfig],
        ["pi-moved", sshConfig],
      ]);
      expect((yield* Effect.flip(service.removeWorker({ workerId: worker.id }))).reason).toBe(
        "worker",
      );
    }),
  );
  it.effect("reaches a job's saved connection when the registry cannot be read", () =>
    Effect.gen(function* () {
      const { service, reached, registry } = yield* setup;
      yield* service.submit(request);
      NodeFS.writeFileSync(registry, "not json");
      reached.length = 0;
      expect((yield* service.inspect(ref)).receipt.job?.state).toBe("succeeded");
      expect(reached.map((call) => call.target)).toEqual([worker.target, worker.target]);
    }),
  );
  it.effect("sends no job to a worker removed while its snapshot was prepared", () =>
    Effect.gen(function* () {
      const { service, reached, atCheckout } = yield* setup;
      atCheckout(service.removeWorker({ workerId: worker.id }));
      expect((yield* Effect.flip(service.submit(request))).reason).toBe("worker");
      expect(reached).toEqual([]);
      expect(yield* service.list(tid)).toEqual([]);
    }),
  );
  it.effect("reports a host key SSH refused as its own readiness reason", () =>
    Effect.gen(function* () {
      const { service, failWith } = yield* setup;
      failWith(new MiniOffloadError({ reason: "transfer", cause: new Ssh.HostKeyRejected() }));
      for (const report of [
        yield* service.check({ workerId: worker.id }),
        yield* service.prepare({ workerId: worker.id }),
      ]) {
        expect(report.status).toBe("unreachable");
        expect(report.reasons).toEqual([MINI_HOST_KEY_MISMATCH]);
      }
      failWith(new MiniOffloadError({ reason: "transfer" }));
      expect((yield* service.check({ workerId: worker.id })).reasons).toEqual([
        "connection_failed",
      ]);
      failWith(null);
      expect((yield* service.check({ workerId: worker.id })).status).toBe("ready");
    }),
  );
});
