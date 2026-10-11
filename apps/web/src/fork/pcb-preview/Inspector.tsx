import type { VariantRequest } from "./variantBatch";
import type { ReactNode } from "react";
import {
  ActivityIcon,
  BookmarkIcon,
  GitCompareArrowsIcon,
  LayersIcon,
  MessageSquareDotIcon,
  Maximize2Icon,
  Minimize2Icon,
  PackageIcon,
  RulerIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbDesign,
  PcbInspection,
  PcbLayerPreset,
  PcbLayerState,
  PcbPoint,
  PcbView,
  PcbWorkspace,
} from "@t3tools/contracts/fork";
import { SimulationEditor } from "./SimulationEditor";
import { ParameterEditor } from "./ParameterEditor";
import { RevisionCompare } from "./RevisionCompare";
import { HardwareLibrary } from "./HardwareLibrary";
import { InspectTab } from "./InspectTab";
import { LayersTab } from "./LayersTab";
import type { BoardStatsCardProps } from "./BoardStatsCard";
import { MarksTab, type MarkTool } from "./MarksTab";
import { ViewsTab } from "./ViewsTab";
import { EmptyState, Scroll } from "./InspectorKit";
import { ToolButton } from "./ToolButton";
import styles from "./workspace.module.css";

/** Tab names are also the agent-facing `open-tools` names, so keep them stable. */
export const INSPECTOR_TABS = [
  "Inspect",
  "Layers",
  "Checks",
  "Marks",
  "Views",
  "Compare",
  "Simulate",
  "Parameters",
  "Library",
  "Requests",
  "Fabrication",
  "Enclosure",
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];
const TAB_META: Record<
  InspectorTab,
  { icon: typeof LayersIcon; short: string; title: string; detail: string }
> = {
  Enclosure: {
    icon: PackageIcon,
    short: "Case",
    title: "Enclosure",
    detail: "Board case and mechanical fit",
  },
  Fabrication: {
    icon: PackageIcon,
    short: "Fab",
    title: "Fabrication",
    detail: "Manufacturing files and readiness checklist",
  },
  Requests: {
    icon: MessageSquareDotIcon,
    short: "Requests",
    title: "Change requests",
    detail: "Asks for the agent, pinned to parts",
  },
  Inspect: {
    icon: ScanSearchIcon,
    short: "Inspect",
    title: "Components & nets",
    detail: "Find parts, pins and connections",
  },
  Layers: {
    icon: LayersIcon,
    short: "Layers",
    title: "Layers",
    detail: "Visibility, opacity and saved combinations",
  },
  Checks: {
    icon: ShieldCheckIcon,
    short: "Checks",
    title: "Design checks",
    detail: "Electrical and board rules on the saved design",
  },
  Marks: {
    icon: RulerIcon,
    short: "Marks",
    title: "Measurements & notes",
    detail: "Pinned to the revision they were made on",
  },
  Views: {
    icon: BookmarkIcon,
    short: "Views",
    title: "Saved views",
    detail: "Return to a sheet, position and layer set",
  },
  Compare: {
    icon: GitCompareArrowsIcon,
    short: "Compare",
    title: "Compare revisions",
    detail: "Commits, checkpoints and the working tree",
  },
  Simulate: {
    icon: ActivityIcon,
    short: "Simulate",
    title: "Simulation",
    detail: "ngspice on this environment",
  },
  Parameters: {
    icon: SlidersHorizontalIcon,
    short: "Params",
    title: "Circuit parameters",
    detail: "Declared tscircuit values",
  },
  Library: {
    icon: PackageIcon,
    short: "Library",
    title: "Hardware library",
    detail: "References and owned parts on this environment",
  },
};
const NEEDS_EXECUTION: ReadonlySet<InspectorTab> = new Set([
  "Inspect",
  "Compare",
  "Simulate",
  "Enclosure",
]);

