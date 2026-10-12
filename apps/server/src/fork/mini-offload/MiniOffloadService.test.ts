// @effect-diagnostics nodeBuiltinImport:off - Real Git snapshots and receipt persistence are exercised in an owned temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import { MiniOffloadError, type MiniSubmit, type MiniWorker } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Config from "../../config.ts";
import * as Projects from "../../orchestration-v2/ProjectStore.ts";
import * as Threads from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Ssh from "./MiniSshTransport.ts";
import * as Mini from "./MiniOffloadService.ts";
const tid = ThreadId.make("mini-thread");
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
  requestId: "a".repeat(32),
  label: "Mini test",
  argv: ["printf", "%s", "hello"],
  memoryMiB: 1024,
  cpuPercent: 200,
  timeoutSeconds: 60,
  committedOnly: false,
};
const job = {
  id: "b".repeat(32),
  state: "queued" as const,
  label: request.label,
  exit_code: null,
  reason: null,
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
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-mini-native-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
  );
  const cwd = NodePath.join(home, "repo");
  NodeFS.mkdirSync(cwd);
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", ...args], {
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  NodeFS.writeFileSync(NodePath.join(cwd, "source.txt"), "baseline\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "--quiet",
    "-m",
    "Baseline",
  );
  const base = NodePath.join(home, "state");
  const state = NodePath.join(base, "userdata");
  const calls: { worker: MiniWorker; operation: string; header: object; archive?: string }[] = [];
  let mode: "normal" | "lost" | "wrong" | "badPatch" = "normal";
  let artifactOverrides: Record<string, unknown> = {};
  let caps: object = {
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
  const transport: Ssh.MiniSshTransport["Service"] = {
    request: (destination, operation, header, archive) =>
      Effect.gen(function* () {
        calls.push({ worker: destination, operation, header, ...(archive ? { archive } : {}) });
        if (operation === "receive") {
          // The receipt must exist before any bytes could be accepted by a destination.
          const saved = JSON.parse(
            NodeFS.readFileSync(
              NodePath.join(state, "fork", "mini-offload", request.requestId, "receipt.json"),
              "utf8",
            ),
          );
          expect(saved.receipt.state).toBe("transfer_pending");
          if (mode === "lost") return yield* new MiniOffloadError({ reason: "transfer" });
          return {
            request_id: mode === "wrong" ? "f".repeat(32) : request.requestId,
            source_revision: saved.receipt.sourceRevision,
            job,
          };
        }
        const action = (header as { action: string }).action;
        if (action === "capabilities" || action === "prepare-worker") {
          if (mode === "lost") return yield* new MiniOffloadError({ reason: "transfer" });
          return caps;
        }
        if (action === "show") return { ...job, state: "succeeded", exit_code: 0 };
        if (action === "cancel") return { ...job, state: "cancelled", reason: "user_cancel" };
        if (action === "logs") return { job_id: job.id, text: "Finished\n", truncated: false };
        if (action === "artifacts") {
          const bytes = Buffer.from("saved bundle");
          return {
            schema_version: 1,
            job_id: job.id,
            bytes: bytes.length,
            sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
            files: [{ path: "dist/result.bin", bytes: 3, sha256: "c".repeat(64) }],
            missing: ["report.txt"],
            artifacts_base64: bytes.toString("base64"),
            ...artifactOverrides,
          };
        }
        const bytes = Buffer.from("diff --git a/source.txt b/source.txt\n");
        return {
          job_id: job.id,
          source_revision: git("rev-parse", "HEAD"),
          patch_base64: bytes.toString("base64"),
          sha256:
            mode === "badPatch"
              ? "0".repeat(64)
              : NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
        };
      }),
  };
  const dependencies = Layer.mergeAll(
    Config.layerTest(home, base),
    ProcessRunner.layer,
    Layer.succeed(Ssh.MiniSshTransport, transport),
    Layer.succeed(
      Threads.ProjectionStoreV2,
      partial<Threads.ProjectionStoreV2["Service"]>({
        getThread: (id) =>
          Effect.succeed({
            id,
            projectId: ProjectId.make("test-project"),
            worktreePath: null,
          } as OrchestrationV2AppThread),
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
  ).pipe(Layer.provide(NodeServices.layer));
  const makeService = Mini.MiniOffloadService.pipe(
    Effect.provide(Mini.layer.pipe(Layer.provide(dependencies))),
  );
  const service = yield* makeService;
  yield* service.register(worker);
  return {
    service,
    makeService,
    cwd,
    git,
    state,
    calls,
    capabilities: (value: object) => {
      caps = value;
    },
    artifacts: (value: Record<string, unknown>) => {
      artifactOverrides = value;
    },
    mode: (value: typeof mode) => {
      mode = value;
    },
  };
});
const ref = { threadId: tid, requestId: request.requestId };
describe("native Mini offloading", () => {
  it.effect(
    "persists output declarations before acceptance and recovers them unchanged after restart",
    () =>
      Effect.gen(function* () {
        const { service, makeService, mode, calls, state } = yield* setup;
        const input = { ...request, outputs: ["dist/result.bin", "report.txt"] };
        mode("lost");
        expect((yield* Effect.flip(service.submit(input))).reason).toBe("transfer");
        expect(
          JSON.parse(
            NodeFS.readFileSync(
              NodePath.join(state, "fork", "mini-offload", request.requestId, "receipt.json"),
              "utf8",
            ),
          ).receipt.request.outputs,
        ).toEqual(input.outputs);
        const restarted = yield* makeService;
        mode("normal");
        const recovered = yield* restarted.recover(ref);
        expect(recovered.request.outputs).toEqual(input.outputs);
        expect(calls[1]?.header).toEqual(calls[0]?.header);
        expect(calls[0]?.header).toMatchObject({ outputs: input.outputs });
        yield* restarted.submit(input);
        expect(calls).toHaveLength(2);
        expect(
          (yield* Effect.flip(restarted.submit({ ...input, outputs: ["another.bin"] }))).reason,
        ).toBe("conflict");
      }),
  );
  it.effect(
    "collects a verified saved bundle with explicit missing files and isolates receipt ownership",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* setup;
        yield* service.submit({ ...request, outputs: ["dist/result.bin", "report.txt"] });
        const result = yield* service.artifacts(ref);
        expect(Buffer.from(result.artifactsBase64, "base64").toString()).toBe("saved bundle");
        expect(result.missing).toEqual(["report.txt"]);
        const before = calls.length;
        expect(
          (yield* Effect.flip(
            service.artifacts({ ...ref, threadId: ThreadId.make("other-thread") }),
          )).reason,
        ).toBe("conflict");
        expect(calls).toHaveLength(before);
      }),
  );
  it.effect("refuses undeclared, mismatched, duplicate, corrupt and oversized output bundles", () =>
    Effect.gen(function* () {
      const { service, artifacts } = yield* setup;
      yield* service.submit({ ...request, outputs: ["dist/result.bin", "report.txt"] });
      for (const overrides of [
        { job_id: "d".repeat(32) },
        { sha256: "0".repeat(64) },
        { bytes: 10 },
        { bytes: 64 * 1024 * 1024 + 1 },
        { artifacts_base64: Buffer.from("saved bundle").toString("base64") + "\n" },
        { missing: ["unexpected.txt"] },
        { missing: [] },
        { missing: ["dist/result.bin"] },
        { files: [{ path: "../private", bytes: 3, sha256: "c".repeat(64) }] },
        { schema_version: 2 },
        {
          files: [
            { path: "dist/result.bin", bytes: 60 * 1024 * 1024, sha256: "c".repeat(64) },
            { path: "report.txt", bytes: 1, sha256: "c".repeat(64) },
          ],
          missing: [],
        },
      ]) {
        artifacts(overrides);
        expect((yield* Effect.flip(service.artifacts(ref))).reason).toBe("artifacts");
      }
    }),
  );
  it.effect(
    "keeps legacy receipts usable without sending output headers or offering undeclared bundles",
    () =>
      Effect.gen(function* () {
        const { service, makeService, calls } = yield* setup;
        yield* service.submit(request);
        expect(calls[0]?.header).not.toHaveProperty("outputs");
        const restarted = yield* makeService;
        expect((yield* restarted.list(tid))[0]?.request).not.toHaveProperty("outputs");
        expect((yield* restarted.inspect(ref)).receipt.job?.state).toBe("succeeded");
        const before = calls.length;
        expect((yield* Effect.flip(restarted.artifacts(ref))).reason).toBe("artifacts");
        expect(calls).toHaveLength(before);
      }),
  );
  it.effect("rejects invalid declarations before creating a receipt or contacting a worker", () =>
    Effect.gen(function* () {
      const { service, calls, state } = yield* setup;
      for (const outputs of [
        [""],
        ["."],
        ["../x"],
        ["/x"],
        ["a/../b"],
        ["a/.git/config"],
        ["a//b"],
        ["a/./b"],
        ["a/"],
        ["a\\b"],
        ["a\n"],
        ["same", "same"],
        ["x".repeat(513)],
        Array.from({ length: 33 }, (_, i) => `file-${i}`),
      ])
        yield* Effect.flip(service.submit({ ...request, outputs }));
      expect(calls).toHaveLength(0);
      expect(
        NodeFS.existsSync(
          NodePath.join(state, "fork", "mini-offload", request.requestId, "receipt.json"),
        ),
      ).toBe(false);
    }),
  );
  it.effect("omits binary content for agents unless they explicitly request it", () =>
    Effect.gen(function* () {
      const { service } = yield* setup;
      yield* service.submit({ ...request, outputs: ["dist/result.bin", "report.txt"] });
      const summary = yield* service.agentArtifacts(ref);
      expect(summary.artifactsBase64).toBeNull();
      expect(summary.missing).toEqual(["report.txt"]);
      expect((yield* service.agentArtifacts({ ...ref, includeBundle: true })).artifactsBase64).toBe(
        Buffer.from("saved bundle").toString("base64"),
      );
    }),
  );
  it.effect("serializes concurrent submissions of one request without dispatching twice", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup;
      const receipts = yield* Effect.forEach(
        Array.from({ length: 8 }, () => request),
        (input) => service.submit(input),
        { concurrency: "unbounded" },
      );
      expect(new Set(receipts.map((receipt) => receipt.job?.id)).size).toBe(1);
      expect(calls).toHaveLength(1);
    }),
  );
  it.effect("bounds archive generation and removes an oversized partial snapshot", () =>
    Effect.gen(function* () {
      const { service, calls, cwd, git, state } = yield* setup;
      NodeFS.writeFileSync(NodePath.join(cwd, "large.bin"), Buffer.alloc(64 * 1024 * 1024));
      git("add", ".");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@localhost",
        "commit",
        "--quiet",
        "-m",
        "Large",
      );
      expect((yield* Effect.flip(service.submit(request))).reason).toBe("storage");
      const directory = NodePath.join(state, "fork", "mini-offload", request.requestId);
      expect(NodeFS.existsSync(NodePath.join(directory, "source.tar"))).toBe(false);
      expect(NodeFS.existsSync(NodePath.join(directory, "receipt.json"))).toBe(false);
      expect(calls).toHaveLength(0);
    }),
  );
  it.effect("saves a private receipt before transfer and deduplicates repeated submissions", () =>
    Effect.gen(function* () {
      const { service, calls, state } = yield* setup;
      const first = yield* service.submit(request);
      expect(first.job?.id).toBe(job.id);
      expect(yield* service.submit(request)).toEqual(first);
      expect(calls).toHaveLength(1);
      expect(
        NodeFS.statSync(
          NodePath.join(state, "fork", "mini-offload", request.requestId, "receipt.json"),
        ).mode & 0o777,
      ).toBe(0o600);
      expect(NodeFS.statSync(calls[0]!.archive!).mode & 0o777).toBe(0o600);
    }),
  );
  it.effect(
    "recovers an uncertain acceptance after restart using the original archive and connection",
    () =>
      Effect.gen(function* () {
        const { service, makeService, calls, mode, cwd, git } = yield* setup;
        mode("lost");
        expect((yield* Effect.flip(service.submit(request))).reason).toBe("transfer");
        const original = NodeFS.readFileSync(calls[0]!.archive!);
        NodeFS.writeFileSync(NodePath.join(cwd, "source.txt"), "new head\n");
        git("add", ".");
        git(
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@localhost",
          "commit",
          "--quiet",
          "-m",
          "Changed",
        );
        const restarted = yield* makeService;
        yield* restarted.setEnabled({ workerId: worker.id, enabled: false });
        mode("normal");
        const receipt = yield* restarted.recover(ref);
        expect(receipt.job?.id).toBe(job.id);
        expect(calls[1]?.worker.target).toBe(worker.target);
        expect(calls[1]?.header).toEqual(calls[0]?.header);
        expect(NodeFS.readFileSync(calls[1]!.archive!)).toEqual(original);
      }),
  );
  it.effect("refuses specification changes or another thread reusing a receipt", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup;
      yield* service.submit(request);
      expect((yield* Effect.flip(service.submit({ ...request, argv: ["false"] }))).reason).toBe(
        "conflict",
      );
      expect(
        (yield* Effect.flip(service.recover({ ...ref, threadId: ThreadId.make("other-thread") })))
          .reason,
      ).toBe("conflict");
      expect(calls).toHaveLength(1);
    }),
  );
  it.effect("refuses dirty work unless committed-only is explicit", () =>
    Effect.gen(function* () {
      const { service, cwd, calls } = yield* setup;
      NodeFS.writeFileSync(NodePath.join(cwd, "untracked.txt"), "local\n");
      expect((yield* Effect.flip(service.submit(request))).reason).toBe("dirty");
      expect(calls).toHaveLength(0);
      expect((yield* service.submit({ ...request, committedOnly: true })).localEditsExcluded).toBe(
        true,
      );
      expect(
        NodeChildProcess.execFileSync("tar", ["-tf", calls[0]!.archive!], { encoding: "utf8" }),
      ).not.toContain("untracked.txt");
    }),
  );
  it.effect(
    "disabled workers cannot receive new work and destination identity cannot be replaced",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* setup;
        yield* service.setEnabled({ workerId: worker.id, enabled: false });
        expect((yield* Effect.flip(service.submit(request))).reason).toBe("worker");
        expect(
          (yield* Effect.flip(service.register({ ...worker, target: "other-node" }))).reason,
        ).toBe("worker");
        expect(calls).toHaveLength(0);
        yield* service.setEnabled({ workerId: worker.id, enabled: true });
        yield* service.submit(request);
        expect(calls).toHaveLength(1);
      }),
  );
  it.effect("validates received identities before trusting a submission", () =>
    Effect.gen(function* () {
      const { service, mode } = yield* setup;
      mode("wrong");
      expect((yield* Effect.flip(service.submit(request))).reason).toBe("response");
      expect((yield* service.list(tid))[0]?.state).toBe("transfer_pending");
    }),
  );
  it.effect("detects a modified recovery archive before sending it", () =>
    Effect.gen(function* () {
      const { service, calls, mode } = yield* setup;
      mode("lost");
      yield* Effect.flip(service.submit(request));
      NodeFS.appendFileSync(calls[0]!.archive!, "tamper");
      expect((yield* Effect.flip(service.recover(ref))).reason).toBe("storage");
      expect(calls).toHaveLength(1);
    }),
  );
  it.effect(
    "refreshes state, returns bounded logs, cancels, and verifies returned patch checksums",
    () =>
      Effect.gen(function* () {
        const { service, mode } = yield* setup;
        yield* service.submit(request);
        expect((yield* service.inspect(ref)).logs.text).toBe("Finished\n");
        expect((yield* service.list(tid))[0]?.job?.state).toBe("succeeded");
        expect((yield* service.patch(ref)).bytes).toBeGreaterThan(0);
        mode("badPatch");
        expect((yield* Effect.flip(service.patch(ref))).reason).toBe("patch");
        expect((yield* service.cancel(ref)).job?.state).toBe("cancelled");
      }),
  );
  it.effect("rejects invalid and oversized argv without dispatching", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup;
      for (const argv of [
        [""],
        ["echo", "\0"],
        Array.from({ length: 5 }, () => "a".repeat(8192)),
      ]) {
        yield* Effect.flip(service.submit({ ...request, argv }));
      }
      expect(calls).toHaveLength(0);
    }),
  );
});

