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
import * as NodeZlib from "node:zlib";
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
  type MiniWorkerConnection,
  MINI_HOST_KEY_MISMATCH,
  DIRECTORY_MAX_WORKERS,
  LoomOsSignedIdentity,
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
import * as WorkerSource from "./MiniWorkerSource.ts";
import { atomicJson, disk, readJson } from "./storage.ts";

const jsonBytes = (value: object) => Buffer.byteLength(JSON.stringify(value)) + 1;
// Matches the LoomOS worker's receive limit. Patches travel inside JSON, so they stay smaller.
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_PATCH_BYTES = 64 * 1024 * 1024;
class ArchiveTooLarge extends Error {}
// Receipts saved before compression have no encoding and replay their plain tar unchanged.
const Stored = Schema.Struct({
  receipt: MiniReceipt,
  worker: MiniWorker,
  archiveEncoding: Schema.optional(Schema.Literal("gzip")),
});
type Stored = typeof Stored.Type;
const archiveName = (stored: Pick<Stored, "archiveEncoding">) =>
  stored.archiveEncoding === "gzip" ? "source.tar.gz" : "source.tar";
const receiveSpec = ({ receipt, archiveEncoding }: Stored) => ({
  schema_version: 1,
  request_id: receipt.request.requestId,
  source_revision: receipt.sourceRevision,
  label: receipt.request.label,
  argv: receipt.request.argv,
  memory_mib: receipt.request.memoryMiB,
  cpu_percent: receipt.request.cpuPercent,
  timeout_seconds: receipt.request.timeoutSeconds,
  archive_bytes: receipt.archiveBytes,
  archive_sha256: receipt.archiveSha256,
  ...(archiveEncoding ? { archive_encoding: archiveEncoding } : {}),
  ...(receipt.request.outputs?.length ? { outputs: receipt.request.outputs } : {}),
});
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
  // LoomOS 0.1.6 sends none. Decoded on its own so a bad identity never fails readiness.
  identity: Schema.optional(Schema.Unknown),
});
const decodeIdentity = Schema.decodeUnknownOption(LoomOsSignedIdentity);
const fail = (reason: MiniOffloadError["reason"]) => Effect.fail(new MiniOffloadError({ reason }));
const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new MiniOffloadError({ reason: "response", cause })),
  );
