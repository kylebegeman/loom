import * as NodeURL from "node:url";
import { CheckpointScopeId, CheckpointRef, NodeId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { writeZip } from "./zipWriter.ts";
import { VcsUnsupportedOperationError } from "@t3tools/contracts";
import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import type {
  OrchestrationV2ThreadProjection,
  OrchestrationV2Checkpoint,
  OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";
import { RunId, CheckpointId } from "@t3tools/contracts";
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
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
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
  const root = yield* fs
    .makeTempDirectoryScoped({ prefix: "loom-pcb-test-" })
    .pipe(Effect.flatMap(fs.realPath));
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
  let reviewNetlist = "(export (nets))";
  const calls: ProcessRunInput[] = [];
  const stagedSources: string[] = [];
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
        if (input.args[0] === "export" && input.args[1]?.endsWith(".tsx"))
          stagedSources.push(yield* fs.readFileString(input.args[1]));
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
        else if (input.args.includes("pdf")) yield* fs.writeFileString(target, "%PDF-1.7\nfixture");
        else if (input.args.includes("glb")) yield* fs.writeFileString(target, "glTFtest");
        else if (input.args.includes("netlist")) yield* fs.writeFileString(target, reviewNetlist);
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
  const paths = yield* WorkspacePaths.WorkspacePaths.pipe(
    Effect.provide(WorkspacePaths.layer),
    Effect.provide(context),
  );
  let checkpointRecords: readonly OrchestrationV2Checkpoint[] = [];
  let checkpointScopes: readonly OrchestrationV2CheckpointScope[] = [];
  const queries = partial<ProjectionStore.ProjectionStoreV2["Service"]>({
    getThreadRecords: () =>
      Effect.succeed(
        partial<OrchestrationV2ThreadProjection>({
          checkpoints: checkpointRecords,
          checkpointScopes,
          runs: [],
        }),
      ),
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
  const capturedRefs: string[] = [],
    deletedRefs: string[] = [];
  let gitRequests = false,
    failedCapture = false;
  const create = (filesystem = fs, processRunner = runner) =>
    PcbPreview.make.pipe(
      Effect.provide(context),
      Effect.provideService(
        CheckpointStore,
        partial<CheckpointStore["Service"]>({
          isGitRepository: () => Effect.succeed(gitRequests),
          captureCheckpoint: ({ checkpointRef }) =>
            failedCapture
              ? Effect.fail(
                  new VcsUnsupportedOperationError({
                    kind: "git",
                    operation: "capture",
                    detail: "unavailable",
                  }),
                )
              : Effect.sync(() => {
                  capturedRefs.push(checkpointRef);
                }),
          deleteCheckpointRefs: ({ checkpointRefs }) =>
            Effect.sync(() => {
              deletedRefs.push(...checkpointRefs);
            }),
        }),
      ),
      Effect.provideService(WorkspacePaths.WorkspacePaths, paths),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, queries),
      Effect.provideService(ProjectStore.ProjectStoreV2, projectStore),
      Effect.provideService(WorkspaceEntries, entries),
      Effect.provideService(ProcessRunner, processRunner),
      Effect.provideService(
        ThreadManagementService,
        partial<ThreadManagementService["Service"]>({ streamDomainEvents: Stream.empty }),
      ),
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
    stagedSources,
    setHistory: (
      records: readonly OrchestrationV2Checkpoint[],
      scopes: readonly OrchestrationV2CheckpointScope[],
    ) => {
      checkpointRecords = records;
      checkpointScopes = scopes;
    },
    setReviewNetlist: (source: string) => {
      reviewNetlist = source;
    },
    runner,
    getRefreshes: () => refreshes,
    capturedRefs,
    deletedRefs,
    requestGit: (enabled: boolean, fail = false) => {
      gitRequests = enabled;
      failedCapture = fail;
    },
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
    setCheckpoints: (values: readonly OrchestrationV2Checkpoint[]) => {
      checkpointRecords = values;
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
        const fresh = yield* service.check(input);
        expect(fresh.outcome).toBe("violations");
        expect(fresh.pointsInMm).toBe(true);
        expect(fresh.violations[0]?.id).toMatch(/^drc-/);
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
  it.effect("upgrades raw and already corrected legacy ERC using saved schematic evidence", () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_sch"),
          '(kicad_sch (uuid root) (symbol (uuid r1) (at 40 40 0) (property "Reference" "R1") (property "Value" "R")))',
        );
        t.setResult(5);
        const fresh = yield* service.check({ ...t.input, kind: "erc" });
        const directory = t.path.join(t.stateDir, "fork", "pcb-preview", "checks");
        const name = (yield* t.fs.readDirectory(directory)).find((name) => name.endsWith(".json"))!;
        const file = t.path.join(directory, name);
        for (const x of [0.4, 40]) {
          const { pointsInMm: _flag, ...legacy } = fresh;
          yield* t.fs.writeFileString(
            file,
            JSON.stringify({
              ...legacy,
              coordinateUnits: "mm",
              violations: [
                {
                  type: "rule",
                  description: "legacy",
                  severity: "error",
                  excluded: false,
                  group: "violation",
                  sheet: "/",
                  items: [{ description: "Symbol R1 [R]", x, y: x }],
                },
              ],
            }),
          );
          const result = (yield* service.latestChecks(t.input))[0]!;
          expect(result.pointsInMm).toBe(true);
          expect(result.violations[0]).toMatchObject({
            sheetId: "board.svg",
            items: [{ description: "Symbol R1 [R]", x: 40, y: 40 }],
          });
          expect(result.violations[0]?.id).toMatch(/^erc-/);
          expect(JSON.parse(yield* t.fs.readFileString(file))).not.toHaveProperty("pointsInMm");
        }
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
      expect(metadata).toMatchObject({
        format: "loom-pcb-reference",
        version: 2,
        kind: "kicad",
        outline: { source: "edge-cuts", outer: 0 },
      });
      expect(ref.relativePath).toMatch(/^\.loom\/pcb-references\/.*\.glb$/);
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
      yield* t.fs.writeFileString(t.path.join(t.root, "blink.loom-assembly.json"), "{}");
      const enclosure = t.path.join(t.root, "blink-enclosure");
      yield* t.fs.makeDirectory(enclosure);
      yield* t.fs.writeFileString(t.path.join(enclosure, "case.stl"), "exported case mesh");
      const fab = t.path.join(t.root, "fab", "print");
      yield* t.fs.makeDirectory(fab, { recursive: true });
      yield* t.fs.writeFileString(t.path.join(fab, "generated.json"), "{}");
      yield* t.fs.writeFileString(t.path.join(fab, "print.pdf"), "%PDF-1.7");
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
      expect(comparison.changes).toEqual([{ kind: "changed", reference: "R1", detail: "nets" }]);
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

it.effect(
  "caches board stats/netlists and reads only cached GLB JSON for explicit height measurement",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        const input = { threadId: t.input.threadId, designId: t.input.designId };
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_pcb"),
          validBoard.replace(
            "(gr_rect",
            '(footprint "Connector" (property "Reference" "J3") (model "connector.step")) (gr_rect',
          ),
        );
        yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "(kicad_sch)");
        yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_pro"), "{}");
        const guarded = FileSystem.FileSystem.of({
          ...t.fs,
          readFile: (file) =>
            file.endsWith("board.glb")
              ? Effect.die(new Error("Inspection must not read the binary GLB chunk"))
              : t.fs.readFile(file),
        });
        const service = yield* t.create(guarded);
        const first = yield* service.inspect(input);
        expect(first.stats).toMatchObject({
          areaMm2: 1200,
          areaSource: "outline",
          heights: "needs-3d",
        });
        expect(yield* service.inspect(input)).toEqual(first);
        expect(t.calls.filter((call) => call.args.includes("netlist"))).toHaveLength(1);
        expect(t.calls.some((call) => call.args.includes("glb"))).toBe(false);
        const exported = yield* service.asset({ ...input, format: "glb", transport: "url" });
        const file = yield* service.resolveSignedRequest(
          exported.file!.relativeUrl.split("/").at(-2)!,
          "board.glb",
        );
        const document = {
          nodes: [
            { name: "Board", mesh: 0 },
            { name: "J3", mesh: 1 },
          ],
          meshes: [
            { primitives: [{ attributes: { POSITION: 0 } }] },
            { primitives: [{ attributes: { POSITION: 1 } }] },
          ],
          accessors: [
            { min: [-0.015, -0.0008, -0.02], max: [0.015, 0.0008, 0.02] },
            { min: [-0.004, 0.0008, -0.004], max: [0.004, 0.012, 0.004] },
          ],
        };
        const json = new TextEncoder().encode(JSON.stringify(document)),
          padded = Math.ceil(json.length / 4) * 4;
        const bytes = new Uint8Array(20 + padded + 8 + 1024 * 1024),
          header = new DataView(bytes.buffer);
        header.setUint32(0, 0x46546c67, true);
        header.setUint32(4, 2, true);
        header.setUint32(8, bytes.length, true);
        header.setUint32(12, padded, true);
        header.setUint32(16, 0x4e4f534a, true);
        bytes.fill(32, 20, 20 + padded);
        bytes.set(json, 20);
        header.setUint32(20 + padded, 1024 * 1024, true);
        header.setUint32(24 + padded, 0x004e4942, true);
        yield* t.fs.writeFile(file, bytes);
        const measured = yield* service.inspect(input);
        expect(measured.sourceHash).toBe(first.sourceHash);
        expect(measured.stats?.tallest).toEqual({
          heightMm: 11.2,
          side: "front",
          reference: "J3",
          source: "glb",
        });
        expect(yield* service.inspect(input)).toEqual(measured);
        expect(t.calls.filter((call) => call.args.includes("netlist"))).toHaveLength(2);
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_pro"),
          JSON.stringify({ board: { design_settings: { rules: { min_clearance: 0.2 } } } }),
        );
        const changed = yield* service.inspect(input);
        expect(changed.sourceHash).not.toBe(first.sourceHash);
        expect(changed.stats).toMatchObject({
          tallest: null,
          heights: "needs-3d",
          rules: { clearance: 0.2 },
        });
      }),
    ),
);
it.effect("retains inspection when board stats cannot parse project rules", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "(kicad_sch)");
      const service = yield* t.create();
      const inspection = yield* service.inspect({
        threadId: t.input.threadId,
        designId: t.input.designId,
      });
      expect(inspection.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 });
      expect(inspection.stats).toBeUndefined();
      expect(
        inspection.warnings.some((warning) => warning.startsWith("Board stats are incomplete:")),
      ).toBe(true);
    }),
  ),
);

