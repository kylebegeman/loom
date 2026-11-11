import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryOperation, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { cancelEmptyLibraryPreparation } from "./library-preparation-recovery.ts";

const operation = (state: LibraryOperation["state"]): LibraryOperation => ({
  id: "original:prepare",
  kind: "prepare",
  projectId: "project",
  environmentId: EnvironmentId.make("computer"),
  state,
  phase: "Preparing files",
  attempt: 1,
  error: null,
  result: null,
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
});
it("preserves accepted work and existing files when a person changes the setup", async () => {
  const cancel = vi.fn(async () => operation("cancelled"));
  for (const state of ["queued", "running", "succeeded"] as const) {
    await expect(
      cancelEmptyLibraryPreparation("original", {
        outcome: async () => operation(state),
        preparation: async () => null,
        cancel,
      }),
    ).rejects.toThrow("Check its result");
  }
  const copy: LibraryWorkingCopy = {
    id: "copy",
    projectId: "project",
    projectRevision: 1,
    environmentId: EnvironmentId.make("computer"),
    rootPath: "/work/project",
    repositories: [],
    ownership: "managed",
    state: "failed",
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
  };
  await expect(
    cancelEmptyLibraryPreparation("original", {
      outcome: async () => operation("failed"),
      preparation: async () => copy,
      cancel,
    }),
  ).rejects.toThrow("already has files");
  expect(cancel).not.toHaveBeenCalled();
});
it("requires confirmed cancellation before releasing a failed setup and retains unknown outcomes", async () => {
  const cancelled = vi.fn(async () => operation("cancelled"));
  await cancelEmptyLibraryPreparation("original", {
    outcome: async () => operation("needs-input"),
    preparation: async () => null,
    cancel: cancelled,
  });
  expect(cancelled).toHaveBeenCalledExactlyOnceWith("original:prepare");
  for (const ports of [
    {
      outcome: async (): Promise<LibraryOperation | null> => {
        throw new Error("Offline");
      },
      preparation: async () => null,
      cancel: cancelled,
    },
    {
      outcome: async () => operation("failed"),
      preparation: async () => null,
      cancel: async () => operation("running"),
    },
  ])
    await expect(cancelEmptyLibraryPreparation("original", ports)).rejects.toThrow();
  await cancelEmptyLibraryPreparation("original", {
    outcome: async () => null,
    preparation: async () => null,
    cancel: async () => {
      throw new Error("Nothing was accepted");
    },
  });
});
