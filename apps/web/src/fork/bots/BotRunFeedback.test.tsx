// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => ({ rate: vi.fn() }));
vi.mock("./state", () => ({ bots: { rateRun: "rate" } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => commands.rate }));

import { EnvironmentId } from "@t3tools/contracts";
import { BotRunFeedback } from "./BotRunFeedback";
import { makeBotRun } from "./testFixtures";

let root: Root;
let container: HTMLDivElement;
const environmentId = EnvironmentId.make("test");
const run = makeBotRun("a", { rating: "down", note: "Missed a null check." });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  commands.rate.mockReset();
  commands.rate.mockImplementation(async ({ input }) => ({
    _tag: "Success",
    value: { ...run, ...input },
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === text)!;
const writeNote = (text: string) => {
  const textarea = container.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      text,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const render = (canRate = true) =>
  act(() =>
    root.render(<BotRunFeedback environmentId={environmentId} run={run} canRate={canRate} />),
  );

it("saves and clears a note without losing the rating, before the run watch catches up", async () => {
  render();
  act(() => button("Edit note").click());
  writeNote("Missed the null check in parse.");
  await act(async () => button("Save note").click());
  expect(commands.rate).toHaveBeenLastCalledWith({
    environmentId,
    input: { runId: "a", rating: "down", note: "Missed the null check in parse." },
  });
  expect(container.textContent).toContain("Missed the null check in parse.");
  expect(button("Bad").getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector("textarea")).toBeNull();
  act(() => button("Edit note").click());
  writeNote("");
  await act(async () => button("Save note").click());
  expect(commands.rate).toHaveBeenLastCalledWith({
    environmentId,
    input: { runId: "a", rating: "down", note: null },
  });
  expect(button("Add note")).toBeTruthy();
});

it("keeps an unsaved draft while changing a rating and preserves the saved note on a toggle", async () => {
  render();
  act(() => button("Edit note").click());
  writeNote("Draft to keep.");
  await act(async () => button("Bad").click());
  expect(commands.rate).toHaveBeenLastCalledWith({
    environmentId,
    input: { runId: "a", rating: null, note: run.note },
  });
  expect(container.querySelector("textarea")?.value).toBe("Draft to keep.");
  await act(async () => button("Good").click());
  expect(commands.rate).toHaveBeenLastCalledWith({
    environmentId,
    input: { runId: "a", rating: "up", note: run.note },
  });
  await act(async () => button("Save note").click());
  expect(commands.rate).toHaveBeenLastCalledWith({
    environmentId,
    input: { runId: "a", rating: "up", note: "Draft to keep." },
  });
});

it("retains a failed note save for correction and honors permission loss", async () => {
  commands.rate.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Run no longer available.")),
  });
  render();
  act(() => button("Edit note").click());
  writeNote("Keep this after failure.");
  await act(async () => button("Save note").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Run no longer available.",
  );
  expect(container.querySelector("textarea")?.value).toBe("Keep this after failure.");
  render(false);
  expect(button("Save note").disabled).toBe(true);
  expect(button("Good").disabled).toBe(true);
  expect(container.querySelector("textarea")?.disabled).toBe(true);
  act(() => button("Cancel").click());
  expect(container.textContent).toContain(run.note);
  expect(commands.rate).toHaveBeenCalledOnce();
});

it("accepts newer feedback from the run watch after a local save", async () => {
  render();
  await act(async () => button("Good").click());
  const newer = { ...run, note: "Edited on another computer.", rating: null };
  act(() => root.render(<BotRunFeedback environmentId={environmentId} run={newer} canRate />));
  expect(container.textContent).toContain(newer.note);
  expect(button("Good").getAttribute("aria-pressed")).toBe("false");
});
