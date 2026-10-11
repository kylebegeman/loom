import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { modelFormatOf, type AgentModelsMode, type TurnModels } from "@t3tools/contracts/fork";
import { create } from "zustand";
import { useRightPanelStore } from "~/rightPanelStore";
import { toastManager } from "~/components/ui/toast";
import { forkPanelSurface } from "../panels/registry";
import { useAgentModelMarks } from "./agentModelMarks";
import { models, runModelCommand } from "./state";

export const MAX_AGENT_MODEL_TABS = 8;
export const DISMISSED_MODEL_TURNS_KEY = "loom:model-follow-agent:dismissed:v1";
const MAX_DISMISSED_MODEL_TURNS = 200;
// Literal OpenSCAD inputs can change a part even when no model file was edited directly.
const SCAD_INPUT_EXTENSIONS = new Set([
  "scad",
  "stl",
  "off",
  "obj",
  "amf",
  "3mf",
  "dxf",
  "svg",
  "pdf",
  "json",
  "png",
  "dat",
  "txt",
]);

export function mayAffectModels(paths: readonly string[]): boolean {
  return paths.some((path) => {
    const format = modelFormatOf(path);
    return (
      (format !== null && format !== "step") ||
      SCAD_INPUT_EXTENSIONS.has(path.split(".").at(-1)?.toLowerCase() ?? "")
    );
  });
}

export function modelSurface(path: string) {
  return {
    ...forkPanelSurface("model-preview-3d", path),
    title: path.split(/[\\/]/).at(-1) ?? path,
  };
}

export function hasModelTab(threadRef: ScopedThreadRef): boolean {
  const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
  return (
    !!panel?.isOpen &&
    panel.surfaces.some(
      (surface) => surface.kind === "fork" && surface.panelId === "model-preview-3d",
    )
  );
}

export function addBackgroundModelTabs(threadRef: ScopedThreadRef, paths: readonly string[]) {
  const surfaces = [...new Set(paths)].slice(0, MAX_AGENT_MODEL_TABS).map(modelSurface);
  // Only an already-open panel can receive tabs without its visibility bookkeeping changing.
  // Automatic additions must not advance userActionRevision, which protects proactive diff.
  useRightPanelStore.setState((state) => {
    const key = scopedThreadKey(threadRef);
    const current = state.byThreadKey[key];
    if (!current?.isOpen) return state;
    const added = surfaces.filter(
      (surface) => !current.surfaces.some((entry) => entry.id === surface.id),
    );
    if (!added.length) return state;
    return {
      byThreadKey: {
        ...state.byThreadKey,
        [key]: { ...current, surfaces: [...current.surfaces, ...added] },
      },
    };
  });
}

/** Focus opens the first model as a user choice; all remaining models stay in the background. */
export function openModels(
  threadRef: ScopedThreadRef,
  paths: readonly string[],
  mode: "focus" | "background",
) {
  const selected = [...new Set(paths)].slice(0, MAX_AGENT_MODEL_TABS);
  if (!selected.length) return;
  if (mode === "focus") {
    useRightPanelStore.getState().openSurface(threadRef, modelSurface(selected[0]!));
    addBackgroundModelTabs(threadRef, selected.slice(1));
  } else addBackgroundModelTabs(threadRef, selected);
}

/** Auto-open is app state, so a later proactive diff remains eligible for this same turn. */
function openModelsAutomatically(threadRef: ScopedThreadRef, paths: readonly string[]) {
  const surfaces = [...new Set(paths)].slice(0, MAX_AGENT_MODEL_TABS).map(modelSurface);
  if (!surfaces.length) return;
  useRightPanelStore.setState((state) => {
    const key = scopedThreadKey(threadRef);
    const current = state.byThreadKey[key];
    const added = surfaces.filter(
      (surface) => !current?.surfaces.some((entry) => entry.id === surface.id),
    );
    const visibility = state.threadPanelVisibilityByThreadKey[key];
    let visibilityMap = state.threadPanelVisibilityByThreadKey;
    // Match the store's closed-to-open transition: close the floating panel, retain inline preference.
    if (!current?.isOpen && visibility?.popoverOpen) {
      visibilityMap = { ...visibilityMap };
      if (visibility.inlineOpen) delete visibilityMap[key];
      else visibilityMap[key] = { ...visibility, popoverOpen: false };
    }
    return {
      byThreadKey: {
        ...state.byThreadKey,
        [key]: {
          ...current,
          isOpen: true,
          activeSurfaceId: surfaces[0]!.id,
          surfaces: [...(current?.surfaces ?? []), ...added],
        },
      },
      threadPanelVisibilityByThreadKey: visibilityMap,
    };
  });
}

