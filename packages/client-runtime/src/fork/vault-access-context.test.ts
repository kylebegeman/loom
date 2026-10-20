import { expect, it } from "@effect/vitest";
import type { VaultAccessContext } from "@t3tools/contracts/fork";
import { vaultAccessContextRows } from "./vault-access.ts";
const context: VaultAccessContext = {
  checkedAt: 100,
  freshUntil: 200,
  state: "current",
  providerInstanceId: "codex",
  runId: "run",
  profiles: [
    {
      id: "a".repeat(32),
      label: "Development",
      version: 1,
      state: "active",
      selected: true,
      requirements: ["server"],
    },
  ],
  sessions: [],
  approvals: [{ id: "b".repeat(32), state: "pending", until: 200 }],
  omittedProfiles: 2,
  omittedSessions: 3,
  omittedApprovals: 1,
  externalConsumers: "not-discovered",
  providerCopies: "unknown",
};
it("withdraws relationship labels at expiry or context change while preserving the separate policy explanation", () => {
  const expired = vaultAccessContextRows(context, 200)
    .map((r) => r.text)
    .join(" ");
  expect(expired).toContain("Run the access check again");
  expect(expired).not.toContain("Development");
  expect(vaultAccessContextRows({ ...context, state: "changed" }, 101)).toEqual(
    vaultAccessContextRows(context, 200),
  );
  expect(
    vaultAccessContextRows({ ...context, state: "unavailable" }, 101)
      .map((r) => r.text)
      .join(" "),
  ).toContain("separate observation");
});
it("keeps limited coverage and omitted relationships explicit in normal and partial context", () => {
  const lines = vaultAccessContextRows({ ...context, state: "partial" }, 101)
    .map((r) => r.text)
    .join(" ");
  expect(lines).toContain("Empty lists do not prove there are no consumers");
  expect(lines).toContain("selected default");
  expect(lines).toContain("2 additional matching profiles omitted");
  expect(lines).toContain("3 additional matching workload sessions omitted");
  expect(lines).toContain("1 additional matching requests omitted");
  expect(lines).toContain("External consumers are not discovered");
  expect(lines).toContain("does not authorize an operation");
});

it("gives identically labelled profiles stable distinct keys and visible identities", () => {
  const other = { ...context.profiles[0]!, id: "c".repeat(32) };
  const rows = vaultAccessContextRows({ ...context, profiles: [context.profiles[0]!, other] }, 101);
  const profiles = rows.filter((r) => r.id.startsWith("profile:"));
  expect(profiles.map((r) => r.id)).toEqual([
    `profile:${context.profiles[0]!.id}`,
    `profile:${other.id}`,
  ]);
  expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  expect(profiles[0]!.text).toContain(context.profiles[0]!.id);
  expect(profiles[1]!.text).toContain(other.id);
  expect(profiles[0]!.text).not.toBe(profiles[1]!.text);
});
