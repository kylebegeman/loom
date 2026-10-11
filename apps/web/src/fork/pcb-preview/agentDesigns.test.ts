import { beforeEach, expect, it, vi } from "vite-plus/test";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, RunId, CheckpointId } from "@t3tools/contracts";
import { useRightPanelStore } from "~/rightPanelStore";
vi.mock("./state", () => ({ pcb: { loadTurnDesigns: {} } }));
vi.mock("../model-preview-3d/state", () => ({ runModelCommand: vi.fn() }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
import {
  applyAgentDesigns,
  openDesigns,
  hasPcbTab,
  mayAffectDesigns,
  pcbSurface,
  appendDismissedDesignTurn,
  parseDismissedDesignTurns,
} from "./agentDesigns";
const ref = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
  key = scopedThreadKey(ref);
beforeEach(() =>
  useRightPanelStore.setState({
    byThreadKey: {},
    userActionRevisionByThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
  }),
);
it("focus opens one tab, adds up to eight, and background preserves active surface and user revisions", () => {
  openDesigns(
    ref,
    ["a.kicad_pro", "a.kicad_pro", ...Array.from({ length: 10 }, (_, n) => `${n}.circuit.tsx`)],
    "focus",
  );
  const panel = useRightPanelStore.getState().byThreadKey[key]!;
  expect(panel.surfaces).toHaveLength(8);
  expect(panel.activeSurfaceId).toBe(pcbSurface("a.kicad_pro").id);
  expect(hasPcbTab(ref)).toBe(true);
  const revision = useRightPanelStore.getState().userActionRevisionByThreadKey[key];
  openDesigns(ref, ["other.kicad_pro"], "background");
  expect(useRightPanelStore.getState().byThreadKey[key]?.activeSurfaceId).toBe(
    panel.activeSurfaceId,
  );
  expect(useRightPanelStore.getState().userActionRevisionByThreadKey[key]).toBe(revision);
});
it("background cannot open a closed panel and automatic mode does not become a user action", () => {
  openDesigns(ref, ["a.kicad_pro"], "background");
  expect(hasPcbTab(ref)).toBe(false);
  const result = {
    runId: RunId.make("run"),
    checkpointId: CheckpointId.make("checkpoint"),
    turn: 1,
    truncated: false,
    designs: [
      {
        designId: "a.kicad_pro",
        name: "a",
        kind: "kicad" as const,
        reason: "written" as const,
        via: null,
      },
    ],
  };
  applyAgentDesigns(ref, result, "offer");
  expect(hasPcbTab(ref)).toBe(false);
  applyAgentDesigns(ref, result, "open");
  expect(hasPcbTab(ref)).toBe(true);
  expect(useRightPanelStore.getState().userActionRevisionByThreadKey[key]).toBeUndefined();
});
it("keeps real tab names, matches candidate assets and bounds device dismissals", () => {
  expect(pcbSurface("hw/board.kicad_pro").title).toBe("board");
  expect(pcbSurface("src/main.tsx").title).toBe("main");
  expect(mayAffectDesigns(["lib/part.ts", "sym-lib-table"])).toBe(true);
  expect(mayAffectDesigns(["asset.png"])).toBe(true);
  expect(mayAffectDesigns(["README.md"])).toBe(false);
  const keys = Array.from({ length: 205 }, (_, n) => `env:run${n}`);
  expect(parseDismissedDesignTurns(JSON.stringify(keys))).toHaveLength(200);
  expect(appendDismissedDesignTurn(keys, "env:run0").at(-1)).toBe("env:run0");
});
