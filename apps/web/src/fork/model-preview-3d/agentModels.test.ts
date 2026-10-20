import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, RunId, CheckpointId } from "@t3tools/contracts";
import type { TurnModels } from "@t3tools/contracts/fork";
import { useRightPanelStore } from "~/rightPanelStore";
import { useClosedViewStore } from "~/closedViewStore";
import { useAgentModelMarks } from "./agentModelMarks";
const commands = vi.hoisted(() => ({ load: vi.fn(), toast: vi.fn() }));
vi.mock("./state", () => ({ models: { loadTurnModels: {} }, runModelCommand: commands.load }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: commands.toast } }));
import {
  addBackgroundModelTabs,
  applyAgentModels,
  appendDismissedModelTurn,
  hasModelTab,
  mayAffectModels,
  modelSurface,
  modelTurnDismissalKey,
  openLastAgentModels,
  openModels,
  openTurnModels,
  parseDismissedModelTurns,
  DISMISSED_MODEL_TURNS_KEY,
  useDismissedModelTurns,
} from "./agentModels";

const ref = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));
const key = scopedThreadKey(ref);
const other = scopeThreadRef(EnvironmentId.make("other"), ref.threadId);
function turn(paths = ["part.scad"]): TurnModels {
  return {
    threadId: ref.threadId,
    runId: RunId.make("run"),
    checkpointId: CheckpointId.make("checkpoint"),
    turn: 6,
    models: paths.map((path) => ({ path, format: "scad", reason: "written", via: null })),
    truncated: false,
  };
}
beforeEach(() => {
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
  useClosedViewStore.setState({ entries: [] });
  useAgentModelMarks.setState({ marks: {}, latest: {}, pickerTurn: {} });
  useDismissedModelTurns.setState({ keys: [] });
  vi.clearAllMocks();
});

describe("agent model opening", () => {
  it("recognizes previewable models and literal SCAD inputs while leaving code-only turns alone", () => {
    for (const path of [
      "part.STL",
      "bracket.scad",
      "outline.svg",
      "map.png",
      "data.json",
      "scene.GLB",
      "height.dat",
      "height.txt",
    ])
      expect(mayAffectModels([path])).toBe(true);
    expect(mayAffectModels(["code.ts", "Makefile", "notes.md"])).toBe(false);
    expect(mayAffectModels(["part.step", "bracket.b3d.py", "helper.py"])).toBe(true);
    expect(mayAffectModels([])).toBe(false);
  });
  it("names a model surface by its basename while retaining its workspace-relative id", () => {
    expect(modelSurface("parts/bracket.scad")).toEqual({
      id: "fork:model-preview-3d:parts/bracket.scad",
      kind: "fork",
      panelId: "model-preview-3d",
      resourceId: "parts/bracket.scad",
      title: "bracket.scad",
    });
  });
  it("does not add background tabs to a closed panel", () => {
    addBackgroundModelTabs(ref, ["part.scad"]);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(hasModelTab(ref)).toBe(false);
  });
  it("adds unique background tabs without changing active surface, visibility or user action revision", () => {
    openModels(ref, ["first.scad"], "focus");
    const previous = useRightPanelStore.getState();
    addBackgroundModelTabs(ref, ["first.scad", "next.scad", "next.scad"]);
    const current = useRightPanelStore.getState();
    expect(current.byThreadKey[key]!.surfaces.map((surface) => surface.id)).toEqual([
      modelSurface("first.scad").id,
      modelSurface("next.scad").id,
    ]);
    expect(current.byThreadKey[key]!.activeSurfaceId).toBe(modelSurface("first.scad").id);
    expect(current.userActionRevisionByThreadKey).toBe(previous.userActionRevisionByThreadKey);
    expect(current.threadPanelVisibilityByThreadKey).toBe(
      previous.threadPanelVisibilityByThreadKey,
    );
    expect(current.byThreadKey[scopedThreadKey(other)]).toBeUndefined();
    expect(hasModelTab(ref)).toBe(true);
  });
  it("focuses the first requested model and caps the turn at eight tabs", () => {
    openModels(
      ref,
      Array.from({ length: 12 }, (_, i) => `${i}.scad`),
      "focus",
    );
    const panel = useRightPanelStore.getState().byThreadKey[key]!;
    expect(panel.surfaces).toHaveLength(8);
    expect(panel.activeSurfaceId).toBe(modelSurface("0.scad").id);
  });
  it("routes a larger explicit turn to its filtered picker instead of silently losing models", () => {
    const result = turn(Array.from({ length: 12 }, (_, i) => `${i}.scad`));
    openTurnModels(ref, result);
    expect(useRightPanelStore.getState().byThreadKey[key]!.activeSurfaceId).toBe(
      "fork:model-preview-3d",
    );
    expect(useAgentModelMarks.getState().pickerTurn[key]).toBe(result.runId);
  });
});

