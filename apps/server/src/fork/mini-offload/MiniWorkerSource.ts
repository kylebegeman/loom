// @effect-diagnostics nodeBuiltinImport:off - The worker registry is a private file on the host.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  MiniOffloadError,
  MiniWorker,
  MiniWorkerConnection,
  MiniWorkerRef,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../../config.ts";
import { atomicJson, disk, readJson } from "./storage.ts";

// A removed worker stays in the file, disabled, so a server that predates removal still sends it nothing.
const Row = Schema.Struct({ ...MiniWorker.fields, removed: Schema.optional(Schema.Literal(true)) });
type Row = typeof Row.Type;
const Rows = Schema.Array(Row);
const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((cause) => new MiniOffloadError({ reason: "response", cause })),
  );
const live = ({ removed: _removed, ...worker }: Row): MiniWorker => worker;
const sameConnection = (a: MiniWorker, b: { target: string; sshConfig: string | null }) =>
  a.target === b.target && a.sshConfig === b.sshConfig;

/** The registered Mini workers. Offloading reads and changes workers only through this. */
export class MiniWorkerSource extends Context.Service<
  MiniWorkerSource,
  {
    readonly list: Effect.Effect<ReadonlyArray<MiniWorker>, MiniOffloadError>;
    /**
     * The worker with this ID, including one that was removed, so its earlier jobs keep reaching
     * it at its last connection.
     */
    readonly lookup: (workerId: string) => Effect.Effect<MiniWorker | undefined, MiniOffloadError>;
    /**
     * Adds a worker, or replaces the one with its id when the connection is the same. A removed
     * worker's ID comes back only at its own connection, so its jobs never reach another computer.
     */
    readonly register: (input: MiniWorker) => Effect.Effect<MiniWorker, MiniOffloadError>;
    readonly setEnabled: (input: {
      readonly workerId: string;
      readonly enabled: boolean;
    }) => Effect.Effect<MiniWorker, MiniOffloadError>;
    /** Points a registered worker at a new SSH connection, for when the same worker moved. */
    readonly update: (input: MiniWorkerConnection) => Effect.Effect<MiniWorker, MiniOffloadError>;
    /** Stops listing a worker and returns it. Its earlier jobs still reach it through `lookup`. */
    readonly remove: (input: MiniWorkerRef) => Effect.Effect<MiniWorker, MiniOffloadError>;
  }
>()("t3/fork/mini-offload/MiniWorkerSource") {}

const makeFile = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const root = NodePath.join(config.stateDir, "fork", "mini-offload");
  const file = NodePath.join(root, "workers.json");
  // Each change rewrites the whole file from a fresh read, so changes run one at a time.
  const writeLock = yield* Semaphore.make(1);
  // No cache: every call sees the file as it is now, including edits made outside this process.
  const rows = Effect.gen(function* () {
    const value = yield* disk(() => readJson(file));
    return value === null ? [] : yield* decode(Rows, value);
  });
  const list = rows.pipe(Effect.map((all) => all.filter((row) => !row.removed).map(live)));
  const write = (next: ReadonlyArray<Row>) =>
    disk(async () => {
      await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
      await atomicJson(file, next);
    });
  const replace = (all: ReadonlyArray<Row>, next: Row) =>
    write(all.map((row) => (row.id === next.id ? next : row)));
  return MiniWorkerSource.of({
    list,
    lookup: (workerId) =>
      rows.pipe(
        Effect.map((all) => {
          const row = all.find((candidate) => candidate.id === workerId);
          return row && live(row);
        }),
      ),
    register: (input) =>
      writeLock.withPermit(
        Effect.gen(function* () {
          const worker = yield* decode(MiniWorker, input);
          if (worker.sshConfig !== null && !NodePath.isAbsolute(worker.sshConfig))
            return yield* new MiniOffloadError({ reason: "worker" });
          const all = yield* rows;
          const old = all.find((row) => row.id === worker.id);
          if (old && !sameConnection(old, worker))
            return yield* new MiniOffloadError({ reason: "worker" });
          yield* write([...all.filter((row) => row.id !== worker.id), worker]);
          return worker;
        }),
      ),
    setEnabled: (input) =>
      writeLock.withPermit(
        Effect.gen(function* () {
          const all = yield* rows;
          const worker = all.find((row) => row.id === input.workerId && !row.removed);
          if (!worker) return yield* new MiniOffloadError({ reason: "worker" });
          const next = { ...worker, enabled: input.enabled };
          yield* replace(all, next);
          return next;
        }),
      ),
    update: (input) =>
      writeLock.withPermit(
        Effect.gen(function* () {
          const connection = yield* decode(MiniWorkerConnection, input);
          if (connection.sshConfig !== null && !NodePath.isAbsolute(connection.sshConfig))
            return yield* new MiniOffloadError({ reason: "worker" });
          const all = yield* rows;
          const worker = all.find((row) => row.id === connection.workerId && !row.removed);
          if (!worker) return yield* new MiniOffloadError({ reason: "worker" });
          if (sameConnection(worker, connection)) return worker;
          const next = { ...worker, target: connection.target, sshConfig: connection.sshConfig };
          yield* replace(all, next);
          return next;
        }),
      ),
    remove: (input) =>
      writeLock.withPermit(
        Effect.gen(function* () {
          const { workerId } = yield* decode(MiniWorkerRef, input);
          const all = yield* rows;
          const worker = all.find((row) => row.id === workerId && !row.removed);
          if (!worker) return yield* new MiniOffloadError({ reason: "worker" });
          yield* replace(all, { ...worker, enabled: false, removed: true });
          return worker;
        }),
      ),
  });
});

/** The registry kept in `<stateDir>/fork/mini-offload/workers.json`. */
export const layerFile = Layer.effect(MiniWorkerSource, makeFile);
