import { expect, it } from "vite-plus/test";
import {
  isTextEntry,
  nudgeFor,
  opensPointMenu,
  ORBIT_STEP,
  PAN_STEP,
  undoKeys,
  undoShortcut,
} from "./keyboard";
it("maps arrows to the standard orbit directions and shifted arrows to viewport-relative pan", () => {
  for (const [key, x, y] of [
    ["ArrowLeft", 1, 0],
    ["ArrowRight", -1, 0],
    ["ArrowUp", 0, 1],
    ["ArrowDown", 0, -1],
  ] as const) {
    expect(nudgeFor(key, false)).toEqual({
      kind: "orbit",
      left: x * ORBIT_STEP,
      up: y * ORBIT_STEP,
    });
    expect(nudgeFor(key, true)).toEqual({ kind: "pan", x: x * PAN_STEP, y: y * PAN_STEP });
  }
  expect(nudgeFor("Left", false)).toBeNull();
  expect(nudgeFor("f", true)).toBeNull();
});

it("opens the point menu with the menu key or Shift+F10 and nothing else", () => {
  const press = (
    key: string,
    modifiers: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey", boolean>> = {},
  ) =>
    opensPointMenu({
      key,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...modifiers,
    });
  expect(press("ContextMenu")).toBe(true);
  expect(press("F10", { shiftKey: true })).toBe(true);
  expect(press("F10")).toBe(false);
  expect(press("ContextMenu", { ctrlKey: true })).toBe(false);
  expect(press("F10", { shiftKey: true, metaKey: true })).toBe(false);
  expect(press("k")).toBe(false);
});

it("undoes with Command or Control Z and redoes with Shift or Control Y", () => {
  const press = (
    key: string,
    modifiers: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey", boolean>> = {},
  ) =>
    undoShortcut({
      key,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...modifiers,
    });
  expect(press("z", { metaKey: true })).toBe("undo");
  expect(press("z", { ctrlKey: true })).toBe("undo");
  expect(press("Z", { metaKey: true, shiftKey: true })).toBe("redo");
  expect(press("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
  expect(press("y", { ctrlKey: true })).toBe("redo");
  expect(press("y", { metaKey: true })).toBeNull();
  expect(press("z")).toBeNull();
  expect(press("z", { ctrlKey: true, altKey: true })).toBeNull();
  expect(press("c", { metaKey: true })).toBeNull();
  expect(undoKeys(true)).toEqual({ mac: true, undo: "⌘Z", redo: "⇧⌘Z" });
  expect(undoKeys(false)).toEqual({ mac: false, undo: "Ctrl+Z", redo: "Ctrl+Shift+Z" });
});

it("leaves undo to text fields but not to sliders, switches or buttons", () => {
  const element = (matches: Record<string, string | null>) =>
    ({
      closest: (selector: string) =>
        selector === "input"
          ? "input" in matches
            ? { getAttribute: () => matches.input }
            : null
          : "text" in matches
            ? {}
            : null,
    }) as unknown as EventTarget;
  expect(isTextEntry(element({ input: null }))).toBe(true);
  expect(isTextEntry(element({ input: "number" }))).toBe(true);
  expect(isTextEntry(element({ input: "search" }))).toBe(true);
  expect(isTextEntry(element({ text: "textarea" }))).toBe(true);
  expect(isTextEntry(element({ input: "range" }))).toBe(false);
  expect(isTextEntry(element({ input: "checkbox" }))).toBe(false);
  expect(isTextEntry(element({}))).toBe(false);
  expect(isTextEntry(null)).toBe(false);
});
