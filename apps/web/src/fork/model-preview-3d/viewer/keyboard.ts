import { isMacPlatform } from "@t3tools/shared/keybindings";
export const ORBIT_STEP = Math.PI / 12;
export const PAN_STEP = 0.1;
export type Nudge =
  | { kind: "orbit"; left: number; up: number }
  | { kind: "pan"; x: number; y: number };

/** Use the same arrow directions as OrbitControls without stealing other controls' keys. */
export function nudgeFor(key: string, shift: boolean): Nudge | null {
  const directions: Record<string, readonly [number, number]> = {
    ArrowLeft: [1, 0],
    ArrowRight: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  const direction = directions[key];
  if (!direction) return null;
  const [x, y] = direction;
  return shift
    ? { kind: "pan", x: x * PAN_STEP, y: y * PAN_STEP }
    : { kind: "orbit", left: x * ORBIT_STEP, up: y * ORBIT_STEP };
}

/**
 * The menu key or Shift+F10 opens the model's point menu, as in desktop apps. Callers apply it
 * only while the viewport itself has focus.
 */
export function opensPointMenu(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">,
) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/**
 * Cmd/Ctrl+Z undoes and Shift+Cmd/Ctrl+Z redoes; Ctrl+Y also redoes, as on Windows and Linux,
 * but Cmd+Y does not. Alt combinations are left alone and key repeat steps again. Callers skip
 * this while a text field has focus, so fields keep their own undo.
 */
export function undoShortcut(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">,
): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.metaKey) return "redo";
  return null;
}

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether focus is somewhere that edits text and so has its own undo. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as Element;
  if (element.closest("textarea, select, [contenteditable]:not([contenteditable=false])"))
    return true;
  const input = element.closest("input");
  return !!input && !NON_TEXT_INPUTS.has((input.getAttribute("type") ?? "text").toLowerCase());
}

/** Undo and redo shortcut labels as this platform writes them. */
export function undoKeys(mac: boolean) {
  return mac ? { mac, undo: "⌘Z", redo: "⇧⌘Z" } : { mac, undo: "Ctrl+Z", redo: "Ctrl+Shift+Z" };
}

/** This platform's undo and redo labels for tooltips and the shortcut help. */
export const UNDO_KEYS = undoKeys(
  typeof navigator !== "undefined" && isMacPlatform(navigator.platform),
);