it.effect("prints through the shared service, saves outside sources and limits signed PDFs", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const input = {
        threadId: t.input.threadId,
        designId: "board.kicad_pro",
        side: "bottom" as const,
        paper: "A4" as const,
        blackAndWhite: true,
        save: true,
      };
      const result = yield* service.print(input);
      expect(result.mirrored).toBe(true);
      expect(result.workspacePath).toMatch(/^fab\/print\/.*\.pdf$/);
      expect(yield* t.fs.readFileString(result.path!)).toBe("%PDF-1.7\nfixture");
      expect(t.getRefreshes()).toBeGreaterThan(0);
      const parts = result.file.relativeUrl.split("/");
      expect(parts.at(-1)).toBe("print.pdf");
      const signedPath = yield* service.resolveSignedRequest(parts.at(-2)!, parts.at(-1)!);
      expect(yield* t.fs.readFileString(signedPath)).toBe("%PDF-1.7\nfixture");
      const again = yield* service.print({ ...input, save: false });
      expect(again.sourceHash).toBe(result.sourceHash);
      expect(t.calls.filter((call) => call.args.includes("pdf"))).toHaveLength(1);
      yield* t.fs.writeFileString(t.path.join(t.path.dirname(signedPath), "other.pdf"), "%PDF-1.7");
      expect(
        (yield* service.resolveSignedRequest(parts.at(-2)!, "other.pdf").pipe(Effect.flip)).reason,
      ).toBe("render-not-found");
      yield* t.fs.truncate(signedPath, 64 * 1024 * 1024 + 1);
      expect(
        (yield* service.resolveSignedRequest(parts.at(-2)!, "print.pdf").pipe(Effect.flip)).reason,
      ).toBe("render-not-found");
    }),
  ),
);

it.effect("excludes canonical fabrication output folders from circuit revisions", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const outputDirectory = t.path.join(t.root, "generated-output");
      yield* t.fs.makeDirectory(outputDirectory);
      yield* t.fs.symlink(outputDirectory, t.path.join(t.root, "fab"));
      const input = { ...t.input, designId: "blink.circuit.tsx" };
      const before = yield* service.render(input);
      yield* t.fs.writeFileString(t.path.join(outputDirectory, "board.json"), "{}");
      const after = yield* service.render(input);
      expect(after.sourceHash).toBe(before.sourceHash);
      expect(after.cached).toBe(true);
    }),
  ),
);