it.effect("worker check reports readiness, blocked capacity and missing Git without dispatch", () =>
  Effect.gen(function* () {
    const f = yield* setup;
    const ready = yield* f.service.check({ workerId: worker.id });
    expect(ready).toMatchObject({
      status: "ready",
      architecture: "aarch64",
      slots: 2,
      outputBundles: true,
    });
    f.capabilities({
      architecture: "aarch64",
      cpu_count: 8,
      toolsets: [{ id: "repository", missing: [] }],
      loom: { service_active: true },
      command_jobs: {
        may_start: false,
        worker_active: true,
        storage_available: true,
        slots: 2,
        active: 2,
        waiting_reasons: ["slots_reserved"],
      },
    });
    expect(yield* f.service.check({ workerId: worker.id })).toMatchObject({
      status: "busy",
      active: 2,
      reasons: ["slots_reserved"],
    });
    f.capabilities({
      architecture: "aarch64",
      cpu_count: 8,
      toolsets: [{ id: "repository", missing: ["git"] }],
      loom: { service_active: false },
      command_jobs: {
        may_start: true,
        worker_active: false,
        storage_available: true,
        slots: 2,
        active: 0,
        waiting_reasons: ["worker_stopped"],
      },
    });
    expect(yield* f.service.check({ workerId: worker.id })).toMatchObject({
      status: "needs_setup",
      missingTools: ["git"],
      reasons: ["worker_stopped", "git_missing"],
    });
    expect(f.calls.every((call) => call.operation === "rpc")).toBe(true);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("worker preparation uses only the registered destination and fixed protocol", () =>
  Effect.gen(function* () {
    const f = yield* setup;
    expect((yield* f.service.prepare({ workerId: worker.id })).status).toBe("ready");
    expect(f.calls.at(-1)).toMatchObject({
      worker,
      operation: "rpc",
      header: { schema_version: 1, action: "prepare-worker" },
    });
    yield* f.service.setEnabled({ workerId: worker.id, enabled: false });
    const count = f.calls.length;
    expect((yield* f.service.prepare({ workerId: worker.id }).pipe(Effect.result))._tag).toBe(
      "Failure",
    );
    expect(f.calls.length).toBe(count);
    f.mode("lost");
    expect(yield* f.service.check({ workerId: worker.id })).toMatchObject({
      status: "unreachable",
      reasons: ["connection_failed"],
    });
    f.capabilities({ cpu_count: 100000 });
    f.mode("normal");
    expect((yield* f.service.check({ workerId: worker.id })).status).toBe("unreachable");
  }).pipe(Effect.provide(NodeServices.layer)),
);
