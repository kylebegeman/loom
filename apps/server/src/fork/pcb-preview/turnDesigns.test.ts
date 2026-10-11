import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { CheckpointId, RunId, ThreadId } from "@t3tools/contracts";
import { PcbPreviewError } from "@t3tools/contracts/fork";
import { workspaceFiles } from "../turnFiles.ts";
import { designsForFiles, makeTurnDesigns } from "./turnDesigns.ts";
const board = {
  id: "board.kicad_pro",
  kind: "kicad" as const,
  name: "board",
  schematicPath: "board.kicad_sch",
  boardPath: "board.kicad_pcb",
};
const circuit = { id: "src/amp.tsx", kind: "tscircuit" as const, name: "amp" };
it.effect("groups direct files and orders written designs before exact source dependencies", () =>
  Effect.gen(function* () {
    let snapshots = 0;
    const result = yield* designsForFiles(
      ["board.kicad_sch", "board.kicad_pcb", "lib/divider.ts"],
      {
        discover: () => Effect.succeed([board, circuit]),
        snapshotFiles: () =>
          Effect.sync(() => {
            snapshots++;
            return ["lib/divider.ts"];
          }),
      },
    );
    expect(result.designs).toEqual([
      { designId: board.id, kind: "kicad", name: "board", reason: "written", via: null },
      {
        designId: circuit.id,
        kind: "tscircuit",
        name: "amp",
        reason: "dependency",
        via: "lib/divider.ts",
      },
    ]);
    expect(snapshots).toBe(1);
  }),
);
it.effect("sub-sheets and assets only offer designs whose hashed file set includes them", () =>
  Effect.gen(function* () {
    const result = yield* designsForFiles(["power.kicad_sch", "asset.png"], {
      discover: () => Effect.succeed([board, circuit]),
      snapshotFiles: (d) =>
        Effect.succeed(d.kind === "kicad" ? ["power.kicad_sch"] : ["asset.png"]),
    });
    expect(result.designs.map((d) => d.via)).toEqual(["power.kicad_sch", "asset.png"]);
  }),
);
it.effect("unrelated edits avoid discovery and source walks", () =>
  Effect.gen(function* () {
    let called = false;
    const result = yield* designsForFiles(["README.md", "firmware/pins.h"], {
      discover: () =>
        Effect.sync(() => {
          called = true;
          return [];
        }),
      snapshotFiles: () => Effect.succeed([]),
    });
    expect(result.designs).toEqual([]);
    expect(called).toBe(false);
  }),
);
it.effect("bounds dependency scans and results and reports incomplete source discovery", () =>
  Effect.gen(function* () {
    let walks = 0;
    const found = Array.from({ length: 60 }, (_, n) => ({ ...circuit, id: `src/${n}.tsx` }));
    const result = yield* designsForFiles(["lib/part.ts"], {
      discover: () => Effect.succeed(found),
      snapshotFiles: () =>
        Effect.sync(() => {
          walks++;
          return ["lib/part.ts"];
        }),
    });
    expect(walks).toBe(50);
    expect(result.designs).toHaveLength(20);
    expect(result.truncated).toBe(true);
    const skipped = yield* designsForFiles(["part.ts"], {
      discover: () => Effect.succeed([circuit]),
      snapshotFiles: () =>
        Effect.fail(new PcbPreviewError({ reason: "source-limit", message: "too large" })),
    });
    expect(skipped).toEqual({ designs: [], truncated: true });
  }),
);
it.effect("uses repository prefixes, walks recent turns and emits checkpoint changes", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread"),
      runId = RunId.make("run"),
      checkpoint = {
        runId,
        checkpointId: CheckpointId.make("checkpoint"),
        turn: 2,
        files: ["hw/board.kicad_pcb", "other/board.kicad_sch"],
      };
    const methods = makeTurnDesigns({
      workspace: () => Effect.succeed({ root: "/repo/hw" }),
      discover: () => Effect.succeed([board]),
      snapshotFiles: () => Effect.succeed([]),
      turnFiles: {
        repoPrefix: () => Effect.succeed("hw/"),
        workspaceFiles,
        turnCheckpoints: () =>
          Effect.succeed([{ ...checkpoint, turn: 3, files: ["hw/README.md"] }, checkpoint]),
        turnCheckpointEvents: () => Stream.succeed(checkpoint),
      },
    });
    expect((yield* methods.turnDesigns({ threadId, runId: null })).turn).toBe(2);
    expect(
      (yield* methods.turnDesignEvents({ threadId }).pipe(Stream.runCollect))[0]?.designs[0]
        ?.designId,
    ).toBe(board.id);
  }),
);