it.effect("keeps board inspection when optional project rules exceed the read limit", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "(kicad_sch)");
      yield* t.fs.truncate(t.path.join(t.root, "board.kicad_pro"), 16 * 1024 * 1024 + 1);
      const service = yield* t.create();
      const inspection = yield* service.inspect({
        threadId: t.input.threadId,
        designId: t.input.designId,
      });
      expect(inspection.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 });
      expect(inspection.stats?.areaMm2).toBe(400);
      expect(inspection.warnings).toContain(
        "Board stats are incomplete: project rules could not be read.",
      );
    }),
  ),
);

it.effect(
  "agent fresh reads run enabled checks, persist deltas, and preserve reports after automatic failures",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        const input = { threadId: t.input.threadId, designId: t.input.designId };
        expect((yield* service.projectSettings(input)).autoChecks.drc).toBe(false);
        yield* service.updateProjectSettings({ ...input, autoChecks: { drc: true } });
        t.setResult(5);
        const first = (yield* service.latestChecks({ ...input, ensureFresh: true }))[0]!;
        expect(first.trigger).toBe("auto");
        expect(first.outcome).toBe("violations");
        t.setResult(0);
        yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_pcb"), "updated");
        const second = (yield* service.latestChecks({ ...input, ensureFresh: true }))[0]!;
        expect(second.delta?.resolvedCount).toBe(1);
        expect(second.delta?.newCount).toBe(0);
        t.setResult(1);
        yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_pcb"), "failed update");
        expect((yield* service.latestChecks({ ...input, ensureFresh: true }))[0]?.sourceHash).toBe(
          second.sourceHash,
        );
        const manual = yield* service.check({ ...input, kind: "drc" });
        expect(manual.trigger).toBe("manual");
        expect(manual.outcome).toBe("failed");
      }),
    ),
);
it.effect("check activity emits agent results with subscribe-before-read ordering", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const input = { threadId: t.input.threadId, designId: t.input.designId };
      const subscribed = yield* Deferred.make<void>();
      const event = yield* service.checkEvents(input).pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.filter((e) => !!e.ranAt.drc),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      const result = yield* service.check({ ...input, kind: "drc" });
      expect((yield* Fiber.join(event))[0]?.ranAt.drc).toBe(result.ranAt);
    }),
  ),
);

it.effect(
  "pin maps save current source, require explicit replacement and reject unsafe destinations",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "(kicad_sch)");
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_pcb"),
          '(kicad_pcb (footprint "QFN" (property "Reference" "U1") (property "Value" "RP2040") (pad "27" smd rect (pinfunction "GPIO25") (net 1 "LED"))))',
        );
        const service = yield* t.create();
        const input = {
          threadId: t.input.threadId,
          designId: t.input.designId,
          reference: "U1",
          format: "c" as const,
          includePower: false,
          includeNoConnect: false,
        };
        const first = yield* service.pinMap(input);
        expect(first.text).toContain("#define LED 25");
        const saved = yield* service.pinMap({
          ...input,
          expectedSourceHash: first.sourceHash,
          save: { path: "pins.h", overwrite: false },
        });
        expect(saved.saved?.path).toBe("pins.h");
        expect(yield* t.fs.readFileString(t.path.join(t.root, "pins.h"))).toBe(first.text);
        expect((yield* service.inspect(input)).sourceHash).toBe(first.sourceHash);
        expect(
          (yield* service
            .pinMap({ ...input, save: { path: "pins.h", overwrite: false } })
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        yield* service.pinMap({
          ...input,
          names: { "27": "STATUS" },
          save: { path: "pins.h", overwrite: true },
        });
        expect(yield* t.fs.readFileString(t.path.join(t.root, "pins.h"))).toContain(
          "#define STATUS 25",
        );
        for (const name of ["../bad.h", "missing/pins.h", "pins.rs"])
          yield* service
            .pinMap({ ...input, save: { path: name, overwrite: false } })
            .pipe(Effect.flip);
        yield* service
          .pinMap({ ...input, format: "markdown", save: { path: "pins.md", overwrite: false } })
          .pipe(Effect.flip);
        yield* service.pinMap({ ...input, reference: "gone" }).pipe(Effect.flip);
        yield* service.pinMap({ ...input, names: { "27": "int" } }).pipe(Effect.flip);
        yield* service
          .pinMap({
            ...input,
            expectedSourceHash: "old",
            save: { path: "other.h", overwrite: false },
          })
          .pipe(Effect.flip);
        const outside = yield* t.fs.makeTempDirectoryScoped();
        yield* t.fs.symlink(outside, t.path.join(t.root, "link"));
        expect(
          (yield* service
            .pinMap({ ...input, save: { path: "link/pins.h", overwrite: false } })
            .pipe(Effect.flip)).reason,
        ).toBe("path-outside-workspace");
        yield* t.fs.symlink(t.path.join(outside, "missing.h"), t.path.join(t.root, "symlink.h"));
        expect(
          (yield* service
            .pinMap({ ...input, save: { path: "symlink.h", overwrite: true } })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-parameters");
      }),
    ),
);

it.effect(
  "turn design lookup uses real repository prefixes and reads the same sub-sheet sources as reload",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          native = yield* NativeProcesses.make().pipe(Effect.provide(NodeServices.layer));
        const nested = t.path.join(t.root, "electronics");
        yield* t.fs.makeDirectory(nested);
        expect(
          (yield* native.run({ command: "git", args: ["init", "--quiet"], cwd: t.root })).code,
        ).toBe(0);
        yield* t.fs.writeFileString(t.path.join(nested, "board.kicad_pro"), "{}");
        yield* t.fs.writeFileString(t.path.join(nested, "board.kicad_pcb"), validBoard);
        yield* t.fs.writeFileString(
          t.path.join(nested, "board.kicad_sch"),
          '(kicad_sch (sheet (property "Sheetfile" "power.kicad_sch")))',
        );
        yield* t.fs.writeFileString(t.path.join(nested, "power.kicad_sch"), "(kicad_sch)");
        t.names.push("power.kicad_sch");
        t.setWorktree(nested);
        const checkpoint = (turn: number, file: string) =>
          partial<OrchestrationV2Checkpoint>({
            id: CheckpointId.make(`checkpoint-${turn}`),
            runId: RunId.make(`run-${turn}`),
            appRunOrdinal: turn,
            status: "ready",
            files: [partial<OrchestrationV2Checkpoint["files"][number]>({ path: file })],
          });
        t.setCheckpoints([
          checkpoint(2, "electronics/README.md"),
          checkpoint(1, "electronics/power.kicad_sch"),
        ]);
        const service = yield* t.create(
          t.fs,
          ProcessRunner.of({ run: (i) => (i.command === "git" ? native.run(i) : t.runner.run(i)) }),
        );
        const result = yield* service.turnDesigns({ threadId: t.input.threadId, runId: null });
        expect(result.turn).toBe(1);
        expect(result.designs).toEqual([
          {
            designId: "board.kicad_pro",
            kind: "kicad",
            name: "board",
            reason: "dependency",
            via: "power.kicad_sch",
          },
        ]);
        expect(
          (yield* service.turnDesigns({ threadId: t.input.threadId, runId: RunId.make("run-2") }))
            .designs,
        ).toEqual([]);
      }),
    ),
);

