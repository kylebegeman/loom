import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { ThreadId } from "@t3tools/contracts";
import type {
  PcbPreviewError,
  PcbTurnDesign,
  PcbTurnDesigns,
  PcbTurnDesignsInput,
} from "@t3tools/contracts/fork";
import type { makeTurnFiles, TurnCheckpoint } from "../turnFiles.ts";
import { isPcbSource } from "./sourceFiles.ts";
type Design = {
  id: string;
  kind: "kicad" | "tscircuit";
  name: string;
  schematicPath?: string;
  boardPath?: string;
};
const empty = (): PcbTurnDesigns => ({
  runId: null,
  checkpointId: null,
  turn: null,
  designs: [],
  truncated: false,
});
const candidate = (name: string) => isPcbSource("kicad", name) || isPcbSource("tscircuit", name);
/** Match discovered groups once; dependency walks are bounded and use the exact hashed set. */
export const designsForFiles = Effect.fn("PcbPreview.designsForFiles")(function* (
  changed: readonly string[],
  deps: {
    discover: () => Effect.Effect<readonly Design[], PcbPreviewError>;
    snapshotFiles: (design: Design) => Effect.Effect<readonly string[], PcbPreviewError>;
  },
) {
  const relevant = changed.filter(candidate);
  if (!relevant.length) return { designs: [] as PcbTurnDesign[], truncated: false };
  const found = yield* deps.discover();
  const written = found
    .flatMap((d) => {
      const direct = new Set([
        d.id,
        d.schematicPath,
        d.boardPath,
        ...(d.kind === "kicad" ? [d.id.replace(/\.kicad_(?:pro|sch|pcb)$/, ".kicad_pro")] : []),
      ]);
      const rank = changed.findIndex((file) => direct.has(file));
      return rank < 0 ? [] : [{ d, rank }];
    })
    .sort((a, b) => a.rank - b.rank || a.d.id.localeCompare(b.d.id));
  const writtenIds = new Set(written.map(({ d }) => d.id));
  const candidates = found
    .filter((d) => !writtenIds.has(d.id) && relevant.some((file) => isPcbSource(d.kind, file)))
    .sort((a, b) => a.id.localeCompare(b.id));
  let truncated = candidates.length > 50;
  const indirect = yield* Effect.forEach(
    candidates.slice(0, 50),
    (d) =>
      deps.snapshotFiles(d).pipe(
        Effect.map((files) => {
          const set = new Set(files),
            via = relevant.find((file) => set.has(file));
          return via
            ? { designId: d.id, kind: d.kind, name: d.name, reason: "dependency" as const, via }
            : null;
        }),
        Effect.catch((cause) => {
          if (["source-limit", "design-not-found"].includes(cause.reason)) {
            truncated = true;
            return Effect.succeed(null);
          }
          return Effect.fail(cause);
        }),
      ),
    { concurrency: 8 },
  );
  const all: PcbTurnDesign[] = [
    ...written.map(({ d }) => ({
      designId: d.id,
      kind: d.kind,
      name: d.name,
      reason: "written" as const,
      via: null,
    })),
    ...indirect.filter((d) => d !== null),
  ];
  return { designs: all.slice(0, 20), truncated: truncated || all.length > 20 };
});
export const makeTurnDesigns = <Ws extends { root: string }>(deps: {
  workspace: (threadId: ThreadId) => Effect.Effect<Ws, PcbPreviewError>;
  discover: (root: string) => Effect.Effect<readonly Design[], PcbPreviewError>;
  snapshotFiles: (
    workspace: Ws,
    design: Design,
  ) => Effect.Effect<readonly string[], PcbPreviewError>;
  turnFiles: Effect.Success<typeof makeTurnFiles>;
}) => {
  const prefix = (root: string) =>
    deps.turnFiles.repoPrefix(root).pipe(Effect.orElseSucceed(() => null));
  const fromCheckpoint = (ws: Ws, prefix: string, checkpoint: TurnCheckpoint) =>
    designsForFiles(deps.turnFiles.workspaceFiles(prefix, checkpoint.files), {
      discover: () => deps.discover(ws.root),
      snapshotFiles: (design) => deps.snapshotFiles(ws, design),
    }).pipe(
      Effect.map((result) => ({
        ...result,
        runId: checkpoint.runId,
        checkpointId: checkpoint.checkpointId,
        turn: checkpoint.turn,
      })),
    );
  const turnDesigns = Effect.fn("PcbPreview.turnDesigns")(function* (input: PcbTurnDesignsInput) {
    const ws = yield* deps.workspace(input.threadId),
      base = yield* prefix(ws.root);
    if (base === null) return empty();
    const checkpoints = yield* deps.turnFiles
      .turnCheckpoints(input.threadId, input.runId, 20)
      .pipe(Effect.orElseSucceed(() => []));
    for (const checkpoint of checkpoints) {
      const result = yield* fromCheckpoint(ws, base, checkpoint);
      if (result.designs.length || input.runId !== null) return result;
    }
    return empty();
  });
  const turnDesignEvents = (input: { threadId: ThreadId }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const ws = yield* deps.workspace(input.threadId),
          base = yield* prefix(ws.root);
        if (base === null) return Stream.empty;
        return deps.turnFiles.turnCheckpointEvents(input.threadId).pipe(
          Stream.mapEffect((checkpoint) => fromCheckpoint(ws, base, checkpoint)),
          Stream.filter((result) => !!result.designs.length),
        );
      }),
    );
  return { turnDesigns, turnDesignEvents };
};
