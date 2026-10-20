// @effect-diagnostics nodeBuiltinImport:off - The worker registry is a private file on the host.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { MiniOffloadError, MiniWorker } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../../config.ts";
import { atomicJson, disk, readJson } from "./storage.ts";

const Workers = Schema.Array(MiniWorker);
const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new MiniOffloadError({ reason: "response", cause })),
  );

/** The registered Mini workers. Offloading reads and changes workers only through this. */
export class MiniWorkerSource extends Context.Service<
  MiniWorkerSource,
  {
    readonly list: Effect.Effect<ReadonlyArray<MiniWorker>, MiniOffloadError>;
    /** Adds a worker, or replaces the one with its id when the connection is the same. */
    readonly register: (input: MiniWorker) => Effect.Effect<MiniWorker, MiniOffloadError>;
    readonly setEnabled: (input: {
      readonly workerId: string;
      readonly enabled: boolean;
    }) => Effect.Effect<MiniWorker, MiniOffloadError>;
  }
>()("t3/fork/mini-offload/MiniWorkerSource") {}

const makeFile = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const root = NodePath.join(config.stateDir, "fork", "mini-offload");
  const file = NodePath.join(root, "workers.json");
  // Each change rewrites the whole file from a fresh read, so changes run one at a time.
  const writeLock = yield* Semaphore.make(1);
  // No cache: every call sees the file as it is now, including edits made outside this process.
  const list = Effect.gen(function* () {
    const value = yield* disk(() => readJson(file));
    return value === null ? [] : yield* decode(Workers, value);
  });
  return MiniWorkerSource.of({
    list,
    register: (input) =>
      writeLock.withPermit(
        Effect.gen(function* () {
          const worker = yield* decode(MiniWorker, input);
          if (worker.sshConfig !== null && !NodePath.isAbsolute(worker.sshConfig))
            return yield* new MiniOffloadError({ reason: "worker" });
          const workers = yield* list;
          const old = workers.find((row) => row.id === worker.id);
          if (old && (old.target !== worker.target || old.sshConfig !== worker.sshConfig))
            return yield* new MiniOffloadError({ reason: "worker" });
          yield* disk(async () => {
            await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
            await atomicJson(file, [...workers.filter((row) => row.id !== worker.id), worker]);
          });
          return worker;
        }),
      ),
    setEnabled: (input) =>
      writeLock.withPermit(
        Effect.gen(function* () {
          const workers = yield* list;
          const worker = workers.find((row) => row.id === input.workerId);
          if (!worker) return yield* new MiniOffloadError({ reason: "worker" });
          const next = { ...worker, enabled: input.enabled };
          yield* disk(() =>
            atomicJson(
              file,
              workers.map((row) => (row.id === next.id ? next : row)),
            ),
          );
          return next;
        }),
      ),
  });
});

/** The registry kept in `<stateDir>/fork/mini-offload/workers.json`. */
export const layerFile = Layer.effect(MiniWorkerSource, makeFile);