it.effect(
  "captures request baselines, preserves them during ordinary saves, and cleans accepted refs",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        t.requestGit(true);
        const hash = (yield* service.render(t.input)).sourceHash;
        const draft = {
          id: "request-one",
          title: "Move R1",
          request: "Move it left",
          anchor: { kind: "component" as const, reference: "R1" },
          view: "pcb" as const,
          sheet: "board",
          point: { x: 0, y: 0 },
          sourceHash: hash,
          referenceImage: null,
        };
        let data = yield* service.changeRequest(
          {
            ...t.input,
            expectedVersion: 0,
            operation: { op: "create", request: draft, sent: false },
          },
          "user",
        );
        expect(data.requests[0]?.baseRef).toMatch(/^refs\/loom\/pcb-requests\/[^/]+\/base$/);
        expect(t.capturedRefs).toEqual([data.requests[0]?.baseRef]);
        const conflict = yield* Effect.flip(
          service.changeRequest(
            { ...t.input, expectedVersion: 0, operation: { op: "remove", id: draft.id } },
            "user",
          ),
        );
        expect(conflict.reason).toBe("conflict");
        const denied = yield* Effect.flip(
          service.changeRequest(
            {
              ...t.input,
              expectedVersion: data.version,
              operation: { op: "status", id: draft.id, status: "accepted" },
            },
            "agent",
          ),
        );
        expect(denied.message).toContain("Only the user");
        expect(t.capturedRefs).toHaveLength(1);
        data = yield* service.updateWorkspace({
          ...t.input,
          expectedVersion: data.version,
          workspace: { ...data, requests: [] },
        });
        expect(data.requests).toHaveLength(1);
        data = yield* service.changeRequest(
          {
            ...t.input,
            expectedVersion: data.version,
            operation: { op: "status", id: draft.id, status: "review", response: "Moved" },
          },
          "agent",
        );
        data = yield* service.changeRequest(
          {
            ...t.input,
            expectedVersion: data.version,
            operation: { op: "status", id: draft.id, status: "accepted" },
          },
          "user",
        );
        const resolved = data.requests[0]!.resolvedRef!;
        expect(resolved).toMatch(/\/resolved$/);
        expect(data.requests[0]?.resolvedRevision).toBe(hash);
        data = yield* service.changeRequest(
          {
            ...t.input,
            expectedVersion: data.version,
            operation: { op: "status", id: draft.id, status: "open" },
          },
          "user",
        );
        expect(t.deletedRefs).toEqual([resolved]);
        expect(data.requests[0]?.response).toBe("Moved");
        const listed = yield* service.listRequests(t.input, "all");
        expect(listed[0]).toMatchObject({ designChanged: false, anchorDescription: "R1" });
        expect(listed[0]).not.toHaveProperty("referenceImage");
        data = yield* service.changeRequest(
          { ...t.input, expectedVersion: data.version, operation: { op: "remove", id: draft.id } },
          "user",
        );
        expect(data.requests).toEqual([]);
        expect(t.deletedRefs).toContain(t.capturedRefs[0]);
      }),
    ),
);
it.effect.each([false, true])(
  "saves requests without refs when Git capture is unavailable (%s)",
  (fail) =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        t.requestGit(fail, fail);
        const hash = (yield* service.render(t.input)).sourceHash;
        const data = yield* service.changeRequest(
          {
            ...t.input,
            expectedVersion: 0,
            operation: {
              op: "create",
              request: {
                id: "one",
                title: "Ask",
                request: "Move it",
                anchor: { kind: "area", box: { x: 0, y: 0, width: 2, height: 2 } },
                view: "pcb",
                sheet: "board",
                point: { x: 1, y: 1 },
                sourceHash: hash,
                referenceImage: null,
              },
              sent: false,
            },
          },
          "user",
        );
        expect(data.requests[0]?.baseRef).toBeNull();
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_pcb"),
          "(kicad_pcb (general (thickness 2)))",
        );
        expect((yield* service.listRequests(t.input, "all"))[0]?.designChanged).toBe(true);
      }),
    ),
);

it.effect(
  "review persists, reuses its source and config, applies waivers without rerunning and degrades after a failed export",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "(kicad_sch)");
        t.setReviewNetlist(
          yield* t.fs.readFileString(
            NodeURL.fileURLToPath(new URL("./fixtures/review/i2c-missing.net", import.meta.url)),
          ),
        );
        const service = yield* t.create();
        const input = { threadId: t.input.threadId, designId: t.input.designId };
        const result = yield* service.review(input);
        expect(result.findings.find((f) => f.rule === "i2c-pullup")).toBeDefined();
        const count = t.calls.length;
        expect((yield* service.review(input)).ranAt).toBe(result.ranAt);
        expect(t.calls).toHaveLength(count);
        yield* service.updateProjectSettings({
          threadId: input.threadId,
          review: {
            waive: [
              {
                designId: input.designId,
                findingId: result.findings[0]!.id,
                note: "External pull",
              },
            ],
          },
        });
        expect((yield* service.latestReview(input))?.counts.waived).toBe(1);
        expect(t.calls).toHaveLength(count);
        yield* service.updateProjectSettings({
          threadId: input.threadId,
          review: { rules: { "i2c-pullup": false } },
        });
        expect((yield* service.review(input)).findings).toHaveLength(0);
        expect(t.calls.length).toBeGreaterThan(count);
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_sch"),
          "(kicad_sch (version 1))",
        );
        t.setResult(1);
        expect((yield* service.review(input)).notices.join()).toContain(
          "Pin types are unavailable",
        );
        yield* t.fs.remove(t.path.join(t.root, "board.kicad_sch"));
        t.names.splice(t.names.indexOf("board.kicad_sch"), 1);
        const failed = yield* service
          .review({ ...input, designId: "board.kicad_pro" })
          .pipe(Effect.flip);
        expect(failed).toMatchObject({ reason: "unsupported-view" });
      }),
    ),
);

