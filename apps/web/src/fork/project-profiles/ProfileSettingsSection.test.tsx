// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  defaultProjectProfile,
  type ProjectProfile,
  type ProjectProfileUpdate,
} from "@t3tools/contracts/fork";
const state = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn() }));
vi.mock("./state", () => ({
  FEATURE: "project-profiles",
  profiles: { update: "update", reset: "reset", profile: (input: unknown) => input },
  runProfileCommand: state.run,
  profileError: (error: unknown) => (error instanceof Error ? error.message : "Failed"),
}));
vi.mock("~/state/entities", () => ({ useProjects: () => [], useServerConfigs: () => new Map() }));
vi.mock("~/rpc/atomRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/rpc/atomRegistry")>();
  vi.spyOn(actual.appAtomRegistry, "refresh").mockImplementation(state.refresh);
  return actual;
});
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/settings/projects">{children}</a>,
}));
import { ProfileEditor } from "./ProfileSettingsSection";
const one = EnvironmentId.make("one");
const two = EnvironmentId.make("two");
const projectId = ProjectId.make("project");
const first: ProjectProfile = {
  ...defaultProjectProfile(projectId),
  agentNotes: "Notes on first computer.",
  budgets: { dailyTokens: 1000, threadTokens: 100 },
  commands: {
    test: { _tag: "command", command: "vp test first" },
    build: { _tag: "action", scriptId: "build" },
  },
};
const second: ProjectProfile = {
  ...first,
  agentNotes: "Notes on second computer.",
  budgets: { dailyTokens: 2000, threadTokens: 200 },
};
const record = (environmentId: EnvironmentId, profile: ProjectProfile, allowed = true) => ({
  environmentId,
  projectId,
  profile,
  label: environmentId === one ? "First" : "Second",
  allowed,
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.run.mockReset();
  state.refresh.mockReset();
  state.run.mockImplementation(
    async (
      _command,
      { environmentId, input }: { environmentId: EnvironmentId; input: ProjectProfileUpdate },
    ) => ({
      ...(environmentId === one ? first : second),
      ...input.patch,
      updatedAt: "2026-10-22T18:00:00Z",
    }),
  );
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
const field = (label: string) =>
  container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
const write = (label: string, value: string) =>
  act(() => {
    const input = field(label);
    const prototype =
      input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const render = (records = [record(one, first), record(two, second)]) =>
  act(() => root.render(<ProfileEditor records={records} />));
it("edits mixed notes and one budget across checkouts while preserving each untouched budget", async () => {
  render();
  expect(field("Agent notes").getAttribute("placeholder")).toBe("Mixed");
  write("Agent notes", "Shared private instructions.");
  write("Tokens per day for this project", "3000");
  await act(async () => button("Save profile").click());
  expect(state.run.mock.calls.map(([, request]) => request)).toEqual([
    {
      environmentId: one,
      input: {
        projectId,
        patch: {
          agentNotes: "Shared private instructions.",
          budgets: { dailyTokens: 3000, threadTokens: 100 },
        },
      },
    },
    {
      environmentId: two,
      input: {
        projectId,
        patch: {
          agentNotes: "Shared private instructions.",
          budgets: { dailyTokens: 3000, threadTokens: 200 },
        },
      },
    },
  ]);
  expect(field("Agent notes").value).toBe("Shared private instructions.");
  expect(button("Save profile").disabled).toBe(true);
  const changed = {
    ...first,
    agentNotes: "Updated from another client.",
    updatedAt: "2026-10-22T18:01:00Z",
  };
  render([record(one, changed)]);
  expect(field("Agent notes").value).toBe(changed.agentNotes);
});
it("retains a draft after a partial failure and respects permission loss on retry", async () => {
  state.run.mockImplementation(async (_command, { environmentId, input }) => {
    if (environmentId === two) throw new Error("Second is offline.");
    return { ...first, ...input.patch, updatedAt: "2026-10-22T18:00:00Z" };
  });
  render();
  write("Agent notes", "Keep after a partial save.");
  await act(async () => button("Save profile").click());
  expect(container.textContent).toContain("Saved on 1 of 2 checkouts.");
  expect(container.textContent).toContain("Second: Second is offline.");
  expect(field("Agent notes").value).toBe("Keep after a partial save.");
  render([record(one, first), record(two, second, false)]);
  expect(button("Save profile").disabled).toBe(true);
  expect(field("Agent notes").disabled).toBe(true);
  expect(state.run).toHaveBeenCalledTimes(2);
});
it("preserves other command mappings and prevents invalid token budgets", async () => {
  render([record(one, first)]);
  write("test literal command", "vp test focused");
  write("Tokens per thread", "-1");
  expect(button("Save profile").disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "positive whole token budgets",
  );
  expect(state.run).not.toHaveBeenCalled();
  write("Tokens per thread", "");
  await act(async () => button("Save profile").click());
  expect(state.run.mock.calls[0]?.[1].input.patch).toEqual({
    commands: {
      test: { _tag: "command", command: "vp test focused" },
      build: first.commands.build,
    },
    budgets: { dailyTokens: 1000, threadTokens: null },
  });
});
