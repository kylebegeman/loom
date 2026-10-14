import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveProjectHomeDestination } from "@t3tools/client-runtime/fork";
import { projectHomeDestinationFromSearch, validateProjectHomeSearch } from "./routeSearch";
const mac = { environmentId: EnvironmentId.make("mac"), id: ProjectId.make("mac-checkout") };
const pi = { environmentId: EnvironmentId.make("pi"), id: ProjectId.make("pi-checkout") };

describe("prepared project home destination", () => {
  it("preserves the exact checkout when the project also exists on the primary computer", () => {
    const chosenProjectRef = projectHomeDestinationFromSearch(
      validateProjectHomeSearch({ computer: pi.environmentId, checkoutId: pi.id }),
    );
    expect(
      resolveProjectHomeDestination({
        memberProjects: [mac, pi],
        preferredProjectRef: { environmentId: mac.environmentId, projectId: mac.id },
        chosenProjectRef,
        connectedEnvironmentIds: new Set([mac.environmentId, pi.environmentId]),
        permittedEnvironmentIds: new Set([mac.environmentId, pi.environmentId]),
      }),
    ).toBe(pi);
    expect(
      resolveProjectHomeDestination({
        memberProjects: [mac, pi],
        chosenProjectRef,
        connectedEnvironmentIds: new Set([mac.environmentId]),
        permittedEnvironmentIds: new Set([mac.environmentId, pi.environmentId]),
      }),
    ).toBeNull();
  });
  it("discards incomplete or malformed destinations without inventing a partial target", () => {
    for (const raw of [
      {},
      { computer: "pi" },
      { checkoutId: "id" },
      { computer: [], checkoutId: "id" },
      { computer: " ", checkoutId: "id" },
    ])
      expect(projectHomeDestinationFromSearch(validateProjectHomeSearch(raw))).toBeNull();
  });
});