it.effect(
  "fab profiles round-trip with version conflicts, immutable built-ins and lenient old storage",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        const catalog = yield* service.fabCapabilities();
        expect(catalog.defaultId).toBe("jlcpcb-standard");
        expect(catalog.builtIns).toHaveLength(5);
        const entry = { ...catalog.builtIns[0]!, id: "custom", name: "My fab" };
        const saved = yield* service.updateFabCapabilities({
          expectedVersion: 0,
          entries: [entry],
          defaultId: entry.id,
        });
        expect(saved.version).toBe(1);
        expect((yield* service.fabCapabilities()).defaultId).toBe(entry.id);
        expect(
          (yield* service
            .updateFabCapabilities({ expectedVersion: 0, entries: [], defaultId: null })
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        for (const invalid of [
          catalog.builtIns[0]!,
          { ...entry, sourceUrl: "https://user:secret@example.com" },
        ])
          expect(
            (yield* service
              .updateFabCapabilities({ expectedVersion: 1, entries: [invalid], defaultId: null })
              .pipe(Effect.flip)).reason,
          ).toBe("invalid-parameters");
        expect(
          (yield* service
            .updateFabCapabilities({ expectedVersion: 1, entries: [entry], defaultId: "missing" })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-parameters");
        yield* t.fs.writeFileString(
          t.path.join(t.stateDir, "fork", "pcb-preview", "workspaces", "fab-capabilities.json"),
          JSON.stringify({ version: 2, entries: [entry, { id: "bad" }], defaultId: entry.id }),
        );
        const lenient = yield* service.fabCapabilities();
        expect(lenient.entries).toHaveLength(1);
        expect(lenient.skipped).toEqual(["bad"]);
        yield* service.updateFabCapabilities({ expectedVersion: 2, entries: [], defaultId: null });
        expect((yield* service.fabCapabilities()).defaultId).toBe("jlcpcb-standard");
      }),
    ),
);
it.effect(
  "fab check stages isolated constraints, persists classified results and cleans up failures",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_pro"),
          JSON.stringify({
            board: { design_settings: { rules: { min_clearance: 1, min_track_width: 1 } } },
          }),
        );
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_dru"),
          '(version 1)\n(rule "mine" (constraint clearance (min 1mm)))',
        );
        const original = yield* Effect.forEach(
          ["board.kicad_pcb", "board.kicad_pro", "board.kicad_dru"],
          (file) => t.fs.readFileString(t.path.join(t.root, file)),
        );
        let directory = "";
        const runner = ProcessRunner.of({
          run: (input) =>
            Effect.gen(function* () {
              if (input.args.includes("drc")) {
                const board = input.args.at(-1)!;
                directory = t.path.dirname(board);
                expect(directory).not.toBe(t.root);
                expect(input.args).toContain("--refill-zones");
                expect(input.args).not.toContain("--save-board");
                expect(input.args).not.toContain("--schematic-parity");
                const project = JSON.parse(
                  yield* t.fs.readFileString(board.replace(/\.kicad_pcb$/, ".kicad_pro")),
                );
                expect(project.board.design_settings.rules.min_clearance).toBe(0);
                const rules = yield* t.fs.readFileString(
                  board.replace(/\.kicad_pcb$/, ".kicad_dru"),
                );
                expect(rules.indexOf('rule "mine"')).toBeLessThan(
                  rules.indexOf('rule "loom_fab_track"'),
                );
              }
              return yield* t.runner.run(input);
            }).pipe(Effect.orDie),
        });
        t.setResult(5);
        const service = yield* t.create(t.fs, runner);
        const input = {
          threadId: t.input.threadId,
          designId: t.input.designId,
          fabId: "jlcpcb-standard",
        };
        const result = yield* service.fabCheck(input);
        expect(result.outcome).toBe("violations");
        expect(result.violations[0]?.rule).toBe("space");
        expect((yield* service.latestFabCheck(input))?.ranAt).toBe(result.ranAt);
        expect(yield* t.fs.exists(directory)).toBe(false);
        expect(
          yield* Effect.forEach(["board.kicad_pcb", "board.kicad_pro", "board.kicad_dru"], (file) =>
            t.fs.readFileString(t.path.join(t.root, file)),
          ),
        ).toEqual(original);
        expect(
          (yield* service.fabCheck({ ...input, fabId: "missing" }).pipe(Effect.flip)).reason,
        ).toBe("invalid-parameters");
        expect(
          (yield* service.fabCheck({ ...input, designId: "blink.circuit.tsx" }).pipe(Effect.flip))
            .reason,
        ).toBe("unsupported-view");
        t.setResult(1);
        expect((yield* service.fabCheck(input)).outcome).toBe("failed");
        expect(yield* t.fs.exists(directory)).toBe(false);
        t.setResult(0, true);
        expect((yield* service.fabCheck(input)).outcome).toBe("timed-out");
        expect(yield* t.fs.exists(directory)).toBe(false);
      }),
    ),
);
it.effect("fab check on KiCad 9 leaves zones as saved and interruption removes its copy", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup;
      const started = yield* Deferred.make<void>(),
        stopped = yield* Deferred.make<void>();
      let directory = "";
      const runner = ProcessRunner.of({
        run: (input) => {
          if (input.args[0] === "version") return Effect.succeed(output(0, "9.0.9"));
          if (input.args.includes("drc"))
            return Effect.gen(function* () {
              expect(input.args).not.toContain("--refill-zones");
              directory = t.path.dirname(input.args.at(-1)!);
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }).pipe(Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)));
          return t.runner.run(input);
        },
      });
      const service = yield* t.create(t.fs, runner);
      const fiber = yield* service
        .fabCheck({ threadId: t.input.threadId, designId: t.input.designId })
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      yield* Deferred.await(stopped);
      expect(yield* t.fs.exists(directory)).toBe(false);
    }),
  ),
);

