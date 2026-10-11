import type { PcbBounds, PcbInspection, PcbView } from "@t3tools/contracts/fork";
export interface DrawingSnapshot {
  readonly view: PcbView;
  readonly sheetId: string;
  readonly layersKey: string;
  readonly frame: PcbBounds;
  readonly images: ReadonlyArray<{ readonly svg: string; readonly opacity: number }>;
}
export interface SeenVersion {
  readonly sourceHash: string;
  readonly inspection: PcbInspection;
  readonly drawing: DrawingSnapshot | null;
}
export function createChangeMemory(maxDesigns = 8, maxBytes = 16 * 1024 * 1024) {
  const entries = new Map<string, SeenVersion>();
  const trim = () => {
    let bytes = [...entries.values()].reduce(
      (n, v) => n + (v.drawing?.images.reduce((s, i) => s + i.svg.length * 2, 0) ?? 0),
      0,
    );
    for (const [key, v] of entries) {
      if (bytes <= maxBytes) break;
      bytes -= v.drawing?.images.reduce((s, i) => s + i.svg.length * 2, 0) ?? 0;
      entries.set(key, { ...v, drawing: null });
    }
    while (entries.size > maxDesigns) entries.delete(entries.keys().next().value!);
  };
  return {
    get(key: string) {
      const v = entries.get(key);
      if (v) {
        entries.delete(key);
        entries.set(key, v);
      }
      return v;
    },
    set(key: string, value: SeenVersion) {
      entries.delete(key);
      entries.set(key, value);
      trim();
    },
    setDrawing(key: string, sourceHash: string, drawing: DrawingSnapshot) {
      const v = entries.get(key);
      if (v?.sourceHash === sourceHash) {
        entries.set(key, { ...v, drawing });
        trim();
      }
    },
  };
}
export const changeMemory = createChangeMemory();
