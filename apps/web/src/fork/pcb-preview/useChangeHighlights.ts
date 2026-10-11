import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  pcbChangeSet,
  changeCounts,
  type PcbChangeState,
  type PcbInspection,
  type PcbLayerState,
} from "@t3tools/contracts/fork";
import { changeMemory, type DrawingSnapshot, type SeenVersion } from "./changeMemory";
import { drawingRegions } from "./drawingDiff";
import { svgFrame } from "./geometry";
import type { usePcbPreview } from "./usePcbPreview";
type Pair = { before: SeenVersion; after: PcbInspection };
type RasterResult = Awaited<ReturnType<typeof drawingRegions>>;
export function useChangeHighlights({
  key,
  inspection,
  display,
  customLayers,
  suspended,
}: {
  key: string;
  inspection: PcbInspection | null;
  display: ReturnType<typeof usePcbPreview>["display"];
  customLayers: readonly PcbLayerState[] | null;
  suspended: boolean;
}) {
  const [seen, setSeen] = useState<string | null>(null),
    [pair, setPair] = useState<Pair | null>(null),
    [shown, setShown] = useState(false),
    [dismissed, setDismissed] = useState<string | null>(null);
  const [layerSvgs, setLayerSvgs] = useState<{ renderKey: string; svgs: Map<string, string> }>({
    renderKey: "",
    svgs: new Map(),
  });
  const [raster, setRaster] = useState<{ key: string; result: RasterResult } | null>(null);
  if (!suspended && inspection && inspection.sourceHash !== seen) {
    const before = changeMemory.get(key);
    setSeen(inspection.sourceHash);
    if (before?.sourceHash !== inspection.sourceHash) {
      setPair(before ? { before, after: inspection } : null);
      changeMemory.set(key, { sourceHash: inspection.sourceHash, inspection, drawing: null });
    }
  }
  const set = useMemo(
    () => (pair ? pcbChangeSet(pair.before.inspection, pair.after) : { components: [], nets: [] }),
    [pair],
  );
  const onSvg = useCallback(
    (renderKey: string, sheetId: string, svg: string) =>
      setLayerSvgs((old) => {
        if (old.renderKey === renderKey && old.svgs.get(sheetId) === svg) return old;
        const svgs = old.renderKey === renderKey ? new Map(old.svgs) : new Map<string, string>();
        svgs.set(sheetId, svg);
        return { renderKey, svgs };
      }),
    [],
  );
  const snapshot = useMemo<DrawingSnapshot | null>(() => {
    if (!display || display.sourceHash !== inspection?.sourceHash || suspended) return null;
    const frame = svgFrame(display.svg);
    if (!frame) return null;
    const layered = display.view === "pcb" && !!display.result.sheets[0]?.layer;
    const visible = display.result.sheets.filter(
      (s) => customLayers?.find((l) => l.name === s.layer)?.visible,
    );
    if (
      layered &&
      (layerSvgs.renderKey !== display.renderKey || visible.some((s) => !layerSvgs.svgs.has(s.id)))
    )
      return null;
    return {
      view: display.view,
      sheetId: layered ? "board" : display.sheetId,
      layersKey: JSON.stringify([
        display.layers,
        layered ? customLayers?.filter((l) => l.visible) : null,
      ]),
      frame,
      images: layered
        ? visible.map((s) => ({
            svg: layerSvgs.svgs.get(s.id)!,
            opacity: customLayers!.find((l) => l.name === s.layer)!.opacity,
          }))
        : [{ svg: display.svg, opacity: 1 }],
    };
  }, [display, inspection?.sourceHash, suspended, customLayers, layerSvgs]);
  useEffect(() => {
    if (snapshot && inspection) changeMemory.setDrawing(key, inspection.sourceHash, snapshot);
  }, [key, inspection, snapshot]);
  const rasterKey =
    pair && snapshot
      ? JSON.stringify([
          pair.before.sourceHash,
          pair.after.sourceHash,
          snapshot.view,
          snapshot.sheetId,
          snapshot.layersKey,
        ])
      : "";
  const jobs = useRef({ sourceHash: "", map: new Map<string, Promise<RasterResult>>() });
  const runDrawing = useCallback(() => {
    if (!pair || !snapshot) return Promise.resolve(null);
    if (jobs.current.sourceHash !== pair.after.sourceHash)
      jobs.current = { sourceHash: pair.after.sourceHash, map: new Map() };
    let job = jobs.current.map.get(rasterKey);
    if (!job) {
      job = pair.before.drawing
        ? drawingRegions(pair.before.drawing, snapshot)
        : Promise.resolve(null);
      jobs.current.map.set(rasterKey, job);
    }
    return job;
  }, [pair, snapshot, rasterKey]);
  useEffect(() => {
    if (!rasterKey || (!shown && (set.components.length || set.nets.length))) return;
    let active = true;
    void runDrawing().then((result) => {
      if (active) setRaster({ key: rasterKey, result });
    });
    return () => {
      active = false;
    };
    // The key contains the complete immutable drawing request. No new work on unrelated renders.
  }, [rasterKey, shown, set, runDrawing]);
  const resolved = raster?.key === rasterKey ? raster : undefined;
  const regions = resolved?.result?.regions ?? [];
  const drawing = resolved ? (resolved.result ? "ready" : "unavailable") : "pending";
  const state = (result = resolved?.result): PcbChangeState | null =>
    pair
      ? {
          shown: shown && !suspended,
          fromSourceHash: pair.before.sourceHash,
          toSourceHash: pair.after.sourceHash,
          components: set.components.slice(0, 200),
          nets: set.nets.slice(0, 200),
          regions: result?.regions ?? [],
          drawing: result === undefined ? "pending" : result === null ? "unavailable" : "ready",
          truncated:
            !!set.truncated ||
            set.components.length > 200 ||
            set.nets.length > 200 ||
            !!result?.truncated,
        }
      : null;
  return {
    pair,
    set,
    counts: changeCounts(set),
    shown: shown && !suspended,
    chip:
      !!pair &&
      !suspended &&
      dismissed !== pair.after.sourceHash &&
      !!(set.components.length || set.nets.length || regions.length),
    regions,
    drawing,
    state,
    onSvg,
    show: (on: boolean) => {
      setShown(on);
      if (on) setDismissed(null);
    },
    dismiss: () => {
      setShown(false);
      setDismissed(pair?.after.sourceHash ?? null);
    },
    drawingSettled: async () => {
      const result = await runDrawing();
      setRaster({ key: rasterKey, result });
      return state(result);
    },
  };
}
