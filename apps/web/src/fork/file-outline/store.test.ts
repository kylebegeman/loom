import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createMemoryStorage } from "~/lib/storage";
import { createFileOutlineStore } from "./store";

const ref = scopeThreadRef(EnvironmentId.make("e"), ThreadId.make("t"));
const source = {
  threadRef: ref,
  path: "test.ts",
  contents: "export function a() {}",
  truncated: false,
};
describe("outline state", () => {
  it("persists only the preference, keeping file contents and focus requests out of storage", () => {
    const storage = createMemoryStorage();
    const store = createFileOutlineStore(storage);
    store.getState().publish("e:t", source);
    store.getState().toggle();
    expect(store.getState().focusRequestId).toBe(1);
    const reloaded = createFileOutlineStore(storage);
    expect(reloaded.getState().open).toBe(true);
    expect(reloaded.getState().sources).toEqual({});
    expect(reloaded.getState().focusRequestId).toBe(0);
    expect(storage.getItem("loom:file-outline:open:v1")).not.toContain(source.contents);
    store.getState().toggle();
    expect(store.getState().focusRequestId).toBe(1);
  });
  it("does not let an old file's cleanup unpublish its replacement", () => {
    const store = createFileOutlineStore(createMemoryStorage());
    store.getState().publish("e:t", source);
    store.getState().publish("e:t", { ...source, path: "other.ts" });
    store.getState().unpublish("e:t", "test.ts");
    expect(store.getState().sources["e:t"]?.path).toBe("other.ts");
    store.getState().unpublish("e:t", "other.ts");
    expect(store.getState().sources).toEqual({});
  });
  it("stays usable when browser storage throws", () => {
    const store = createFileOutlineStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    store.getState().toggle();
    expect(store.getState().open).toBe(true);
  });
});
