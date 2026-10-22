import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { LoomSettingsField } from "./parts";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("connects a visible field label and help text to its control", async () => {
  await act(() =>
    root.render(
      <LoomSettingsField label="Lane cap" description="Applies to new lanes.">
        <Input type="number" defaultValue={40} />
      </LoomSettingsField>,
    ),
  );
  const input = container.querySelector("input")!;
  const label = container.querySelector("label")!;
  await act(() => label.click());
  expect(document.activeElement).toBe(input);
  expect(input.labels?.[0]?.textContent).toBe("Lane cap");
  const descriptionId = input.getAttribute("aria-describedby")!;
  expect(document.getElementById(descriptionId)?.textContent).toBe("Applies to new lanes.");
});

it("preserves an existing label's control binding without nested labels", async () => {
  await act(() =>
    root.render(
      <LoomSettingsField label={<label htmlFor="vault-name">Name</label>}>
        <Input id="vault-name" />
      </LoomSettingsField>,
    ),
  );
  const input = container.querySelector("input")!;
  const label = container.querySelector("label")!;
  expect(container.querySelectorAll("label")).toHaveLength(1);
  expect(label.textContent).toBe("Name");
  await act(() => label.click());
  expect(document.activeElement).toBe(input);
});

it("associates textarea help without requiring a separate accessible name", async () => {
  await act(() =>
    root.render(
      <LoomSettingsField label="Repositories" description="One repository per line.">
        <Textarea />
      </LoomSettingsField>,
    ),
  );
  const textarea = container.querySelector("textarea")!;
  expect(textarea.labels?.[0]?.textContent).toBe("Repositories");
  expect(document.getElementById(textarea.getAttribute("aria-describedby")!)?.textContent).toBe(
    "One repository per line.",
  );
});
