import { randomUUID } from "~/lib/utils";
import { useState } from "react";
import {
  CircuitBoardIcon,
  CrosshairIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import {
  PCB_LAYER_PRESETS,
  resolveLayerPreset,
  type PcbBuiltInLayerPreset,
  type PcbInspection,
  type PcbLayerPreset,
  type PcbLayerState,
  type PcbView,
  type PcbWorkspace,
} from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
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
import {
  LAYER_GROUPS,
  layerColor,
  layerGroup,
  matchLayerSet,
  reconcileSaved,
  sameVisibility,
  uniqueLayerSetName,
} from "./layers";
import { usePcbPreferences } from "./preferences";
import { reconcileLayers } from "./usePcbPreview.logic";
import { ToolButton } from "./ToolButton";
import k from "./inspector.module.css";

const PRESETS = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "all", label: "All copper" },
] as const;
const SAVED_SET_LIMIT = 20;

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
  const hiddenPresets = usePcbPreferences((preferences) => preferences.hiddenLayerPresets);
  const setHiddenPresets = usePcbPreferences((preferences) => preferences.setHiddenLayerPresets);
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
  const names = inspection?.layers ?? layers.map((l) => l.name);
  const active = matchLayerSet(layers, names, data.layerSets);
  const presets = PCB_LAYER_PRESETS.filter((preset) => !hiddenPresets.includes(preset.id));
  const full = data.layerSets.length >= SAVED_SET_LIMIT;
  const saveDisabled = !canSave || full || write.busy;
  const saveHint = full
    ? "Saved sets are full (20)"
    : !canSave
      ? "Workspace write permission is required"
      : undefined;
  const duplicate = (preset: PcbBuiltInLayerPreset) => {
    const resolved = resolveLayerPreset(preset, names);
    if (!resolved || saveDisabled) return;
    void write.run(() =>
      mutate((current) => {
        if (current.layerSets.length >= SAVED_SET_LIMIT)
          throw new Error("Saved sets are full (20).");
        return {
          ...current,
          layerSets: [
            ...current.layerSets,
            {
              id: randomUUID(),
              name: uniqueLayerSetName(preset.name, current.layerSets),
              layers: resolved,
            },
          ],
        };
      }),
    );
  };
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
  const save = () => {
    if (saveDisabled || !name.trim()) return;
    void write
      .run(() =>
        mutate((current) => {
          if (current.layerSets.length >= SAVED_SET_LIMIT)
            throw new Error("Saved sets are full (20).");
          return {
            ...current,
            layerSets: [...current.layerSets, { id: randomUUID(), name: name.trim(), layers }],
          };
        }),
      )
      .then((saved) => saved && setName(""));
  };
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
          {!matched && !active && (
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
        {names.length > 0 && (
          <Section
            title="Presets"
            count={
              presets.length === PCB_LAYER_PRESETS.length
                ? presets.length
                : `${presets.length} of ${PCB_LAYER_PRESETS.length}`
            }
            action={
              <Menu>
                <MenuTrigger
                  render={
                    <button type="button" className={revealTool} aria-label="Preset options" />
                  }
                >
                  <MoreHorizontalIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuGroup>
                    <MenuGroupLabel>Duplicate as saved set</MenuGroupLabel>
                    {PCB_LAYER_PRESETS.map((preset) => {
                      const resolved = resolveLayerPreset(preset, names);
                      return (
                        <MenuItem
                          key={preset.id}
                          disabled={saveDisabled || !resolved}
                          aria-description={
                            resolved ? saveHint : "This board has none of these layers"
                          }
                          onClick={() => duplicate(preset)}
                        >
                          {preset.name}
                        </MenuItem>
                      );
                    })}
                  </MenuGroup>
                  {PCB_LAYER_PRESETS.some((preset) => hiddenPresets.includes(preset.id)) && (
                    <MenuGroup>
                      <MenuGroupLabel>Hidden</MenuGroupLabel>
                      {PCB_LAYER_PRESETS.filter((preset) => hiddenPresets.includes(preset.id)).map(
                        (preset) => (
                          <MenuItem
                            key={preset.id}
                            onClick={() =>
                              setHiddenPresets(hiddenPresets.filter((id) => id !== preset.id))
                            }
                          >
                            Show {preset.name}
                          </MenuItem>
                        ),
                      )}
                    </MenuGroup>
                  )}
                </MenuPopup>
              </Menu>
            }
          >
            {presets.length ? (
              <div className={k.chips}>
                {presets.map((preset) => {
                  const resolved = resolveLayerPreset(preset, names);
                  return (
                    <Chip
                      key={preset.id}
                      pressed={active?.kind === "built-in" && active.id === preset.id}
                      applyDisabled={!resolved}
                      title={resolved ? undefined : "This board has none of these layers"}
                      onClick={() => resolved && set(resolved)}
                      onRemove={() => setHiddenPresets([...hiddenPresets, preset.id])}
                      removeLabel={`Hide ${preset.name}`}
                    >
                      {preset.name}
                    </Chip>
                  );
                })}
              </div>
            ) : (
              <p className={k.barCaption}>All presets are hidden.</p>
            )}
          </Section>
        )}
        <Section title="Saved sets" count={data.layerSets.length || undefined}>
          {full && <p className={k.barCaption}>Saved sets are full (20).</p>}
          {data.layerSets.length > 0 && (
            <div className={k.chips}>
              {data.layerSets.map((s) => (
                <Chip
                  key={s.id}
                  pressed={active?.kind === "saved" && active.id === s.id}
                  onClick={() => set(reconcileSaved(s.layers, names))}
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
                  <span className={k.chipMeta}>
                    {reconcileSaved(s.layers, names).filter((layer) => layer.visible).length}
                  </span>
                </Chip>
              ))}
            </div>
          )}
          <form
            className={k.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (!saveDisabled && name.trim()) save();
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
              disabled={saveDisabled || !name.trim()}
              aria-description={saveHint}
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
