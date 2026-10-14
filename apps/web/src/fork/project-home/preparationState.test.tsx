// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  readPreparationAttempt,
  savePreparationAttempt,
  useProjectPreparationAttempt,
  type PreparationAttempt,
} from "./preparationState";
const attempt: PreparationAttempt = {
  environmentId: EnvironmentId.make("pi"),
  projectId: ProjectId.make("fixed-request-id"),
  repositoryKey: "github.com/example/project",
  remoteUrl: "https://github.com/example/project.git",
  destinationPath: "/ssd/project",
  title: "Project",
  createdAt: "2026-10-13T15:00:00.000Z",
};
let renderer: ReactTestRenderer | null = null;
const clients = new Map<number, ReturnType<typeof useProjectPreparationAttempt>>();
function Client({ id }: { id: number }) {
  const state = useProjectPreparationAttempt("recovery-test");
  useLayoutEffect(() => {
    clients.set(id, state);
  });
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(
      <>
        <Client id={1} />
        <Client id={2} />
      </>,
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  savePreparationAttempt("loom:project-preparation:recovery-test", null, window.localStorage);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  savePreparationAttempt("loom:project-preparation:recovery-test", null, window.localStorage);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("project preparation recovery receipt", () => {
  it("persists one submitted ID across dialog clients, reloads and explicit completion reset", async () => {
    await mount();
    expect(clients.get(1)?.[0]).toBeNull();
    await act(async () => clients.get(1)?.[1](attempt));
    expect(clients.get(2)?.[0]?.projectId).toBe(attempt.projectId);
    await act(async () => renderer?.unmount());
    await mount();
    expect(clients.get(1)?.[0]?.projectId).toBe(attempt.projectId);
    await act(async () => clients.get(2)?.[1](null));
    expect(clients.get(1)?.[0]).toBeNull();
    expect(window.localStorage.getItem("loom:project-preparation:recovery-test")).toBeNull();
  });
  it("unlocks a completed attempt when another window removes its receipt", async () => {
    await mount();
    await act(async () => clients.get(1)?.[1](attempt));
    const key = "loom:project-preparation:recovery-test";
    window.localStorage.removeItem(key);
    await act(async () =>
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: null })),
    );
    expect(clients.get(1)?.[0]).toBeNull();
    expect(clients.get(2)?.[0]).toBeNull();
  });
  it("keeps the same request recoverable when storage is blocked", () => {
    const key = "blocked-recovery";
    savePreparationAttempt(key, attempt, {
      setItem: () => {
        throw new Error("Storage full");
      },
      removeItem: () => undefined,
    });
    expect(
      readPreparationAttempt(key, {
        getItem: () => {
          throw new Error("Storage blocked");
        },
      })?.projectId,
    ).toBe(attempt.projectId);
    savePreparationAttempt(key, null, null);
  });
  it("rejects corrupted receipt data instead of inventing a replacement submitted request", () => {
    expect(readPreparationAttempt("corrupt", { getItem: () => "broken" })).toBeNull();
    expect(
      readPreparationAttempt("missing-fields", {
        getItem: () => JSON.stringify({ projectId: attempt.projectId }),
      }),
    ).toBeNull();
  });
});
