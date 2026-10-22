// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { VaultQueryFeedback } from "./SettingsFeedback";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("offers retry after a failed query without announcing perpetual loading", () => {
  const retry = vi.fn();
  const props = {
    loading: "Loading records…",
    error: "Records could not be loaded.",
    onRetry: retry,
  };
  act(() =>
    root.render(<VaultQueryFeedback {...props} result={{ _tag: "Failure", waiting: false }} />),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(props.error);
  expect(container.querySelector('[role="status"]')).toBeNull();
  const button = container.querySelector("button")!;
  act(() => button.click());
  expect(retry).toHaveBeenCalledOnce();

  act(() =>
    root.render(<VaultQueryFeedback {...props} result={{ _tag: "Failure", waiting: true }} />),
  );
  expect(button.disabled).toBe(true);
  act(() => button.click());
  expect(retry).toHaveBeenCalledOnce();

  act(() =>
    root.render(<VaultQueryFeedback {...props} result={{ _tag: "Success", waiting: false }} />),
  );
  expect(container.textContent).toBe("");
});

it("announces initial loading and refreshes, then clears feedback on success", () => {
  const props = { loading: "Loading records…", error: "Could not load records.", onRetry: vi.fn() };
  for (const result of [
    { _tag: "Initial", waiting: false },
    { _tag: "Success", waiting: true },
  ] as const) {
    act(() => root.render(<VaultQueryFeedback {...props} result={result} />));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(props.loading);
    expect(container.querySelector("button")).toBeNull();
  }
  act(() =>
    root.render(<VaultQueryFeedback {...props} result={{ _tag: "Success", waiting: false }} />),
  );
  expect(container.textContent).toBe("");
});
