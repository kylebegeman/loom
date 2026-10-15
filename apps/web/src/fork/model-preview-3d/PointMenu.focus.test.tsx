// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { PointMenu } from "./PointMenu";
import type { ContextPick } from "./viewer/createViewer";

const pick: ContextPick = {
  point: [20, 15, 40],
  world: [20, 15, 40],
  face: [0, 0, 1],
  worldFace: [0, 0, 1],
  x: 10,
  y: 10,
  stage: { left: 0, top: 0, width: 400, height: 300 },
};
let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Opens the menu over a focusable stand-in for the canvas; choosing Pin opens a note field. */
async function openMenu() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.appendChild(document.createElement("div"));
  const canvas = document.body.appendChild(document.createElement("canvas"));
  canvas.tabIndex = 0;
  function Harness() {
    const [open, setOpen] = useState(true);
    const [pinned, setPinned] = useState(false);
    return (
      <>
        <PointMenu
          pick={open ? pick : null}
          entries={[
            { action: "center", label: "Center view here" },
            { action: "pin", label: "Pin here" },
          ]}
          onAction={(action) => {
            setOpen(false);
            if (action === "pin") setPinned(true);
          }}
          onClose={() => setOpen(false)}
          returnFocus={() => canvas.focus()}
        />
        {pinned && <textarea aria-label="Note" autoFocus />}
      </>
    );
  }
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  await settle();
  return canvas;
}
const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
    (element) => element.textContent === label,
  )!;
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

it("gives focus back to the canvas after a clicked item", async () => {
  const canvas = await openMenu();
  await act(async () => item("Center view here").click());
  await settle();
  expect(document.querySelector("[data-point-menu]")).toBeNull();
  expect(document.activeElement).toBe(canvas);
});

it("leaves focus where a chosen action put it", async () => {
  await openMenu();
  await act(async () => item("Pin here").click());
  await settle();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Note");
});
