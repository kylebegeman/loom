import { describe, expect, it } from "vite-plus/test";
import { persistedQueryCacheKind } from "./pull-request-cache-store";
describe("persisted query cache ownership", () => {
  it("keeps library history outside PR expiry and eviction policy", () => {
    expect(
      persistedQueryCacheKind(JSON.stringify(["loom:library:history", { id: "archive" }])),
    ).toBe("project-library");
    expect(
      persistedQueryCacheKind(
        JSON.stringify(["pull-request:details", { title: "loom:library:history" }]),
      ),
    ).toBe("pull-request");
    expect(persistedQueryCacheKind("invalid")).toBe("pull-request");
  });
});
