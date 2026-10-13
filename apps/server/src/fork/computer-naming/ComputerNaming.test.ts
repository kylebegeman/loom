import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ComputerNaming from "./ComputerNaming.ts";

const namedHost = Layer.mergeAll(
  Layer.succeed(HostProcess.Platform, "win32"),
  Layer.succeed(HostProcess.Hostname, "Dorothy"),
);
const namingLayer = (baseDir: string) =>
  ComputerNaming.layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provide(ProcessRunner.layer),
    Layer.provide(namedHost),
  );
const environmentLayer = (baseDir: string) =>
  ServerEnvironment.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provide(namedHost),
  );

it.layer(NodeServices.layer)("canonical computer names", (it) => {
  it.effect("uses the OS name by default, persists a rename and restores the default", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const naming = yield* ComputerNaming.ComputerNaming;
        expect(yield* naming.current).toEqual({
          name: null,
          label: "Dorothy",
          defaultLabel: "Dorothy",
        });
        expect(yield* naming.rename({ name: "  Rack Mac  " })).toEqual({
          name: "Rack Mac",
          label: "Rack Mac",
          defaultLabel: "Dorothy",
        });
      }).pipe(Effect.provide(namingLayer(baseDir)));
      yield* Effect.gen(function* () {
        const naming = yield* ComputerNaming.ComputerNaming;
        expect((yield* naming.current).label).toBe("Rack Mac");
        expect((yield* naming.rename({ name: null })).label).toBe("Dorothy");
      }).pipe(Effect.provide(namingLayer(baseDir)));
      const restored = yield* ComputerNaming.ComputerNaming.pipe(
        Effect.flatMap((naming) => naming.current),
        Effect.provide(namingLayer(baseDir)),
      );
      expect(restored.name).toBeNull();
      expect(restored.label).toBe("Dorothy");
    }),
  );

  it.effect("rejects invalid names before persistence and preserves the previous state", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const naming = yield* ComputerNaming.ComputerNaming;
        const previous = yield* naming.rename({ name: "Orange Pi" });
        for (const name of [
          "",
          "   ",
          "x".repeat(101),
          "Pi\nRack",
          "Pi\u0000Rack",
          "Pi\u202eRack",
        ]) {
          const error = yield* naming.rename({ name }).pipe(Effect.flip);
          expect(error.operation).toBe("validate");
          expect(yield* naming.current).toEqual(previous);
        }
      }).pipe(Effect.provide(namingLayer(baseDir)));
      const name = yield* ComputerNaming.ComputerNaming.pipe(
        Effect.flatMap((naming) => naming.current),
        Effect.provide(namingLayer(baseDir)),
      );
      expect(name.label).toBe("Orange Pi");
    }),
  );

  it.effect("preserves the visible name when an atomic save fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const naming = yield* ComputerNaming.ComputerNaming;
        const previous = yield* naming.rename({ name: "Rack Mac" });
        const blocker = `${baseDir}/userdata/fork/computer-naming/settings.json`;
        yield* fs.remove(blocker);
        yield* fs.makeDirectory(blocker);
        const error = yield* naming.rename({ name: "Other Mac" }).pipe(Effect.flip);
        expect(error.operation).toBe("write");
        expect(yield* naming.current).toEqual(previous);
      }).pipe(Effect.provide(namingLayer(baseDir)));
    }),
  );

  it.effect("serializes competing edits and publishes only durable changes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const final = yield* Effect.gen(function* () {
        const naming = yield* ComputerNaming.ComputerNaming;
        const subscribed = yield* Deferred.make<void>();
        const changes = yield* Deferred.make<ReadonlyArray<string>>();
        const labels: string[] = [];
        yield* naming.changes.pipe(
          Stream.take(3),
          Stream.runForEach((state) =>
            Effect.gen(function* () {
              labels.push(state.label);
              if (labels.length === 1) yield* Deferred.succeed(subscribed, undefined);
              if (labels.length === 3) yield* Deferred.succeed(changes, labels);
            }),
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(subscribed);
        yield* Effect.all([naming.rename({ name: "Rack A" }), naming.rename({ name: "Rack B" })], {
          concurrency: "unbounded",
        });
        expect((yield* Deferred.await(changes)).toSorted()).toEqual([
          "Dorothy",
          "Rack A",
          "Rack B",
        ]);
        return yield* naming.current;
      }).pipe(Effect.provide(namingLayer(baseDir)));
      const persisted = yield* ComputerNaming.ComputerNaming.pipe(
        Effect.flatMap((naming) => naming.current),
        Effect.provide(namingLayer(baseDir)),
      );
      expect(persisted).toEqual(final);
    }),
  );

  it.effect("updates discovery descriptors immediately without changing environment identity", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      yield* Effect.gen(function* () {
        const naming = yield* ComputerNaming.ComputerNaming;
        const environment = yield* ServerEnvironment.ServerEnvironment;
        const original = yield* environment.getDescriptor;
        expect(original.capabilities.loomFeatures).toContain("computer-naming");
        yield* naming.rename({ name: "Orange Pi" });
        const renamed = yield* environment.getDescriptor;
        expect(renamed.environmentId).toBe(original.environmentId);
        expect(renamed.label).toBe("Orange Pi");
        yield* naming.rename({ name: null });
        expect((yield* environment.getDescriptor).label).toBe("Dorothy");
      }).pipe(Effect.provide(environmentLayer(baseDir)));
    }),
  );

  it.effect("ignores malformed stored names without rewriting them", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const directory = `${baseDir}/userdata/fork/computer-naming`;
      yield* fs.makeDirectory(directory, { recursive: true });
      const contents = '{"name":""}';
      yield* fs.writeFileString(`${directory}/settings.json`, contents);
      const current = yield* ComputerNaming.ComputerNaming.pipe(
        Effect.flatMap((naming) => naming.current),
        Effect.provide(namingLayer(baseDir)),
      );
      expect(current.label).toBe("Dorothy");
      expect(yield* fs.readFileString(`${directory}/settings.json`)).toBe(contents);
    }),
  );
});
