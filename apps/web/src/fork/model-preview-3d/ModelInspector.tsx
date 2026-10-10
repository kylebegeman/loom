import styles from "./workspace.module.css";
import { useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import {
  ApertureIcon,
  BoxIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  LayoutGridIcon,
  PanelRightCloseIcon,
  PencilRulerIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  BuildPlatePresetId,
  ModelPreviewSettings,
  ScadRenderResult,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import type { meshStats } from "./viewer/load";
import { buildPlateLabel, buildPlateOptions, fitsBuildVolume } from "./buildPlate";
import { Chip, EmptyNote, SectionHead, Tip, useSlidingThumb } from "./controls";
import { models, runModelCommand } from "./state";

export type InspectorTab = "customize" | "variants" | "markup" | "views" | "part";
const TABS: readonly { id: InspectorTab; label: string; icon: LucideIcon; scad: boolean }[] = [
  { id: "customize", label: "Customize", icon: SlidersHorizontalIcon, scad: true },
  { id: "variants", label: "Variants", icon: LayoutGridIcon, scad: true },
  { id: "markup", label: "Markup", icon: PencilRulerIcon, scad: false },
  { id: "views", label: "Views", icon: ApertureIcon, scad: false },
  { id: "part", label: "Part", icon: BoxIcon, scad: false },
];
// Agents and saved snapshots may still use the tab names from the first inspector.
const TAB_ALIASES: Record<string, InspectorTab> = {
  parameters: "customize",
  model: "part",
  log: "part",
  tools: "markup",
  review: "markup",
};
export const inspectorTabs = (scad: boolean) =>
  TABS.filter((tab) => scad || !tab.scad).map((tab) => tab.id);
export const defaultInspectorTab = (scad: boolean): InspectorTab => (scad ? "customize" : "part");
/** Maps a current or legacy tab name to a tab this file has, or null when it has none. */
export function resolveInspectorTab(name: string | null | undefined, scad: boolean) {
  const tab = TAB_ALIASES[name ?? ""] ?? name;
  return inspectorTabs(scad).find((id) => id === tab) ?? null;
}

export type InspectorBadge = { tone: "primary" | "warning"; count: number | null };

export function InspectorTabs({
  active,
  onTab,
  scad,
  badges,
  onClose,
  expanded,
  onExpand,
}: {
  active: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  scad: boolean;
  badges: Partial<Record<InspectorTab, InspectorBadge>>;
  onClose: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const tabs = TABS.filter((tab) => scad || !tab.scad);
  const list = useSlidingThumb<HTMLDivElement>('[aria-selected="true"]', active);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "Home"
            ? 0
            : null;
    if (step === null && event.key !== "End") return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + step! + tabs.length) % tabs.length;
    onTab(tabs[next]!.id);
    event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
  };
  return (
    <>
      <button
        type="button"
        className={styles["model-grabber"]}
        aria-label={expanded ? "Show more of the model" : "Expand inspector"}
        onClick={onExpand}
      />
      <div className={styles["model-tabs"]}>
        <div
          ref={list}
          className={styles["model-tab-list"]}
          role="tablist"
          aria-label="Inspector sections"
          onKeyDown={move}
        >
          <span className={styles["model-tab-thumb"]} aria-hidden />
          {tabs.map(({ id, label, icon: Icon }) => {
            const badge = badges[id];
            return (
              <Tip key={id} label={label}>
                <button
                  type="button"
                  role="tab"
                  id={`model-tab-${id}`}
                  className={styles["model-tab"]}
                  aria-label={label}
                  aria-selected={active === id}
                  tabIndex={active === id ? 0 : -1}
                  onClick={() => onTab(id)}
                >
                  <Icon />
                  <span className={styles["model-tab-label"]}>{label}</span>
                  {badge && (
                    <span
                      className={styles["model-tab-badge"]}
                      data-tone={badge.tone}
                      data-dot={badge.count === null}
                    >
                      {badge.count}
                    </span>
                  )}
                </button>
              </Tip>
            );
          })}
        </div>
        <div className="flex-1" />
        <Tip label="Hide inspector" kbd="I">
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="Hide inspector"
            onClick={onClose}
          >
            <PanelRightCloseIcon />
          </Button>
        </Tip>
      </div>
    </>
  );
}

const AXES = ["Width", "Depth", "Height"] as const;
const OVER = ["wide", "deep", "tall"] as const;
const PLATE_GRID_MM = 50;

/** Top view of the part on the plate, to scale, plus a height gauge. */
function PlateFit({
  size,
  volume,
  fits,
}: {
  size: readonly number[];
  volume: readonly [number, number, number];
  fits: boolean;
}) {
  const [bx, by, bz] = volume;
  const pad = 6,
    width = Math.max(bx, size[0]!) + pad * 2,
    height = Math.max(by, size[1]!) + pad * 2;
  const ox = (width - bx) / 2,
    oy = (height - by) / 2;
  const tone = fits ? "var(--primary)" : "var(--warning)";
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let x = PLATE_GRID_MM; x < bx; x += PLATE_GRID_MM)
    lines.push({ key: `x${x}`, x1: ox + x, y1: oy, x2: ox + x, y2: oy + by });
  for (let y = PLATE_GRID_MM; y < by; y += PLATE_GRID_MM)
    lines.push({ key: `y${y}`, x1: ox, y1: oy + y, x2: ox + bx, y2: oy + y });
  const fill = Math.min(1, size[2]! / bz);
  return (
    <div className={styles["model-fit-body"]}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Top view of the part on the ${bx} by ${by} mm plate`}
      >
        <rect
          x={ox}
          y={oy}
          width={bx}
          height={by}
          rx={6}
          fill="var(--muted)"
          stroke="var(--border)"
          strokeWidth={1.5}
        />
        <g stroke="var(--border)" strokeWidth={0.8}>
          {lines.map(({ key, ...line }) => (
            <line key={key} {...line} />
          ))}
        </g>
        <rect
          x={ox + (bx - size[0]!) / 2}
          y={oy + (by - size[1]!) / 2}
          width={size[0]}
          height={size[1]}
          rx={2}
          fill={`color-mix(in oklab, ${tone} 26%, transparent)`}
          stroke={tone}
          strokeWidth={1.6}
        />
        <text x={ox + 8} y={oy + by - 9} fontSize={13} fill="var(--muted-foreground)">
          {bx} × {by} mm
        </text>
      </svg>
      <svg viewBox="0 0 38 120" role="img" aria-label={`Height ${size[2]!.toFixed(1)} of ${bz} mm`}>
        <rect
          x={11}
          y={2}
          width={16}
          height={104}
          rx={4}
          fill="var(--muted)"
          stroke="var(--border)"
        />
        <rect
          x={11}
          y={2 + 104 * (1 - fill)}
          width={16}
          height={104 * fill}
          rx={4}
          fill={`color-mix(in oklab, ${size[2]! > bz ? "var(--warning)" : "var(--primary)"} 55%, transparent)`}
        />
        <text x={19} y={118} fontSize={10} textAnchor="middle" fill="var(--muted-foreground)">
          {Math.round((size[2]! / bz) * 100)}%
        </text>
      </svg>
    </div>
  );
}

/** Chooses the printer for this environment. The plate and fit checks follow the saved setting. */
function PrinterMenu({
  environmentId,
  settings,
}: {
  environmentId: EnvironmentId;
  settings: ModelPreviewSettings;
}) {
  const canSave = useAtomValue(models.updateSettings.permissionAtom(environmentId));
  // Shows the choice while the save and settings refresh are in flight.
  const [pending, setPending] = useState<BuildPlatePresetId | null>(null);
  if (pending !== null && pending === settings.buildPlate.preset) setPending(null);
  const preset = pending ?? settings.buildPlate.preset;
  const choose = async (next: BuildPlatePresetId) => {
    if (next === preset) return;
    setPending(next);
    try {
      await runModelCommand(models.updateSettings, {
        environmentId,
        input: { ...settings, buildPlate: { ...settings.buildPlate, preset: next } },
      });
      appAtomRegistry.refresh(models.settings({ environmentId, input: {} }));
    } catch (error) {
      setPending(null);
      toastManager.add({
        type: "error",
        title: "Printer not changed",
        description: error instanceof Error ? error.message : "The setting could not be saved.",
      });
    }
  };
  const trigger = (
    <MenuTrigger
      disabled={!canSave}
      render={<Button variant="ghost-muted" size="xs" className="min-w-0" />}
    >
      <span className="truncate">{buildPlateLabel({ ...settings.buildPlate, preset })}</span>
      <ChevronsUpDownIcon />
    </MenuTrigger>
  );
  return (
    <Menu>
      {canSave ? (
        trigger
      ) : (
        <Tip label="This connection cannot change model settings.">
          <span className="min-w-0">{trigger}</span>
        </Tip>
      )}
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Printer</MenuGroupLabel>
          <MenuRadioGroup
            value={preset}
            onValueChange={(next: BuildPlatePresetId) => void choose(next)}
          >
            {buildPlateOptions(settings.buildPlate.customMm).map((option) => (
              <MenuRadioItem key={option.id} value={option.id} closeOnClick>
                <span className="flex items-center gap-2">
                  <span className="flex w-3.5 shrink-0">
                    <MenuRadioItemIndicator />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="ps-4 text-muted-foreground text-xs tabular-nums">
                    {option.volumeMm.join(" × ")}
                  </span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem render={<Link to="/settings/loom" />}>
          <Settings2Icon />
          Custom size and preview settings
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** Part tab: dimensions, build plate fit, mesh facts and the OpenSCAD render log. */
export function PartSection({
  environmentId,
  stats,
  settings,
  volume,
  render,
  format,
  path,
}: {
  environmentId: EnvironmentId;
  stats: ReturnType<typeof meshStats> | null;
  settings: ModelPreviewSettings;
  volume: readonly [number, number, number];
  render: ScadRenderResult | null;
  format: string;
  path: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const log = render?.log ?? [];
  const warnings = log.filter((line) => line.level === "warning" || line.level === "error").length;
  if (!stats)
    return (
      <div className={styles["model-inspector-scroll"]}>
        <div className="h-4" />
        <EmptyNote>Dimensions appear when the model loads.</EmptyNote>
      </div>
    );
  const over = stats.size.map((value, axis) => value - volume[axis]!);
  const fits = fitsBuildVolume(stats.size, volume);
  const rotated =
    !fits &&
    stats.size[0]! <= volume[1] &&
    stats.size[1]! <= volume[0] &&
    stats.size[2]! <= volume[2];
  const manifold = render?.summary?.manifold;
  return (
    <div className={styles["model-inspector-scroll"]}>
      <div className={styles["model-dims"]}>
        {stats.size.map((value, axis) => (
          <div key={AXES[axis]} className={styles["model-dim"]} data-over={over[axis]! > 1e-6}>
            <span>
              {AXES[axis]}
              <span>{"XYZ"[axis]}</span>
            </span>
            <strong>
              {value.toFixed(1)}
              <small>mm</small>
            </strong>
          </div>
        ))}
      </div>
      <div className={styles["model-fit"]}>
        <div className={styles["model-fit-head"]}>
          {fits ? (
            <Chip tone="success">
              <CheckIcon />
              Fits the plate
            </Chip>
          ) : (
            <Chip tone="warning">
              <TriangleAlertIcon />
              Too large
            </Chip>
          )}
          <div className="flex-1" />
          <PrinterMenu environmentId={environmentId} settings={settings} />
        </div>
        <PlateFit size={stats.size} volume={volume} fits={fits} />
        <p className={styles["model-fit-advice"]}>
          {fits ? (
            `${Math.min(...volume.map((value, axis) => value - stats.size[axis]!)).toFixed(0)} mm of clearance on the tightest axis.`
          ) : (
            <>
              <strong>
                {over
                  .flatMap((value, axis) =>
                    value > 1e-6 ? [`${value.toFixed(1)} mm too ${OVER[axis]}`] : [],
                  )
                  .join(", ")}
                .
              </strong>{" "}
              {rotated
                ? "It fits if you rotate it 90° on the plate."
                : "Split the part or choose a larger printer. You can still preview and capture it."}
            </>
          )}
        </p>
      </div>
      <dl className={styles["model-facts"]}>
        <dt>Triangles</dt>
        <dd>{stats.triangles.toLocaleString()}</dd>
        {manifold !== null && manifold !== undefined && (
          <>
            <dt>Mesh</dt>
            <dd>
              <Chip tone={manifold ? "success" : "warning"}>
                {manifold ? "Watertight" : "Not watertight"}
              </Chip>
            </dd>
          </>
        )}
        <dt>Format</dt>
        <dd>{format === "scad" ? "OpenSCAD source" : format.toUpperCase()}</dd>
        {render && (
          <>
            <dt>Last render</dt>
            <dd>
              {(render.durationMs / 1000).toFixed(2)} s{render.cached ? ", cached" : ""}
            </dd>
          </>
        )}
        <dt>File</dt>
        <Tip label={path}>
          <dd className="truncate">{path.split("/").at(-1)}</dd>
        </Tip>
      </dl>
      {format === "scad" && (
        <>
          <SectionHead title="Render log">
            {warnings > 0 && (
              <Chip tone="warning">
                {warnings} {warnings === 1 ? "issue" : "issues"}
              </Chip>
            )}
            <Tip label={isCopied ? "Copied" : "Copy log"}>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Copy render log"
                disabled={!log.length}
                onClick={() => copyToClipboard(log.map((line) => line.text).join("\n"))}
              >
                {isCopied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </Tip>
          </SectionHead>
          {log.length ? (
            <div className={styles["model-log"]}>
              {log.map((line, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- Immutable log snapshots can contain identical messages.
                <div key={index} data-level={line.level}>
                  {line.text}
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote>
              {render ? "No messages from the last render." : "Render messages appear here."}
            </EmptyNote>
          )}
        </>
      )}
    </div>
  );
}
