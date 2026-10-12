import { expect, it } from "vite-plus/test";
import { runWorkspaceHandoff } from "./workspace-handoff-flow.ts";
import type { WorkspaceHandoffAttempt } from "./workspace-handoff-flow.ts";
import type { WorkspaceHandoffOffer, WorkspaceHandoffReceipt } from "@t3tools/contracts/fork";

const offer = { requestId: "request-1" } as WorkspaceHandoffOffer;
const receipt = { requestId: "request-1" } as WorkspaceHandoffReceipt;
const empty: WorkspaceHandoffAttempt = { offer: null, receipt: null, sourceResult: null };
it("confirms destination preparation before touching the source or starting the continuation", async () => {
  const calls: string[] = [];
  await runWorkspaceHandoff({
    attempt: empty,
    offer: async () => {
      calls.push("offer");
      return offer;
    },
    prepare: async () => {
      calls.push("prepare");
      return receipt;
    },
    finish: async () => {
      calls.push("finish");
      return { sourceSettled: true, reason: "settled" };
    },
    resume: async () => {
      calls.push("resume");
      return receipt;
    },
    progress: () => {},
  });
  expect(calls).toEqual(["offer", "prepare", "finish", "resume"]);
});
it("preserves the source when destination setup fails", async () => {
  const calls: string[] = [];
  await expect(
    runWorkspaceHandoff({
      attempt: empty,
      offer: async () => offer,
      prepare: async () => {
        throw new Error("setup failed");
      },
      finish: async () => {
        calls.push("finish");
        return { sourceSettled: true, reason: "settled" };
      },
      resume: async () => {
        calls.push("resume");
        return receipt;
      },
      progress: () => {},
    }),
  ).rejects.toThrow("setup failed");
  expect(calls).toEqual([]);
});
it("resumes a saved attempt after final delivery fails without repeating accepted steps", async () => {
  let saved = empty;
  const finish = async () => ({ sourceSettled: false, reason: "local data kept" });
  await expect(
    runWorkspaceHandoff({
      attempt: empty,
      offer: async () => offer,
      prepare: async () => receipt,
      finish,
      resume: async () => {
        throw new Error("offline");
      },
      progress: (_phase, attempt) => {
        saved = attempt;
      },
    }),
  ).rejects.toThrow("offline");
  expect(saved).toEqual({
    offer,
    receipt,
    sourceResult: { sourceSettled: false, reason: "local data kept" },
  });
  await runWorkspaceHandoff({
    attempt: saved,
    offer: async () => {
      throw new Error("repeated offer");
    },
    prepare: async () => {
      throw new Error("repeated prepare");
    },
    finish: async () => {
      throw new Error("repeated finish");
    },
    resume: async () => receipt,
    progress: () => {},
  });
});
it("keeps the prepared destination if the source changes before completion", async () => {
  let saved = empty;
  let resumed = false;
  await expect(
    runWorkspaceHandoff({
      attempt: empty,
      offer: async () => offer,
      prepare: async () => receipt,
      finish: async () => {
        throw new Error("source changed");
      },
      resume: async () => {
        resumed = true;
        return receipt;
      },
      progress: (_phase, attempt) => {
        saved = attempt;
      },
    }),
  ).rejects.toThrow("source changed");
  expect(saved.receipt).toBe(receipt);
  expect(resumed).toBe(false);
});

it("persists destination readiness before source settlement", async () => {
  let settled = false;
  await expect(
    runWorkspaceHandoff({
      attempt: empty,
      offer: async () => offer,
      prepare: async () => receipt,
      finish: async () => {
        settled = true;
        return { sourceSettled: true, reason: "settled" };
      },
      resume: async () => receipt,
      progress: async (_phase, attempt) => {
        if (attempt.receipt) throw new Error("storage unavailable");
      },
    }),
  ).rejects.toThrow("storage unavailable");
  expect(settled).toBe(false);
});

it("revalidates a saved destination before source settlement", async () => {
  let settled = false;
  await expect(
    runWorkspaceHandoff({
      attempt: { ...empty, offer, receipt },
      offer: async () => {
        throw new Error("repeated offer");
      },
      prepare: async () => {
        throw new Error("destination no longer ready");
      },
      finish: async () => {
        settled = true;
        return { sourceSettled: true, reason: "settled" };
      },
      resume: async () => receipt,
      progress: () => {},
    }),
  ).rejects.toThrow("destination no longer ready");
  expect(settled).toBe(false);
});
