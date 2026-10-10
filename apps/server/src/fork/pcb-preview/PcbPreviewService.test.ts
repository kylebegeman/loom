import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ByteSize from "effect/ByteSize";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub";
import * as TestClock from "effect/testing/TestClock";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PcbPreview from "./PcbPreviewService.ts";
import * as Config from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import { ProcessRunner, type ProcessRunInput, type ProcessRunOutput } from "../../processRunner.ts";
import * as NativeProcesses from "../../processRunner.ts";

const partial = <A extends object>(methods: Partial<A>): A =>
  new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected service call: ${String(key)}`);
    },
  });
const output = (code = 0, stdout = "", timedOut = false): ProcessRunOutput => ({
  code: code as ProcessRunOutput["code"],
  stdout,
  stderr: "",
  timedOut,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-pcb-test-" });
  const state = path.join(root, ".t3");
  const bin = path.join(root, ".tools");
  yield* fs.makeDirectory(bin);
  for (const tool of ["kicad-cli", "tsci", "ngspice"]) {
    const file = path.join(bin, tool);
    yield* fs.writeFileString(file, "#!/bin/sh\n");
    yield* fs.chmod(file, 0o755);
  }
  const names = ["board.kicad_pro", "board.kicad_sch", "board.kicad_pcb", "blink.circuit.tsx"];
  for (const name of names)
    yield* fs.writeFileString(
      path.join(root, name),
      name.endsWith(".kicad_pcb")
        ? '(kicad_pcb (general (thickness 1.6)) (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user)) (gr_rect (start 0 0) (end 20 20) (layer "Edge.Cuts")))'
        : "source " + name,
    );
  const threadId = ThreadId.make("pcb-thread"),
    projectId = ProjectId.make("pcb-project");
  let worktree: string | null = null;
  let invalidSheet = false;
  let code = 0,
    timeout = false;
  const calls: ProcessRunInput[] = [];
  let block: { started: Deferred.Deferred<void>; stopped: Deferred.Deferred<void> } | null = null;
  const runner = ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        if (input.args[0] === "version") return output(0, "10.0.6");
        if (input.args[0] === "--version") {
          if (!input.command.endsWith("ngspice")) {
            yield* fs.makeDirectory(path.join(input.cwd!, ".tscircuit", "cache"), {
              recursive: true,
            });
            yield* fs.writeFileString(
              path.join(input.cwd!, ".tscircuit", "cache", "probe"),
              "cache",
            );
          }
          return output(0, input.command.endsWith("ngspice") ? "ngspice-47" : "0.0.2764");
        }
        calls.push(input);
        const target =
          input.args[input.args.indexOf(input.args.includes("-o") ? "-o" : "--output") + 1]!;
        if (block) {
          const current = block;
          block = null;
          yield* fs.makeDirectory(target, { recursive: true });
          yield* fs.writeFileString(path.join(target, "partial.svg"), "partial");
          return yield* Deferred.succeed(current.started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(current.stopped, undefined)),
          );
        }
        if (
          input.args[0] === "export" &&
          input.args.some((format) => format === "json" || format === "circuit-json")
        )
          yield* fs.writeFileString(
            target,
            JSON.stringify([{ type: "pcb_board", center: { x: 0, y: 0 }, width: 20, height: 20 }]),
          );
        else if (input.args.includes("glb")) yield* fs.writeFileString(target, "glTFtest");
        else if (input.args.includes("netlist"))
          yield* fs.writeFileString(target, "(export (nets))");
        else if (input.args.includes("erc") || input.args.includes("drc")) {
          const violation = {
            type: "clearance",
            description: "Too close",
            severity: "error",
            items: [],
          };
          const report = input.args.includes("erc")
            ? {
                kicad_version: "10.0.6",
                sheets: [{ path: "/", violations: code === 5 ? [violation] : [] }],
              }
            : {
                kicad_version: "10.0.6",
                violations: code === 5 ? [violation] : [],
                unconnected_items: [],
                schematic_parity: [],
              };
          yield* fs.writeFileString(target, JSON.stringify(report));
        } else if (input.args.includes("sch")) {
          yield* fs.makeDirectory(target, { recursive: true });
          if (invalidSheet)
            yield* fs.symlink(path.join(root, "board.kicad_sch"), path.join(target, "board.svg"));
          else
            yield* fs.writeFileString(
              path.join(target, "board.svg"),
              '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" data-real-to-screen-transform="matrix(1,0,0,-1,5,5)"><path data-type="pcb_board" d="M 0 0 L 10 0 L 10 10 L 0 10 Z"/></svg>',
            );
        } else
          yield* fs.writeFileString(
            target,
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" data-real-to-screen-transform="matrix(1,0,0,-1,5,5)"><path data-type="pcb_board" d="M 0 0 L 10 0 L 10 10 L 0 10 Z"/></svg>',
          );
        return output(code, "tool log", timeout);
      }).pipe(Effect.orDie),
  });
  const context = yield* Layer.build(Config.layerTest(root, state));
  const paths = yield* WorkspacePaths.make;
  const queries = partial<ProjectionStore.ProjectionStoreV2["Service"]>({
    getThread: () =>
      Effect.succeed(partial<OrchestrationV2AppThread>({ projectId, worktreePath: worktree })),
  });
  const projectStore = partial<ProjectStore.ProjectStoreV2["Service"]>({
    get: () =>
      Effect.succeedSome(partial<ProjectStore.ProjectRow>({ projectId, workspaceRoot: root })),
  });
  let refreshes = 0;
  const entries = partial<WorkspaceEntries["Service"]>({
    refresh: () =>
      Effect.sync(() => {
        refreshes++;
      }),
    search: ({ query }) =>
      Effect.succeed({
        entries: names
          .filter((n) => n.includes(query))
          .map((name) => ({ path: name, kind: "file" as const })),
        truncated: false,
      }),
  });
  const create = (filesystem = fs, processRunner = runner) =>
    PcbPreview.make.pipe(
      Effect.provide(context),
      Effect.provideService(WorkspacePaths.WorkspacePaths, paths),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, queries),
      Effect.provideService(ProjectStore.ProjectStoreV2, projectStore),
      Effect.provideService(WorkspaceEntries, entries),
      Effect.provideService(ProcessRunner, processRunner),
      Effect.provideService(FileSystem.FileSystem, filesystem),
      Effect.provideService(HostProcess.Environment, {
        PATH: bin,
        HOME: root,
        API_TOKEN: "private",
        T3CODE_HOME: "private",
        NODE_OPTIONS: "private",
      }),
      Effect.provideService(HostProcess.Platform, "linux"),
    );
  return {
    fs,
    path,
    root,
    stateDir: (yield* Config.ServerConfig.pipe(Effect.provide(context))).stateDir,
    create,
    calls,
    runner,
    getRefreshes: () => refreshes,
    names,
    setInvalidSheet: () => {
      invalidSheet = true;
    },
    input: { threadId, designId: names[0]!, view: "schematic" as const },
    setResult: (c: number, t = false) => {
      code = c;
      timeout = t;
    },
    setBlock: (b: typeof block) => {
      block = b;
    },
    setWorktree: (p: string) => {
      worktree = p;
    },
  };
});
const test = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | import("effect/Scope").Scope>,
) => effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("PCB preview service", () => {
  it.effect("discovers, renders, reads remotely and reuses complete workspace-isolated cache", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        expect((yield* service.listDesigns({ threadId: t.input.threadId })).designs).toHaveLength(
          2,
        );
        const first = yield* service.render(t.input);
        expect(first.outcome).toBe("ok");
        expect(first.cached).toBe(false);
        expect(
          (yield* service.readSheet({
            threadId: t.input.threadId,
            renderKey: first.renderKey,
            sheetId: first.sheets[0]!.id,
          })).svg,
        ).toContain("<svg");
        expect((yield* service.render(t.input)).cached).toBe(true);
        expect((yield* service.render({ ...t.input, layers: "back" })).cached).toBe(true);
        expect(t.calls).toHaveLength(1);
        expect((yield* service.render({ ...t.input, force: true })).cached).toBe(false);
        expect(t.calls).toHaveLength(2);
        const cache = t.path.join(t.stateDir, "fork", "pcb-preview", "cache");
        expect((yield* t.fs.readDirectory(cache)).some((n) => n.startsWith("pending-"))).toBe(
          false,
        );
        const other = t.path.join(t.root, "worktree");
        yield* t.fs.makeDirectory(other);
        for (const name of ["board.kicad_pro", "board.kicad_sch", "board.kicad_pcb"])
          yield* t.fs.writeFileString(t.path.join(other, name), "same board");
        t.setWorktree(other);
        expect(
          (yield* service
            .readSheet({
              threadId: t.input.threadId,
              renderKey: first.renderKey,
              sheetId: first.sheets[0]!.id,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("render-not-found");
        expect((yield* service.render(t.input)).renderKey).not.toBe(first.renderKey);
      }),
    ),
  );
  it.effect("isolates drawings for designs that share one source folder", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        t.names.push("other.kicad_sch");
        yield* t.fs.writeFileString(t.path.join(t.root, "other.kicad_sch"), "other schematic");
        const service = yield* t.create();
        const first = yield* service.render(t.input);
        const second = yield* service.render({ ...t.input, designId: "other.kicad_sch" });
        expect(second.sourceHash).toBe(first.sourceHash);
        expect(second.renderKey).not.toBe(first.renderKey);
        expect(second.cached).toBe(false);
        expect(t.calls).toHaveLength(2);
        expect((yield* service.render(t.input)).cached).toBe(true);
      }),
    ),
  );
  it.effect("returns clean, violations, failure and timeout; restores latest checks", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create(),
          input = { ...t.input, kind: "drc" as const };
        expect((yield* service.check(input)).outcome).toBe("clean");
        t.setResult(5);
        expect((yield* service.check(input)).outcome).toBe("violations");
        const reopened = yield* t.create();
        expect((yield* reopened.latestChecks(input))[0]?.violations).toHaveLength(1);
        t.setResult(1);
        expect((yield* service.check(input)).outcome).toBe("failed");
        t.setResult(0, true);
        expect((yield* service.check(input)).outcome).toBe("timed-out");
        expect(t.calls.find((c) => c.args.includes("drc"))?.args).toContain("--schematic-parity");
      }),
    ),
  );
  it.effect("rejects traversal, escaped symlinks and oversized sheets", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        expect(
          (yield* service.render({ ...t.input, designId: "../board.kicad_pro" }).pipe(Effect.flip))
            .reason,
        ).toBe("path-outside-workspace");
        const result = yield* service.render(t.input);
        const sheet = t.path.join(
          t.stateDir,
          "fork",
          "pcb-preview",
          "cache",
          result.renderKey,
          "sheets",
          result.sheets[0]!.id,
        );
        yield* t.fs.writeFileString(sheet, "x".repeat(4 * 1024 * 1024 + 1));
        expect(
          (yield* service
            .readSheet({
              threadId: t.input.threadId,
              renderKey: result.renderKey,
              sheetId: result.sheets[0]!.id,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("sheet-too-large");
        const outside = yield* t.fs.makeTempDirectoryScoped();
        yield* t.fs.writeFileString(t.path.join(outside, "board.kicad_pro"), "x");
        yield* t.fs.remove(t.path.join(t.root, "board.kicad_pro"));
        yield* t.fs.symlink(
          t.path.join(outside, "board.kicad_pro"),
          t.path.join(t.root, "board.kicad_pro"),
        );
        expect((yield* service.render(t.input).pipe(Effect.flip)).reason).toBe(
          "path-outside-workspace",
        );
      }),
    ),
  );
  it.effect(
    "does not execute local circuit code during discovery and isolates render environment",
    () =>
      test(
        Effect.gen(function* () {
          const t = yield* setup;
          yield* t.fs.makeDirectory(t.path.join(t.root, "node_modules/.bin"), { recursive: true });
          yield* t.fs.writeFileString(
            t.path.join(t.root, "node_modules/.bin/tsci"),
            "project executable",
          );
          const service = yield* t.create();
          yield* service.listDesigns({ threadId: t.input.threadId });
          expect(t.calls).toHaveLength(0);
          yield* service.render({ ...t.input, designId: "blink.circuit.tsx" });
          const call = t.calls[0]!;
          expect(call.env?.API_TOKEN).toBeUndefined();
          expect(call.env?.T3CODE_HOME).toBeUndefined();
          expect(call.env?.NODE_OPTIONS).toBeUndefined();
          expect(call.extendEnv).toBe(false);
        }),
      ),
  );
  it.effect("cancels in-flight renders and deletes their partial output", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        const started = yield* Deferred.make<void>(),
          stopped = yield* Deferred.make<void>();
        t.setBlock({ started, stopped });
        const fiber = yield* service.render(t.input).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(stopped);
        expect(
          (yield* t.fs.readDirectory(
            t.path.join(t.stateDir, "fork", "pcb-preview", "cache"),
          )).filter((n) => n.startsWith("pending-")),
        ).toEqual([]);
      }),
    ),
  );
  it.effect("rejects linked tool outputs and cleans the failed render", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        t.setInvalidSheet();
        expect((yield* service.render(t.input).pipe(Effect.flip)).reason).toBe("io-failed");
        expect(
          (yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork/pcb-preview/cache"))).filter(
            (name) => name.startsWith("pending-"),
          ),
        ).toEqual([]);
      }),
    ),
  );
  it.effect("bounds persistent check history by bytes without large test allocations", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        yield* t.create();
        const directory = t.path.join(t.stateDir, "fork/pcb-preview/checks");
        for (let index = 0; index < 100; index++)
          yield* t.fs.writeFileString(
            t.path.join(directory, `${index.toString(16).padStart(64, "0")}.json`),
            "{}",
          );
        const filesystem = {
          ...t.fs,
          stat: (file: string) =>
            t.fs
              .stat(file)
              .pipe(
                Effect.map((info) =>
                  file.includes("/fork/pcb-preview/checks/") && file.endsWith(".json")
                    ? { ...info, size: ByteSize.bytes(300 * 1024) }
                    : info,
                ),
              ),
        };
        yield* t.create(filesystem);
        const retained = yield* t.fs.readDirectory(directory);
        expect(retained.length).toBeLessThan(100);
        expect(retained.length * 300 * 1024).toBeLessThanOrEqual(20 * 1024 * 1024);
      }),
    ),
  );
  it.effect("invalidates previews for workspace dependencies outside the design folder", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        yield* t.fs.makeDirectory(t.path.join(t.root, "hw"));
        yield* t.fs.makeDirectory(t.path.join(t.root, "shared"));
        yield* t.fs.writeFileString(t.path.join(t.root, "hw/main.kicad_pro"), "project");
        yield* t.fs.writeFileString(
          t.path.join(t.root, "hw/main.kicad_sch"),
          '(property "Sheetfile" "../shared/power.kicad_sch")',
        );
        yield* t.fs.writeFileString(
          t.path.join(t.root, "shared/power.kicad_sch"),
          "first dependency",
        );
        t.names.push("hw/main.kicad_pro", "hw/main.kicad_sch", "shared/power.kicad_sch");
        const service = yield* t.create();
        const input = { ...t.input, designId: "hw/main.kicad_pro" };
        const first = yield* service.render(input);
        yield* t.fs.writeFileString(
          t.path.join(t.root, "shared/power.kicad_sch"),
          "second dependency is different",
        );
        const next = yield* service.render(input);
        expect(next.sourceHash).not.toBe(first.sourceHash);
        expect(next.cached).toBe(false);
      }),
    ),
  );
  it.effect("rebuilds nested watcher coverage and releases every watch on unsubscribe", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        const events = yield* PubSub.unbounded<FileSystem.WatchEvent>();
        const active = new Set<string>();
        const attached = yield* Deferred.make<void>(),
          eventSeen = yield* Deferred.make<void>(),
          nestedAttached = yield* Deferred.make<void>();
        const filesystem = {
          ...t.fs,
          watch: (directory: string) =>
            Stream.unwrap(
              Effect.gen(function* () {
                yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    active.add(directory);
                  }),
                  () =>
                    Effect.sync(() => {
                      active.delete(directory);
                    }),
                );
                const queue = yield* PubSub.subscribe(events);
                yield* Deferred.succeed(attached, undefined);
                if (directory.endsWith("/nested"))
                  yield* Deferred.succeed(nestedAttached, undefined);
                return Stream.fromSubscription(queue).pipe(
                  Stream.tap(() => Deferred.succeed(eventSeen, undefined)),
                );
              }),
            ),
        };
        const service = yield* t.create(filesystem),
          initialEmitted = yield* Deferred.make<void>(),
          changed = yield* Deferred.make<string>();
        let initial = "";
        const fiber = yield* service.watch(t.input).pipe(
          Stream.runForEach((e) => {
            if (!initial) {
              initial = e.sourceHash;
              return Deferred.succeed(initialEmitted, undefined);
            }
            return Deferred.succeed(changed, e.sourceHash);
          }),
          Effect.forkChild,
        );
        yield* Deferred.await(attached);
        yield* Deferred.await(initialEmitted);
        yield* t.fs.makeDirectory(t.path.join(t.root, "nested"));
        yield* t.fs.writeFileString(t.path.join(t.root, "nested/power.kicad_sch"), "nested source");
        yield* PubSub.publish(events, {
          _tag: "Create" as const,
          path: t.path.join(t.root, "nested"),
        });
        yield* Deferred.await(eventSeen);
        yield* TestClock.adjust("400 millis");
        expect(yield* Deferred.await(changed)).not.toBe(initial);
        yield* Deferred.await(nestedAttached);
        expect([...active].some((dir) => dir.endsWith("/nested"))).toBe(true);
        yield* Fiber.interrupt(fiber);
        expect(active.size).toBe(0);
      }),
    ),
  );
});

const validBoard =
  '(kicad_pcb (general (thickness 1.6)) (layers (0 "F.Cu" signal)) (gr_rect (start 0 0) (end 30 40) (layer "Edge.Cuts")))';
it.effect("serializes workspace saves, streams updates, and rejects stale versions", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(),
        input = { threadId: t.input.threadId, designId: t.input.designId };
      const initial = yield* service.getWorkspace(input),
        ready = yield* Deferred.make<void>();
      const watched = yield* service.workspaceUpdates(input).pipe(
        Stream.tap((v) => (v.version === 0 ? Deferred.succeed(ready, undefined) : Effect.void)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(ready);
      const next = yield* service.updateWorkspace({
        ...input,
        expectedVersion: 0,
        workspace: initial,
      });
      expect(next.version).toBe(1);
      expect((yield* Fiber.join(watched)).map((v) => v.version)).toEqual([0, 1]);
      expect(
        (yield* service
          .updateWorkspace({ ...input, expectedVersion: 0, workspace: initial })
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      const restored = yield* (yield* t.create()).getWorkspace(input);
      expect(restored.version).toBe(1);
    }),
  ),
);
it.effect("previews explicit parameters and rejects applying to newer source", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(),
        input = { threadId: t.input.threadId, designId: "blink.circuit.tsx" };
      const file = t.path.join(t.root, input.designId),
        source = "const resistance = /* loom:param resistance */ 1000;";
      yield* t.fs.writeFileString(file, source);
      yield* t.fs.writeFileString(
        file + ".parameters.json",
        JSON.stringify({
          parameters: [
            {
              key: "resistance",
              label: "Resistance",
              description: "",
              type: "number",
              default: 1000,
              min: 1,
              max: 10000,
            },
          ],
        }),
      );
      const current = yield* service.parameters(input);
      const preview = yield* service.applyParameters({
        ...input,
        expectedSourceHash: current.sourceHash,
        values: { resistance: 2200 },
        preview: true,
      });
      expect(preview.source).toContain("2200");
      expect(yield* t.fs.readFileString(file)).toBe(source);
      yield* t.fs.writeFileString(file, source + "\n");
      expect(
        (yield* service
          .applyParameters({
            ...input,
            expectedSourceHash: current.sourceHash,
            values: { resistance: 2200 },
            preview: false,
          })
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }),
  ),
);
it.effect("exports revision-bound references atomically and rejects destination symlinks", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(),
        input = { threadId: t.input.threadId, designId: t.input.designId };
      yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_pcb"), validBoard);
      yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "(kicad_sch)");
      const ref = yield* service.exportReference(input);
      expect((yield* t.fs.stat(ref.path)).type).toBe("File");
      const metadata = JSON.parse(yield* t.fs.readFileString(ref.metadataPath));
      expect(metadata.sourceHash).toBe(ref.sourceHash);
      expect(metadata.bounds.width).toBe(30);
      expect(t.getRefreshes()).toBeGreaterThan(0);
      expect(
        (yield* t.fs.readDirectory(t.path.dirname(ref.path))).some((n) => n.startsWith("pending-")),
      ).toBe(false);
      yield* t.fs.remove(ref.path);
      yield* t.fs.symlink(t.path.join(t.root, "board.kicad_pcb"), ref.path);
      expect((yield* service.exportReference(input).pipe(Effect.flip)).reason).toBe(
        "path-outside-workspace",
      );
    }),
  ),
);
it.effect("reuses linked hardware in an immutable workspace folder and detects conflicts", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(),
        library = yield* service.library();
      const item = {
        ...library.items[0]!,
        id: "test-hardware",
        assets: [{ kind: "3d" as const, path: "reference.glb", workspaceRoot: t.root }],
      };
      yield* t.fs.writeFileString(t.path.join(t.root, "reference.glb"), "glTFtest");
      yield* service.updateLibrary({
        expectedVersion: library.version,
        library: { ...library, items: [item] },
      });
      const input = { threadId: t.input.threadId, itemId: item.id },
        result = yield* service.reuseHardware(input);
      expect(yield* t.fs.readFileString(t.path.join(t.root, result.files[0]!.path))).toBe(
        "glTFtest",
      );
      expect(t.getRefreshes()).toBeGreaterThan(0);
      expect(yield* service.reuseHardware(input)).toEqual(result);
      yield* t.fs.writeFileString(t.path.join(t.root, result.files[0]!.path), "changed");
      expect((yield* service.reuseHardware(input).pipe(Effect.flip)).reason).toBe("conflict");
    }),
  ),
);

it.effect("streams cached board files with scoped signed URLs and bounded expiry", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const input = {
        threadId: t.input.threadId,
        designId: "board.kicad_pro",
        format: "glb" as const,
      };
      const model = yield* service.asset(input);
      expect(model.data).toBe("");
      expect(model.file?.sizeBytes).toBe(8);
      const parts = model.file!.relativeUrl.split("/");
      expect(
        yield* t.fs.readFileString(
          yield* service.resolveSignedRequest(parts.at(-2)!, parts.at(-1)!),
        ),
      ).toBe("glTFtest");
      expect((yield* service.asset(input)).sourceHash).toBe(model.sourceHash);
      expect(t.calls).toHaveLength(1);
      for (const [token, relative] of [
        ["bad", "board.glb"],
        [parts.at(-2)!, "../manifest.json"],
        [parts.at(-2)!, "manifest.json"],
      ]) {
        expect(
          (yield* service.resolveSignedRequest(token!, relative!).pipe(Effect.flip)).reason,
        ).toBe("render-not-found");
      }
      yield* TestClock.adjust("61 minutes");
      expect(
        (yield* service.resolveSignedRequest(parts.at(-2)!, "board.glb").pipe(Effect.flip)).reason,
      ).toBe("render-not-found");
    }),
  ),
);

it.effect("reports the simulator installation alongside CAD tools", () =>
  Effect.gen(function* () {
    const t = yield* setup;
    const service = yield* t.create();
    expect((yield* service.status()).ngspice).toMatchObject({ found: true, version: "47" });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("cleans tool detection caches without writing into the workspace", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      expect((yield* service.status()).tscircuit.version).toBe("0.0.2764");
      expect(yield* t.fs.exists(t.path.join(t.root, ".tscircuit"))).toBe(false);
      expect(
        (yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork", "pcb-preview", "cache"))).some(
          (n) => n.startsWith("pending-"),
        ),
      ).toBe(false);
    }),
  ),
);

it.effect("keeps generated board references out of circuit revisions and cache invalidation", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const input = { ...t.input, designId: "blink.circuit.tsx" };
      const before = yield* service.render(input);
      const references = t.path.join(t.root, ".loom", "pcb-references");
      yield* t.fs.makeDirectory(references, { recursive: true });
      yield* t.fs.writeFileString(t.path.join(references, "board.glb"), "generated geometry");
      yield* t.fs.writeFileString(t.path.join(references, "board.json"), "{}");
      const after = yield* service.render(input);
      expect(after.sourceHash).toBe(before.sourceHash);
      expect(after.cached).toBe(true);
    }),
  ),
);

it.effect("compares designs when the workspace is a subdirectory of its Git repository", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup;
      const native = yield* NativeProcesses.make().pipe(Effect.provide(NodeServices.layer));
      const nested = t.path.join(t.root, "electronics");
      yield* t.fs.makeDirectory(nested);
      const source = validBoard.replace(
        "(general",
        '(footprint "R" (property "Reference" "R1") (property "Value" "1k")) (general',
      );
      yield* t.fs.writeFileString(t.path.join(nested, "board.kicad_pro"), "{}");
      yield* t.fs.writeFileString(t.path.join(nested, "board.kicad_pcb"), source);
      yield* t.fs.writeFileString(t.path.join(nested, "board.kicad_sch"), "(kicad_sch)");
      for (const args of [
        ["init", "--quiet"],
        ["add", "--", "electronics"],
        [
          "-c",
          "user.name=Loom test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "Board",
        ],
      ]) {
        expect((yield* native.run({ command: "git", args, cwd: t.root })).code).toBe(0);
      }
      yield* t.fs.writeFileString(
        t.path.join(nested, "board.kicad_pcb"),
        source.replace('"1k"', '"2k"'),
      );
      t.setWorktree(nested);
      const service = yield* t.create(
        t.fs,
        ProcessRunner.of({
          run: (input) => (input.command === "git" ? native.run(input) : t.runner.run(input)),
        }),
      );
      const comparison = yield* service.compare({ ...t.input, from: "HEAD", to: "" });
      expect(comparison.changes).toEqual([{ kind: "changed", reference: "R1", detail: "value" }]);
      expect(comparison.beforeSvg).toContain("<svg");
      expect(comparison.afterSvg).toContain("<svg");
    }),
  ),
);

it.effect("rejects reference parent symlinks before creating destination folders", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_pcb"), validBoard);
      yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "(kicad_sch)");
      const outside = yield* t.fs.makeTempDirectoryScoped();
      yield* t.fs.symlink(outside, t.path.join(t.root, ".loom"));
      expect((yield* service.exportReference(t.input).pipe(Effect.flip)).reason).toBe(
        "path-outside-workspace",
      );
      expect(yield* t.fs.readDirectory(outside)).toEqual([]);
    }),
  ),
);
it.effect("keeps catalog metadata editable when an unchanged linked asset is missing", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const initial = yield* service.library();
      const file = t.path.join(t.root, "reference.glb");
      yield* t.fs.writeFileString(file, "model");
      const item = {
        ...initial.items[0]!,
        assets: [{ kind: "3d" as const, path: "reference.glb", workspaceRoot: t.root }],
      };
      const saved = yield* service.updateLibrary({
        expectedVersion: initial.version,
        library: { ...initial, items: [item] },
      });
      yield* t.fs.remove(file);
      const updated = yield* service.updateLibrary({
        expectedVersion: saved.version,
        library: { ...saved, items: [{ ...item, owned: true, quantity: 2 }] },
      });
      expect(updated.items[0]).toMatchObject({ owned: true, quantity: 2 });
      expect(
        (yield* service
          .reuseHardware({ threadId: t.input.threadId, itemId: item.id })
          .pipe(Effect.flip)).reason,
      ).toBe("design-not-found");
      expect(
        (yield* service
          .updateLibrary({
            expectedVersion: updated.version,
            library: {
              ...updated,
              items: [{ ...item, assets: [{ ...item.assets[0]!, path: "new-missing.glb" }] }],
            },
          })
          .pipe(Effect.flip)).reason,
      ).toBe("design-not-found");
    }),
  ),
);

it.effect("rejects hardware parent symlinks before creating destination folders", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const initial = yield* service.library();
      yield* t.fs.writeFileString(t.path.join(t.root, "reference.glb"), "model");
      const item = {
        ...initial.items[0]!,
        assets: [{ kind: "3d" as const, path: "reference.glb", workspaceRoot: t.root }],
      };
      yield* service.updateLibrary({
        expectedVersion: initial.version,
        library: { ...initial, items: [item] },
      });
      const outside = yield* t.fs.makeTempDirectoryScoped();
      yield* t.fs.symlink(outside, t.path.join(t.root, "hardware"));
      expect(
        (yield* service
          .reuseHardware({ threadId: t.input.threadId, itemId: item.id })
          .pipe(Effect.flip)).reason,
      ).toBe("path-outside-workspace");
      expect(yield* t.fs.readDirectory(outside)).toEqual([]);
    }),
  ),
);

it.effect("shares a circuit build across inspection and both drawing views", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const input = { threadId: t.input.threadId, designId: "blink.circuit.tsx" };
      expect((yield* service.render({ ...input, view: "schematic" })).outcome).toBe("ok");
      yield* service.inspect(input);
      expect((yield* service.render({ ...input, view: "pcb" })).outcome).toBe("ok");
      const builds = () =>
        t.calls.filter(
          (call) =>
            call.args[0] === "export" &&
            call.args.some((format) => format === "json" || format === "circuit-json"),
        );
      expect(builds()).toHaveLength(1);
      expect((yield* service.render({ ...input, view: "pcb", force: true })).outcome).toBe("ok");
      expect(builds()).toHaveLength(2);
    }),
  ),
);

it.effect(
  "runs simulation without loading host startup commands and cleans generated results",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        const raw =
          "Title: op\nFlags: real\nNo. Variables: 1\nNo. Points: 1\nVariables:\n0 v(out) voltage\nValues:\n0 2.5\n";
        let invocation: ProcessRunInput | null = null;
        const runner = ProcessRunner.of({
          run: (input) =>
            input.args.includes("-b")
              ? Effect.gen(function* () {
                  invocation = input;
                  yield* t.fs.writeFileString(t.path.join(input.cwd!, "results.raw"), raw);
                  return output();
                }).pipe(Effect.orDie)
              : t.runner.run(input),
        });
        const service = yield* t.create(t.fs, runner);
        yield* t.fs.writeFileString(
          t.path.join(t.root, "divider.cir"),
          "Divider\nV1 out 0 2.5\nR1 out 0 1000\n.end",
        );
        const result = yield* service.simulate({
          ...t.input,
          setup: {
            id: "op",
            name: "Operating point",
            analysis: "op",
            probes: [],
            step: 0.001,
            stop: 0.01,
            startFrequency: 10,
            stopFrequency: 1000,
            points: 100,
            netlistPath: "divider.cir",
            sweep: null,
          },
        });
        expect(result.runs[0]?.series[0]?.values).toEqual([2.5]);
        expect(invocation!.args).toContain("-n");
        expect(yield* t.fs.exists(invocation!.cwd!)).toBe(false);
      }),
    ),
);

it.effect("compares schematic-only connectivity from each isolated Git revision", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.fs.remove(t.path.join(t.root, "board.kicad_pcb"));
      t.names.splice(t.names.indexOf("board.kicad_pcb"), 1);
      const source =
        '(kicad_sch (uuid root) (symbol (lib_id "R") (at 10 20) (property "Reference" "R1") (property "Value" "1k")) (label "VCC"))';
      yield* t.fs.writeFileString(
        t.path.join(t.root, "board.kicad_sch"),
        source.replace('"VCC"', '"GND"'),
      );
      const exports: string[] = [];
      const runner = ProcessRunner.of({
        run: (input) =>
          Effect.gen(function* () {
            if (input.command === "git")
              return output(0, input.args[0] === "rev-parse" ? "old" : source);
            if (input.args.includes("netlist")) {
              const staged = input.args.at(-1)!;
              exports.push(staged);
              const content = yield* t.fs.readFileString(staged);
              const net = content.includes('"VCC"') ? "VCC" : "GND";
              const target = input.args[input.args.indexOf("--output") + 1]!;
              yield* t.fs.writeFileString(
                target,
                `(export (nets (net (name "${net}") (node (ref "R1") (pin "1") (pinfunction "IN")))))`,
              );
              return output();
            }
            return yield* t.runner.run(input);
          }).pipe(Effect.orDie),
      });
      const service = yield* t.create(t.fs, runner);
      const comparison = yield* service.compare({ ...t.input, from: "HEAD", to: "" });
      expect(comparison.before.nets[0]?.name).toBe("VCC");
      expect(comparison.after.nets[0]?.name).toBe("GND");
      expect(comparison.changes).toEqual([{ kind: "changed", reference: "R1", detail: "pins" }]);
      expect(comparison.beforeSvg).toContain("<svg");
      expect(comparison.afterSvg).toContain("<svg");
      expect(exports).toHaveLength(2);
      for (const file of exports) expect(yield* t.fs.exists(file)).toBe(false);
    }),
  ),
);

it.effect("returns a failed drawing result when the shared circuit build fails", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      t.setResult(1);
      const result = yield* service.render({ ...t.input, designId: "blink.circuit.tsx" });
      expect(result.outcome).toBe("failed");
      expect(result.log).toContain("tool log");
      expect(result.sheets).toEqual([]);
      t.setResult(0, true);
      expect(
        (yield* service.render({ ...t.input, designId: "blink.circuit.tsx", force: true })).outcome,
      ).toBe("timed-out");
    }),
  ),
);
