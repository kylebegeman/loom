import { RegistryContext } from "@effect/atom-react";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const storage = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("expo-file-system", () => ({
  Directory: class {
    create() {}
  },
  File: class {
    exists = true;
    text() {
      return storage.read();
    }
  },
  Paths: { document: "documents" },
}));
vi.mock("../../lib/atomic-file", () => ({ writeFileAtomically: storage.write }));

import { appAtomRegistry } from "../../state/atom-registry";
import { usePullRequestReviewDraft } from "./usePullRequestReviewDraft";

it("recovers from restore and save failures without losing review feedback", async () => {
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
  const container = {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(container as unknown as HTMLElement);
  const harness: { store?: ReturnType<typeof usePullRequestReviewDraft> } = {};
  const readStore = () => {
    if (!harness.store) throw new Error("Review draft hook is not mounted");
    return harness.store;
  };
  function Probe() {
    const current = usePullRequestReviewDraft({
      environmentId: "environment",
      projectId: "project",
      repository: "owner/repo",
      number: 1,
    });
    useEffect(() => {
      harness.store = current;
    }, [current]);
    return null;
  }
  storage.read.mockRejectedValueOnce(new Error("Temporarily unavailable"));
  try {
    await act(async () => {
      root.render(
        <RegistryContext.Provider value={appAtomRegistry}>
          <Probe />
        </RegistryContext.Provider>,
      );
    });
    expect(readStore().ready).toBe(false);
    expect(readStore().error).toContain("Could not restore");
    expect(await readStore().flush()).toBe(false);
    storage.read.mockResolvedValueOnce('{"version":1,"drafts":{}}');
    await act(async () => {
      await readStore().retry();
    });
    expect(readStore().ready).toBe(true);
    expect(readStore().error).toBeNull();
    act(() => readStore().update((draft) => ({ ...draft, summary: "Keep my feedback" })));
    storage.write.mockRejectedValueOnce(new Error("Storage full"));
    await act(async () => {
      expect(await readStore().flush()).toBe(false);
    });
    expect(readStore().draft.summary).toBe("Keep my feedback");
    expect(readStore().error).toContain("could not be saved");

    storage.write.mockResolvedValueOnce(undefined);
    await act(async () => {
      expect(await readStore().flush()).toBe(true);
    });
    expect(readStore().error).toBeNull();
    expect(JSON.parse(storage.write.mock.calls.at(-1)![1]).drafts).toEqual({
      '["environment","project","","owner/repo",1]': {
        summary: "Keep my feedback",
        comment: "",
        comments: [],
      },
    });
    expect(await readStore().flush()).toBe(true);
    expect(storage.write).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