describe("turn stream behavior", () => {
  it("offers only while closed, and treats a diff-only panel as closed for models", () => {
    applyAgentModels(ref, turn(), "offer");
    expect(useRightPanelStore.getState().byThreadKey[key]).toBeUndefined();
    useRightPanelStore.getState().open(ref, "diff");
    applyAgentModels(ref, turn(["second.scad"]), "offer");
    expect(useRightPanelStore.getState().byThreadKey[key]!.surfaces).toEqual([
      { id: "diff", kind: "diff" },
    ]);
    expect(useAgentModelMarks.getState().latest[key]!.models[0]!.path).toBe("second.scad");
  });
  it("keeps the active tab, marks changed tabs and new written models, and skips unseen dependencies", () => {
    openModels(ref, ["part.scad"], "focus");
    const original = turn(["part.scad", "new.scad", "unopened.scad"]);
    const result: TurnModels = {
      ...original,
      models: original.models.map((model, index) =>
        index === 2 ? { ...model, reason: "dependency", via: "gear.scad" } : model,
      ),
    };
    const revision = useRightPanelStore.getState().getUserActionRevision(ref);
    applyAgentModels(ref, result, "offer");
    const panel = useRightPanelStore.getState().byThreadKey[key]!;
    expect(panel.activeSurfaceId).toBe(modelSurface("part.scad").id);
    expect(panel.surfaces).toHaveLength(2);
    expect(useAgentModelMarks.getState().marks[key]).toEqual({
      "part.scad": { turn: 6 },
      "new.scad": { turn: 6 },
    });
    expect(
      useRightPanelStore
        .getState()
        .openProactive(ref, { kind: "diff", turnId: RunId.make("run") }, revision),
    ).toBe(true);
  });
  it("automatically opens a closed model panel while leaving proactive diff eligible", () => {
    const revision = useRightPanelStore.getState().getUserActionRevision(ref);
    applyAgentModels(ref, turn(["first.scad", "second.scad"]), "open");
    expect(useRightPanelStore.getState().byThreadKey[key]!.activeSurfaceId).toBe(
      modelSurface("first.scad").id,
    );
    expect(useAgentModelMarks.getState().marks[key]).toEqual({ "second.scad": { turn: 6 } });
    expect(
      useRightPanelStore
        .getState()
        .openProactive(ref, { kind: "diff", turnId: RunId.make("run") }, revision),
    ).toBe(true);
    expect(useRightPanelStore.getState().byThreadKey[key]!.activeSurfaceId).toBe("diff");
  });
  it("closes an existing floating panel on automatic open while retaining its inline preference", () => {
    useRightPanelStore.setState({
      threadPanelVisibilityByThreadKey: { [key]: { inlineOpen: false, popoverOpen: true } },
    });
    applyAgentModels(ref, turn(), "open");
    expect(useRightPanelStore.getState().threadPanelVisibilityByThreadKey[key]).toEqual({
      inlineOpen: false,
      popoverOpen: false,
    });
    expect(useRightPanelStore.getState().getUserActionRevision(ref)).toBe(0);
  });
  it("does nothing when disabled and rejects a stale event from another thread", () => {
    applyAgentModels(ref, turn(), "off");
    applyAgentModels(ref, { ...turn(), threadId: ThreadId.make("different") }, "open");
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
    expect(useAgentModelMarks.getState().latest).toEqual({});
  });
  it("clears marks independently by thread and path, keeping newer remembered turns", () => {
    const marks = useAgentModelMarks.getState();
    marks.mark(key, ["one.scad", "two.scad"], 6);
    marks.mark(scopedThreadKey(other), ["one.scad"], 2);
    marks.clear(key, "one.scad");
    expect(useAgentModelMarks.getState().marks[key]).toEqual({ "two.scad": { turn: 6 } });
    expect(useAgentModelMarks.getState().marks[scopedThreadKey(other)]).toEqual({
      "one.scad": { turn: 2 },
    });
    marks.remember(key, turn());
    marks.remember(key, { ...turn(), turn: 3 });
    expect(useAgentModelMarks.getState().latest[key]!.turn).toBe(6);
  });
});

describe("turn dismissal and last-turn action", () => {
  it("tolerates malformed browser data and caps persisted turn dismissals at 200 newest entries", () => {
    expect(parseDismissedModelTurns("invalid")).toEqual([]);
    expect(parseDismissedModelTurns('{"dismissed":true}')).toEqual([]);
    expect(parseDismissedModelTurns('["env:one",42,null,"env:one","env:two"]')).toEqual([
      "env:one",
      "env:two",
    ]);
    const keys = Array.from({ length: 205 }, (_, i) => `env:${i}`);
    const appended = appendDismissedModelTurn(keys, "env:0");
    expect(appended).toHaveLength(200);
    expect(appended.at(-1)).toBe("env:0");
    expect(parseDismissedModelTurns(JSON.stringify(appended))).toEqual(appended);
  });
  it("stores the environment/run dismissal key and keeps this session usable when storage is denied", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    const dismissed = modelTurnDismissalKey(ref.environmentId, RunId.make("run"));
    useDismissedModelTurns.getState().dismiss(dismissed);
    expect(setItem).toHaveBeenCalledWith(DISMISSED_MODEL_TURNS_KEY, '["env:run"]');
    setItem.mockImplementation(() => {
      throw new Error("Denied");
    });
    expect(() => useDismissedModelTurns.getState().dismiss("env:other")).not.toThrow();
    expect(useDismissedModelTurns.getState().keys).toEqual(["env:run", "env:other"]);
    vi.unstubAllGlobals();
  });
  it("shows useful empty and disconnected errors from the last-turn action", async () => {
    commands.load.mockResolvedValueOnce({ ...turn(), models: [] });
    await openLastAgentModels(ref);
    expect(commands.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The agent has not changed a model in this thread." }),
    );
    commands.load.mockRejectedValueOnce(new Error("Environment disconnected"));
    await openLastAgentModels(ref);
    expect(commands.toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "error", description: "Environment disconnected" }),
    );
  });
});