/** Only the sections that mean something for this kind of design. */
export function inspectorTabs(
  design: PcbDesign,
  features: readonly string[] = [],
): readonly InspectorTab[] {
  return INSPECTOR_TABS.filter((tab) =>
    tab === "Enclosure"
      ? features.includes("pcb-enclosure-fit") &&
        (design.kind === "tscircuit" || !!design.boardPath)
      : tab === "Layers"
        ? design.kind === "kicad" && !!design.boardPath
        : tab === "Checks"
          ? true
          : tab === "Parameters"
            ? design.kind === "tscircuit"
            : true,
  );
}
export function isInspectorTab(name: string | undefined): name is InspectorTab {
  return INSPECTOR_TABS.includes(name as InspectorTab);
}

/** The rail is the only way into the inspector, and it sits on the inspector's own edge. */
export function InspectorRail({
  tabs,
  active,
  executionAllowed,
  badges,
  onTab,
}: {
  tabs: readonly InspectorTab[];
  active: InspectorTab | null;
  executionAllowed: boolean;
  badges: Partial<Record<InspectorTab, { count: number; tone: "error" | "warning" }>>;
  onTab: (tab: InspectorTab | null) => void;
}) {
  return (
    <nav className={styles.rail} aria-label="PCB tools">
      {tabs.map((tab) => {
        const { icon: Icon, short, title } = TAB_META[tab],
          badge = badges[tab],
          locked = !executionAllowed && NEEDS_EXECUTION.has(tab);
        return (
          <div key={tab} className={styles.railItem} data-group={tab === "Compare" || undefined}>
            <ToolButton
              className={styles.railButton}
              side="left"
              label={
                badge && badge.count > 0
                  ? `${title}, ${badge.count} ${badge.count === 1 ? "issue" : "issues"}`
                  : title
              }
              hint={locked ? `${title} needs circuit code rendering` : title}
              aria-pressed={active === tab}
              disabled={locked}
              onClick={() => onTab(active === tab ? null : tab)}
            >
              <Icon aria-hidden="true" />
              <span>{short}</span>
              {badge && badge.count > 0 && (
                <span className={styles.railBadge} data-tone={badge.tone} aria-hidden="true">
                  {badge.count > 99 ? "99+" : badge.count}
                </span>
              )}
            </ToolButton>
          </div>
        );
      })}
    </nav>
  );
}

