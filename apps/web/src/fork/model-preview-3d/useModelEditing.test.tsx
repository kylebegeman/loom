import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
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

let renderer: ReactTestRenderer | null;
let editing: ReturnType<typeof useModelEditing>;
const viewer = { current: null };
function Harness({ revision }: { revision: string }) {
  const result = useModelEditing(
    { environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("test") },
    "board.glb",
    viewer,
    revision,
    null,
  );
  useLayoutEffect(() => {
    editing = result;
  });
  return null;
}
async function update(revision = "revision") {
  await act(async () => {
    if (renderer) renderer.update(<Harness revision={revision} />);
    else renderer = create(<Harness revision={revision} />);
  });
}
beforeEach(() => {
  renderer = null;
  mutate.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
it("awaits measurement persistence and preserves the first point after a failed save", async () => {
  await update();
  await act(async () => editing.choose("measure"));
  await act(async () => {
    expect(await editing.onPick([[1, 2, 3]])).toBe(true);
  });
  expect(editing.pendingPoint).toEqual([1, 2, 3]);
  mutate.mockResolvedValueOnce(undefined);
  await act(async () => {
    expect(await editing.onPick([[4, 6, 3]])).toBe(false);
  });
  expect(editing.pendingPoint).toEqual([1, 2, 3]);
  let resolve!: (value: typeof EMPTY_MODEL_WORKSPACE) => void;
  mutate.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const saving = editing.onPick([[4, 6, 3]]);
  expect(editing.pendingPoint).toEqual([1, 2, 3]);
  await act(async () => {
    resolve(EMPTY_MODEL_WORKSPACE);
    expect(await saving).toBe(true);
  });
  expect(editing.pendingPoint).toBeNull();
  expect(mutate.mock.calls.at(-1)?.[0]).toMatchObject({
    kind: "measurement",
    item: { sourceRevision: "revision", start: [1, 2, 3], end: [4, 6, 3] },
  });
});
it("rejects empty or inactive picks and invalidates an unfinished region when geometry changes", async () => {
  await update();
  expect(await editing.onPick([[1, 2, 3]])).toBe(false);
  await act(async () => editing.choose("annotate"));
  expect(await editing.onPick([])).toBe(false);
  await act(async () => {
    expect(
      await editing.onPick([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toBe(true);
  });
  expect(editing.pendingRegion).toHaveLength(2);
  await update("changed");
  expect(editing.pendingRegion).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
});
