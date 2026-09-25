import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { ThreadInspector } from "./ThreadInspector";

export const INSPECTOR_TRIGGER_ATTRIBUTE = "data-loom-inspector-trigger";
const COMPACT_QUERY = "(max-width: 899px)";
const HEADER_GAP_PX = 4;

/**
 * The glance card, docked under the chat header at its right edge. Light dismissal: it closes
 * on a press outside it (the eye button excepted, so the button can toggle it), Escape, a
 * window resize, a header width change and after a row action. Height changes are ignored so
 * a streaming reply never closes it. Not a modal: no focus trap, no backdrop.
 */
export function InspectorCard({
  threadRef,
  header,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  header: HTMLElement;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Placed once: anything that would move the header closes the card instead.
  const [position] = useState(() => dockUnder(header));
  const compact = useMediaQuery(COMPACT_QUERY);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || cardRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`[${INSPECTOR_TRIGGER_ATTRIBUTE}]`)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    let width = header.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = header.getBoundingClientRect().width;
      if (next !== width) onClose();
      width = next;
    });
    observer.observe(header);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [header, onClose]);

  return createPortal(
    <div
      ref={cardRef}
      role="region"
      aria-label="Thread inspector"
      style={{ top: position.top, right: position.right }}
      className="dropdown-glass fixed z-40 flex w-[340px] max-w-[calc(100vw-1rem)] flex-col rounded-lg text-popover-foreground shadow-lg"
    >
      <div className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
        <ThreadInspector
          threadRef={threadRef}
          density={compact ? "compact" : "full"}
          onActionDone={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}

function dockUnder(header: HTMLElement): { top: number; right: number } {
  const rect = header.getBoundingClientRect();
  const paddingRight = Number.parseFloat(getComputedStyle(header).paddingRight) || 0;
  return { top: rect.bottom + HEADER_GAP_PX, right: window.innerWidth - rect.right + paddingRight };
}
