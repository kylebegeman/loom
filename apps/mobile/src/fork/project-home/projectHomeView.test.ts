import { buildProjectHome, selectProjectHomeConversations } from "@t3tools/client-runtime/fork";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadShellFixture } from "../../test-fixtures";
import { pinProjectHomeView } from "./projectHomeView";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const thread = makeThreadShellFixture({
  environmentId,
  projectId,
  id: ThreadId.make("work"),
  title: "Current work",
});
const inventory = (settled: boolean) =>
  buildProjectHome({
    projectRefs: [{ environmentId, projectId }],
    threads: [thread],
    connectedEnvironmentIds: new Set([environmentId]),
    getThreadActivity: () => (settled ? "settled" : "ready"),
  });

describe("native project thread view lifetime", () => {
  it("waits for inventory and pins the first available default", () => {
    const empty = selectProjectHomeConversations({ sections: [], view: null });
    expect(pinProjectHomeView(null, empty)).toBeNull();
    const first = selectProjectHomeConversations({
      sections: inventory(false).sections,
      view: null,
    });
    const pinned = pinProjectHomeView(null, first);
    expect(pinned).toBe("open");
    const settled = selectProjectHomeConversations({
      sections: inventory(true).sections,
      view: pinned,
    });
    expect(pinProjectHomeView(pinned, settled)).toBe("open");
    expect(settled.matchingCount).toBe(0);
    expect(settled.counts.history).toBe(1);
    const searched = selectProjectHomeConversations({
      sections: inventory(true).sections,
      view: pinned,
      query: "Current",
    });
    expect(searched.matchingCount).toBe(1);
    expect(pinProjectHomeView(pinned, searched)).toBe("open");
    const cleared = selectProjectHomeConversations({
      sections: inventory(true).sections,
      view: pinned,
      query: "",
    });
    expect(cleared.view).toBe("open");
  });
  it("keeps a manual choice and allows a newly mounted project to choose its own default", () => {
    const work = selectProjectHomeConversations({
      sections: inventory(false).sections,
      view: null,
    });
    expect(pinProjectHomeView("history", work)).toBe("history");
    const reopened = selectProjectHomeConversations({
      sections: inventory(true).sections,
      view: null,
    });
    expect(pinProjectHomeView(null, reopened)).toBe("history");
  });
});