export function InspectorFrame({
  tab,
  expanded,
  onExpand,
  onClose,
  children,
  focusRef,
}: {
  focusRef?: React.Ref<HTMLElement>;
  tab: InspectorTab;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { icon: Icon, title, detail } = TAB_META[tab];
  return (
    <section ref={focusRef} className={styles.inspector} aria-label={title} tabIndex={-1}>
      <header className={styles.inspectorHeader}>
        <span className={styles.inspectorIcon} aria-hidden="true">
          <Icon />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
        <ToolButton
          className={`${styles.tool} ${styles.compactOnly}`}
          label={expanded ? "Show drawing" : "Expand tools"}
          onClick={onExpand}
        >
          {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
        </ToolButton>
        <ToolButton label="Close tools" hint="Close tools (I)" onClick={onClose}>
          <XIcon />
        </ToolButton>
      </header>
      <div className={styles.inspectorBody} role="region" aria-label={`${title} content`}>
        {children}
      </div>
    </section>
  );
}

export function ToolPanel({
  compareInitial,
  variantRequest,
  onVariantRequestConsumed,
  canSaveVariants,
  tab,
  requestPanel,
  onConvertNote,
  threadRef,
  design,
  inspection,
  executionAllowed,
  canSave,
  canSaveView,
  canMark,
  data,
  view,
  sourceHash,
  layers,
  selected,
  net,
  onPinMap,
  onSelect,
  onPin,
  onNet,
  onLayers,
  onPreset,
  onShowBoard,
  onTool,
  onFocusMark,
  mutate,
  onSaveView,
  onLoadView,
  canMeasure,
  measureDisabledReason,
  measuring,
  measureError,
  onMeasure,
  onOpenChecks,
  onDraft,
}: {
  canSaveVariants?: boolean;
  variantRequest?: VariantRequest | null;
  onVariantRequestConsumed?: () => void;
  compareInitial?: { from: string; to: string; key: string } | undefined;
  tab: Exclude<InspectorTab, "Checks">;
  requestPanel?: ReactNode;
  onConvertNote?: ((id: string) => void) | undefined;
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  inspection: PcbInspection | null;
  executionAllowed: boolean;
  canSave: boolean;
  canSaveView: boolean;
  canMark: boolean;
  data: PcbWorkspace;
  view: PcbView;
  sourceHash: string | null;
  layers: readonly PcbLayerState[];
  selected: string | null;
  net: string | null;
  onPinMap?: ((reference: string) => void) | undefined;
  onSelect: (reference: string | null) => void;
  onPin: (reference: string, pin: string) => void;
  onNet: (net: string | null) => void;
  onLayers: (layers: readonly PcbLayerState[]) => void;
  onPreset: (preset: PcbLayerPreset) => void;
  onShowBoard: () => void;
  onTool: (tool: MarkTool) => void;
  onFocusMark: (view: PcbView, sheet: string, point: PcbPoint) => void;
  mutate: (change: (data: PcbWorkspace) => PcbWorkspace) => Promise<unknown>;
  onSaveView: (name: string) => Promise<unknown>;
  onLoadView: (id: string) => void;
} & Omit<BoardStatsCardProps, "inspection" | "design">) {
  if (!executionAllowed && NEEDS_EXECUTION.has(tab))
    return (
      <Scroll>
        <EmptyState icon={<ShieldIcon />} title="Circuit code is not running">
          {TAB_META[tab].title} needs this tscircuit design to run. Allow circuit code from the
          drawing to continue.
        </EmptyState>
      </Scroll>
    );
  switch (tab) {
    case "Requests":
      return requestPanel ?? null;
    case "Inspect":
      return (
        <InspectTab
          inspection={inspection}
          selected={selected}
          net={net}
          onPinMap={onPinMap}
          onSelect={onSelect}
          onPin={onPin}
          onNet={onNet}
          design={design}
          canMeasure={canMeasure}
          measureDisabledReason={measureDisabledReason}
          measuring={measuring}
          measureError={measureError}
          onMeasure={onMeasure}
          onOpenChecks={onOpenChecks}
          onDraft={onDraft}
        />
      );
    case "Layers":
      return (
        <LayersTab
          inspection={inspection}
          view={view}
          layers={layers}
          data={data}
          canSave={canSave}
          onPreset={onPreset}
          onLayers={onLayers}
          onShowBoard={onShowBoard}
          mutate={mutate}
        />
      );
    case "Marks":
      return (
        <MarksTab
          onConvertNote={onConvertNote}
          data={data}
          sourceHash={sourceHash}
          canSave={canSave}
          canMark={canMark}
          onTool={onTool}
          onFocusMark={onFocusMark}
          mutate={mutate}
        />
      );
    case "Views":
      return (
        <ViewsTab
          data={data}
          sourceHash={sourceHash}
          canSave={canSave}
          canSaveView={canSaveView}
          onSaveView={onSaveView}
          onLoadView={onLoadView}
          mutate={mutate}
        />
      );
    case "Compare":
      return (
        <RevisionCompare
          initial={compareInitial}
          threadRef={threadRef}
          designId={design.id}
          onSelect={onSelect}
        />
      );
    case "Simulate":
      return (
        <SimulationEditor
          threadRef={threadRef}
          designId={design.id}
          data={data}
          canSave={canSave}
          onRemove={(id) =>
            mutate((d) => ({ ...d, simulations: d.simulations.filter((s) => s.id !== id) }))
          }
          onSave={(setup) =>
            mutate((d) => ({
              ...d,
              simulations: [...d.simulations.filter((s) => s.id !== setup.id), setup],
            }))
          }
        />
      );
    case "Parameters":
      return (
        <ParameterEditor
          key={JSON.stringify([threadRef.environmentId, threadRef.threadId, design.id])}
          threadRef={threadRef}
          designId={design.id}
          data={data}
          canSave={canSaveVariants ?? canSave}
          mutate={mutate}
          executionAllowed={executionAllowed}
          sourceHash={sourceHash}
          request={variantRequest}
          onRequestConsumed={onVariantRequestConsumed}
        />
      );
    case "Library":
      return <HardwareLibrary threadRef={threadRef} design={design} inspection={inspection} />;
  }
}
