import { describe, expect, it } from "vite-plus/test";
import { vaultHealthCoverageMessages, vaultHealthInboxGroups } from "./vault-health.ts";

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

describe("outage inbox groups", () => {
  const issue = (letter: string, state: "open" | "resolved" | "dismissed" = "open") => ({
    id: `${letter.repeat(32)}:outage`,
    itemId: letter.repeat(32),
    itemLabel: `QA ${letter}`,
    itemVersion: 1,
    category: "outage" as const,
    state,
    firstSeenAt: 0,
    lastSeenAt: 1,
    resolvedAt: null,
    occurrences: 2,
    snoozedUntil: null,
  });
  it("keeps older unscoped reports individual and filters history", () => {
    const snapshot = {
      revision: 1,
      checkedAt: 1,
      rules: [],
      omittedIssues: 0,
      issues: [issue("a"), issue("b", "resolved")],
    };
    expect(vaultHealthInboxGroups(snapshot, false).map((group) => group.label)).toEqual([null]);
    expect(vaultHealthInboxGroups(snapshot, true)).toHaveLength(2);
  });
  it("renders grouped items once in issue order while keeping dismissed history separate", () => {
    const a = issue("a"),
      b = issue("b"),
      old = issue("c", "dismissed");
    const snapshot = {
      revision: 1,
      checkedAt: 1,
      rules: [],
      omittedIssues: 0,
      issues: [a, old, b],
      outageGroups: [
        { id: "outage:github.com", target: { kind: "github" as const }, issueIds: [a.id, b.id] },
      ],
    };
    expect(
      vaultHealthInboxGroups(snapshot, false).map((group) => [
        group.label,
        group.issues.map((item) => item.id),
      ]),
    ).toEqual([["GitHub (github.com)", [a.id, b.id]]]);
    expect(vaultHealthInboxGroups(snapshot, true)).toHaveLength(2);
    expect(
      vaultHealthInboxGroups(
        {
          ...snapshot,
          outageGroups: [
            {
              ...snapshot.outageGroups[0]!,
              target: { kind: "ssh", hostname: "qa.example", port: 2222 },
            },
          ],
        },
        false,
      )[0]?.label,
    ).toBe("SSH qa.example:2222");
  });
});
