import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import { CircuitBoardIcon, CrosshairIcon, EyeIcon, EyeOffIcon, LayersIcon } from "lucide-react";
import type {
  PcbInspection,
  PcbLayerPreset,
  PcbLayerState,
  PcbView,
  PcbWorkspace,
} from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Bar,
  Chip,
  EmptyState,
  Notice,
  Range,
  Scroll,
  Section,
  Segmented,
  revealTool,
  useWrite,
} from "./InspectorKit";
import { LAYER_GROUPS, layerColor, layerGroup } from "./layers";
import { reconcileLayers } from "./usePcbPreview.logic";
import { ToolButton } from "./ToolButton";
import k from "./inspector.module.css";

const PRESETS = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "all", label: "All copper" },
] as const;
const sameVisibility = (a: readonly PcbLayerState[], b: readonly PcbLayerState[]) =>
  a.length === b.length &&
  a.every((layer, i) => layer.visible === b[i]?.visible && layer.opacity === b[i]?.opacity);

export function LayersTab({
  inspection,
  view,
  layers,
  data,
  canSave,
  onPreset,
  onLayers,
  onShowBoard,
  mutate,
}: {
  inspection: PcbInspection | null;
  view: PcbView;
  layers: readonly PcbLayerState[];
  data: PcbWorkspace;
  canSave: boolean;
  onPreset: (preset: PcbLayerPreset) => void;
  onLayers: (layers: readonly PcbLayerState[]) => void;
  onShowBoard: () => void;
  mutate: (change: (data: PcbWorkspace) => PcbWorkspace) => Promise<unknown>;
}) {
  const [solo, setSolo] = useState<{ name: string; previous: readonly PcbLayerState[] } | null>(
      null,
    ),
    [name, setName] = useState("");
  const write = useWrite("The layer set could not be saved.");
  if (view !== "pcb")
    return (
      <Scroll>
        <EmptyState
          icon={<LayersIcon />}
          title="Layers belong to the board"
          action={
            <Button size="sm" variant="outline" onClick={onShowBoard}>
              <CircuitBoardIcon />
              Show board
            </Button>
          }
        >
          Switch to the board drawing to choose which copper, mask and silkscreen layers show.
        </EmptyState>
      </Scroll>
    );
  if (!layers.length)
    return (
      <Scroll>
        <EmptyState icon={<LayersIcon />} title="Reading board layers">
          Layer controls appear once the board has been inspected.
        </EmptyState>
      </Scroll>
    );
  const names = layers.map((l) => l.name);
  const matched =
    PRESETS.find((p) => sameVisibility(layers, reconcileLayers(null, names, p.value)))?.value ??
    null;
  const set = (next: readonly PcbLayerState[]) => {
    setSolo(null);
    onLayers(next);
  };
  const patch = (layerName: string, change: Partial<PcbLayerState>) =>
    set(layers.map((l) => (l.name === layerName ? { ...l, ...change } : l)));
  const label = (layerName: string) => inspection?.layerLabels?.[layerName] ?? layerName;
  const save = () =>
    void write
      .run(() =>
        mutate((d) => ({
          ...d,
          layerSets: [...d.layerSets, { id: randomUUID(), name: name.trim(), layers }],
        })),
      )
      .then((saved) => saved && setName(""));
  const visible = layers.filter((l) => l.visible).length;
  return (
    <>
      <Bar>
        <div className={k.barRow}>
          <Segmented
            label="Layer preset"
            value={matched}
            onChange={(next) => {
              setSolo(null);
              onPreset(next);
            }}
            options={PRESETS}
          />
          {!matched && (
            <Badge variant="outline" size="sm">
              Custom
            </Badge>
          )}
        </div>
        <p className={k.barCaption}>
          {visible} of {layers.length} layers visible
        </p>
      </Bar>
      <Scroll>
        {solo && (
          <Notice
            tone="info"
            icon={<CrosshairIcon />}
            action={
              <Button size="xs" variant="outline" onClick={() => set(solo.previous)}>
                Restore
              </Button>
            }
          >
            Showing only {label(solo.name)}.
          </Notice>
        )}
        {LAYER_GROUPS.map((group) => {
          const rows = layers.filter((l) => layerGroup(l.name) === group);
          if (!rows.length) return null;
          const shown = rows.filter((l) => l.visible).length;
          return (
            <Section
              key={group}
              title={group}
              count={`${shown}/${rows.length}`}
              action={
                <ToolButton
                  label={
                    shown
                      ? `Hide ${group.toLowerCase()} layers`
                      : `Show ${group.toLowerCase()} layers`
                  }
                  onClick={() =>
                    set(
                      layers.map((l) =>
                        layerGroup(l.name) === group ? { ...l, visible: shown === 0 } : l,
                      ),
                    )
                  }
                >
                  {shown ? <EyeIcon /> : <EyeOffIcon />}
                </ToolButton>
              }
            >
              <div className={k.layerList}>
                {rows.map((layer) => (
                  <div
                    key={layer.name}
                    className={k.layerRow}
                    data-hidden={!layer.visible || undefined}
                  >
                    <ToolButton
                      label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                      aria-pressed={layer.visible}
                      onClick={() => patch(layer.name, { visible: !layer.visible })}
                    >
                      {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
                    </ToolButton>
                    <span
                      className={k.swatch}
                      style={{ background: layerColor(layer.name) }}
                      aria-hidden="true"
                    />
                    <span className={k.layerName}>
                      <strong>{label(layer.name)}</strong>
                      {label(layer.name) !== layer.name && <small>{layer.name}</small>}
                    </span>
                    <Range
                      label={`${layer.name} opacity`}
                      min={0}
                      max={1}
                      step={0.05}
                      value={layer.opacity}
                      disabled={!layer.visible}
                      onChange={(opacity) => patch(layer.name, { opacity })}
                    />
                    <span className={k.layerOpacity}>{Math.round(layer.opacity * 100)}%</span>
                    <ToolButton
                      className={revealTool}
                      label={solo?.name === layer.name ? "Restore layers" : `Solo ${layer.name}`}
                      aria-pressed={solo?.name === layer.name}
                      onClick={() => {
                        if (solo?.name === layer.name) return set(solo.previous);
                        onLayers(layers.map((l) => ({ ...l, visible: l.name === layer.name })));
                        setSolo({ name: layer.name, previous: solo?.previous ?? layers });
                      }}
                    >
                      <CrosshairIcon />
                    </ToolButton>
                  </div>
                ))}
              </div>
            </Section>
          );
        })}
        <Section title="Saved sets" count={data.layerSets.length || undefined}>
          {data.layerSets.length > 0 && (
            <div className={k.chips}>
              {data.layerSets.map((s) => (
                <Chip
                  key={s.id}
                  pressed={sameVisibility(layers, s.layers)}
                  onClick={() => set(s.layers)}
                  onRemove={() =>
                    void write.run(() =>
                      mutate((d) => ({
                        ...d,
                        layerSets: d.layerSets.filter((v) => v.id !== s.id),
                      })),
                    )
                  }
                  removeLabel={`Remove ${s.name}`}
                  disabled={!canSave || write.busy}
                >
                  {s.name}
                  <span className={k.chipMeta}>{s.layers.filter((l) => l.visible).length}</span>
                </Chip>
              ))}
            </div>
          )}
          <form
            className={k.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave && name.trim()) save();
            }}
          >
            <Input
              size="sm"
              aria-label="Layer set name"
              placeholder="Name these layers"
              disabled={write.busy}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!canSave || !name.trim() || write.busy}
            >
              Save set
            </Button>
          </form>
          {write.error && (
            <p role="alert" className={k.error}>
              {write.error}
            </p>
          )}
        </Section>
      </Scroll>
    </>
  );
}