const fabExportRunner = (
  t: Effect.Success<typeof setup>,
  options: {
    missingOutline?: boolean;
    failGerbers?: boolean;
    circuit?: boolean;
    interrupt?: Deferred.Deferred<void>;
  } = {},
) =>
  ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        const target =
          input.args[input.args.indexOf(input.args.includes("-o") ? "-o" : "--output") + 1]!;
        if (input.args.includes("gerbers")) {
          if (options.interrupt)
            return yield* Deferred.succeed(options.interrupt, undefined).pipe(
              Effect.andThen(Effect.never),
            );
          if (options.failGerbers) return output(1, "export failed");
          const files = [
            {
              name: "board-F_Cu.gtl",
              bytes: Buffer.from("%TF.FileFunction,Copper,L1,Top*%\nX10Y10D01*"),
            },
            {
              name: "board-B_Cu.gbl",
              bytes: Buffer.from("%TF.FileFunction,Copper,L2,Bot*%\nX10Y10D01*"),
            },
            ...(options.missingOutline
              ? []
              : [
                  {
                    name: "board-Edge_Cuts.gm1",
                    bytes: Buffer.from("%TF.FileFunction,Profile,NP*%\nX10Y10D01*"),
                  },
                ]),
          ];
          if (input.args[0] === "export")
            yield* t.fs.writeFile(
              target,
              writeZip(files, DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-10T12:00:00Z"))),
            );
          else
            for (const file of files)
              yield* t.fs.writeFile(t.path.join(target, file.name), file.bytes);
          return output();
        }
        if (input.args.includes("drill")) {
          yield* t.fs.writeFileString(
            t.path.join(target, "board-PTH.drl"),
            "; #@! TF.FileFunction,Plated,1,2,PTH\nT1C0.8",
          );
          return output();
        }
        if (input.args.includes("pos")) {
          expect(input.args).toContain("mm");
          yield* t.fs.writeFileString(
            target,
            "Ref,Val,Package,PosX,PosY,Rot,Side\nU1,Chip,SOIC-8,1,2,350,back\n",
          );
          return output();
        }
        if (input.args.includes("bom")) {
          expect(input.args).toContain('"');
          yield* t.fs.writeFileString(
            target,
            "Reference,Value,Footprint,Qty,DNP,LCSC\nU1,Chip,Lib:SOIC-8,1,,C123\n",
          );
          return output();
        }
        if (options.circuit && input.args.includes("circuit-json")) {
          yield* t.fs.writeFileString(
            target,
            JSON.stringify([
              { type: "pcb_board", num_layers: 2 },
              {
                type: "source_component",
                source_component_id: "a",
                name: "U1",
                display_value: "Chip",
                supplier_part_numbers: { jlcpcb: ["C123"] },
              },
              {
                type: "pcb_component",
                source_component_id: "a",
                center: { x: 1, y: 2 },
                rotation: 90,
                layer: "top",
                metadata: { kicad_footprint: { footprintName: "SOIC-8" } },
              },
            ]),
          );
          return output();
        }
        return yield* t.runner.run(input);
      }).pipe(Effect.orDie),
  });
it.effect(
  "fab packages publish complete immutable outputs, reuse inputs, sign downloads and isolate designs",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup;
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_sch"),
          '(kicad_sch (symbol(property "LCSC Part #" "C123")))',
        );
        yield* t.fs.writeFileString(
          t.path.join(t.root, "board.kicad_pcb"),
          '(kicad_pcb (general(thickness 1.6))(layers(0 "F.Cu" signal)(31 "B.Cu" signal)(44 "Edge.Cuts" user))(gr_rect(start 0 0)(end 10 10)(layer "Edge.Cuts"))(footprint "Lib:SOIC-8"(layer "B.Cu")(property "Reference" "U1")(property "Value" "Chip")(property "LCSC Part #" "C123")(property "JLCPCB Rotation Offset" "30")))',
        );
        const original = yield* t.fs.readFileString(t.path.join(t.root, "board.kicad_pcb")),
          service = yield* t.create(t.fs, fabExportRunner(t)),
          input = {
            threadId: t.input.threadId,
            designId: t.input.designId,
            profile: "jlcpcb" as const,
            assembly: true,
            force: false,
          };
        const first = yield* service.fabPackage(input);
        expect(first.verdict).toBe("ready");
        expect(first.outputs.some((f) => f.path === "assembly/assembly-bottom.pdf")).toBe(true);
        expect(yield* t.fs.readFileString(t.path.join(first.path, "jlcpcb/cpl.csv"))).toContain(
          '"Bottom","20.0000"',
        );
        expect(first.zip.relativeUrl).toContain("package.zip");
        expect(
          yield* service.resolveSignedRequest(
            first.zip.relativeUrl.split("/").at(-2)!,
            "package.zip",
          ),
        ).toContain("package.zip");
        const again = yield* service.fabPackage(input);
        expect(again.reused).toBe(true);
        expect(again.id).toBe(first.id);
        expect(again.sourceHash).toBe(first.sourceHash);
        const forced = yield* service.fabPackage({ ...input, force: true });
        expect(forced.id).toBe(first.id + "-2");
        expect(yield* service.fabPackages(input)).toHaveLength(2);
        expect(yield* t.fs.readFileString(t.path.join(t.root, "board.kicad_pcb"))).toBe(original);
        expect(yield* service.fabPackages({ ...input, designId: "blink.circuit.tsx" })).toEqual([]);
        const fresh = yield* service.fabPackageZip({ ...input, packageId: first.id });
        expect(fresh.manifest.id).toBe(first.id);
        expect(
          (yield* service.fabPackageZip({ ...input, packageId: "../x" }).pipe(Effect.flip)).reason,
        ).toBe("path-outside-workspace");
        yield* service.deleteFabPackage({ ...input, packageId: first.id });
        expect(yield* t.fs.exists(first.path)).toBe(false);
        expect(yield* service.fabPackages(input)).toHaveLength(1);
        yield* t.fs.writeFileString(t.path.join(forced.path, "loom-fab-package.json"), "broken");
        expect((yield* service.fabPackages(input))[0]?.unreadable).toBe(true);
        yield* service.deleteFabPackage({ ...input, packageId: forced.id });
        expect(yield* t.fs.exists(forced.path)).toBe(false);
        yield* t.fs.makeDirectory(t.path.join(t.root, "fab", "keep"));
        yield* t.fs.writeFileString(t.path.join(t.root, "fab", "keep", "user.txt"), "user");
        yield* service.deleteFabPackage({ ...input, packageId: "keep" }).pipe(Effect.flip);
        expect(yield* t.fs.exists(t.path.join(t.root, "fab", "keep"))).toBe(true);
      }),
    ),
);
it.effect(
  "failed and interrupted package builds remove pending files; missing outputs and DRC errors are not ready",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* setup,
          input = {
            threadId: t.input.threadId,
            designId: t.input.designId,
            profile: "generic" as const,
            assembly: false,
            force: true,
          };
        const failed = yield* t.create(t.fs, fabExportRunner(t, { failGerbers: true }));
        expect((yield* failed.fabPackage(input).pipe(Effect.flip)).reason).toBe("io-failed");
        expect(yield* t.fs.readDirectory(t.path.join(t.root, "fab"))).toEqual([]);
        const started = yield* Deferred.make<void>(),
          cancelled = yield* t.create(t.fs, fabExportRunner(t, { interrupt: started }));
        const fiber = yield* cancelled.fabPackage(input).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        expect(yield* t.fs.readDirectory(t.path.join(t.root, "fab"))).toEqual([]);
        const missing = yield* t.create(t.fs, fabExportRunner(t, { missingOutline: true }));
        expect((yield* missing.fabPackage(input)).verdict).toBe("not-ready");
        t.setResult(5);
        const errors = yield* t.create(t.fs, fabExportRunner(t));
        expect(
          (yield* errors.fabPackage(input)).checklist.find((i) => i.id === "drc")?.status,
        ).toBe("fail");
      }),
    ),
);
it.effect("circuit fabrication extracts its archive and keeps code execution staged", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(t.fs, fabExportRunner(t, { circuit: true }));
      const result = yield* service.fabPackage({
        threadId: t.input.threadId,
        designId: "blink.circuit.tsx",
        profile: "jlcpcb",
        assembly: true,
        force: false,
      });
      expect(result.verdict).toBe("ready");
      expect(result.checklist.find((i) => i.id === "drc")?.status).toBe("skipped");
      expect(result.outputs.some((f) => f.path === "assembly/assembly.svg")).toBe(true);
      expect(result.outputs.some((f) => f.path === "jlcpcb/cpl.csv")).toBe(true);
      expect((yield* t.fs.readDirectory(t.root)).includes(".tscircuit")).toBe(false);
    }),
  ),
);

