// @effect-diagnostics nodeBuiltinImport:off -- Opt-in real tool verification is a framework boundary.
import * as NodeProcess from "node:process";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as PcbPreview from "./PcbPreviewService.ts";
import * as Config from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import * as ProcessRunner from "../../processRunner.ts";

const fixtureRoot = NodeProcess.env.LOOM_TEST_PCB_FIXTURES;
const realTest = fixtureRoot ? it.live : it.live.skip;
const partial = <A extends object>(methods: Partial<A>): A =>
  new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected service call: ${String(key)}`);
    },
  });

realTest(
  "renders actual KiCad sheets/presets/checks and tscircuit views through the service",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path;
        const fixtures = yield* fs.realPath(fixtureRoot!);
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-pcb-fixtures-" });
        yield* fs.copy(fixtures, root, { overwrite: true });
        const state = yield* fs.makeTempDirectoryScoped({ prefix: "loom-pcb-real-" });
        const context = yield* Layer.build(Config.layerTest(root, state));
        const paths = yield* WorkspacePaths.make;
        const runner = yield* ProcessRunner.ProcessRunner.pipe(Effect.provide(ProcessRunner.layer));
        const threadId = ThreadId.make("pcb-real-thread"),
          projectId = ProjectId.make("pcb-real-project");
        const names = (yield* fs.readDirectory(root, { recursive: true })).filter((n) =>
          /\.(kicad_pro|kicad_sch|kicad_pcb|circuit.tsx)$/.test(n),
        );
        const service = yield* PcbPreview.make.pipe(
          Effect.provide(context),
          Effect.provideService(WorkspacePaths.WorkspacePaths, paths),
          Effect.provideService(ProcessRunner.ProcessRunner, runner),
          Effect.provideService(
            ProjectionStore.ProjectionStoreV2,
            partial<ProjectionStore.ProjectionStoreV2["Service"]>({
              getThread: () =>
                Effect.succeed(
                  partial<OrchestrationV2AppThread>({ projectId, worktreePath: null }),
                ),
            }),
          ),
          Effect.provideService(
            ProjectStore.ProjectStoreV2,
            partial<ProjectStore.ProjectStoreV2["Service"]>({
              get: () =>
                Effect.succeedSome(partial<ProjectStore.ProjectRow>({ workspaceRoot: root })),
            }),
          ),
          Effect.provideService(
            WorkspaceEntries,
            partial<WorkspaceEntries["Service"]>({
              refresh: () => Effect.void,
              search: ({ query }) =>
                Effect.succeed({
                  entries: names
                    .filter((n) => n.includes(query))
                    .map((n) => ({ path: n, kind: "file" as const })),
                  truncated: false,
                }),
            }),
          ),
          Effect.provideService(HostProcessEnvironment, {
            ...NodeProcess.env,
            API_TOKEN: "must-not-be-inherited",
            HOME: state,
            XDG_CONFIG_HOME: state,
            XDG_CACHE_HOME: state,
          }),
        );
        const designs = yield* service.listDesigns({ threadId });
        const kicad = designs.designs.find((d) => d.id.endsWith("complex_hierarchy.kicad_pro"))!;
        expect(kicad.toolStatus.version).toBe("10.0.6");
        const schematic = yield* service.render({
          threadId,
          designId: kicad.id,
          view: "schematic",
        });
        expect(schematic.outcome).toBe("ok");
        expect(schematic.sheets.length).toBe(3);
        for (const sheet of schematic.sheets)
          expect(
            (yield* service.readSheet({
              threadId,
              renderKey: schematic.renderKey,
              sheetId: sheet.id,
            })).svg,
          ).toContain("<svg");
        for (const layers of ["front", "back", "all"] as const) {
          const result = yield* service.render({
            threadId,
            designId: kicad.id,
            view: "pcb",
            layers,
          });
          expect(result.outcome, result.log).toBe("ok");
          expect(result.sheets).toHaveLength(1);
        }
        const fourLayer = designs.designs.find((d) => /One-Air-Max\.kicad_(?:pcb|pro)$/.test(d.id));
        expect(fourLayer, "Include the four-layer demo fixture").toBeDefined();
        if (fourLayer) {
          const result = yield* service.render({
            threadId,
            designId: fourLayer.id,
            view: "pcb",
            layers: "all",
          });
          expect(result.outcome, result.log).toBe("ok");
          expect(result.sheets).toHaveLength(1);
          const inspected = yield* service.inspect({ threadId, designId: fourLayer.id });
          expect(inspected.layerLabels).toMatchObject({ "In1.Cu": "PWR", "In2.Cu": "GND" });
          const customCopper = yield* service.render({
            threadId,
            designId: fourLayer.id,
            view: "pcb",
            layerNames: ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu", "Edge.Cuts"],
          });
          expect(customCopper.sheets.map((s) => s.layer).toSorted()).toEqual(
            ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu", "Edge.Cuts"].toSorted(),
          );
        }
        const streamedBoard = yield* service.asset({
          threadId,
          designId: fourLayer!.id,
          format: "glb",
        });
        expect(streamedBoard.file?.sizeBytes).toBeGreaterThan(16 * 1024 * 1024);
        const modelParts = streamedBoard.file!.relativeUrl.split("/");
        const streamedPath = yield* service.resolveSignedRequest(
          modelParts.at(-2)!,
          modelParts.at(-1)!,
        );
        const handle = yield* fs.open(streamedPath);
        const header = new Uint8Array(4);
        yield* handle.read(header);
        expect(Buffer.from(header).toString()).toBe("glTF");
        const erc = yield* service.check({ threadId, designId: kicad.id, kind: "erc" });
        const drc = yield* service.check({ threadId, designId: kicad.id, kind: "drc" });
        expect(erc.outcome, erc.log).toBe("violations");
        expect(erc.violations).toHaveLength(40);
        expect(drc.outcome, drc.log).toBe("violations");
        expect(drc.violations).toHaveLength(68);
        const circuit = designs.designs.find((d) => d.kind === "tscircuit")!;
        expect(circuit).toBeDefined();
        for (const view of ["schematic", "pcb"] as const) {
          const result = yield* service.render({ threadId, designId: circuit.id, view });
          expect(result.outcome, result.log).toBe("ok");
          expect(result.sheets).toHaveLength(1);
          expect(
            (yield* service.readSheet({
              threadId,
              renderKey: result.renderKey,
              sheetId: result.sheets[0]!.id,
            })).svg,
          ).toContain("<svg");
        }
        const inspection = yield* service.inspect({ threadId, designId: kicad.id });
        expect(inspection.components.length).toBeGreaterThan(10);
        const sheetIds = new Set(schematic.sheets.map((sheet) => sheet.id));
        expect(
          inspection.components
            .filter((c) => c.schematic)
            .every((c) => sheetIds.has(c.schematic!.sheet!)),
        ).toBe(true);
        expect(
          inspection.components.flatMap((c) => c.pins).some((pin) => pin.schematic && pin.net),
        ).toBe(true);
        const custom = yield* service.render({
          threadId,
          designId: kicad.id,
          view: "pcb",
          layerNames: ["F.Cu", "Edge.Cuts"],
        });
        expect(custom.outcome, custom.log).toBe("ok");
        expect(custom.sheets).toHaveLength(2);
        for (const sheet of custom.sheets) {
          const content = yield* service.readSheet({
            threadId,
            renderKey: custom.renderKey,
            sheetId: sheet.id,
          });
          expect(content.svg).toContain(
            `viewBox="${sheet.frame!.x} ${sheet.frame!.y} ${sheet.frame!.width} ${sheet.frame!.height}"`,
          );
        }
        for (const designId of [kicad.id, circuit.id]) {
          const mesh = yield* service.asset({
            threadId,
            designId,
            format: "glb",
            transport: "inline",
          });
          expect(Buffer.from(mesh.data, "base64").subarray(0, 4).toString()).toBe("glTF");
          if (designId === circuit.id) {
            const bytes = Buffer.from(mesh.data, "base64");
            const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
            const root = document.nodes[document.scenes[0].nodes[0]];
            expect(root.scale).toEqual([0.001, 0.001, 0.001]);
            // The real 20 mm fixture must export a 0.020 m wide board, not 20 m.
            const widths = document.accessors
              .filter(
                (a: { type: string; min?: number[]; max?: number[] }) =>
                  a.type === "VEC3" && a.min && a.max,
              )
              .map(
                (a: { min: number[]; max: number[] }) => (a.max[0]! - a.min[0]!) * root.scale[0],
              );
            expect(Math.max(...widths)).toBeCloseTo(0.02);
          }
        }
        const circuitInspection = yield* service.inspect({ threadId, designId: circuit.id });
        const resistor = circuitInspection.components.find((c) => c.reference === "R1")!;
        expect(resistor.pins.some((pin) => pin.schematic && pin.pcb && pin.net)).toBe(true);
        const spice = yield* service.asset({ threadId, designId: circuit.id, format: "spice" });
        expect(spice.data).toContain("R");
        const setup = {
          id: "divider",
          name: "Divider",
          analysis: "op" as const,
          probes: ["v(out)"],
          step: 0.0001,
          stop: 0.01,
          startFrequency: 10,
          stopFrequency: 10000,
          points: 20,
          netlistPath: "divider.cir",
          sweep: null,
        };
        const operatingPoint = yield* service.simulate({ threadId, designId: circuit.id, setup });
        expect(operatingPoint.outcome, operatingPoint.log).toBe("ok");
        expect(operatingPoint.runs[0]!.series[0]!.values[0]).toBeCloseTo(2.5);
        expect(operatingPoint.netlistHash).not.toBe(operatingPoint.sourceHash);
        for (const analysis of ["tran", "ac"] as const) {
          const simulated = yield* service.simulate({
            threadId,
            designId: circuit.id,
            setup: { ...setup, analysis },
          });
          expect(simulated.outcome, simulated.log).toBe("ok");
          expect(simulated.runs[0]!.x.length).toBeGreaterThan(2);
          if (analysis === "ac")
            expect(simulated.runs[0]!.series[0]!.imaginary?.length).toBe(
              simulated.runs[0]!.x.length,
            );
        }
        const swept = yield* service.simulate({
          threadId,
          designId: circuit.id,
          setup: { ...setup, sweep: { parameter: "Rload", values: [1000, 2000] } },
        });
        expect(swept.outcome, swept.log).toBe("ok");
        expect(swept.runs.map((run) => run.series[0]!.values[0])).toEqual([
          2.5,
          expect.closeTo(10 / 3, 5),
        ]);
        const git = Effect.fn(function* (args: readonly string[]) {
          const result = yield* runner.run({ command: "git", args: [...args], cwd: root });
          expect(result.code, result.stderr).toBe(0);
          return result.stdout.trim();
        });
        yield* git(["init", "--quiet"]);
        yield* git(["add", "--", path.dirname(kicad.id), circuit.id]);
        yield* git([
          "-c",
          "user.name=Loom verification",
          "-c",
          "user.email=loom-test@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "Fixture baseline",
        ]);
        const commit = yield* git(["rev-parse", "HEAD"]);
        const checkpoint = "refs/t3/checkpoints/pcb-fixture/turn/1";
        yield* git(["update-ref", checkpoint, commit]);
        const revisions = yield* service.revisions({ threadId, designId: kicad.id });
        expect(revisions.map((r) => r.ref)).toEqual(expect.arrayContaining([commit, checkpoint]));
        const boardPath = path.join(root, kicad.boardPath!);
        const originalBoard = yield* fs.readFileString(boardPath);
        const first = inspection.components[0]!;
        const changedBoard = originalBoard.replace(
          `(property "Value" "${first.value}"`,
          `(property "Value" "LOOM_REVISION_TEST"`,
        );
        expect(changedBoard).not.toBe(originalBoard);
        yield* fs.writeFileString(boardPath, changedBoard);
        const comparison = yield* service.compare({
          threadId,
          designId: kicad.id,
          from: checkpoint,
          to: "",
        });
        expect(comparison.changes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              reference: first.reference,
              kind: "changed",
              detail: expect.stringContaining("value"),
            }),
          ]),
        );
        expect(comparison.beforeSvg).toContain("<svg");
        expect(comparison.afterSvg).toContain("<svg");
        expect(
          (yield* service.compare({ threadId, designId: kicad.id, from: checkpoint, to: commit }))
            .changes,
        ).toEqual([]);
        const circuitComparison = yield* service.compare({
          threadId,
          designId: circuit.id,
          from: commit,
          to: "",
        });
        expect(circuitComparison.changes).toEqual([]);
        expect(circuitComparison.beforeSvg).toContain("<svg");
        expect(circuitComparison.afterSvg).toContain("<svg");
        const original = yield* fs.readFileString(circuit.absolutePath);
        yield* Effect.acquireRelease(
          fs.writeFileString(circuit.absolutePath, "export default () => <this-is-invalid"),
          () => fs.writeFileString(circuit.absolutePath, original).pipe(Effect.orDie),
        );
        const broken = yield* service.render({ threadId, designId: circuit.id, view: "schematic" });
        expect(broken.outcome).toBe("failed");
        expect(broken.log.length).toBeGreaterThan(0);
        expect(yield* fs.exists(path.join(root, ".tscircuit"))).toBe(false);
        const cache = path.join(
          (yield* Config.ServerConfig.pipe(Effect.provide(context))).stateDir,
          "fork/pcb-preview/cache",
        );
        expect((yield* fs.readDirectory(cache)).some((n) => n.startsWith("pending-"))).toBe(false);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  180000,
);
