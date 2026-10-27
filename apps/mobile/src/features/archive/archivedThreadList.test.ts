import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { archivedThreadQueryEnvironmentIds } from "./archivedThreadList";

const environmentId = EnvironmentId.make("environment-1");

// fork: fleet-connections
describe("archivedThreadQueryEnvironmentIds", () => {
  it("loads only the selected computer so unrelated offline computers cannot fail its archive", () => {
    const offlineComputer = EnvironmentId.make("offline-computer");
    expect(
      archivedThreadQueryEnvironmentIds([environmentId, offlineComputer], environmentId),
    ).toEqual([environmentId]);
  });

  it("includes every computer after clearing the filter", () => {
    const secondComputer = EnvironmentId.make("second-computer");
    expect(archivedThreadQueryEnvironmentIds([environmentId, secondComputer], null)).toEqual([
      environmentId,
      secondComputer,
    ]);
  });
});
