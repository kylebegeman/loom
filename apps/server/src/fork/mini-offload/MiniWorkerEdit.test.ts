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
  enabled: false,
};
const other: MiniWorker = { ...worker, id: "pi-02", name: "Other Pi", target: "pi-other" };
const setup = Effect.gen(function* () {
  const home = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-mini-edit-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
  );
  const source = yield* WorkerSource.MiniWorkerSource.pipe(
    Effect.provide(
      WorkerSource.layerFile.pipe(
        Layer.provide(Config.layerTest(home, NodePath.join(home, "state"))),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
  yield* source.register(worker);
  yield* source.register(other);
  return {
    source,
    sshConfig: NodePath.join(home, "ssh_config"),
    file: NodePath.join(home, "state", "userdata", "fork", "mini-offload", "workers.json"),
  };
});
describe("changing a registered Mini worker", () => {
  it.effect("re-points a worker and keeps its ID, name and enabled state", () =>
    Effect.gen(function* () {
      const { source, sshConfig } = yield* setup;
      const moved = { ...worker, target: "pi-moved", sshConfig };
      expect(yield* source.update({ workerId: worker.id, target: "pi-moved", sshConfig })).toEqual(
        moved,
      );
      expect(yield* source.list).toEqual([moved, other]);
      // The same connection again changes nothing.
      expect(yield* source.update({ workerId: worker.id, target: "pi-moved", sshConfig })).toEqual(
        moved,
      );
      expect(
        yield* source.update({ workerId: worker.id, target: "pi-moved", sshConfig: null }),
      ).toEqual({ ...moved, sshConfig: null });
      // Registering is still not a way to move a worker.
      expect(
        (yield* Effect.flip(source.register({ ...worker, target: "pi-elsewhere" }))).reason,
      ).toBe("worker");
    }),
  );
  it.effect("refuses an unknown worker or a relative SSH config path without writing", () =>
    Effect.gen(function* () {
      const { source } = yield* setup;
      for (const input of [
        { workerId: "missing", target: "pi-moved", sshConfig: null },
        { workerId: worker.id, target: "pi-moved", sshConfig: "relative/ssh_config" },
      ])
        expect((yield* Effect.flip(source.update(input))).reason).toBe("worker");
      expect(yield* source.list).toEqual([worker, other]);
    }),
  );
  it.effect("removes only the named worker and keeps its last connection for its jobs", () =>
    Effect.gen(function* () {
      const { source, file } = yield* setup;
      const enabled = yield* source.setEnabled({ workerId: worker.id, enabled: true });
      expect(yield* source.remove({ workerId: worker.id })).toEqual(enabled);
      expect(yield* source.list).toEqual([other]);
      for (const change of [
        source.remove({ workerId: worker.id }),
        source.update({ workerId: worker.id, target: "pi-new", sshConfig: null }),
        source.setEnabled({ workerId: worker.id, enabled: true }),
      ])
        expect((yield* Effect.flip(change)).reason).toBe("worker");
      expect(yield* source.lookup(worker.id)).toEqual({ ...worker, enabled: false });
      // A server that predates removal reads the row as a disabled worker and sends it nothing.
      expect(JSON.parse(NodeFS.readFileSync(file, "utf8"))).toContainEqual({
        ...worker,
        enabled: false,
        removed: true,
      });
      // Another computer never takes a removed ID, since that would hand it the earlier jobs.
      expect((yield* Effect.flip(source.register({ ...worker, target: "pi-new" }))).reason).toBe(
        "worker",
      );
      const returned = { ...worker, name: "Returned Pi", enabled: true };
      expect(yield* source.register(returned)).toEqual(returned);
      expect(yield* source.list).toEqual([other, returned]);
    }),
  );
});