export function openTurnModels(threadRef: ScopedThreadRef, result: TurnModels) {
  if (result.threadId !== threadRef.threadId || !result.models.length) return;
  const state = useAgentModelMarks.getState();
  const key = scopedThreadKey(threadRef);
  if (result.models.length > MAX_AGENT_MODEL_TABS || result.truncated) {
    state.setPickerTurn(key, result.runId);
    useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("model-preview-3d"));
  } else
    openModels(
      threadRef,
      result.models.map((model) => model.path),
      "focus",
    );
}

/** One stream event affects only its own environment/thread and never focuses an open model panel. */
export function applyAgentModels(
  threadRef: ScopedThreadRef,
  result: TurnModels,
  mode: AgentModelsMode,
) {
  if (mode === "off" || result.threadId !== threadRef.threadId || !result.models.length) return;
  const key = scopedThreadKey(threadRef);
  const panel = useRightPanelStore.getState().byThreadKey[key];
  const openPaths = new Set(
    panel?.surfaces.flatMap((surface) =>
      surface.kind === "fork" && surface.panelId === "model-preview-3d" && surface.resourceId
        ? [surface.resourceId]
        : [],
    ),
  );
  const marked = result.models
    .filter((model) => openPaths.has(model.path))
    .map((model) => model.path);
  const state = useAgentModelMarks.getState();
  if (result.turn !== null && marked.length) state.mark(key, marked, result.turn);
  state.remember(key, result);
  if (hasModelTab(threadRef)) {
    const newPaths = result.models
      .filter((model) => model.reason === "written" && !openPaths.has(model.path))
      .map((model) => model.path);
    openModels(threadRef, newPaths, "background");
    if (result.turn !== null && newPaths.length)
      state.mark(key, newPaths.slice(0, MAX_AGENT_MODEL_TABS), result.turn);
  } else if (mode === "open") {
    openModelsAutomatically(
      threadRef,
      result.models.map((model) => model.path),
    );
    if (result.turn !== null)
      state.mark(
        key,
        result.models.slice(1, MAX_AGENT_MODEL_TABS).map((model) => model.path),
        result.turn,
      );
  }
}

export async function openLastAgentModels(threadRef: ScopedThreadRef) {
  try {
    const result = await runModelCommand(models.loadTurnModels, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, runId: null },
    });
    if (!result.models.length) {
      toastManager.add({
        type: "info",
        title: "The agent has not changed a model in this thread.",
      });
      return;
    }
    useAgentModelMarks.getState().remember(scopedThreadKey(threadRef), result);
    openTurnModels(threadRef, result);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Models from the last turn could not be opened",
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

export function parseDismissedModelTurns(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((key): key is string => typeof key === "string"))].slice(
          -MAX_DISMISSED_MODEL_TURNS,
        )
      : [];
  } catch {
    return [];
  }
}
export function appendDismissedModelTurn(keys: readonly string[], key: string): string[] {
  return [...keys.filter((item) => item !== key), key].slice(-MAX_DISMISSED_MODEL_TURNS);
}
export const modelTurnDismissalKey = (environmentId: EnvironmentId, runId: RunId) =>
  `${environmentId}:${runId}`;
function storedDismissals() {
  try {
    return parseDismissedModelTurns(
      globalThis.localStorage?.getItem(DISMISSED_MODEL_TURNS_KEY) ?? null,
    );
  } catch {
    return [];
  }
}
export const useDismissedModelTurns = create<{
  keys: string[];
  dismiss: (key: string) => void;
}>((set) => ({
  keys: storedDismissals(),
  dismiss: (key) =>
    set((state) => {
      const keys = appendDismissedModelTurn(state.keys, key);
      try {
        globalThis.localStorage?.setItem(DISMISSED_MODEL_TURNS_KEY, JSON.stringify(keys));
      } catch {
        /* Browser storage may be unavailable; this session still remembers dismissal. */
      }
      return { keys };
    }),
}));
