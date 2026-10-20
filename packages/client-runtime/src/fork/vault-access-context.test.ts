import { expect, it } from "@effect/vitest";
import type { VaultAccessContext } from "@t3tools/contracts/fork";
import { vaultAccessContextLines } from "./vault-access.ts";
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
  const expired = vaultAccessContextLines(context, 200).join(" ");
  expect(expired).toContain("Run the access check again");
  expect(expired).not.toContain("Development");
  expect(vaultAccessContextLines({ ...context, state: "changed" }, 101)).toEqual(
    vaultAccessContextLines(context, 200),
  );
  expect(vaultAccessContextLines({ ...context, state: "unavailable" }, 101).join(" ")).toContain(
    "separate observation",
  );
});
it("keeps limited coverage and omitted relationships explicit in normal and partial context", () => {
  const lines = vaultAccessContextLines({ ...context, state: "partial" }, 101).join(" ");
  expect(lines).toContain("Empty lists do not prove there are no consumers");
  expect(lines).toContain("selected default");
  expect(lines).toContain("2 additional matching profiles omitted");
  expect(lines).toContain("3 additional matching workload sessions omitted");
  expect(lines).toContain("1 additional matching requests omitted");
  expect(lines).toContain("External consumers are not discovered");
  expect(lines).toContain("does not authorize an operation");
});
