import { describe, expect, it } from "vite-plus/test";
import { vaultHealthCoverageMessages } from "./vault-health.ts";

const limits = {
  externalConsumers: "not-discovered",
  providerCopies: "unknown",
  authorization: "not-evaluated",
} as const;

describe("health discovery coverage", () => {
  it("does not imply complete discovery for older servers", () => {
    expect(vaultHealthCoverageMessages(undefined)).toEqual([
      "This server did not report discovery coverage. Empty results do not establish that the item is unused.",
    ]);
  });
  it("keeps current references separate from retained history and current authorization", () => {
    const messages = vaultHealthCoverageMessages({
      ...limits,
      scope: "project-page",
      unattributedGrants: 0,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("this page of projects");
    expect(messages[0]).toContain("Inspect retained run selections separately");
    expect(messages[1]).toBe(
      "External consumers are not discovered. Copies held by providers are unknown. Current access has not been evaluated.",
    );
  });
  it("shows unattributed grants as an environment-wide limit", () => {
    expect(
      vaultHealthCoverageMessages({ ...limits, scope: "project-page", unattributedGrants: 1 })[2],
    ).toContain(
      "1 grant referencing this item cannot be attributed to a current project across this environment",
    );
    expect(
      vaultHealthCoverageMessages({ ...limits, scope: "project-page", unattributedGrants: 4 })[2],
    ).toContain("4 grants referencing this item cannot");
  });
  it("explains retained snapshot attribution and keeps external unknowns", () => {
    const messages = vaultHealthCoverageMessages({ ...limits, scope: "retained-page" });
    expect(messages[0]).toContain("this page in the selected project");
    expect(messages[0]).toContain("Retired selections without snapshots cannot be attributed");
    expect(messages[1]).toContain("Copies held by providers are unknown");
  });
});
