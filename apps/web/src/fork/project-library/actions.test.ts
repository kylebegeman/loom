import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  dropLibraryClone,
  onLibraryAction,
  onLibraryClone,
  openLibraryAction,
  requestLibraryClone,
  takeLibraryClone,
} from "./actions";

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

  it.each(["create-project", "import-folder"] as const)(
    "preserves the explicitly chosen computer before a project exists for %s",
    (action) => {
      vi.stubGlobal("window", new EventTarget());
      const listener = vi.fn();
      const unsubscribe = onLibraryAction(listener);
      const defaults = { environmentId: EnvironmentId.make("remote") };
      openLibraryAction(action, undefined, defaults);
      expect(listener).toHaveBeenCalledExactlyOnceWith(action, undefined, defaults);
      unsubscribe();
    },
  );

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

describe("cloning a project made from a Git URL", () => {
  it("is taken once, by the page of the project it names", () => {
    vi.stubGlobal("window", new EventTarget());
    const listener = vi.fn();
    const unsubscribe = onLibraryClone(listener);
    const laptop = EnvironmentId.make("laptop");
    requestLibraryClone("harbor", laptop);
    expect(listener).toHaveBeenCalledOnce();
    expect(takeLibraryClone("other")).toBeNull();
    expect(takeLibraryClone("harbor")).toEqual({ projectId: "harbor", hostId: laptop });
    expect(takeLibraryClone("harbor")).toBeNull();
    unsubscribe();
  });

  it("is dropped when its project's page closes before taking it", () => {
    vi.stubGlobal("window", new EventTarget());
    requestLibraryClone("harbor");
    dropLibraryClone("other");
    dropLibraryClone("harbor");
    expect(takeLibraryClone("harbor")).toBeNull();
  });
});
