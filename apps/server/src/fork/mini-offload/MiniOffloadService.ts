// @effect-diagnostics nodeBuiltinImport:off - Private durable receipts and bounded repository archives live on the host filesystem.
import * as NodeUtil from "node:util";
import * as NodeChildProcess from "node:child_process";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as DateTime from "effect/DateTime";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { ThreadId } from "@t3tools/contracts";
import {
  MiniOffloadError,
  MiniWorker,
  MiniSubmit,
  MiniReceipt,
  MiniJob,
  MiniRef,
  type MiniDetail,
  type MiniPatch,
  MiniArtifacts,
  type MiniAgentArtifacts,
  MiniWorkerRef,
  MiniWorkerReadiness,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Ssh from "./MiniSshTransport.ts";

const jsonBytes = (value: object) => Buffer.byteLength(JSON.stringify(value)) + 1;
const MAX_BYTES = 64 * 1024 * 1024;
const Stored = Schema.Struct({ receipt: MiniReceipt, worker: MiniWorker });
type Stored = typeof Stored.Type;
const Workers = Schema.Array(MiniWorker);
const Received = Schema.Struct({
  request_id: Schema.String,
  source_revision: Schema.String,
  job: MiniJob,
});
const Logs = Schema.Struct({
  job_id: Schema.String,
  text: Schema.String.check(Schema.isMaxLength(1024 * 1024)),
  truncated: Schema.Boolean,
});
const Patch = Schema.Struct({
  job_id: Schema.String,
  source_revision: Schema.String,
  sha256: Schema.String,
  patch_base64: Schema.String.check(Schema.isMaxLength(90 * 1024 * 1024)),
});
const Artifacts = Schema.Struct({
  schema_version: Schema.Literal(1),
  job_id: MiniJob.fields.id,
  sha256: MiniArtifacts.fields.sha256,
  bytes: MiniArtifacts.fields.bytes,
  files: MiniArtifacts.fields.files,
  missing: MiniArtifacts.fields.missing,
  artifacts_base64: MiniArtifacts.fields.artifactsBase64,
});
const Capabilities = Schema.Struct({
  architecture: Schema.String.check(Schema.isMaxLength(64)),
  cpu_count: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 256 }))),
  toolsets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      missing: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(
        Schema.isMaxLength(32),
      ),
    }),
  ).check(Schema.isMaxLength(32)),
  loom: Schema.Struct({ service_active: Schema.Boolean }),
  command_jobs: Schema.Struct({
    may_start: Schema.Boolean,
    worker_active: Schema.Boolean,
    storage_available: Schema.Boolean,
    slots: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 256 })),
    active: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 256 })),
    waiting_reasons: MiniWorkerReadiness.fields.reasons,
    output_bundles: Schema.optional(Schema.Struct({ supported: Schema.Boolean })),
  }),
});
const fail = (reason: MiniOffloadError["reason"]) => Effect.fail(new MiniOffloadError({ reason }));
const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new MiniOffloadError({ reason: "response", cause })),
  );
const disk = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => new MiniOffloadError({ reason: "storage", cause }),
  });
