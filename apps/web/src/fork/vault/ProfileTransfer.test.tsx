// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("~/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/utils")>()),
  randomUUID: vi.fn(),
}));
vi.mock("~/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("~/components/ui/textarea", () => ({
  Textarea: (props: { value: string; readOnly: boolean }) => <textarea {...props} />,
}));
import { VaultRequirementExport } from "./ProfileTransfer";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps portable requirements selectable when clipboard access is unavailable", async () => {
  vi.stubGlobal("navigator", {});
  act(() =>
    root.render(
      <VaultRequirementExport
        profile={{
          id: "a".repeat(32),
          label: "Development",
          bindings: [{ name: "code", kind: "git", itemId: null, repository: null }],
        }}
      />,
    ),
  );
  act(() =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Copy requirements")!
      .click(),
  );
  await act(async () => {});
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "Copy unavailable. Select and copy the declaration above.",
  );
  expect(container.querySelector("textarea")?.value).toContain('"code"');
});
