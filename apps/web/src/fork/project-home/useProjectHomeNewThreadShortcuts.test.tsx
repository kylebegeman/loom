// @vitest-environment jsdom
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
} from "@t3tools/shared/keybindings";
import { useProjectHomeNewThreadShortcuts } from "./useProjectHomeNewThreadShortcuts";

const state = vi.hoisted(() => ({ keybindings: [] as typeof DEFAULT_RESOLVED_KEYBINDINGS }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.keybindings }));
vi.mock("~/state/server", () => ({ primaryServerKeybindingsAtom: {} }));
let renderer: ReactTestRenderer | null = null;
const start = vi.fn();
function Home({ action = start }: { action?: () => void }) {
  useProjectHomeNewThreadShortcuts(action);
  return null;
}
function press(key = "N", extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  window.dispatchEvent(event);
  return event;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  state.keybindings = DEFAULT_RESOLVED_KEYBINDINGS;
  start.mockClear();
  await act(async () => {
    renderer = create(<Home />);
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it.each(["N", "O"])(
  "handles the configured %s shortcut on Project home and prevents a browser window",
  (key) => {
    expect(press(key).defaultPrevented).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  },
);
it("uses the latest selected checkout action, and removes registration after leaving home", async () => {
  const selectedCheckout = vi.fn();
  await act(async () => renderer?.update(<Home action={selectedCheckout} />));
  expect(press().defaultPrevented).toBe(true);
  expect(selectedCheckout).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  await act(async () => renderer?.unmount());
  renderer = null;
  expect(press().defaultPrevented).toBe(false);
  expect(selectedCheckout).toHaveBeenCalledOnce();
});
it("follows customized bindings instead of hardcoding the default chord", async () => {
  state.keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+shift+x", command: "chat.newLocal" },
  ]);
  await act(async () => renderer?.update(<Home />));
  expect(press().defaultPrevented).toBe(false);
  expect(press("X").defaultPrevented).toBe(true);
  expect(start).toHaveBeenCalledOnce();
});
it.each([
  "[data-command-palette]",
  "[data-model-picker-content]",
  '[role="dialog"]',
  '[role="alertdialog"]',
])("yields while %s owns the interaction", (selector) => {
  const overlay = document.createElement("div");
  if (selector.startsWith("[role"))
    overlay.setAttribute("role", selector.includes("alertdialog") ? "alertdialog" : "dialog");
  else overlay.setAttribute(selector.slice(1, -1), "");
  document.body.append(overlay);
  expect(press().defaultPrevented).toBe(false);
  expect(start).not.toHaveBeenCalled();
});
it.each([{ repeat: true }, { isComposing: true }, { altKey: true }])(
  "ignores repeat, composition, and unrelated shortcuts: %j",
  (options) => {
    expect(press("N", options).defaultPrevented).toBe(false);
    expect(start).not.toHaveBeenCalled();
  },
);
it("respects keyboard events already consumed by a control", () => {
  const event = new KeyboardEvent("keydown", {
    key: "N",
    metaKey: true,
    shiftKey: true,
    cancelable: true,
  });
  event.preventDefault();
  window.dispatchEvent(event);
  expect(start).not.toHaveBeenCalled();
});

it("does not let a closed retained dialog disable Home shortcuts", () => {
  const closed = document.createElement("div");
  closed.setAttribute("role", "dialog");
  closed.setAttribute("data-closed", "");
  document.body.append(closed);
  expect(press().defaultPrevented).toBe(true);
  expect(start).toHaveBeenCalledOnce();
});
