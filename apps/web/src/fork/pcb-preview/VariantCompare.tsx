import { useEffect, useEffectEvent, useState } from "react";
import type { PcbVariant } from "@t3tools/contracts/fork";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { ComparisonImages } from "./RevisionCompare";
import { Segmented, Range, Notice, errorText } from "./InspectorKit";
import { alignSvgPair } from "./variantImages";
import { BOARD_COLUMNS, variantStat, type SortKey } from "./sweep";
import { formatArea, formatLength } from "./length";
import { useLengthUnit } from "./preferences";
import styles from "./VariantWorkbench.module.css";
type Mode = "side" | "overlay" | "before" | "after" | "difference";
function SvgImage({ svg, label }: { svg: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const value = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    // Publish the allocated image resource; cleanup releases it.
    // eslint-disable-next-line react/set-state-in-effect
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [svg]);
  return url ? <img src={url} alt={label} /> : null;
}
export function VariantCompare({
  variants,
  load,
  close,
}: {
  variants: readonly [PcbVariant, PcbVariant];
  load: (variant: PcbVariant) => Promise<string>;
  close: () => void;
}) {
  const [images, setImages] = useState<[string, string] | null>(null),
    [error, setError] = useState<string | null>(null),
    [mode, setMode] = useState<Mode>("side"),
    [opacity, setOpacity] = useState(0.5);
  const units = useLengthUnit();
  const read = useEffectEvent(async (current: () => boolean) => {
    const a = await load(variants[0]);
    if (!current()) return null;
    const b = await load(variants[1]);
    return current() ? alignSvgPair(a, b) : null;
  });
  useEffect(() => {
    let alive = true;
    void read(() => alive).then(
      (v) => {
        if (alive && v) setImages(v);
      },
      (e) => {
        if (alive) setError(errorText(e, "Could not compare variants."));
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  const keys = [...new Set(variants.flatMap((v) => Object.keys(v.values)))];
  const stats = (
    ["width", "height", "area", "components", "issues", ...Object.keys(BOARD_COLUMNS)] as Exclude<
      SortKey,
      "name"
    >[]
  ).filter((key) => variantStat(variants[0], key) !== variantStat(variants[1], key));
  const statText = (value: number | null, key: string) =>
    value === null
      ? "Unavailable"
      : key === "area"
        ? formatArea(value, units)
        : key === "width" || key === "height" || key.endsWith("Mm")
          ? formatLength(value, units)
          : String(value);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup variant="media">
        <DialogTitle>Compare circuit variants</DialogTitle>
        <Segmented
          label="Comparison mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "side", label: "Side by side" },
            { value: "overlay", label: "Overlay" },
            { value: "before", label: "A" },
            { value: "after", label: "B" },
            { value: "difference", label: "Difference" },
          ]}
        />
        {mode === "overlay" && (
          <Range
            label="B opacity"
            value={opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={setOpacity}
          />
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {!images && !error && <p role="status">Loading candidate drawings…</p>}
        {images &&
          (mode === "side" ? (
            <div className={styles.comparison}>
              {images.map((svg, i) => (
                <figure key={variants[i]!.id}>
                  <figcaption>
                    {i === 0 ? "A" : "B"}: {variants[i]!.name}
                  </figcaption>
                  <SvgImage svg={svg} label={variants[i]!.name} />
                </figure>
              ))}
            </div>
          ) : (
            <ComparisonImages
              before={images[0]}
              after={images[1]}
              mode={mode}
              opacity={opacity}
              beforeLabel={variants[0].name}
              afterLabel={variants[1].name}
            />
          ))}
        <div className={styles.tableWrap}>
          <table className={styles.facts}>
            <thead>
              <tr>
                <th>Difference</th>
                <th>A: {variants[0].name}</th>
                <th>B: {variants[1].name}</th>
              </tr>
            </thead>
            <tbody>
              {keys
                .filter((key) => variants[0].values[key] !== variants[1].values[key])
                .map((key) => (
                  <tr key={key}>
                    <th>{key}</th>
                    {variants.map((v) => (
                      <td key={v.id}>{String(v.values[key] ?? "Source value")}</td>
                    ))}
                  </tr>
                ))}
              {stats.map((key) => (
                <tr key={key}>
                  <th>
                    {key in BOARD_COLUMNS ? BOARD_COLUMNS[key as keyof typeof BOARD_COLUMNS] : key}
                  </th>
                  {variants.map((v) => (
                    <td key={v.id}>{statText(variantStat(v, key), key)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
