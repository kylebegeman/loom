import styles from "./workspace.module.css";
import { Link } from "@tanstack/react-router";
import {
  BoxIcon,
  CheckIcon,
  ClockIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  XIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import type { ModelPreviewSettings, ScadRenderResult } from "@t3tools/contracts/fork";
import type { meshStats } from "./viewer/load";
import { buildPlateLabel, fitsBuildVolume } from "./buildPlate";
import { ModelTool } from "./WorkspaceTools";
export type InspectorTab =
  | "parameters"
  | "model"
  | "log"
  | "tools"
  | "views"
  | "variants"
  | "review";
export function InspectorHeader({
  active,
  onTab,
  onClose,
  scad,
  errors,
  expanded,
  onExpand,
}: {
  active: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  onClose: () => void;
  scad: boolean;
  errors: number;
  expanded: boolean;
  onExpand: () => void;
}) {
  return (
    <>
      <div className={styles["model-inspector-heading"]}>
        <h2>Inspector</h2>
        <ModelTool label="Hide inspector (I)" onClick={onClose}>
          <XIcon />
        </ModelTool>
      </div>
      <div className={styles["model-inspector-tabs"]} role="group" aria-label="Inspector sections">
        {scad && (
          <button
            className={styles["model-tool"]}
            aria-pressed={active === "parameters"}
            onClick={() => onTab("parameters")}
          >
            <SlidersHorizontalIcon />
            Parameters
          </button>
        )}
        <button
          className={styles["model-tool"]}
          aria-pressed={active === "model"}
          onClick={() => onTab("model")}
        >
          <BoxIcon />
          Model
        </button>
        {scad && (
          <button
            className={styles["model-tool"]}
            aria-pressed={active === "log"}
            onClick={() => onTab("log")}
          >
            <TerminalIcon />
            Log{errors > 0 && <span className="text-destructive-foreground">{errors}</span>}
          </button>
        )}
        {(["tools", "views", ...(scad ? ["variants"] : []), "review"] as InspectorTab[]).map(
          (tab) => (
            <button
              key={tab}
              className={styles["model-tool"]}
              aria-pressed={active === tab}
              onClick={() => onTab(tab)}
            >
              {tab[0]!.toUpperCase() + tab.slice(1)}
            </button>
          ),
        )}
        <span className={styles["model-compact-expand"]}>
          <ModelTool label={expanded ? "Show viewport" : "Expand inspector"} onClick={onExpand}>
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </ModelTool>
        </span>
      </div>
    </>
  );
}
export function GeometryInspector({
  stats,
  settings,
  volume,
  render,
  format,
}: {
  stats: ReturnType<typeof meshStats> | null;
  settings: ModelPreviewSettings;
  volume: readonly [number, number, number];
  render: ScadRenderResult | null;
  format: string;
}) {
  return (
    <div className={styles["model-inspector-scroll"]}>
      <div className={styles["model-inspector-page"]}>
        <h3 className={styles["model-section-title"]}>
          Dimensions <span className="font-normal text-muted-foreground">/ mm</span>
        </h3>
        {stats ? (
          <div className={styles["model-dimensions"]}>
            {stats.size.map((value, axis) => (
              <div key={["x", "y", "z"][axis]}>
                <span>{["Width · X", "Depth · Y", "Height · Z"][axis]}</span>
                <strong>{value.toFixed(2)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-5 text-xs text-muted-foreground">
            Dimensions appear when the model loads.
          </p>
        )}
        <dl className="mb-6">
          <div className={styles["model-property-row"]}>
            <dt>Triangles</dt>
            <dd>{stats?.triangles.toLocaleString() ?? "Not loaded"}</dd>
          </div>
          <div className={styles["model-property-row"]}>
            <dt>File format</dt>
            <dd>{format.toUpperCase()}</dd>
          </div>
          {render?.summary?.manifold !== null && render?.summary?.manifold !== undefined && (
            <div className={styles["model-property-row"]}>
              <dt>Manifold</dt>
              <dd className="flex items-center gap-1">
                {render.summary.manifold && <CheckIcon className="size-3" />}
                {render.summary.manifold ? "Yes" : "No"}
              </dd>
            </div>
          )}
        </dl>
        <h3 className={styles["model-section-title"]}>Build volume</h3>
        <div className={styles["model-notice"]}>
          <strong className="font-medium">{buildPlateLabel(settings.buildPlate)}</strong>
          <p className="mt-1 text-muted-foreground tabular-nums">{volume.join(" × ")} mm</p>
        </div>
        {stats && !fitsBuildVolume(stats.size, volume) && (
          <div className={styles["model-notice"] + " mt-3"} data-tone="warning">
            Larger than the {buildPlateLabel(settings.buildPlate)} build volume. You can still
            preview and capture it.
          </div>
        )}
        <Link
          to="/settings/loom"
          className="mt-3 inline-block text-xs text-muted-foreground underline underline-offset-4"
        >
          Change build plate in settings
        </Link>
        {render && (
          <>
            <h3 className={styles["model-section-title"] + " mt-6"}>Last render</h3>
            <dl>
              <div className={styles["model-property-row"]}>
                <dt>Duration</dt>
                <dd>{(render.durationMs / 1000).toFixed(2)} s</dd>
              </div>
              <div className={styles["model-property-row"]}>
                <dt>Source</dt>
                <dd>{render.cached ? "Cached result" : "OpenSCAD"}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
export function RenderLog({ render }: { render: ScadRenderResult | null }) {
  return (
    <div className={styles["model-inspector-scroll"]}>
      <div className={styles["model-inspector-page"]}>
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <ClockIcon className="size-3.5" />
          {render
            ? `${(render.durationMs / 1000).toFixed(2)} s${render.cached ? " · Cached" : ""}`
            : "No render yet"}
        </div>
        {!render?.log.length ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {render ? "No messages from the last render." : "Render messages will appear here."}
          </p>
        ) : (
          render.log.map((line, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- Immutable log snapshots can contain identical messages.
            <div key={index} className={styles["model-log-entry"]} data-level={line.level}>
              <span>{line.level}</span>
              <p>{line.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
