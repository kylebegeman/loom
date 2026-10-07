import styles from "./workspace.module.css";
import type { ComponentProps, ReactNode } from "react";
import {
  BoxIcon,
  CameraIcon,
  ChevronDownIcon,
  FocusIcon,
  Grid2X2Icon,
  HandIcon,
  HelpCircleIcon,
  LayersIcon,
  OrbitIcon,
  PlusIcon,
  MinusIcon,
} from "lucide-react";
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
} from "~/components/ui/menu";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "~/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import type { NavigationMode } from "./viewer/createViewer";
import type { View } from "./viewer/views";

/** Feature-owned controls for the floating 3D tool shelves. */
export function ModelTool({
  label,
  children,
  ...props
}: ComponentProps<"button"> & { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" className={styles["model-tool"]} aria-label={label} {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
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
  onView,
  disabled,
}: {
  active: View | null;
  onView: (view: View) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles["model-floating"] + " " + styles["model-view-tools"]}>
      <Menu>
        <MenuTrigger
          render={
            <button
              className={styles["model-tool"]}
              aria-label="Camera views"
              disabled={disabled}
            />
          }
        >
          <BoxIcon />
          <span>{active ? VIEW_LABELS[active] : "Custom view"}</span>
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuGroup>
            <MenuGroupLabel>Camera</MenuGroupLabel>
            {(["iso", "front", "top", "right"] as const).map((view, index) => (
              <MenuItem key={view} onClick={() => onView(view)}>
                {VIEW_LABELS[view]}
                <span className="ml-auto text-xs text-muted-foreground">{index + 1}</span>
              </MenuItem>
            ))}
          </MenuGroup>
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
            </MenuCheckboxItem>
            <MenuSeparator />
            <MenuCheckboxItem checked={grid} onCheckedChange={onGrid}>
              Build plate grid
            </MenuCheckboxItem>
            <MenuCheckboxItem checked={axes} onCheckedChange={onAxes}>
              XYZ axes
            </MenuCheckboxItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}
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
      <ModelTool label="Orbit (O)" aria-pressed={mode === "orbit"} onClick={() => onMode("orbit")}>
        <OrbitIcon />
      </ModelTool>
      <ModelTool label="Pan (H)" aria-pressed={mode === "pan"} onClick={() => onMode("pan")}>
        <HandIcon />
      </ModelTool>
      <span className={styles["model-tool-divider"]} />
      <ModelTool label="Zoom out (-)" disabled={disabled} onClick={() => onZoom(1.2)}>
        <MinusIcon />
      </ModelTool>
      <ModelTool label="Zoom in (+)" disabled={disabled} onClick={() => onZoom(1 / 1.2)}>
        <PlusIcon />
      </ModelTool>
      <ModelTool label="Fit model (F)" disabled={disabled} onClick={onFit}>
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
            <dt className="text-muted-foreground">Orbit</dt>
            <dd>Drag · O</dd>
            <dt className="text-muted-foreground">Pan</dt>
            <dd>Right drag · H</dd>
            <dt className="text-muted-foreground">Zoom</dt>
            <dd>Scroll · + / −</dd>
            <dt className="text-muted-foreground">Fit model</dt>
            <dd>F</dd>
            <dt className="text-muted-foreground">Standard views</dt>
            <dd>1 / 2 / 3 / 4</dd>
            <dt className="text-muted-foreground">Inspector</dt>
            <dd>I</dd>
            <dt className="text-muted-foreground">Wireframe / grid / axes</dt>
            <dd>W / G / A</dd>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Keyboard controls work while the 3D workspace is focused. Pan mode makes dragging move
            the model.
          </p>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
export function CaptureMenu({
  disabled,
  capturing,
  onCapture,
}: {
  disabled: boolean;
  capturing: boolean;
  onCapture: (four: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
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
            <MenuGroupLabel>Attach to composer</MenuGroupLabel>
            <MenuItem onClick={() => onCapture(false)}>
              <CameraIcon />
              Current view
            </MenuItem>
            <MenuItem onClick={() => onCapture(true)}>
              <Grid2X2Icon />
              Four-view sheet
            </MenuItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}
