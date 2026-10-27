import { describe, expect, it } from "vite-plus/test";
import { forkTopicScope } from "./pages";

describe("forkTopicScope", () => {
  const search = { project: "loom", machine: "mac", checkout: "loom-main" };

  it("keeps the page scope where the page shows its scope picker", () => {
    const scope = forkTopicScope(search, true);
    expect(scope.search).toEqual(search);
    expect(scope.pick("mini")).toEqual({ project: "loom", machine: "mini" });
  });

  it("targets a computer alone on pages that hide their scope", () => {
    expect(forkTopicScope(search, false).search).toEqual({ machine: "mac" });
    expect(forkTopicScope({ project: "loom" }, false).search).toEqual({});
    expect(forkTopicScope(search, false).pick("mini")).toEqual({ machine: "mini" });
  });
});