it.effect("fabrication reuse includes rotation rules and rejects concurrent source edits", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        input = {
          threadId: t.input.threadId,
          designId: t.input.designId,
          profile: "generic" as const,
          assembly: false,
          force: false,
        },
        base = fabExportRunner(t),
        service = yield* t.create(t.fs, base);
      const first = yield* service.fabPackage(input);
      yield* t.fs.writeFileString(t.path.join(t.root, "fab", "rotations.csv"), "SOIC.*,90");
      const next = yield* service.fabPackage(input);
      expect(next.reused).toBe(false);
      expect(next.id).not.toBe(first.id);
      expect(next.sourceHash).toBe(first.sourceHash);
      const runner = ProcessRunner.of({
        run: (args) =>
          base
            .run(args)
            .pipe(
              Effect.tap(() =>
                args.args.includes("gerbers")
                  ? t.fs
                      .writeFileString(
                        t.path.join(t.root, "board.kicad_pcb"),
                        '(kicad_pcb(general(thickness 2))(layers(0 "F.Cu" signal)(31 "B.Cu" signal)))',
                      )
                      .pipe(Effect.orDie)
                  : Effect.void,
              ),
            ),
      });
      const edited = yield* t.create(t.fs, runner);
      expect((yield* edited.fabPackage({ ...input, force: true }).pipe(Effect.flip)).reason).toBe(
        "conflict",
      );
      expect(
        (yield* t.fs.readDirectory(t.path.join(t.root, "fab"))).filter((n) =>
          n.startsWith(".pending"),
        ),
      ).toEqual([]);
    }),
  ),
);

it.effect("renders and exports a checkpoint without reading the live project", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup;
      const native = yield* NativeProcesses.make().pipe(Effect.provide(NodeServices.layer));
      const git = (args: readonly string[]) =>
        native
          .run({ command: "git", args, cwd: t.root })
          .pipe(
            Effect.tap((result) => Effect.sync(() => expect(result.code, result.stderr).toBe(0))),
          );
      yield* git(["init", "-q"]);
      yield* git(["config", "user.email", "pcb-history@example.test"]);
      yield* git(["config", "user.name", "PCB tests"]);
      yield* git(["add", "board.kicad_pro", "board.kicad_pcb", "board.kicad_sch"]);
      yield* git(["commit", "-qm", "baseline"]);
      const threadId = t.input.threadId,
        scopeId = CheckpointScopeId.make("scope"),
        nodeId = NodeId.make("node"),
        checkpointId = CheckpointId.make("cp"),
        ref = CheckpointRef.make("refs/t3/tests/pcb");
      yield* git(["update-ref", ref, "HEAD"]);
      t.setHistory(
        [
          {
            id: checkpointId,
            threadId,
            scopeId,
            runId: RunId.make("run"),
            nodeId,
            parentCheckpointId: null,
            ordinalWithinScope: 1,
            appRunOrdinal: 1,
            ref,
            status: "ready",
            files: [{ path: "board.kicad_pcb", kind: "modified", additions: 1, deletions: 0 }],
            capturedAt: DateTime.makeUnsafe(1000),
          },
        ],
        [
          {
            id: scopeId,
            threadId,
            runId: null,
            nodeId,
            parentScopeId: null,
            providerThreadId: null,
            kind: "root_run",
            ordinalWithinParent: 0,
            advancesAppRunCount: true,
            cwd: t.root,
            createdAt: DateTime.makeUnsafe(0),
          },
        ],
      );
      yield* t.fs.writeFileString(t.path.join(t.root, "board.kicad_sch"), "live change");
      const service = yield* t.create(
        t.fs,
        ProcessRunner.of({
          run: (input) => (input.command === "git" ? native.run(input) : t.runner.run(input)),
        }),
      );
      const rendered = yield* service.render({ ...t.input, checkpointId });
      expect(rendered.outcome).toBe("ok");
      expect(t.calls.find((call) => call.args.includes("svg"))?.cwd).toContain("history/trees");
      expect(
        (yield* service.readSheet({
          threadId,
          renderKey: rendered.renderKey,
          sheetId: rendered.sheets[0]!.id,
        })).svg,
      ).toContain("<svg");
      const asset = yield* service.asset({
        threadId,
        designId: t.input.designId,
        checkpointId,
        format: "glb",
      });
      expect(asset.file?.relativeUrl).toContain("/api/");
      expect(
        (yield* service.revisions({ threadId, designId: t.input.designId })).some(
          (version) => version.label === "Turn 1",
        ),
      ).toBe(true);
    }),
  ),
);