const readJson = async (path: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await NodeFSP.readFile(path, "utf8"));
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")
      return null;
    throw cause;
  }
};
const atomicJson = async (path: string, value: unknown) => {
  const temporary = path + "." + NodeCrypto.randomUUID() + ".tmp";
  const file = await NodeFSP.open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await NodeFSP.rename(temporary, path);
  const directory = await NodeFSP.open(NodePath.dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};
const sha256File = async (path: string) => {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
// Bound bytes before writing, rather than filling the host disk before checking size.
const archiveRepository = (cwd: string, revision: string, archive: string) =>
  Effect.suspend(() => {
    let completion: Promise<void> | undefined;
    return Effect.tryPromise({
      try: (signal) =>
        (completion = (async () => {
          const child = NodeChildProcess.spawn(
            "git",
            [
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "core.fsmonitor=false",
              "archive",
              "--format=tar",
              revision,
            ],
            { cwd, stdio: ["ignore", "pipe", "pipe"] },
          );
          const output = NodeFS.createWriteStream(archive, { flags: "w", mode: 0o600 });
          let bytes = 0;
          const limit = new NodeStream.Transform({
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              callback(bytes > MAX_BYTES ? new Error("Archive exceeds limit") : null, chunk);
            },
          });
          const abort = () => {
            child.kill("SIGKILL");
          };
          signal.addEventListener("abort", abort, { once: true });
          child.stderr.resume();
          const exited = new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) =>
              code === 0 ? resolve() : reject(new Error("Git archive failed")),
            );
          });
          try {
            await Promise.all([
              NodeStreamPromises.pipeline(child.stdout, limit, output, { signal }),
              exited,
            ]);
          } catch (cause) {
            abort();
            output.destroy();
            // Wait for the file descriptor to close before unlinking on every platform.
            await Promise.allSettled([exited, NodeStreamPromises.finished(output)]);
            await NodeFSP.rm(archive, { force: true });
            throw cause;
          } finally {
            signal.removeEventListener("abort", abort);
          }
        })()),
      catch: (cause) => new MiniOffloadError({ reason: "storage", cause }),
    }).pipe(
      // A cancelled request keeps its lock until the child and partial file are gone.
      Effect.ensuring(Effect.promise(() => completion?.catch(() => {}) ?? Promise.resolve())),
    );
  }).pipe(
    Effect.timeout("60 seconds"),
    Effect.mapError((cause) =>
      cause._tag === "MiniOffloadError"
        ? cause
        : new MiniOffloadError({ reason: "storage", cause }),
    ),
  );
export class MiniOffloadService extends Context.Service<
  MiniOffloadService,
  {
    readonly check: (input: MiniWorkerRef) => Effect.Effect<MiniWorkerReadiness, MiniOffloadError>;
    readonly prepare: (
      input: MiniWorkerRef,
    ) => Effect.Effect<MiniWorkerReadiness, MiniOffloadError>;
    readonly workers: Effect.Effect<
      ReadonlyArray<Pick<MiniWorker, "id" | "name" | "enabled">>,
      MiniOffloadError
    >;
    readonly register: (
      input: MiniWorker,
    ) => Effect.Effect<Pick<MiniWorker, "id" | "name" | "enabled">, MiniOffloadError>;
    readonly setEnabled: (input: {
      workerId: string;
      enabled: boolean;
    }) => Effect.Effect<Pick<MiniWorker, "id" | "name" | "enabled">, MiniOffloadError>;
    readonly submit: (input: MiniSubmit) => Effect.Effect<MiniReceipt, MiniOffloadError>;
    readonly recover: (input: MiniRef) => Effect.Effect<MiniReceipt, MiniOffloadError>;
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<MiniReceipt>, MiniOffloadError>;
    readonly inspect: (input: MiniRef) => Effect.Effect<typeof MiniDetail.Type, MiniOffloadError>;
    readonly cancel: (input: MiniRef) => Effect.Effect<MiniReceipt, MiniOffloadError>;
    readonly patch: (input: MiniRef) => Effect.Effect<typeof MiniPatch.Type, MiniOffloadError>;
    readonly artifacts: (input: MiniRef) => Effect.Effect<MiniArtifacts, MiniOffloadError>;
    readonly agentArtifacts: (
      input: MiniRef & { readonly includeBundle?: boolean | undefined },
    ) => Effect.Effect<MiniAgentArtifacts, MiniOffloadError>;
  }
