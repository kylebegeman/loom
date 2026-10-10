/** A mounted picker that can take a request: the empty-state launcher or the "+" button. */
export interface PanelPickerTarget {
  readonly kind: "launcher" | "button";
  readonly element: () => HTMLElement | null;
  readonly open: () => void;
}

const targets = new Set<PanelPickerTarget>();

export function registerPanelPickerTarget(target: PanelPickerTarget): () => void {
  targets.add(target);
  return () => targets.delete(target);
}

const isVisible = (element: HTMLElement | null) =>
  element !== null && element.isConnected && element.getClientRects().length > 0;

/**
 * Opens the visible picker: the empty-state launcher when the panel has no tabs, otherwise
 * the "+" popover. False when none is mounted yet (the panel is still opening).
 */
export function requestPanelPicker(): boolean {
  const visible = [...targets].filter((target) => isVisible(target.element()));
  const target =
    visible.find((entry) => entry.kind === "launcher") ??
    visible.find((entry) => entry.kind === "button");
  target?.open();
  return target !== undefined;
}
