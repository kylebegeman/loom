import { expect, it } from "vite-plus/test";
import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { handoffContext, handoffThreadIdle, portableRemoteUrl } from "./policy.ts";
const idle = {
  status: "completed",
  archivedAt: null,
  deletedAt: null,
  activeRunId: null,
  pendingRuntimeRequest: null,
  pendingBackgroundTasks: [],
  latestUserMessageAt: null,
} as unknown as OrchestrationV2ThreadShell;
it("allows stopped root workspaces and blocks queued, running and background work", () => {
  expect(handoffThreadIdle(idle, 0)).toBe(true);
  for (const state of [
    { status: "running" },
    { activeRunId: "run" },
    { pendingRuntimeRequest: {} },
    { pendingBackgroundTasks: [{}] },
    { archivedAt: {} },
  ])
    expect(handoffThreadIdle({ ...idle, ...state } as OrchestrationV2ThreadShell, 0)).toBe(false);
});
it("keeps the initial request and recent context within a bounded excerpt", () => {
  const result = handoffContext([
    { role: "user", text: "Initial requirement" },
    { role: "assistant", text: "x".repeat(70000) },
    { role: "user", text: "Current requirement" },
  ]);
  expect(result.contextTruncated).toBe(true);
  expect(result.context.length).toBeLessThanOrEqual(64000);
  expect(result.context).toContain("Initial requirement");
  expect(result.context).toContain("Current requirement");
  expect(handoffContext([{ role: "user", text: "Hello" }])).toEqual({
    context: "user:\nHello",
    contextTruncated: false,
  });
});
it("does not move embedded source credentials to a new host", () => {
  expect(
    portableRemoteUrl("https://name:secret@example.test/team/repo.git?token=secret#fragment"),
  ).toBe("https://example.test/team/repo.git");
  expect(portableRemoteUrl("git@example.test:team/repo.git")).toBe(
    "git@example.test:team/repo.git",
  );
  expect(portableRemoteUrl("ssh://git@example.test/team/repo.git")).toBe(
    "ssh://git@example.test/team/repo.git",
  );
});

it("does not split a surrogate pair at the first-request excerpt boundary", () => {
  const result = handoffContext([
    { role: "user", text: "a".repeat(3993) + "🌿" + "b".repeat(70000) },
  ]);
  expect(result.context.isWellFormed()).toBe(true);
  expect(result.context.length).toBeLessThanOrEqual(64000);
});