it.effect("returns a 3D measurement to the editor caller through the completion bridge", () =>
  test(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      // Acquire the stream before requesting an action: design resolution performs async I/O.
      const pull = yield* Stream.toPull(
        service.editorEvents({ threadId: t.input.threadId, designId: t.input.designId }),
      );
      const job = yield* service
        .editorAction({
          threadId: t.input.threadId,
          designId: t.input.designId,
          command: {
            action: "measure",
            points: [
              [0, 0, 0],
              [3, 4, 0],
            ],
          },
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      const [event] = yield* pull;
      const measurement3d = {
        kind: "distance" as const,
        start: [0, 0, 0] as const,
        end: [3, 4, 0] as const,
        lengthMm: 5,
      };
      yield* service.completeEditorAction({
        threadId: t.input.threadId,
        designId: t.input.designId,
        requestId: event.requestId,
        message: "Measured",
        measurement3d,
      });
      expect((yield* Fiber.join(job)).measurement3d).toEqual(measurement3d);
    }),
  ),
);

const variantFixture = Effect.gen(function* () {
  const t = yield* setup,
    input = { threadId: t.input.threadId, designId: "blink.circuit.tsx" };
  const file = t.path.join(t.root, input.designId),
    source = "const width = /* loom:param width */ 20;";
  yield* t.fs.writeFileString(file, source);
  yield* t.fs.writeFileString(
    file + ".parameters.json",
    JSON.stringify({
      parameters: [
        {
          key: "width",
          label: "Width",
          description: "",
          type: "number",
          default: 20,
          min: 10,
          max: 40,
        },
      ],
    }),
  );
  const service = yield* t.create(),
    parameters = yield* service.parameters(input);
  return {
    ...t,
    input,
    file,
    source,
    service,
    request: {
      ...input,
      variantId: "candidate",
      values: { width: 30 },
      expectedSourceHash: parameters.sourceHash,
    },
  };
});
it.effect(
  "builds and caches isolated variants with stats and readable sheets without writing the source",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* variantFixture,
          first = yield* t.service.renderVariant(t.request);
        expect(first.outcome).toBe("ok");
        expect(first.stats).toMatchObject({ widthMm: 20, heightMm: 20, errors: 0 });
        expect(t.stagedSources).toContain("const width = /* loom:param width */ 30;");
        expect(yield* t.fs.readFileString(t.file)).toBe(t.source);
        expect(
          (yield* t.service.readSheet({
            threadId: t.input.threadId,
            renderKey: first.renderKey,
            sheetId: first.sheet!.id,
          })).svg,
        ).toContain("viewBox");
        const calls = t.calls.length;
        expect((yield* t.service.renderVariant(t.request)).cached).toBe(true);
        expect(t.calls).toHaveLength(calls);
        expect(
          (yield* t.service
            .renderVariant({ ...t.request, values: { width: 50 } })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-parameters");
        yield* t.fs.writeFileString(t.file, t.source + "\n");
        expect((yield* t.service.renderVariant(t.request).pipe(Effect.flip)).reason).toBe(
          "conflict",
        );
      }),
    ),
);
it.effect(
  "returns variant build failures and cancels a running exporter with no partial cache",
  () =>
    test(
      Effect.gen(function* () {
        const t = yield* variantFixture;
        t.setResult(1);
        const failed = yield* t.service.renderVariant(t.request);
        expect(failed.outcome).toBe("failed");
        expect(failed.log).toContain("tool log");
        t.setResult(0);
        const started = yield* Deferred.make<void>(),
          stopped = yield* Deferred.make<void>();
        t.setBlock({ started, stopped });
        const job = yield* t.service.renderVariant(t.request).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* t.service.cancelVariant(t.request);
        yield* Deferred.await(stopped);
        expect((yield* Fiber.join(job)).outcome).toBe("cancelled");
        expect(
          yield* t.fs.readDirectory(t.path.join(t.stateDir, "fork", "pcb-preview", "cache")),
        ).toEqual([]);
        expect(yield* t.fs.readFileString(t.file)).toBe(t.source);
        yield* t.service.cancelVariant(t.request);
      }),
    ),
);
it.effect("proposes validated agent variants atomically and enforces the saved limit", () =>
  test(
    Effect.gen(function* () {
      const t = yield* variantFixture;
      const ready = yield* Deferred.make<void>(),
        published = yield* Deferred.make<import("@t3tools/contracts/fork").PcbWorkspace>();
      const reader = yield* t.service.workspaceUpdates(t.input).pipe(
        Stream.runForEach((value) =>
          value.version === 0
            ? Deferred.succeed(ready, undefined)
            : Deferred.succeed(published, value),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(ready);
      const first = yield* t.service.proposeVariants(t.input, [
        { name: "Wide", values: { width: 35 } },
      ]);
      expect(yield* Deferred.await(published)).toEqual(first);
      yield* Fiber.interrupt(reader);
      expect(first.variants[0]).toMatchObject({
        origin: "agent",
        thumbnail: null,
        stats: null,
        values: { width: 35 },
      });
      expect(t.calls).toHaveLength(0);
      expect(
        (yield* t.service
          .proposeVariants(t.input, [{ name: "Invalid", values: { width: 50 } }])
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-parameters");
      expect((yield* t.service.getWorkspace(t.input)).version).toBe(first.version);
      const full = yield* t.service.updateWorkspace({
        ...t.input,
        expectedVersion: first.version,
        workspace: {
          ...first,
          variants: Array.from({ length: 24 }, (_, i) => ({
            ...first.variants[0]!,
            id: String(i),
          })),
        },
      });
      expect(full.variants).toHaveLength(24);
      expect(
        (yield* t.service
          .proposeVariants(t.input, [{ name: "Extra", values: { width: 20 } }])
          .pipe(Effect.flip)).message,
      ).toContain("24 variants");
      expect(yield* t.fs.readFileString(t.file)).toBe(t.source);
    }),
  ),
);

it.effect("rejects a variant whose source changes during the build", () =>
  test(
    Effect.gen(function* () {
      const t = yield* variantFixture;
      const runner = ProcessRunner.of({
        run: (input) =>
          t.runner
            .run(input)
            .pipe(
              Effect.tap(() =>
                input.args.includes("circuit-json")
                  ? t.fs
                      .writeFileString(t.file, t.source + "\n// Edited while exporting\n")
                      .pipe(Effect.orDie)
                  : Effect.void,
              ),
            ),
      });
      const service = yield* t.create(t.fs, runner);
      expect((yield* service.renderVariant(t.request).pipe(Effect.flip)).reason).toBe("conflict");
      expect(yield* t.fs.readFileString(t.file)).toBe(t.source + "\n// Edited while exporting\n");
    }),
  ),
);
