import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveProjectLibraryNewThreadTarget } from "./actions";

const mac = { environmentId: EnvironmentId.make("mac"), id: ProjectId.make("mac-project") };
const pi = { environmentId: EnvironmentId.make("pi"), id: ProjectId.make("pi-project") };

function target(
  connected: (typeof mac.environmentId)[],
  permitted: (typeof mac.environmentId)[],
  representative = mac,
) {
  return resolveProjectLibraryNewThreadTarget({
    memberProjects: [mac, pi],
    representative,
    connectedEnvironmentIds: new Set(connected),
    permittedEnvironmentIds: new Set(permitted),
  });
}

describe("project library new-thread destination", () => {
  it("uses an authorized connected member when the first computer is read-only", () => {
    expect(target([mac.environmentId, pi.environmentId], [pi.environmentId])).toBe(pi);
  });

  it("prefers the representative computer whenever it is eligible", () => {
    expect(
      target([mac.environmentId, pi.environmentId], [mac.environmentId, pi.environmentId], pi),
    ).toBe(pi);
  });

  it("does not start new work on an offline or unauthorized computer", () => {
    expect(target([mac.environmentId], [pi.environmentId])).toBeNull();
    expect(target([], [mac.environmentId, pi.environmentId])).toBeNull();
    expect(target([mac.environmentId, pi.environmentId], [])).toBeNull();
    expect(target([pi.environmentId], [pi.environmentId])).toBe(pi);
  });
});