const sha256File = async (path: string) => {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
// Bound bytes before writing, rather than filling the host disk before checking size. Like the
// worker, bound both the uncompressed tar and the compressed transfer, which can be larger.
export const archiveRepository = (
  cwd: string,
  revision: string,
  archive: string,
  maxBytes = MAX_ARCHIVE_BYTES,
) =>
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
          let oversized = false;
          const limit = () => {
            let bytes = 0;
            return new NodeStream.Transform({
              transform(chunk: Buffer, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > maxBytes) oversized = true;
                callback(oversized ? new ArchiveTooLarge() : null, chunk);
              },
            });
          };
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
              NodeStreamPromises.pipeline(
                child.stdout,
                limit(),
                NodeZlib.createGzip(),
                limit(),
                output,
                { signal },
              ),
              exited,
            ]);
          } catch (cause) {
            abort();
            output.destroy();
            // Wait for the file descriptor to close before unlinking on every platform.
            await Promise.allSettled([exited, NodeStreamPromises.finished(output)]);
            await NodeFSP.rm(archive, { force: true });
            // Git can report the closed pipe before the limit error reaches the pipeline.
            throw oversized ? new ArchiveTooLarge() : cause;
          } finally {
            signal.removeEventListener("abort", abort);
          }
        })()),
      catch: (cause) =>
        new MiniOffloadError({
          reason: cause instanceof ArchiveTooLarge ? "too_large" : "storage",
          cause,
        }),
    }).pipe(
      // A cancelled request keeps its lock until the child and partial file are gone.
      Effect.ensuring(Effect.promise(() => completion?.catch(() => {}) ?? Promise.resolve())),
    );
  }).pipe(
    Effect.timeout("5 minutes"),
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
    readonly updateWorker: (
      input: MiniWorkerConnection,
    ) => Effect.Effect<Pick<MiniWorker, "id" | "name" | "enabled">, MiniOffloadError>;
    /** Removes a worker. Its earlier jobs stay inspectable and keep reaching its last connection. */
    readonly removeWorker: (
      input: MiniWorkerRef,
    ) => Effect.Effect<Pick<MiniWorker, "id" | "name" | "enabled">, MiniOffloadError>;
    readonly submit: (input: MiniSubmit) => Effect.Effect<MiniReceipt, MiniOffloadError>;
    readonly recover: (input: MiniRef) => Effect.Effect<MiniReceipt, MiniOffloadError>;
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<MiniReceipt>, MiniOffloadError>;
    /**
     * Jobs this computer has seen reach a final state, from receipts saved at or after `sinceMs`.
     * `recordedAt` is when the final state was saved, which is when this computer learned of it.
     */
    readonly finished: (
      sinceMs: number,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly receipt: MiniReceipt; readonly recordedAt: string }>,
      MiniOffloadError
    >;
    readonly inspect: (input: MiniRef) => Effect.Effect<typeof MiniDetail.Type, MiniOffloadError>;
    readonly cancel: (input: MiniRef) => Effect.Effect<MiniReceipt, MiniOffloadError>;
    readonly patch: (input: MiniRef) => Effect.Effect<typeof MiniPatch.Type, MiniOffloadError>;
    readonly artifacts: (input: MiniRef) => Effect.Effect<MiniArtifacts, MiniOffloadError>;
    readonly agentArtifacts: (
      input: MiniRef & { readonly includeBundle?: boolean | undefined },
    ) => Effect.Effect<MiniAgentArtifacts, MiniOffloadError>;
    /**
     * The signed LoomOS identity each enabled worker gave at its last readiness check, as
     * received. Reads the registry only, so it makes no SSH calls.
     */
    readonly identities: Effect.Effect<ReadonlyArray<LoomOsSignedIdentity>, MiniOffloadError>;
  }
