import { ThreadId, type WorktreeSetupSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { worktreeSetupBlocksSend } from "./worktreeSetup.ts";

const running: WorktreeSetupSnapshot = {
  threadId: ThreadId.make("setup-thread"),
  sequence: 1,
  phase: "running",
  startedAt: "2026-10-26T00:00:00.000Z",
  endedAt: null,
  branch: null,
  baseRef: null,
  worktreePath: "/work/project",
  setupScript: null,
  stages: [
    {
      id: "fetch",
      status: "running",
      startedAt: "2026-10-26T00:00:00.000Z",
      endedAt: null,
      percent: 40,
      detail: null,
      tail: [],
    },
  ],
  error: null,
};

describe("worktreeSetupBlocksSend", () => {
  it("lets the first message through while project files are still downloading", () => {
    expect(worktreeSetupBlocksSend({ ...running, kind: "project-files" })).toBe(false);
  });

  it("holds Send while a worktree is still being made, with or without a kind", () => {
    expect(worktreeSetupBlocksSend(running)).toBe(true);
    expect(worktreeSetupBlocksSend({ ...running, kind: "worktree" })).toBe(true);
  });

  it("releases Send once the worktree is done or handed to the agent", () => {
    expect(worktreeSetupBlocksSend({ ...running, phase: "done" })).toBe(false);
    expect(
      worktreeSetupBlocksSend({
        ...running,
        stages: [
          {
            id: "agent",
            status: "done",
            startedAt: running.startedAt,
            endedAt: running.startedAt,
            percent: null,
            detail: null,
            tail: [],
          },
        ],
      }),
    ).toBe(false);
  });
});
