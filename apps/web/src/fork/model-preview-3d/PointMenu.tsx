import { useMemo, useRef, type Ref } from "react";
import {
  CopyIcon,
  CrosshairIcon,
  MapPinIcon,
  Rotate3dIcon,
  RulerIcon,
  SliceIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
} from "~/components/ui/menu";
import { SCRUB_NAME_HINT, useNameScrub, type HoldRender } from "./controls";
import type { PointAction } from "./pointActions";
import { formatScrub, type ScrubRange } from "./scrub";
import type { ContextPick } from "./viewer/createViewer";

/** The menu's anchor stays this far inside the canvas edges. */
const EDGE_PX = 8;
const ICONS: Record<PointAction, LucideIcon> = {
  measure: RulerIcon,
  pin: MapPinIcon,
  center: CrosshairIcon,
  section: SliceIcon,
  layFlat: Rotate3dIcon,
  copy: CopyIcon,
};

/**
 * Where the point menu opens: anchored at the pick, held inside the canvas, and opening toward
 * the larger free side so it rarely needs to flip.
 */
export function pointMenuPlacement({ x, y, stage }: Pick<ContextPick, "x" | "y" | "stage">) {
  const clamp = (value: number, size: number) =>
    Math.min(Math.max(value, EDGE_PX), Math.max(EDGE_PX, size - EDGE_PX));
  const left = clamp(x, stage.width),
    top = clamp(y, stage.height);
  return {
    left: stage.left + left,
    top: stage.top + top,
    side: top > stage.height / 2 ? ("top" as const) : ("bottom" as const),
    align: left > stage.width / 2 ? ("end" as const) : ("start" as const),
  };
}

/** An analyzed parameter that moves the face under the menu. */
export type PointLink = { name: string; value: number; range: ScrubRange };
const NO_LINKS: readonly PointLink[] = [];

/**
 * A parameter that moves the picked face. Dragging the row sideways scrubs it, holding the
 * automatic render until release as the parameter's name does; a plain press shows it in
 * Customize.
 */
function LinkedParameter({
  link,
  itemRef,
  onFocus,
  onChange,
  onHold,
}: {
  link: PointLink;
  itemRef: Ref<HTMLDivElement> | undefined;
  onFocus: (name: string) => void;
  onChange: (name: string, value: number) => void;
  onHold: HoldRender;
}) {
  const scrub = useNameScrub({
    value: link.value,
    range: link.range,
    onChange: (value) => onChange(link.name, value),
    onHold,
  });
  return (
    <MenuItem
      ref={itemRef}
      closeOnClick={false}
      className="cursor-ew-resize touch-none"
      title={SCRUB_NAME_HINT}
      aria-label={`${link.name} ${formatScrub(link.value, link.range.step)}, show in Customize`}
      data-dragging={scrub.dragging || undefined}
      {...scrub.handlers}
      onClick={() => {
        // A drag ends in a click; only a plain press shows the parameter.
        if (!scrub.takeChanged()) onFocus(link.name);
      }}
    >
      <SlidersHorizontalIcon />
      <span className="font-mono">{link.name}</span>
      <small className="ms-auto text-muted-foreground tabular-nums">
        {formatScrub(link.value, link.range.step)}
      </small>
    </MenuItem>
  );
}

/**
 * Whether closing the point menu gives focus back to the canvas: after the keyboard dismisses it
 * or an item is chosen, unless the chosen action already moved focus somewhere of its own, such as
 * a pin's note. A click elsewhere keeps the focus it gave.
 */
function returnsFocus(closeType: string, chosen: boolean, active: Element | null): boolean {
  if (closeType !== "keyboard" && !chosen) return false;
  return (
    !active || active === active.ownerDocument.body || active.closest("[data-point-menu]") !== null
  );
}

/** The model's context menu at a picked point. Entries that would fail are not offered. */
export function PointMenu({
  pick,
  entries,
  onAction,
  onClose,
  returnFocus,
  links = NO_LINKS,
  onLinkFocus,
  onLinkChange,
  onLinkHold,
}: {
  pick: ContextPick | null;
  entries: readonly { action: PointAction; label: string }[];
  onAction: (action: PointAction, pick: ContextPick) => void;
  onClose: () => void;
  /** Gives focus back to the canvas when the keyboard dismisses the menu or an item is chosen. */
  returnFocus: () => void;
  /** Analyzed parameters that move the face under the pick. */
  links?: readonly PointLink[];
  onLinkFocus?: (name: string) => void;
  onLinkChange?: (name: string, value: number) => void;
  onLinkHold?: HoldRender;
}) {
  const first = useRef<HTMLDivElement>(null);
  const chosen = useRef(false);
  const placement = useMemo(() => (pick ? pointMenuPlacement(pick) : null), [pick]);
  const anchor = useMemo(
    () =>
      placement
        ? { getBoundingClientRect: () => new DOMRect(placement.left, placement.top, 0, 0) }
        : undefined,
    [placement],
  );
  return (
    <Menu
      open={pick !== null && (entries.length > 0 || links.length > 0)}
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) return;
        chosen.current = false;
        first.current?.focus();
      }}
    >
      <MenuPopup
        anchor={anchor}
        side={placement?.side ?? "bottom"}
        align={placement?.align ?? "start"}
        sideOffset={2}
        aria-label="Point actions"
        data-point-menu=""
        finalFocus={(closeType) => {
          if (returnsFocus(closeType, chosen.current, document.activeElement)) returnFocus();
          chosen.current = false;
          return false;
        }}
      >
        {entries.map(({ action, label }, index) => {
          const Icon = ICONS[action];
          return (
            <MenuItem
              key={action}
              ref={index === 0 ? first : undefined}
              onClick={() => {
                chosen.current = true;
                if (pick) onAction(action, pick);
              }}
            >
              <Icon />
              {label}
            </MenuItem>
          );
        })}
        {links.length > 0 && onLinkFocus && onLinkChange && onLinkHold && (
          <>
            {entries.length > 0 && <MenuSeparator />}
            <MenuGroup>
              <MenuGroupLabel>Moved by {links.map((link) => link.name).join(", ")}</MenuGroupLabel>
              {links.map((link, index) => (
                <LinkedParameter
                  key={link.name}
                  link={link}
                  itemRef={!entries.length && index === 0 ? first : undefined}
                  onFocus={(name) => {
                    onClose();
                    onLinkFocus(name);
                  }}
                  onChange={onLinkChange}
                  onHold={onLinkHold}
                />
              ))}
            </MenuGroup>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