>()("t3/fork/mini-offload/MiniOffloadService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const ssh = yield* Ssh.MiniSshTransport;
  // Protect specification creation and registry changes. Each request has a separate transfer lock.
  const registryLock = yield* Semaphore.make(1);
  const requestLocks = new Map<string, { lock: Semaphore.Semaphore; count: number }>();
  const root = NodePath.join(config.stateDir, "fork", "mini-offload");
  const pathFor = (rid: string) => NodePath.join(root, rid);
  const loadWorkers = Effect.gen(function* () {
    const value = yield* disk(() => readJson(NodePath.join(root, "workers.json")));
    return value === null ? [] : yield* decode(Workers, value);
  });
  const summary = (worker: MiniWorker) => ({
    id: worker.id,
    name: worker.name,
    enabled: worker.enabled,
  });
  const workspace = Effect.fn("MiniOffload.workspace")(function* (threadId: ThreadId) {
    const thread = yield* threads
      .getThread(threadId)
      .pipe(Effect.mapError((cause) => new MiniOffloadError({ reason: "workspace", cause })));
    const project = yield* projects
      .get(thread.projectId)
      .pipe(Effect.mapError((cause) => new MiniOffloadError({ reason: "workspace", cause })));
    if (Option.isNone(project)) return yield* fail("workspace");
    return thread.worktreePath ?? project.value.workspaceRoot;
  });
  const git = Effect.fn("MiniOffload.git")(function* (cwd: string, args: ReadonlyArray<string>) {
    const result = yield* processRunner
      .run({
        command: "git",
        args: ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
        cwd,
        timeout: "60 seconds",
        maxOutputBytes: 1024 * 1024,
      })
      .pipe(Effect.mapError((cause) => new MiniOffloadError({ reason: "workspace", cause })));
    if (result.code !== 0 || result.timedOut) return yield* fail("workspace");
    return result.stdout.trim();
  });
  const load = Effect.fn("MiniOffload.load")(function* (input: MiniRef) {
    yield* decode(MiniRef, input);
    yield* workspace(input.threadId);
    const value = yield* disk(() =>
      readJson(NodePath.join(pathFor(input.requestId), "receipt.json")),
    );
    if (value === null) return yield* fail("conflict");
    const stored = yield* decode(Stored, value);
    if (
      stored.receipt.request.threadId !== input.threadId ||
      stored.receipt.request.requestId !== input.requestId
    )
      return yield* fail("conflict");
    return stored;
  });
  const save = (stored: Stored) =>
    disk(() =>
      atomicJson(NodePath.join(pathFor(stored.receipt.request.requestId), "receipt.json"), stored),
    );
  const locked = <A>(rid: string, action: Effect.Effect<A, MiniOffloadError>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const entry = requestLocks.get(rid) ?? { lock: Semaphore.makeUnsafe(1), count: 0 };
        entry.count++;
        requestLocks.set(rid, entry);
        return entry;
      }),
      (entry) => entry.lock.withPermit(action),
      (entry) =>
        Effect.sync(() => {
          if (--entry.count === 0) requestLocks.delete(rid);
        }),
    );
  const send = Effect.fn("MiniOffload.send")(function* (stored: Stored) {
    const receipt = stored.receipt;
    const request = receipt.request;
    const archive = NodePath.join(pathFor(request.requestId), "source.tar");
    const valid = yield* disk(
      async () =>
        (await NodeFSP.stat(archive)).size === receipt.archiveBytes &&
        (await sha256File(archive)) === receipt.archiveSha256,
    );
    if (!valid) return yield* fail("storage");
    const spec = {
      schema_version: 1,
      request_id: request.requestId,
      source_revision: receipt.sourceRevision,
      label: request.label,
      argv: request.argv,
      memory_mib: request.memoryMiB,
      cpu_percent: request.cpuPercent,
      timeout_seconds: request.timeoutSeconds,
      archive_bytes: receipt.archiveBytes,
      archive_sha256: receipt.archiveSha256,
      ...(request.outputs?.length ? { outputs: request.outputs } : {}),
    };
    const response = yield* decode(
      Received,
      yield* ssh.request(stored.worker, "receive", spec, archive),
    );
    if (
      response.request_id !== request.requestId ||
      response.source_revision !== receipt.sourceRevision ||
      (receipt.job !== null && response.job.id !== receipt.job.id)
    )
      return yield* fail("response");
    const next: Stored = {
      ...stored,
      receipt: { ...receipt, state: "submitted", job: response.job },
    };
    yield* save(next);
    return next.receipt;
  });
  const rpc = (stored: Stored, action: "show" | "cancel" | "logs" | "patch" | "artifacts") => {
    if (stored.receipt.job === null) return fail("transfer");
    return ssh.request(stored.worker, "rpc", {
      schema_version: 1,
      action,
      job_id: stored.receipt.job.id,
    });
  };
  const refresh = Effect.fn("MiniOffload.refresh")(function* (
    input: MiniRef,
    action: "show" | "cancel",
  ) {
    const stored = yield* load(input);
    const job = yield* decode(MiniJob, yield* rpc(stored, action));
    if (job.id !== stored.receipt.job?.id) return yield* fail("response");
    const next = { ...stored, receipt: { ...stored.receipt, job } };
    yield* save(next);
    return next;
  });
  const readiness = Effect.fn("MiniOffload.readiness")(function* (
    input: MiniWorkerRef,
    prepare = false,
  ) {
    yield* decode(MiniWorkerRef, input);
    const worker = (yield* loadWorkers).find((worker) => worker.id === input.workerId);
    if (!worker || (prepare && !worker.enabled)) return yield* fail("worker");
    const result = yield* ssh
      .request(worker, "rpc", {
        schema_version: 1,
        action: prepare ? "prepare-worker" : "capabilities",
      })
      .pipe(
        Effect.flatMap((value) => decode(Capabilities, value)),
        Effect.result,
      );
    const common = {
      workerId: worker.id,
      name: worker.name,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
    };
    if (result._tag === "Failure") {
      return {
        ...common,
        status: "unreachable" as const,
        architecture: null,
        cpuCount: null,
        slots: 0,
        active: 0,
        nativeServerRunning: false,
        outputBundles: false,
        missingTools: [],
        reasons: [prepare ? "prepare_failed" : "connection_failed"],
      };
    }
    const caps = result.success;
    const gitMissing = caps.toolsets.find((role) => role.id === "repository")?.missing ?? ["git"];
    const reasons = [
      ...caps.command_jobs.waiting_reasons,
      ...(gitMissing.length ? ["git_missing"] : []),
    ];
    const configured =
      caps.command_jobs.storage_available &&
      caps.command_jobs.worker_active &&
      gitMissing.length === 0;
    return {
      ...common,
      status:
        configured && caps.command_jobs.may_start
          ? ("ready" as const)
          : configured
            ? ("busy" as const)
            : ("needs_setup" as const),
      architecture: caps.architecture,
      cpuCount: caps.cpu_count,
      slots: caps.command_jobs.slots,
      active: caps.command_jobs.active,
      nativeServerRunning: caps.loom.service_active,
      outputBundles: caps.command_jobs.output_bundles?.supported ?? false,
      missingTools: [...new Set(caps.toolsets.flatMap((role) => role.missing))].slice(0, 128),
      reasons,
    };
  });
  const artifacts = Effect.fn("MiniOffload.artifacts")(function* (input: MiniRef) {
    const stored = yield* load(input);
    const declared = stored.receipt.request.outputs ?? [];
    if (declared.length === 0) return yield* fail("artifacts");
    const response = yield* decode(Artifacts, yield* rpc(stored, "artifacts")).pipe(
      Effect.mapError((cause) => new MiniOffloadError({ reason: "artifacts", cause })),
    );
    const bytes = Buffer.from(response.artifacts_base64, "base64");
    const paths = [...response.files.map((file) => file.path), ...response.missing];
    if (
      response.job_id !== stored.receipt.job?.id ||
      bytes.length !== response.bytes ||
      bytes.toString("base64") !== response.artifacts_base64 ||
      NodeCrypto.createHash("sha256").update(bytes).digest("hex") !== response.sha256 ||
      response.files.reduce((total, file) => total + file.bytes, 0) > 60 * 1024 * 1024 ||
      paths.length !== declared.length ||
      new Set(paths).size !== paths.length ||
      paths.some((path) => !declared.includes(path))
    )
      return yield* fail("artifacts");
    return {
      sha256: response.sha256,
      bytes: response.bytes,
      files: response.files,
      missing: response.missing,
      artifactsBase64: response.artifacts_base64,
    };
  });
  return MiniOffloadService.of({
    check: (input) => readiness(input),
    prepare: (input) => readiness(input, true),
    workers: loadWorkers.pipe(Effect.map((workers) => workers.map(summary))),
    register: (input) =>
      registryLock.withPermit(
        Effect.gen(function* () {
          const worker = yield* decode(MiniWorker, input);
          if (worker.sshConfig !== null && !NodePath.isAbsolute(worker.sshConfig))
            return yield* fail("worker");
          const workers = yield* loadWorkers;
          const old = workers.find((row) => row.id === worker.id);
          if (old && (old.target !== worker.target || old.sshConfig !== worker.sshConfig))
            return yield* fail("worker");
          yield* disk(async () => {
            await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
            await atomicJson(NodePath.join(root, "workers.json"), [
              ...workers.filter((row) => row.id !== worker.id),
              worker,
            ]);
          });
          return summary(worker);
        }),
      ),
    setEnabled: (input) =>
      registryLock.withPermit(
        Effect.gen(function* () {
          const workers = yield* loadWorkers;
          const worker = workers.find((row) => row.id === input.workerId);
          if (!worker) return yield* fail("worker");
          const next = { ...worker, enabled: input.enabled };
          yield* disk(() =>
            atomicJson(
              NodePath.join(root, "workers.json"),
              workers.map((row) => (row.id === next.id ? next : row)),
            ),
          );
          return summary(next);
        }),
      ),
    submit: (input) =>
      decode(MiniSubmit, input).pipe(
        Effect.flatMap((request) =>
          locked(
            request.requestId,
            Effect.gen(function* () {
              const existing = yield* disk(() =>
                readJson(NodePath.join(pathFor(request.requestId), "receipt.json")),
              );
              if (existing !== null) {
                const stored = yield* load(request);
                if (!NodeUtil.isDeepStrictEqual(stored.receipt.request, request))
                  return yield* fail("conflict");
                // Submitted requests return their receipt; pending requests replay the immutable archive.
                return stored.receipt.state === "submitted" ? stored.receipt : yield* send(stored);
              }
              const stored = yield* registryLock.withPermit(
                Effect.gen(function* () {
                  const worker = (yield* loadWorkers).find(
                    (row) => row.id === request.workerId && row.enabled,
                  );
                  if (!worker) return yield* fail("worker");
                  const cwd = yield* workspace(request.threadId);
                  const top = yield* git(cwd, ["rev-parse", "--show-toplevel"]);
                  if (
                    yield* disk(
                      async () => (await NodeFSP.realpath(cwd)) !== (await NodeFSP.realpath(top)),
                    )
                  )
                    return yield* fail("workspace");
                  const revision = yield* git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
                  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))
                    return yield* fail("workspace");
                  const dirty = (yield* git(cwd, ["status", "--porcelain"])) !== "";
                  if (dirty && !request.committedOnly) return yield* fail("dirty");
                  const directory = pathFor(request.requestId);
                  yield* disk(() => NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 }));
                  const archive = NodePath.join(directory, "source.tar");
                  yield* archiveRepository(cwd, revision, archive);
                  const bytes = yield* disk(async () => {
                    await NodeFSP.chmod(archive, 0o600);
                    const file = await NodeFSP.open(archive, "r");
                    try {
                      await file.sync();
                      return (await file.stat()).size;
                    } finally {
                      await file.close();
                    }
                  });
                  if (bytes <= 0 || bytes > MAX_BYTES) return yield* fail("storage");
                  const checksum = yield* disk(() => sha256File(archive));
                  const initial: Stored = {
                    worker,
                    receipt: {
                      request,
                      workerName: worker.name,
                      sourceRevision: revision,
                      archiveSha256: checksum,
                      archiveBytes: bytes,
                      localEditsExcluded: dirty,
                      createdAt: DateTime.formatIso(yield* DateTime.now),
                      state: "transfer_pending",
                      job: null,
                    },
                  };
                  const headerBytes = jsonBytes({
                    schema_version: 1,
                    request_id: request.requestId,
                    source_revision: revision,
                    label: request.label,
                    argv: request.argv,
                    memory_mib: request.memoryMiB,
                    cpu_percent: request.cpuPercent,
                    timeout_seconds: request.timeoutSeconds,
                    archive_bytes: bytes,
                    archive_sha256: checksum,
                    ...(request.outputs?.length ? { outputs: request.outputs } : {}),
                  });
                  if (headerBytes > 65536) return yield* fail("response");
                  yield* save(initial);
                  return initial;
                }),
              );
              return yield* send(stored);
            }),
          ),
        ),
      ),
    recover: (input) =>
      decode(MiniRef, input).pipe(
        Effect.flatMap((ref) =>
          locked(
            ref.requestId,
            Effect.gen(function* () {
              const stored = yield* load(ref);
              return stored.receipt.state === "submitted"
                ? (yield* refresh(ref, "show")).receipt
                : yield* send(stored);
            }),
          ),
        ),
      ),
    list: (threadId) =>
      Effect.gen(function* () {
        yield* workspace(threadId);
        const names = yield* disk(async () => {
          try {
            return await NodeFSP.readdir(root);
          } catch (cause) {
            if (
              typeof cause === "object" &&
              cause !== null &&
              "code" in cause &&
              cause.code === "ENOENT"
            )
              return [];
            throw cause;
          }
        });
        const receipts = yield* Effect.forEach(
          names.filter((name) => /^[a-f0-9]{32}$/.test(name)),
          (name) =>
            Effect.gen(function* () {
              const value = yield* disk(() =>
                readJson(NodePath.join(pathFor(name), "receipt.json")),
              );
              return value === null ? null : (yield* decode(Stored, value)).receipt;
            }),
          { concurrency: 4 },
        );
        return receipts
          .filter(
            (receipt): receipt is MiniReceipt =>
              receipt !== null && receipt.request.threadId === threadId,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }),
    inspect: (input) =>
      decode(MiniRef, input).pipe(
        Effect.flatMap((ref) =>
          locked(
            ref.requestId,
            Effect.gen(function* () {
              const stored = yield* refresh(ref, "show");
              const logs = yield* decode(Logs, yield* rpc(stored, "logs"));
              if (logs.job_id !== stored.receipt.job?.id) return yield* fail("response");
              return {
                receipt: stored.receipt,
                logs: { text: logs.text, truncated: logs.truncated },
              };
            }),
          ),
        ),
      ),
    cancel: (input) =>
      decode(MiniRef, input).pipe(
        Effect.flatMap((ref) =>
          locked(
            ref.requestId,
            refresh(ref, "cancel").pipe(Effect.map((stored) => stored.receipt)),
          ),
        ),
      ),
    artifacts,
    agentArtifacts: (input) =>
      artifacts(input).pipe(
        Effect.map((bundle) => ({
          ...bundle,
          artifactsBase64: input.includeBundle ? bundle.artifactsBase64 : null,
        })),
      ),
    patch: (input) =>
      Effect.gen(function* () {
        const stored = yield* load(input);
        const response = yield* decode(Patch, yield* rpc(stored, "patch"));
        const bytes = Buffer.from(response.patch_base64, "base64");
        if (
          response.job_id !== stored.receipt.job?.id ||
          response.source_revision !== stored.receipt.sourceRevision ||
          bytes.length > MAX_BYTES ||
          bytes.toString("base64") !== response.patch_base64 ||
          NodeCrypto.createHash("sha256").update(bytes).digest("hex") !== response.sha256
        )
          return yield* fail("patch");
        return {
          sourceRevision: response.source_revision,
          sha256: response.sha256,
          bytes: bytes.length,
          patchBase64: response.patch_base64,
        };
      }),
  });
});
export const layer = Layer.effect(MiniOffloadService, make);
