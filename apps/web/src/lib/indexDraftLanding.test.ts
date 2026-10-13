import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import { resolveIndexDraftProject } from "./indexDraftLanding";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const createdAt = "2026-10-01T00:00:00.000Z";

function project(environmentId: EnvironmentId, id: string, updatedAt = createdAt) {
  return { environmentId, id: ProjectId.make(id), title: id, createdAt, updatedAt };
}

describe("resolveIndexDraftProject", () => {
  it("starts on a connected computer instead of a more recent offline project", () => {
    const connected = project(local, "connected", "2026-10-02T00:00:00.000Z");
    const cached = project(remote, "cached", "2026-10-12T00:00:00.000Z");
    expect(resolveIndexDraftProject([cached, connected], [], [local])).toBe(connected);
  });

  it("returns no automatic draft when all saved projects are offline", () => {
    expect(resolveIndexDraftProject([project(remote, "cached")], [], [])).toBeNull();
  });

  it("uses recent conversation activity within the connected projects", () => {
    const older = project(local, "older");
    const active = project(remote, "active");
    const thread = makeThreadFixture({
      environmentId: remote,
      projectId: active.id,
      updatedAt: "2026-10-12T00:00:00.000Z",
    });
    expect(resolveIndexDraftProject([older, active], [thread], [local, remote])).toBe(active);
  });

  it("keeps identical project ids on different computers separate", () => {
    const connected = project(local, "shared", "2026-10-02T00:00:00.000Z");
    const cached = project(remote, "shared", "2026-10-12T00:00:00.000Z");
    const thread = makeThreadFixture({
      environmentId: remote,
      projectId: cached.id,
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    expect(resolveIndexDraftProject([cached, connected], [thread], [local])).toBe(connected);
  });

  it("makes a saved project eligible once its computer reconnects", () => {
    const saved = project(remote, "saved");
    expect(resolveIndexDraftProject([saved], [], [local])).toBeNull();
    expect(resolveIndexDraftProject([saved], [], [local, remote])).toBe(saved);
  });
});
