import styles from "./workspace.module.css";
import { Fragment, type ComponentProps, type ReactNode } from "react";
import {
  BookmarkIcon,
  CameraIcon,
  ChevronDownIcon,
  FlipHorizontal2Icon,
  FocusIcon,
  Grid2X2Icon,
  HandIcon,
  HelpCircleIcon,
  LayersIcon,
  MapPinIcon,
  OrbitIcon,
  PlusIcon,
  MinusIcon,
  Rotate3dIcon,
  RulerIcon,
  SliceIcon,
  XIcon,
} from "lucide-react";
import type { ModelCapturePreset, ModelSavedView, ModelSection } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuCheckboxItem,
  MenuSeparator,
  MenuGroupLabel,
  MenuGroup,
  MenuShortcut,
} from "~/components/ui/menu";
import { Kbd } from "~/components/ui/kbd";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "~/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import type { NavigationMode } from "./viewer/createViewer";
import type { View } from "./viewer/views";
import { Scrub, Segmented } from "./controls";

/** Feature-owned controls for the floating 3D tool shelves. */
export function ModelTool({
  label,
  kbd,
  side,
  children,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" className={styles["model-tool"]} aria-label={label} {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side={side}>
        <span className="flex items-center gap-2">
          {label}
          {kbd && <Kbd>{kbd}</Kbd>}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
export const VIEW_LABELS: Record<View, string> = {
  iso: "Isometric",
  front: "Front",
  top: "Top",
  right: "Right",
};
export function ViewTools({
  active,
  savedViews,
  activeViewId,
  onView,
  onSavedView,
  onSaveView,
  disabled,
}: {
  active: View | null;
  savedViews: readonly ModelSavedView[];
  activeViewId: string | null;
  onView: (view: View) => void;
  onSavedView: (view: ModelSavedView) => void;
  onSaveView: () => void;
  disabled: boolean;
}) {
  const label = active
    ? VIEW_LABELS[active]
    : (savedViews.find((view) => view.id === activeViewId)?.name ?? "Custom view");
  return (
    <div className={styles["model-floating"] + " " + styles["model-view-tools"]}>
      <Menu>
        <MenuTrigger
          render={
            <button
              className={styles["model-tool"]}
              aria-label={`Camera view: ${label}`}
              disabled={disabled}
            />
          }
        >
          <Rotate3dIcon />
          <span>{label}</span>
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuGroup>
            <MenuGroupLabel>Standard</MenuGroupLabel>
            {(["iso", "front", "top", "right"] as const).map((view, index) => (
              <MenuItem key={view} onClick={() => onView(view)}>
                <Rotate3dIcon />
                {VIEW_LABELS[view]}
                <MenuShortcut>{index + 1}</MenuShortcut>
              </MenuItem>
            ))}
          </MenuGroup>
          {savedViews.length > 0 && (
            <MenuGroup>
              <MenuGroupLabel>Saved</MenuGroupLabel>
              {savedViews.map((view) => (
                <MenuItem key={view.id} onClick={() => onSavedView(view)}>
                  <BookmarkIcon />
                  <span className="truncate">{view.name}</span>
                </MenuItem>
              ))}
            </MenuGroup>
          )}
          <MenuSeparator />
          <MenuItem onClick={onSaveView}>
            <PlusIcon />
            Save current view
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
export function DisplayTools({
  wireframe,
  grid,
  axes,
  onWireframe,
  onGrid,
  onAxes,
}: {
  wireframe: boolean;
  grid: boolean;
  axes: boolean;
  onWireframe: (value: boolean) => void;
  onGrid: (value: boolean) => void;
  onAxes: (value: boolean) => void;
}) {
  return (
    <div className={styles["model-floating"] + " " + styles["model-display-tools"]}>
      <Menu>
        <MenuTrigger
          render={<button className={styles["model-tool"]} aria-label="Display options" />}
        >
          <LayersIcon />
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>Display</MenuGroupLabel>
            <MenuCheckboxItem checked={wireframe} onCheckedChange={onWireframe}>
              Wireframe
              <MenuShortcut>W</MenuShortcut>
            </MenuCheckboxItem>
            <MenuCheckboxItem checked={grid} onCheckedChange={onGrid}>
              Build plate
              <MenuShortcut>G</MenuShortcut>
            </MenuCheckboxItem>
            <MenuCheckboxItem checked={axes} onCheckedChange={onAxes}>
              Axes
              <MenuShortcut>A</MenuShortcut>
            </MenuCheckboxItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}
const HELP = [
  ["Orbit", "Drag, O"],
  ["Pan", "Middle or right drag, H"],
  ["Zoom", "Scroll, + and −"],
  ["Fit model", "F"],
  ["Standard views", "1 to 4"],
  ["Measure, annotate", "M, N"],
  ["Section plane", "S"],
  ["Wireframe, plate, axes", "W, G, A"],
  ["Inspector", "I"],
] as const;
export function NavigationTools({
  mode,
  onMode,
  onFit,
  onZoom,
  disabled,
}: {
  mode: NavigationMode;
  onMode: (mode: NavigationMode) => void;
  onFit: () => void;
  onZoom: (factor: number) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={styles["model-floating"] + " " + styles["model-navigation-tools"]}
      role="group"
      aria-label="Viewport navigation"
    >
      <ModelTool
        label="Orbit"
        kbd="O"
        side="top"
        aria-pressed={mode === "orbit"}
        onClick={() => onMode("orbit")}
      >
        <OrbitIcon />
      </ModelTool>
      <ModelTool
        label="Pan"
        kbd="H"
        side="top"
        aria-pressed={mode === "pan"}
        onClick={() => onMode("pan")}
      >
        <HandIcon />
      </ModelTool>
      <span className={styles["model-tool-divider"]} />
      <ModelTool
        label="Zoom out"
        kbd="−"
        side="top"
        disabled={disabled}
        onClick={() => onZoom(1.2)}
      >
        <MinusIcon />
      </ModelTool>
      <ModelTool
        label="Zoom in"
        kbd="+"
        side="top"
        disabled={disabled}
        onClick={() => onZoom(1 / 1.2)}
      >
        <PlusIcon />
      </ModelTool>
      <ModelTool label="Fit model" kbd="F" side="top" disabled={disabled} onClick={onFit}>
        <FocusIcon />
      </ModelTool>
      <span className={styles["model-tool-divider"]} />
      <Popover>
        <PopoverTrigger
          render={<button className={styles["model-tool"]} aria-label="Navigation help" />}
        >
          <HelpCircleIcon />
        </PopoverTrigger>
        <PopoverPopup side="top" width="sm">
          <PopoverTitle>Navigate the model</PopoverTitle>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs">
            {HELP.map(([action, keys]) => (
              <Fragment key={action}>
                <dt className="text-muted-foreground">{action}</dt>
                <dd>{keys}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Shortcuts work while the 3D workspace is focused. Pan mode makes a plain drag move the
            model.
          </p>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
export function CaptureMenu({
  disabled,
  capturing,
  sheets,
  onCapture,
  onSheet,
}: {
  disabled: boolean;
  capturing: boolean;
  sheets: readonly ModelCapturePreset[];
  onCapture: (four: boolean) => void;
  onSheet: (sheet: ModelCapturePreset) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        disabled={disabled || capturing}
        onClick={() => onCapture(false)}
        aria-label="Capture view to composer"
      >
        <CameraIcon />
        <span className={styles["model-action-label"]}>{capturing ? "Capturing" : "Capture"}</span>
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              disabled={disabled || capturing}
              aria-label="Capture options"
            />
          }
        >
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>Attach to the composer</MenuGroupLabel>
            <MenuItem onClick={() => onCapture(false)}>
              <CameraIcon />
              Current view
            </MenuItem>
            <MenuItem onClick={() => onCapture(true)}>
              <Grid2X2Icon />
              Four-view sheet
            </MenuItem>
          </MenuGroup>
          {sheets.length > 0 && (
            <MenuGroup>
              <MenuGroupLabel>Review sheets</MenuGroupLabel>
              {sheets.map((sheet) => (
                <MenuItem key={sheet.id} onClick={() => onSheet(sheet)}>
                  <Grid2X2Icon />
                  <span className="truncate">{sheet.name}</span>
                </MenuItem>
              ))}
            </MenuGroup>
          )}
        </MenuPopup>
      </Menu>
    </div>
  );
}
export type PickTool = "measure" | "annotate";
/** Vertical rail for the tools that act on the model itself. */
export function ToolRail({
  tool,
  section,
  disabled,
  onTool,
  onSection,
}: {
  tool: PickTool | null;
  section: boolean;
  disabled: boolean;
  onTool: (tool: PickTool) => void;
  onSection: () => void;
}) {
  return (
    <div
      className={styles["model-floating"] + " " + styles["model-rail"]}
      role="toolbar"
      aria-label="Viewport tools"
      aria-orientation="vertical"
    >
      <ModelTool
        label="Measure"
        kbd="M"
        side="right"
        disabled={disabled}
        aria-pressed={tool === "measure"}
        onClick={() => onTool("measure")}
      >
        <RulerIcon />
      </ModelTool>
      <ModelTool
        label="Annotate for the agent"
        kbd="N"
        side="right"
        disabled={disabled}
        aria-pressed={tool === "annotate"}
        onClick={() => onTool("annotate")}
      >
        <MapPinIcon />
      </ModelTool>
      <span className={styles["model-tool-divider"]} />
      <ModelTool
        label="Section plane"
        kbd="S"
        side="right"
        disabled={disabled}
        aria-pressed={section}
        onClick={onSection}
      >
        <SliceIcon />
      </ModelTool>
    </div>
  );
}
const AXES = [
  { value: "x", label: "X" },
  { value: "y", label: "Y" },
  { value: "z", label: "Z" },
] as const;
/** Section plane controls, shown over the viewport while a section is active. */
export function SectionStrip({
  section,
  bounds,
  onChange,
  onRemove,
}: {
  section: ModelSection;
  /** Model extent along the current axis, in millimetres. */
  bounds: { min: number; max: number };
  onChange: (section: ModelSection) => void;
  onRemove: () => void;
}) {
  const range = { min: Math.floor(bounds.min), max: Math.ceil(bounds.max), step: 0.5 };
  return (
    <div
      className={styles["model-floating"] + " " + styles["model-section-strip"]}
      role="group"
      aria-label="Section plane"
    >
      <div className={styles["model-section-axis"]}>
        <Segmented
          label="Section axis"
          options={AXES}
          value={section.axis}
          onChange={(axis) => onChange({ ...section, axis })}
        />
      </div>
      <input
        type="range"
        aria-label="Section offset"
        min={range.min}
        max={range.max}
        step={range.step}
        value={section.offset}
        onChange={(event) => onChange({ ...section, offset: Number(event.target.value) })}
      />
      <div className={styles["model-section-value"]}>
        <Scrub
          value={section.offset}
          range={range}
          label="Section offset"
          unit="mm"
          onChange={(offset) => onChange({ ...section, offset })}
        />
      </div>
      <ModelTool
        label="Keep the other side"
        aria-pressed={section.flipped}
        onClick={() => onChange({ ...section, flipped: !section.flipped })}
      >
        <FlipHorizontal2Icon />
      </ModelTool>
      <ModelTool label="Remove section" kbd="S" onClick={onRemove}>
        <XIcon />
      </ModelTool>
    </div>
  );
}
/** Instruction shown while a picking tool waits for a click on the model. */
export function ToolHint({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  return (
    <div className={styles["model-hint"]} role="status">
      <span>{children}</span>
      <Kbd>Esc</Kbd>
      <Button variant="ghost-muted" size="xs" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
