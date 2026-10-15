import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ContextPick } from "./viewer/createViewer";

type Props = { children?: ReactNode } & Record<string, unknown>;
// Plain stand-ins for the menu kit, so the test drives the linked rows themselves.
const { pass } = vi.hoisted(() => ({ pass: ({ children }: Props) => children ?? null }));
vi.mock("~/components/ui/menu", async () => {
  const { createElement } = await import("react");
  return {
    Menu: ({ open, children }: Props) => (open ? children : null),
    MenuPopup: pass,
    MenuGroup: pass,
    MenuGroupLabel: ({ children }: Props) => createElement("p", null, children),
    MenuSeparator: () => null,
    MenuItem: ({ children, closeOnClick: _c, ...props }: Props) =>
      createElement("div", { role: "menuitem", ...props }, children),
  };
});
import { PointMenu } from "./PointMenu";

const pick: ContextPick = {
  point: [20, 15, 40],
  world: [20, 15, 40],
  face: [0, 0, 1],
  worldFace: [0, 0, 1],
  x: 10,
  y: 10,
  stage: { left: 0, top: 0, width: 400, height: 300 },
};
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("offers the parameters that move the face: a drag scrubs, a plain press shows the parameter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls = { focus: vi.fn(), change: vi.fn(), hold: vi.fn(), close: vi.fn() };
  await act(async () => {
    renderer = create(
      <PointMenu
        pick={pick}
        entries={[]}
        onAction={() => undefined}
        onClose={calls.close}
        returnFocus={() => undefined}
        links={[{ name: "height", value: 40, range: { min: 10, max: 60, step: 0.5 } }]}
        onLinkFocus={calls.focus}
        onLinkChange={calls.change}
        onLinkHold={calls.hold}
      />,
    );
  });
  const text = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
  // The menu opens for links alone, under a group naming them.
  expect(text(renderer!.root.findByType("p"))).toBe("Moved by height");
  const row = () => renderer!.root.find((node) => node.props.role === "menuitem");
  expect(row().props["aria-label"]).toBe("height 40.0, show in Customize");
  const press = (x: number) =>
    row().props.onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: x,
      preventDefault: () => undefined,
      currentTarget: { setPointerCapture: () => undefined },
    });

  // Two steps of drag: 8 px at 4 px per step, held until release, and no focus on the click.
  await act(async () => press(0));
  await act(async () =>
    row().props.onPointerMove({ pointerId: 1, clientX: 8, shiftKey: false, altKey: false }),
  );
  await act(async () => row().props.onPointerUp());
  await act(async () => row().props.onClick());
  expect(calls.change).toHaveBeenCalledWith("height", 41);
  expect(calls.hold.mock.calls).toEqual([[true], [false]]);
  expect(calls.focus).not.toHaveBeenCalled();

  await act(async () => press(0));
  await act(async () => row().props.onPointerUp());
  await act(async () => row().props.onClick());
  expect(calls.focus).toHaveBeenCalledWith("height");
  expect(calls.close).toHaveBeenCalled();
});
