import styles from "./workspace.module.css";
import { PrintCheckSection, type PrintCheckView } from "./PrintCheckSection";
import type { PrintFinding } from "@t3tools/contracts/fork";
import type { KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
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
import { useAtomValue } from "@effect/atom-react";
import { usePrinterLibrary } from "./printers";
import { PrintInspector } from "./PrintInspector";
import type { SlicingControl } from "./useSlicing";
import { ExportStep } from "./ExportStep";
import { models, modelUrl, runModelCommand } from "./state";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  singleZoneStrips,
  type ZoneRect,
  activeBed,
  selectBed,
  type DisplayUnits,
  type ModelPreviewSettings,
  type ScadRenderResult,
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
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { meshStats } from "./viewer/load";
import {
  bedGroups,
  buildPlateLabel,
  describeFit,
  describeZoneFit,
  fitPlate,
  resolvePlate,
  type BuildVolume,
} from "./buildPlate";
import { useBuildPlate } from "./BedPicker";
import { OrientationSection, type OrientationControls } from "./OrientationSection";
import { BedFitList } from "./BedFitList";
import { formatLength, formatLengths, useDisplayUnits } from "./units";
import { Chip, EmptyNote, SectionHead, Tip, useSlidingThumb } from "./controls";

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
const PLATE_GRID_MM = 50;

/** Top view of the part on the plate, to scale, plus a height gauge. */
function PlateFit({
  size,
  volume,
  fits,
  strips,
}: {
  size: readonly number[];
  volume: BuildVolume;
  fits: boolean;
  strips: readonly ZoneRect[];
}) {
  const units = useDisplayUnits();
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
  const fill = bz === null ? 0 : Math.min(1, size[2]! / bz);
  return (
    <div className={styles["model-fit-body"]}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Top view of the part on the ${formatLength(bx, units)} by ${formatLength(by, units)} plate`}
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
        {strips.map((strip) => (
          <rect
            key={`${strip.offsetMm.join()}-${strip.footprintMm.join()}`}
            x={ox + strip.offsetMm[0]}
            y={oy + by - strip.offsetMm[1] - strip.footprintMm[1]}
            width={strip.footprintMm[0]}
            height={strip.footprintMm[1]}
            fill="var(--model-zone-fill)"
          />
        ))}
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
          {formatLengths([bx, by], units, { trim: true })}
        </text>
      </svg>
      {bz !== null && (
        <svg
          viewBox="0 0 38 120"
          role="img"
          aria-label={`Height ${formatLength(size[2]!, units)} of ${formatLength(bz, units)}`}
        >
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
      )}
    </div>
  );
}

/** Chooses the bed for this environment. The plate and fit checks follow the saved setting. */
function PrinterMenu({
  environmentId,
  settings,
}: {
  environmentId: EnvironmentId;
  settings: ModelPreviewSettings;
}) {
  const units = useDisplayUnits();
  const { plate, canSave, save } = useBuildPlate(environmentId, settings);
  const library = usePrinterLibrary(environmentId);
  const trigger = (
    <MenuTrigger
      disabled={!canSave}
      render={<Button variant="ghost-muted" size="xs" className="min-w-0" />}
    >
      <span className="truncate">{buildPlateLabel(plate, library)}</span>
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
        <MenuRadioGroup
          value={activeBed(plate, { library }).id}
          onValueChange={(next: string) => void save(selectBed(plate, next, { library }))}
        >
          {bedGroups(plate, library).map((group) => (
            <MenuGroup key={group.label}>
              <MenuGroupLabel>{group.label}</MenuGroupLabel>
              {group.options.map((option) => (
                <MenuRadioItem key={option.id} value={option.id} closeOnClick>
                  <span className="flex items-center gap-2">
                    <span className="flex w-3.5 shrink-0">
                      <MenuRadioItemIndicator />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="ps-4 text-muted-foreground text-xs tabular-nums">
                      {formatLengths(option.volumeMm, units, { trim: true })}
                    </span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuGroup>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem render={<Link to="/settings/loom" />}>
          <Settings2Icon />
          Manage beds and preview settings
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export const DIMENSION_DELTA_MM = 0.05;

/** A signed size change, excluding float noise smaller than the displayed precision. */
export function dimensionDelta(current: number, previous: number, units: DisplayUnits = "mm") {
  const delta = current - previous;
  if (!Number.isFinite(delta) || Math.abs(delta) + 1e-9 < DIMENSION_DELTA_MM) return null;
  return (delta > 0 ? "+" : "−") + formatLength(Math.round(Math.abs(delta) * 1e9) / 1e9, units);
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
  previousSize,
  orientation,
  printCheck,
  slicing,
  threadRef,
  selectedFindingId,
  onFinding,
}: {
  environmentId: EnvironmentId;
  previousSize?: readonly [number, number, number] | null;
  orientation?: OrientationControls;
  printCheck?: PrintCheckView;
  slicing?: SlicingControl;
  threadRef?: ScopedThreadRef;
  selectedFindingId?: string | null;
  onFinding?: (finding: PrintFinding) => void;
  stats: ReturnType<typeof meshStats> | null;
  settings: ModelPreviewSettings;
  volume: BuildVolume;
  render: ScadRenderResult | null;
  format: string;
  path: string;
}) {
  const units = useDisplayUnits();
  const library = usePrinterLibrary(environmentId);
  const canExport = useAtomValue(models.exportStep.permissionAtom(environmentId));
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
  const plate = resolvePlate(settings.buildPlate, library);
  const result = fitPlate(stats.size, plate);
  const { fit, withinMm } = result;
  const zone = describeZoneFit(result, plate.zones, (mm) => formatLength(mm, units));
  const over = stats.size.map((value, axis) => {
    const limit = withinMm[axis];
    return limit === null || limit === undefined ? 0 : value - limit;
  });
  const fits = fit.status === "fits";
  const rotated = fit.status === "fits-rotated";
  const manifold =
    printCheck?.report && !printCheck.stale
      ? printCheck.report.summary.watertight
      : render?.summary?.manifold;
  const deltas = previousSize
    ? stats.size.map((value, axis) => dimensionDelta(value, previousSize[axis]!, units))
    : [];
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
              {formatLength(value, units, { unit: false })}
              <small>{units}</small>
            </strong>
            {deltas[axis] && previousSize && (
              <small
                className={styles["model-dim-delta"]}
                aria-label={`${"XYZ"[axis]} changed by ${value > previousSize[axis]! ? "plus" : "minus"} ${deltas[axis]!.slice(1)}`}
              >
                {deltas[axis]}
              </small>
            )}
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
              {rotated ? "Fits rotated" : "Too large"}
            </Chip>
          )}
          <div className="flex-1" />
          <PrinterMenu environmentId={environmentId} settings={settings} />
        </div>
        <PlateFit
          size={stats.size}
          volume={volume}
          fits={fits}
          strips={plate.showZones ? singleZoneStrips(plate.zones) : []}
        />
        <p className={styles["model-fit-advice"]}>
          {fits ? (
            `${formatLength(Math.min(...over.map((value, axis) => (withinMm[axis] === null ? Infinity : -value))), units, { digits: 0 })} of clearance on the tightest axis.`
          ) : rotated ? (
            "It fits if you rotate it 90° on the plate."
          ) : (
            <>
              <strong>{describeFit(fit, (mm) => formatLength(mm, units))}.</strong> Split the part
              or choose a larger bed. You can still preview and capture it.
            </>
          )}
          {zone ? ` ${zone.long}` : ""}
        </p>
      </div>
      <BedFitList environmentId={environmentId} settings={settings} size={stats.size} />
      {orientation && <OrientationSection {...orientation} />}
      {printCheck && (
        <PrintCheckSection
          check={printCheck}
          selectedId={selectedFindingId ?? null}
          onSelect={onFinding ?? (() => {})}
        />
      )}
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
        <dd>
          {format === "scad"
            ? "OpenSCAD source"
            : format === "build123d"
              ? "build123d source"
              : format.toUpperCase()}
        </dd>
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
      {slicing && (
        <PrintInspector environmentId={environmentId} slicing={slicing} format={format} />
      )}
      {format === "build123d" && threadRef && (
        <div className="px-3 py-2">
          <ExportStep
            canExport={canExport}
            filename={path.split("/").at(-1) ?? "model.b3d.py"}
            urlOf={(url) => modelUrl(environmentId, url)}
            onExport={() =>
              runModelCommand(models.exportStep, {
                environmentId,
                input: {
                  file: { threadId: threadRef.threadId, path },
                  overrides: {},
                  parameterSet: null,
                },
              })
            }
          />
        </div>
      )}
      {(format === "scad" || format === "build123d" || format === "step") && (
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
