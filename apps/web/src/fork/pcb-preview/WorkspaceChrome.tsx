import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  BoxIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  CircuitBoardIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderSearchIcon,
  MoreHorizontalIcon,
  PackageOpenIcon,
  RefreshCwIcon,
  ScanIcon,
  Settings2Icon,
  ShieldOffIcon,
} from "lucide-react";
import type { PcbDesign, PcbListDesignsResult } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { OperationStatus } from "./OperationStatus";
import { ToolButton } from "./ToolButton";
import styles from "./workspace.module.css";

export type Surface = "schematic" | "pcb" | "3d";

const folderOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");
const kindLabel = (design: PcbDesign) => (design.kind === "kicad" ? "KiCad" : "tscircuit");

/** The document title doubles as the design switcher, like a file menu in a CAD tool. */
export function DesignMenu({
  design,
  listing,
  onSelect,
  onDiscover,
}: {
  design: PcbDesign;
  listing: PcbListDesignsResult;
  onSelect: (id: string) => void;
  onDiscover: () => void;
}) {
  const folder = folderOf(design.id);
  return (
    <Menu>
      <MenuTrigger
        render={<button type="button" className={styles.designTrigger} aria-label="Board design" />}
      >
        <span className={styles.designGlyph} data-kind={design.kind} aria-hidden="true">
          <CircuitBoardIcon />
        </span>
        <span className={styles.designName}>
          <strong>{design.name}</strong>
          <small>
            {kindLabel(design)}
            {folder ? ` · ${folder}` : ""}
          </small>
        </span>
        <ChevronDownIcon className={styles.chevron} aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <MenuGroupLabel>
            Designs in this workspace{listing.truncated ? " (list limited)" : ""}
          </MenuGroupLabel>
          {listing.designs.map((d) => (
            <MenuItem key={d.id} onClick={() => onSelect(d.id)}>
              {d.id === design.id ? <CheckIcon /> : <span className="size-4" aria-hidden="true" />}
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{d.name}</span>
                <span className="truncate text-muted-foreground text-xs">{d.id}</span>
              </span>
              <MenuShortcut>{kindLabel(d)}</MenuShortcut>
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={onDiscover}>
          <FolderSearchIcon />
          Find designs again
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

const SURFACES = [
  { id: "schematic", label: "Schematic", icon: FileTextIcon, key: "1" },
  { id: "pcb", label: "Board", icon: CircuitBoardIcon, key: "2" },
  { id: "3d", label: "3D", icon: BoxIcon, key: "3" },
] as const;
/** One switch for every way to look at the design; 3D is a view of the board, not a tool. */
export function SurfaceSwitch({
  active,
  available,
  onChoose,
}: {
  active: Surface;
  available: Record<Surface, boolean>;
  onChoose: (surface: Surface) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label="Drawing view">
      {SURFACES.map(({ id, label, icon: Icon, key }) => (
        <ToolButton
          key={id}
          className=""
          label={label}
          hint={`${label} (${key})`}
          aria-pressed={active === id}
          disabled={!available[id]}
          onClick={() => onChoose(id)}
        >
          <Icon aria-hidden="true" />
          <span className={styles.label}>{label}</span>
        </ToolButton>
      ))}
    </div>
  );
}

export function CaptureMenu({
  three,
  disabled,
  busy,
  onCapture,
}: {
  three: boolean;
  disabled: boolean;
  busy: boolean;
  onCapture: (full: boolean) => void;
}) {
  return (
    <div className={styles.split}>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => onCapture(false)}
        aria-label="Capture to draft"
      >
        <CameraIcon />
        <span className={styles.label}>{busy ? "Capturing" : "Capture"}</span>
      </Button>
      {!three && (
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                disabled={disabled || busy}
                aria-label="Capture options"
              />
            }
          >
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>Attach to draft</MenuGroupLabel>
              <MenuItem onClick={() => onCapture(false)}>
                <CameraIcon />
                Visible area
              </MenuItem>
              <MenuItem onClick={() => onCapture(true)}>
                <ScanIcon />
                Whole drawing
              </MenuItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}

export function WorkspaceMenu({
  canRefresh,
  electronicsUrl,
  canExport,
  trusted,
  onRefresh,
  onExport,
  onRevokeTrust,
}: {
  canRefresh: boolean;
  electronicsUrl: string | null;
  canExport: boolean;
  trusted: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onRevokeTrust: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<button className={styles.tool} aria-label="Design actions" />}>
        <MoreHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem disabled={!canRefresh} onClick={onRefresh}>
          <RefreshCwIcon />
          Rebuild preview
        </MenuItem>
        {electronicsUrl && (
          <MenuItem render={<a href={electronicsUrl} target="_blank" rel="noreferrer" />}>
            <ExternalLinkIcon />
            Open in Electronics
          </MenuItem>
        )}
        <MenuItem disabled={!canExport} onClick={onExport}>
          <PackageOpenIcon />
          Export board reference…
        </MenuItem>
        <MenuSeparator />
        {trusted && (
          <MenuItem onClick={onRevokeTrust}>
            <ShieldOffIcon />
            Stop running circuit code
          </MenuItem>
        )}
        <MenuItem render={<Link to="/settings/loom" />}>
          <Settings2Icon />
          PCB preview settings
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

const SHORTCUTS = [
  ["Schematic, Board, 3D", "1 / 2 / 3"],
  ["Select, Distance, Angle, Note", "V / M / A / N"],
  ["Free point without snapping", "Alt + click"],
  ["Pan", "Drag · Arrows"],
  ["Zoom", "Scroll · + / −"],
  ["Fit drawing", "F"],
  ["Tools panel", "I"],
  ["Cancel tool, then close panel", "Esc"],
] as const;
export function ShortcutHelp() {
  return (
    <Popover>
      <PopoverTrigger render={<button className={styles.tool} aria-label="Keyboard shortcuts" />}>
        <CircleHelpIcon />
      </PopoverTrigger>
      <PopoverPopup side="top" width="md">
        <PopoverTitle>Work with the drawing</PopoverTitle>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-xs">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{keys}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
          Shortcuts work while the PCB workspace is focused.
        </p>
      </PopoverPopup>
    </Popover>
  );
}

/** Centered canvas state for empty, blocked and failed designs. */
export function CanvasState({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.canvasState}>
      <div className={styles.stateCard}>
        <span className={styles.stateIcon} aria-hidden="true">
          {icon}
        </span>
        <h3>{title}</h3>
        {children}
        {actions && <div className={styles.stateActions}>{actions}</div>}
      </div>
    </div>
  );
}

export function ExportDialog({
  open,
  busy,
  onOpenChange,
  onExport,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (targetThreadId: string) => Promise<boolean>;
}) {
  const [target, setTarget] = useState("");
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Export board reference</DialogTitle>
          <DialogDescription>
            Saves the board as a GLB with mechanical metadata, for designing an enclosure. Paths are
            added to your draft; nothing is sent.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="flex flex-col gap-2 text-sm">
            Destination thread ID
            <Input
              value={target}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="This thread's workspace"
            />
          </label>
          {busy && (
            <OperationStatus
              label="Exporting board reference"
              detail="Saving real board geometry and revision metadata in the destination workspace."
            />
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void onExport(target.trim()).then((done) => {
                if (done) setTarget("");
              })
            }
          >
            Export
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