>()("t3/fork/mini-offload/MiniOffloadService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const ssh = yield* Ssh.MiniSshTransport;
  const source = yield* WorkerSource.MiniWorkerSource;
  // Order worker lookups with registry changes. Each request has a separate transfer lock.
  const registryLock = yield* Semaphore.make(1);
  const requestLocks = new Map<string, { lock: Semaphore.Semaphore; count: number }>();
  // Keyed by worker id and pinned to the connection that answered, so a worker re-pointed at
  // another machine never carries the old machine's identity.
  const identities = new Map<
    string,
    { readonly connection: string; readonly identity: LoomOsSignedIdentity }
  >();
  const connectionOf = (worker: MiniWorker) => JSON.stringify([worker.target, worker.sshConfig]);
  const root = NodePath.join(config.stateDir, "fork", "mini-offload");
  const pathFor = (rid: string) => NodePath.join(root, rid);
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
  const receiptNames = disk(async () => {
    try {
      return (await NodeFSP.readdir(root)).filter((name) => /^[a-f0-9]{32}$/.test(name));
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")
        return [];
      throw cause;
    }
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
  // A receipt reaches its worker the way the registry says now, so changing a moved worker's
  // connection also reaches its earlier jobs, including after the worker is removed. A registry
  // that cannot be read leaves the connection saved with the receipt, as before workers could move.
  const destination = (stored: Stored) =>
    registryLock.withPermit(source.lookup(stored.worker.id)).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.map((current) =>
        current
          ? { ...stored.worker, target: current.target, sshConfig: current.sshConfig }
          : stored.worker,
      ),
    );
  const send = Effect.fn("MiniOffload.send")(function* (stored: Stored) {
    const receipt = stored.receipt;
    const request = receipt.request;
    const archive = NodePath.join(pathFor(request.requestId), archiveName(stored));
    const valid = yield* disk(
      async () =>
        (await NodeFSP.stat(archive)).size === receipt.archiveBytes &&
        (await sha256File(archive)) === receipt.archiveSha256,
    );
    if (!valid) return yield* fail("storage");
    const response = yield* decode(
      Received,
      yield* ssh.request(yield* destination(stored), "receive", receiveSpec(stored), archive),
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
    // The worker keeps its own copy, and a submitted receipt never sends the archive again.
    yield* disk(() => NodeFSP.rm(archive, { force: true })).pipe(Effect.ignore);
    return next.receipt;
  });
  const rpc = (stored: Stored, action: "show" | "cancel" | "logs" | "patch" | "artifacts") => {
    const job = stored.receipt.job;
    if (job === null) return fail("transfer");
    return destination(stored).pipe(
      Effect.flatMap((worker) =>
        ssh.request(worker, "rpc", { schema_version: 1, action, job_id: job.id }),
      ),
    );
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
    const worker = (yield* source.list).find((worker) => worker.id === input.workerId);
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
        reasons: [
          Ssh.isHostKeyRejected(result.failure)
            ? MINI_HOST_KEY_MISMATCH
            : prepare
              ? "prepare_failed"
              : "connection_failed",
        ],
      };
    }
    const caps = result.success;
    // Only an answer replaces or drops the identity. A failed check keeps the last one.
    const identity = decodeIdentity(caps.identity);
    if (Option.isSome(identity))
      identities.set(worker.id, { connection: connectionOf(worker), identity: identity.value });
    else identities.delete(worker.id);
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
    identities: source.list.pipe(
      Effect.map((workers) =>
        workers
          .filter((worker) => worker.enabled)
          .toSorted((a, b) => a.id.localeCompare(b.id))
          .flatMap((worker) => {
            const known = identities.get(worker.id);
            return known !== undefined && known.connection === connectionOf(worker)
              ? [known.identity]
              : [];
          })
          .slice(0, DIRECTORY_MAX_WORKERS),
      ),
    ),
    check: Effect.fn("MiniOffloadService.check")(function (input) {
      return readiness(input);
    }),
    prepare: Effect.fn("MiniOffloadService.prepare")(function (input) {
      return readiness(input, true);
    }),
    workers: source.list.pipe(Effect.map((workers) => workers.map(summary))),
    register: Effect.fn("MiniOffloadService.register")(function (input) {
      return registryLock.withPermit(source.register(input)).pipe(Effect.map(summary));
    }),
    setEnabled: Effect.fn("MiniOffloadService.setEnabled")(function (input) {
      return registryLock.withPermit(source.setEnabled(input)).pipe(Effect.map(summary));
    }),
    updateWorker: Effect.fn("MiniOffloadService.updateWorker")(function (input) {
      return registryLock.withPermit(source.update(input)).pipe(Effect.map(summary));
    }),
    removeWorker: Effect.fn("MiniOffloadService.removeWorker")(function (input) {
      return registryLock.withPermit(source.remove(input)).pipe(Effect.map(summary));
    }),
    submit: Effect.fn("MiniOffloadService.submit")(function (input) {
      return decode(MiniSubmit, input).pipe(
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
              // Archiving can take minutes, so it must not hold up other submissions or registry changes.
              const enabledWorker = registryLock
                .withPermit(source.list)
                .pipe(
                  Effect.map((rows) =>
                    rows.find((row) => row.id === request.workerId && row.enabled),
                  ),
                );
              if (!(yield* enabledWorker)) return yield* fail("worker");
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
              const archive = NodePath.join(directory, archiveName({ archiveEncoding: "gzip" }));
              const stored = yield* Effect.gen(function* () {
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
                if (bytes > MAX_ARCHIVE_BYTES) return yield* fail("too_large");
                if (bytes <= 0) return yield* fail("storage");
                const checksum = yield* disk(() => sha256File(archive));
                // A worker removed or disabled while this archived gets no new job.
                const worker = yield* enabledWorker;
                if (!worker) return yield* fail("worker");
                const initial: Stored = {
                  worker,
                  archiveEncoding: "gzip",
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
                if (jsonBytes(receiveSpec(initial)) > 65536) return yield* fail("response");
                // Settle the write before any cleanup decides whether the receipt exists.
                yield* Effect.uninterruptible(save(initial));
                return initial;
              }).pipe(
                // Without a receipt nothing would send or remove the archive. With one, recovery needs it.
                Effect.onError(() =>
                  disk(async () => {
                    if ((await readJson(NodePath.join(directory, "receipt.json"))) === null)
                      await NodeFSP.rm(archive, { force: true });
                  }).pipe(Effect.ignore),
                ),
              );
              return yield* send(stored);
            }),
          ),
        ),
      );
    }),
    recover: Effect.fn("MiniOffloadService.recover")(function (input) {
      return decode(MiniRef, input).pipe(
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
      );
    }),
    list: Effect.fn("MiniOffload.list")(function* (threadId) {
      yield* workspace(threadId);
      const receipts = yield* Effect.forEach(
        yield* receiptNames,
        (name) =>
          Effect.gen(function* () {
            const value = yield* disk(() => readJson(NodePath.join(pathFor(name), "receipt.json")));
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
    finished: Effect.fn("MiniOffload.finished")(function* (sinceMs) {
      const found = yield* Effect.forEach(
        yield* receiptNames,
        (name) =>
          Effect.gen(function* () {
            const file = NodePath.join(pathFor(name), "receipt.json");
            const modified = yield* disk(async () => {
              try {
                return (await NodeFSP.stat(file)).mtimeMs;
              } catch {
                return null;
              }
            });
            if (modified === null || modified < sinceMs) return null;
            const value = yield* disk(() => readJson(file));
            if (value === null) return null;
            const stored = yield* decode(Stored, value).pipe(Effect.option);
            if (Option.isNone(stored)) return null;
            const { receipt } = stored.value;
            const state = receipt.job?.state;
            return state === "succeeded" ||
              state === "failed" ||
              state === "cancelled" ||
              state === "interrupted"
              ? { receipt, recordedAt: DateTime.formatIso(DateTime.makeUnsafe(modified)) }
              : null;
          }),
        { concurrency: 4 },
      );
      return found.filter((entry) => entry !== null);
    }),
    inspect: Effect.fn("MiniOffloadService.inspect")(function (input) {
      return decode(MiniRef, input).pipe(
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
      );
    }),
    cancel: Effect.fn("MiniOffloadService.cancel")(function (input) {
      return decode(MiniRef, input).pipe(
        Effect.flatMap((ref) =>
          locked(
            ref.requestId,
            refresh(ref, "cancel").pipe(Effect.map((stored) => stored.receipt)),
          ),
        ),
      );
    }),
    artifacts,
    agentArtifacts: Effect.fn("MiniOffloadService.agentArtifacts")(function (input) {
      return artifacts(input).pipe(
        Effect.map((bundle) => ({
          ...bundle,
          artifactsBase64: input.includeBundle ? bundle.artifactsBase64 : null,
        })),
      );
    }),
    patch: Effect.fn("MiniOffload.patch")(function* (input) {
      const stored = yield* load(input);
      const response = yield* decode(Patch, yield* rpc(stored, "patch"));
      const bytes = Buffer.from(response.patch_base64, "base64");
      if (
        response.job_id !== stored.receipt.job?.id ||
        response.source_revision !== stored.receipt.sourceRevision ||
        bytes.length > MAX_PATCH_BYTES ||
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
export const layer = Layer.effect(MiniOffloadService, make).pipe(
  Layer.provide(WorkerSource.layerFile),
);
