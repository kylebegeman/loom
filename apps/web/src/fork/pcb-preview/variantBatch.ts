import type { PcbVariant, PcbRenderVariantResult } from "@t3tools/contracts/fork";
const sourceConflict = (e: unknown) =>
  (e !== null && typeof e === "object" && "reason" in e && e.reason === "conflict") ||
  (e instanceof Error && /circuit source changed/i.test(e.message));
/** One candidate at a time; every awaited stage checks whether the panel still owns the batch. */
export async function runVariantBatch(options: {
  variants: readonly PcbVariant[];
  current: () => boolean;
  render: (variant: PcbVariant) => Promise<PcbRenderVariantResult>;
  read: (result: PcbRenderVariantResult) => Promise<string>;
  thumbnail: (svg: string) => Promise<string>;
  save: (variant: PcbVariant, patch: Partial<PcbVariant>) => Promise<unknown>;
  progress: (index: number, variant: PcbVariant) => void;
}) {
  for (const [index, variant] of options.variants.entries()) {
    if (!options.current()) break;
    options.progress(index, variant);
    try {
      const rendered = await options.render(variant);
      if (!options.current() || rendered.outcome === "cancelled") break;
      if (rendered.outcome !== "ok" || !rendered.sheet)
        throw new Error(rendered.log || "Build failed.");
      const svg = await options.read(rendered);
      if (!options.current()) break;
      const image = await options.thumbnail(svg);
      if (!options.current()) break;
      await options.save(variant, {
        render: { renderKey: rendered.renderKey, sheetId: rendered.sheet.id },
        thumbnail: image,
        stats: rendered.stats,
        renderedRevision: rendered.sourceHash,
        error: null,
      });
    } catch (error) {
      if (!options.current()) break;
      if (sourceConflict(error)) throw error;
      await options.save(variant, {
        error: (error instanceof Error ? error.message : "Build failed.").slice(0, 2000),
      });
    }
  }
}
export type VariantRequest = { id: string; action: "sweep" | "render"; ids?: readonly string[] };
