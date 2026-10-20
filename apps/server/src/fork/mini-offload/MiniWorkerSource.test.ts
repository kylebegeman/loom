// @effect-diagnostics nodeBuiltinImport:off - The registry file is exercised in an owned temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { MiniWorker } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Config from "../../config.ts";
import * as WorkerSource from "./MiniWorkerSource.ts";

const worker: MiniWorker = {
  id: "pi-01",
  name: "Test Pi",
  target: "pi-test",
  sshConfig: null,
  enabled: true,
};
const second: MiniWorker = {
  id: "pi-02",
  name: "Second Pi",
  target: "pi-test-2",
  sshConfig: null,
  enabled: true,
};
const setup = Effect.gen(function* () {
  const home = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-mini-workers-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
  );
  const base = NodePath.join(home, "state");
  const makeSource = WorkerSource.MiniWorkerSource.pipe(
    Effect.provide(
      WorkerSource.layerFile.pipe(
        Layer.provide(Config.layerTest(home, base)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
  return {
    source: yield* makeSource,
    makeSource,
    sshConfig: NodePath.join(home, "ssh_config"),
    file: NodePath.join(base, "userdata", "fork", "mini-offload", "workers.json"),
  };
});
describe("Mini worker file source", () => {
  it.effect("lists registered workers from the private file on every call", () =>
    Effect.gen(function* () {
      const { source, makeSource, file } = yield* setup;
      expect(yield* source.list).toEqual([]);
      expect(yield* source.register(worker)).toEqual(worker);
      expect(yield* source.list).toEqual([worker]);
      expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
      expect(yield* (yield* makeSource).list).toEqual([worker]);
      NodeFS.writeFileSync(file, JSON.stringify([worker, second]));
      expect(yield* source.list).toEqual([worker, second]);
    }),
  );
  it.effect(
    "replaces a worker registered again with the same connection and refuses a new one",
    () =>
      Effect.gen(function* () {
        const { source, sshConfig } = yield* setup;
        yield* source.register(worker);
        yield* source.register(second);
        const renamed = { ...worker, name: "Renamed Pi", enabled: false };
        expect(yield* source.register(renamed)).toEqual(renamed);
        expect(yield* source.list).toEqual([second, renamed]);
        for (const changed of [
          { ...worker, target: "other-node" },
          { ...worker, sshConfig },
        ])
          expect((yield* Effect.flip(source.register(changed))).reason).toBe("worker");
        expect(yield* source.list).toEqual([second, renamed]);
      }),
  );
  it.effect("refuses invalid registrations without writing the registry", () =>
    Effect.gen(function* () {
      const { source, file } = yield* setup;
      expect(
        (yield* Effect.flip(source.register({ ...worker, sshConfig: "relative/ssh_config" })))
          .reason,
      ).toBe("worker");
      expect((yield* Effect.flip(source.register({ ...worker, id: "Not An Id" }))).reason).toBe(
        "response",
      );
      expect(NodeFS.existsSync(file)).toBe(false);
    }),
  );
  it.effect("disables and enables a registered worker in place", () =>
    Effect.gen(function* () {
      const { source } = yield* setup;
      yield* source.register(worker);
      yield* source.register(second);
      expect(yield* source.setEnabled({ workerId: worker.id, enabled: false })).toEqual({
        ...worker,
        enabled: false,
      });
      expect(yield* source.list).toEqual([{ ...worker, enabled: false }, second]);
      yield* source.setEnabled({ workerId: worker.id, enabled: true });
      expect(yield* source.list).toEqual([worker, second]);
      expect(
        (yield* Effect.flip(source.setEnabled({ workerId: "missing", enabled: true }))).reason,
      ).toBe("worker");
    }),
  );
  it.effect("keeps every change made at the same time", () =>
    Effect.gen(function* () {
      const { source } = yield* setup;
      const workers = Array.from({ length: 8 }, (_, index) => ({
        ...worker,
        id: `pi-${index}`,
        target: `pi-test-${index}`,
      }));
      yield* Effect.forEach(workers, (row) => source.register(row), { concurrency: "unbounded" });
      yield* Effect.forEach(
        workers,
        (row) => source.setEnabled({ workerId: row.id, enabled: false }),
        { concurrency: "unbounded" },
      );
      const listed = yield* source.list;
      expect(listed.map((row) => row.id).toSorted()).toEqual(workers.map((row) => row.id));
      expect(listed.every((row) => !row.enabled)).toBe(true);
    }),
  );
  it.effect("reports an unreadable registry as a storage or response failure", () =>
    Effect.gen(function* () {
      const { source, file } = yield* setup;
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, "not json");
      expect((yield* Effect.flip(source.list)).reason).toBe("storage");
      NodeFS.writeFileSync(file, JSON.stringify({ workers: [worker] }));
      expect((yield* Effect.flip(source.list)).reason).toBe("response");
      expect((yield* Effect.flip(source.register(second))).reason).toBe("response");
    }),
  );
});
