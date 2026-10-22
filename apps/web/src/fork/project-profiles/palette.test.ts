import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
const actions = vi.hoisted(() => ({ open: vi.fn(), request: vi.fn() }));
vi.mock("./state", () => ({
  FEATURE: "project-profiles",
  openEnv: actions.open,
  requestProfileAction: actions.request,
}));
import { projectProfilesPaletteSource } from "./palette";
const threadRef = { environmentId: EnvironmentId.make("host"), threadId: ThreadId.make("thread") };
const profile = {
  projectId: ProjectId.make("project"),
  intents: ["test", "build"] as const,
  varlock: true,
  canRun: true,
};
it("offers only mapped varlock commands, gated by feature and terminal permission", async () => {
  const context = {
    activeThreadRef: threadRef,
    loomFeatures: ["project-profiles"],
    projectProfile: profile,
  };
  const items = projectProfilesPaletteSource.items(context);
  expect(items.map((item) => item.title)).toEqual([
    "Open project env",
    "Edit project profile",
    "Run test with varlock",
    "Run build with varlock",
  ]);
  const ids = items.map((item) => item.value);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => id.startsWith("action:loom:project-profiles:"))).toBe(true);
  for (const projectProfile of [
    { ...profile, varlock: false },
    { ...profile, canRun: false },
  ])
    expect(projectProfilesPaletteSource.items({ ...context, projectProfile }).length).toBe(2);
  expect(projectProfilesPaletteSource.items({ ...context, loomFeatures: [] })).toEqual([]);
  expect(projectProfilesPaletteSource.items({ ...context, activeThreadRef: null })).toEqual([]);
  const run = items.find((item) => item.value.endsWith("run-test"));
  if (run?.kind !== "action") throw new Error("Expected mapped command");
  await run.run();
  expect(actions.request).toHaveBeenLastCalledWith({ kind: "run", threadRef, intent: "test" });
  const edit = items.find((item) => item.value.endsWith(":edit"));
  if (edit?.kind !== "action") throw new Error("Expected profile editor");
  await edit.run();
  expect(actions.request).toHaveBeenLastCalledWith({
    kind: "edit",
    environmentId: threadRef.environmentId,
    projectId: profile.projectId,
  });
});
