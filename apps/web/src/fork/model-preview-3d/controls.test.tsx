// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ScadParameter } from "@t3tools/contracts/fork";
import { ParameterRow, focusParameterControl } from "./controls";

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("focuses a changed parameter's control rather than its reset button", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const parameter: ScadParameter = {
    name: "height",
    kind: "number",
    defaultValue: "10",
    group: "",
    description: null,
    range: null,
    options: null,
  };
  const onChange = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ParameterRow parameter={parameter} value="14" baseline="10" onChange={onChange} />,
    ),
  );
  const row = container.querySelector("[data-parameter='height']");
  expect(row?.querySelector("button[aria-label='Reset Height']")).not.toBeNull();
  focusParameterControl(row);
  const focused = document.activeElement as HTMLElement | null;
  expect(focused?.getAttribute("aria-label")).not.toBe("Reset Height");
  expect(focused?.closest("[data-parameter-control]")).not.toBeNull();
  // Enter on the focused control must not reset the value.
  await act(async () => focused?.click());
  expect(onChange).not.toHaveBeenCalledWith("10");
});
