import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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
