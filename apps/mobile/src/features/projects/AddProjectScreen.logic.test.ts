import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { addProjectTargets, resolveAddProjectEnvironment } from "./AddProjectScreen.logic"; // fork: library-only

const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");
const LIBRARY = EnvironmentId.make("library"); // fork: library-only

function environment(environmentId: EnvironmentId, connectionState: EnvironmentConnectionPhase) {
  return { environmentId, connectionState };
}

describe("resolveAddProjectEnvironment", () => {
  it("does not redirect an explicit unavailable environment to another environment", () => {
    expect(
      resolveAddProjectEnvironment(
        [environment(ENVIRONMENT_A, "offline"), environment(ENVIRONMENT_B, "connected")],
        ENVIRONMENT_A,
      ),
    ).toBeNull();
  });
  // fork: fleet-connections -- a selected computer that drops out or goes offline is not replaced
  it("does not substitute another computer when an explicitly selected computer is removed", () => {
    expect(
      resolveAddProjectEnvironment([environment(ENVIRONMENT_B, "connected")], ENVIRONMENT_A),
    ).toBeNull();
  });

  it("does not offer a saved computer for creation while every computer is offline", () => {
    expect(
      resolveAddProjectEnvironment(
        [environment(ENVIRONMENT_A, "offline"), environment(ENVIRONMENT_B, "error")],
        null,
      ),
    ).toBeNull();
  });
});

// fork: library-only
describe("addProjectTargets", () => {
  it("leaves out the Library and keeps computers whose config is unknown or older", () => {
    const library = { environmentId: LIBRARY };
    const olderComputer = { environmentId: ENVIRONMENT_A };
    const pendingComputer = { environmentId: ENVIRONMENT_B };
    expect(
      addProjectTargets(
        [library, olderComputer, pendingComputer],
        new Map([
          [LIBRARY, { environment: { capabilities: { supportsExecution: false } } }],
          [ENVIRONMENT_A, { environment: { capabilities: {} } }],
        ]),
      ),
    ).toEqual([olderComputer, pendingComputer]);
  });
});
