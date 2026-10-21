import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { onLibraryAction, openLibraryAction } from "./actions";

afterEach(() => vi.unstubAllGlobals());

describe("project actions before Library connection", () => {
  it("opens the custom flow even when browser storage is unavailable", () => {
    const browser = new EventTarget();
    Object.defineProperty(browser, "localStorage", {
      get: () => {
        throw new Error("Storage denied");
      },
    });
    vi.stubGlobal("window", browser);
    const listener = vi.fn();
    const unsubscribe = onLibraryAction(listener);
    expect(openLibraryAction("create-project")).toBe(true);
    expect(listener).toHaveBeenCalledExactlyOnceWith("create-project");
    unsubscribe();
    openLibraryAction("import-folder");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("carries source defaults for one launch and keeps the next regular form blank", () => {
    vi.stubGlobal("window", new EventTarget());
    const listener = vi.fn();
    const unsubscribe = onLibraryAction(listener);
    const defaults = {
      environmentId: EnvironmentId.make("computer"),
      workingCopyId: "files",
      resourceId: "web",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "source-model",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
      runtimeMode: "auto" as const,
      interactionMode: "plan" as const,
    };
    openLibraryAction("new-conversation", "project", defaults);
    expect(listener).toHaveBeenLastCalledWith("new-conversation", "project", defaults);
    openLibraryAction("new-conversation");
    expect(listener).toHaveBeenLastCalledWith("new-conversation");
    unsubscribe();
  });

  it("routes project, import and conversation intents through one host", () => {
    vi.stubGlobal("window", new EventTarget());
    const listener = vi.fn();
    const unsubscribe = onLibraryAction(listener);
    for (const action of ["create-project", "import-folder", "new-conversation"] as const) {
      expect(openLibraryAction(action)).toBe(true);
      expect(listener).toHaveBeenLastCalledWith(action);
    }
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
