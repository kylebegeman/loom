import { describe, expect, it } from "vite-plus/test";

import { isPanelPickerDefaultShortcut, shouldOpenFromDefaultShortcut } from "./defaultShortcut";

const key = (overrides: Partial<KeyboardEventInit> & { code?: string } = {}) => ({
  key: '"',
  code: "Quote",
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  ...overrides,
});

describe("isPanelPickerDefaultShortcut", () => {
  it("matches cmd+shift+' on macOS, even when Shift produces a double quote", () => {
    expect(isPanelPickerDefaultShortcut(key({ metaKey: true }), "MacIntel")).toBe(true);
    expect(isPanelPickerDefaultShortcut(key({ metaKey: true, key: "'" }), "MacIntel")).toBe(true);
  });

  it("matches ctrl+shift+' elsewhere", () => {
    expect(isPanelPickerDefaultShortcut(key({ ctrlKey: true }), "Win32")).toBe(true);
    expect(isPanelPickerDefaultShortcut(key({ metaKey: true }), "Win32")).toBe(false);
  });

  it("rejects missing Shift, extra modifiers and other keys", () => {
    expect(isPanelPickerDefaultShortcut(key({ metaKey: true, shiftKey: false }), "MacIntel")).toBe(
      false,
    );
    expect(isPanelPickerDefaultShortcut(key({ metaKey: true, altKey: true }), "MacIntel")).toBe(
      false,
    );
    expect(isPanelPickerDefaultShortcut(key({ metaKey: true, ctrlKey: true }), "MacIntel")).toBe(
      false,
    );
    expect(
      isPanelPickerDefaultShortcut(key({ metaKey: true, key: ";", code: "Semicolon" }), "MacIntel"),
    ).toBe(false);
  });
});

describe("shouldOpenFromDefaultShortcut", () => {
  const base = {
    enabled: true,
    matches: true,
    defaultPrevented: false,
    repeat: false,
    paletteOpen: false,
    boundCommand: null,
    hasThread: true,
  };

  it("opens on a plain press in a thread", () => {
    expect(shouldOpenFromDefaultShortcut(base)).toBe(true);
  });

  it("yields to a user binding on the same key", () => {
    expect(shouldOpenFromDefaultShortcut({ ...base, boundCommand: "terminal.toggle" })).toBe(false);
    expect(shouldOpenFromDefaultShortcut({ ...base, boundCommand: "loom.panel-picker.open" })).toBe(
      false,
    );
  });

  it("stays off when disabled, repeated, handled, in the palette or without a thread", () => {
    for (const patch of [
      { enabled: false },
      { matches: false },
      { defaultPrevented: true },
      { repeat: true },
      { paletteOpen: true },
      { hasThread: false },
    ]) {
      expect(shouldOpenFromDefaultShortcut({ ...base, ...patch })).toBe(false);
    }
  });
});
