import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { EMPTY_MODEL_WORKSPACE } from "@t3tools/contracts/fork";
import { useModelEditing } from "./useModelEditing";
const mutate = vi.hoisted(() => vi.fn());
vi.mock("./useModelWorkspace", () => ({
  useModelWorkspace: () => ({
    data: EMPTY_MODEL_WORKSPACE,
    mutate,
    ready: true,
    error: null,
    pendingSaves: 0,
  }),
}));
vi.mock("./capture", () => ({ attachModelImage: vi.fn() }));
vi.mock("./viewer/captureSheet", () => ({ captureNamedViews: vi.fn(), thumbnail: vi.fn() }));

it("shows in-flight work, excludes overlapping capture operations and clears status after failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let editing: ReturnType<typeof useModelEditing>;
  let renderer: ReactTestRenderer | null = null;
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  const pending = { promise, resolve };
  const duplicate = vi.fn(async () => "duplicate");
  function Harness() {
    const state = useModelEditing(
      { environmentId: "env", threadId: "thread" } as ScopedThreadRef,
      "part.scad",
      { current: null },
      "mesh",
      null,
    );
    useLayoutEffect(() => {
      editing = state;
    });
    return null;
  }
  try {
    await act(async () => {
      renderer = create(<Harness />);
    });
    let first: Promise<string | undefined>;
    await act(async () => {
      first = editing.perform("Capturing review", () => pending.promise);
    });
    expect(editing!.operation).toBe("Capturing review");
    await act(async () => {
      expect(await editing.perform("Second capture", duplicate)).toBeUndefined();
    });
    expect(duplicate).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve("saved");
      expect(await first!).toBe("saved");
    });
    expect(editing!.operation).toBeNull();
    await act(async () => {
      await editing.perform("Saving", async () => {
        throw new Error("Disconnected");
      });
    });
    expect(editing!.operation).toBeNull();
    expect(editing!.error).toBe("Disconnected");
  } finally {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
