import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { LibraryPaletteDialog, LibraryPaletteView } from "./LibraryPalette";
import { LibraryTextPalette } from "./LibraryTextPalette";

vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => DEFAULT_RESOLVED_KEYBINDINGS,
}));
const selected = vi.fn();
const back = vi.fn();
const closed = vi.fn();
let root: Root;
let container: HTMLDivElement;

function Palette() {
  const [query, setQuery] = useState("");
  return (
    <LibraryPaletteDialog title="Setup" onClose={closed}>
      <LibraryPaletteView
        title="Choose"
        placeholder="Search choices..."
        query={query}
        onQueryChange={setQuery}
        onBack={back}
        onClose={closed}
        items={[
          {
            id: "disabled",
            title: "Offline computer",
            disabled: true,
            select: () => selected("offline"),
          },
          { id: "first", title: "Alpha", select: () => selected("alpha") },
          { id: "second", title: "Beta", terms: ["repository"], select: () => selected("beta") },
        ]}
      />
    </LibraryPaletteDialog>
  );
}
const input = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Search choices..."]')!;
async function press(key: string) {
  await act(() =>
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
}
async function type(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  selected.mockClear();
  back.mockClear();
  closed.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<Palette />));
  await act(() => vi.advanceTimersToNextFrame());
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await vi.runOnlyPendingTimersAsync();
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("keeps focus in the original palette and executes the highlighted enabled row once", async () => {
  expect(document.activeElement).toBe(input());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await press("ArrowDown");
  await press("Enter");
  expect(selected).toHaveBeenCalledExactlyOnceWith("beta");
});
it("searches connection metadata and resets selection when the search changes", async () => {
  await type("repository");
  await press("Enter");
  expect(selected).toHaveBeenLastCalledWith("beta");
  await type("");
  await press("Enter");
  expect(selected.mock.calls).toEqual([["beta"], ["alpha"]]);
});
it("uses empty Backspace and Escape for Back without closing the popup or submitting", async () => {
  await type("missing");
  await press("Enter");
  expect(selected).not.toHaveBeenCalled();
  await press("Backspace");
  expect(back).not.toHaveBeenCalled();
  await type("");
  await press("Backspace");
  await press("Escape");
  expect(back).toHaveBeenCalledTimes(2);
  expect(closed).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
});

function TextEditor() {
  const [value, setValue] = useState("");
  return (
    <LibraryPaletteDialog title="Project brief" onClose={closed}>
      <LibraryTextPalette
        title="Project brief"
        value={value}
        onChange={setValue}
        onBack={back}
        onClose={closed}
      />
    </LibraryPaletteDialog>
  );
}
it("keeps multiline editing inside the palette and returns without treating Enter as selection", async () => {
  await act(() => root.render(<TextEditor />));
  await act(() => vi.advanceTimersToNextFrame());
  const editor = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Project brief"]',
  )!;
  expect(document.activeElement).toBe(editor);
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      editor,
      "First line\nSecond line",
    );
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(back).not.toHaveBeenCalled();
  await act(() =>
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(back).toHaveBeenCalledOnce();
  expect(closed).not.toHaveBeenCalled();
  expect(editor.value).toBe("First line\nSecond line");
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
});
