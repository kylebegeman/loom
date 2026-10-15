import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ScadParameters } from "@t3tools/contracts/fork";
import { ScadFile, type ScadSession } from "./ScadCustomizer";
import type { Parameters } from "./Parameters";
import { AUTO_RENDER_MS } from "./useParameterPreview";
const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  render: vi.fn(),
  parameters: null as unknown,
}));
vi.mock("./state", () => ({
  models: {
    parameters: "parameters",
    renderResult: mocks.render,
    render: { permissionAtom: () => true },
  },
  runModelCommand: mocks.command,
  modelUrl: (_: string, url: string) => url,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: (result: unknown) => result }));
vi.mock("./Parameters", () => ({
  Parameters: (props: unknown) => {
    mocks.parameters = props;
    return null;
  },
}));

it("retains successful mesh parameters after a failed render and waits for refreshed source definitions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const data: ScadParameters = {
    sourceRevision: "source-a",
    parameters: [
      {
        name: "width",
        kind: "number",
        defaultValue: "10",
        group: "",
        description: null,
        range: null,
        options: null,
      },
    ],
    sets: [],
    setValues: {},
    lastUsed: {},
    lastUsedSet: null,
  };
  mocks.command.mockResolvedValue(data);
  const success = (revision: string) => ({
    _tag: "Success",
    waiting: false,
    value: {
      status: "ok",
      mesh: { relativeUrl: "/mesh.stl", revision },
      meshFormat: "stl",
      log: [],
    },
  });
  const first = success("mesh-a"),
    next = success("mesh-b");
  const failed = {
    _tag: "Success",
    waiting: false,
    value: {
      status: "error",
      mesh: null,
      meshFormat: null,
      log: [{ level: "error", text: "Invalid geometry" }],
    },
  };
  mocks.render.mockImplementation(
    ({ input }: { input: { revision: number; overrides: Record<string, string> } }) =>
      input.revision === 2 ? next : input.overrides.width === "20" ? failed : first,
  );
  let session: ScadSession | null = null;
  const props = {
    threadRef: { environmentId: "env", threadId: "scad-audit-test" } as ScopedThreadRef,
    path: "part.scad",
    pending: false,
    onSession: (value: ScadSession) => {
      session = value;
    },
    onMesh: vi.fn(),
    onResult: vi.fn(),
    onPending: vi.fn(),
    onRefreshing: vi.fn(),
    onError: vi.fn(),
  };
  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(<ScadFile {...props} revision={1} />);
    });
    expect(session!.applied).toEqual({ width: "10" });
    expect(session!.appliedRevision).toBe("mesh-a");
    await act(async () => {
      (mocks.parameters as React.ComponentProps<typeof Parameters>).onChange("width", "20");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTO_RENDER_MS);
    });
    expect(props.onResult).toHaveBeenLastCalledWith(failed.value);
    expect(session!.values.width).toBe("20");
    expect(session!.applied).toEqual({ width: "10" });
    expect(session!.appliedRevision).toBe("mesh-a");
    let resolve!: (value: ScadParameters) => void;
    mocks.command.mockReturnValueOnce(
      new Promise<ScadParameters>((done) => {
        resolve = done;
      }),
    );
    await act(async () => {
      renderer!.update(<ScadFile {...props} revision={2} />);
    });
    expect(mocks.render.mock.calls.some(([request]) => request.input.revision === 2)).toBe(false);
    await act(async () => {
      resolve({
        ...data,
        sourceRevision: "source-b",
        parameters: [{ ...data.parameters[0]!, defaultValue: "30" }],
      });
    });
    expect(session!.applied).toEqual({ width: "30" });
    expect(session!.appliedRevision).toBe("mesh-b");
  } finally {
    await act(async () => renderer?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("holds the automatic render during a scrub, renders after a quiet pause and replaces a render in flight", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const data: ScadParameters = {
    sourceRevision: "source-a",
    parameters: [
      {
        name: "width",
        kind: "number",
        defaultValue: "20",
        group: "",
        description: null,
        range: { min: 1, max: 300, step: 1 },
        options: null,
      },
    ],
    sets: [],
    setValues: {},
    lastUsed: {},
    lastUsedSet: null,
  };
  mocks.command.mockResolvedValue(data);
  mocks.render.mockReset();
  const waiting = { _tag: "Initial", waiting: true };
  mocks.render.mockImplementation(({ input }: { input: { overrides: Record<string, string> } }) => {
    const width = input.overrides.width;
    return !width || width === "40"
      ? {
          _tag: "Success",
          waiting: false,
          value: {
            status: "ok",
            mesh: { relativeUrl: `/mesh-${width ?? "20"}.stl`, revision: `mesh-${width}` },
            meshFormat: "stl",
            log: [],
          },
        }
      : waiting;
  });
  const onMesh = vi.fn();
  const requested = () =>
    mocks.render.mock.calls.map(
      ([request]) =>
        (request as { input: { overrides: { width?: string } } }).input.overrides.width,
    );
  const panel = () => mocks.parameters as React.ComponentProps<typeof Parameters>;
  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(
        <ScadFile
          threadRef={{ environmentId: "env", threadId: "scrub-test" } as ScopedThreadRef}
          path="part.scad"
          revision={1}
          pending={false}
          onSession={() => {}}
          onMesh={onMesh}
          onResult={() => {}}
          onPending={() => {}}
          onRefreshing={() => {}}
          onError={() => {}}
        />,
      );
    });
    // A scrub holds the render however long it pauses.
    await act(async () => panel().onHold(true));
    await act(async () => panel().onChange("width", "25"));
    await act(async () => panel().onChange("width", "30"));
    await act(async () => vi.advanceTimersByTime(AUTO_RENDER_MS * 5));
    expect(requested()).not.toContain("30");
    // Released, it renders once after a quiet pause.
    await act(async () => panel().onHold(false));
    await act(async () => vi.advanceTimersByTime(AUTO_RENDER_MS - 1));
    expect(requested()).not.toContain("30");
    await act(async () => vi.advanceTimersByTime(1));
    expect(requested().at(-1)).toBe("30");
    expect(requested()).not.toContain("25");
    // A newer change replaces the render still in flight instead of queueing behind it.
    await act(async () => panel().onChange("width", "40"));
    await act(async () => vi.advanceTimersByTime(AUTO_RENDER_MS));
    expect(requested().at(-1)).toBe("40");
    // Later renders of the panel no longer read the replaced request.
    const before = requested().length;
    await act(async () => panel().onHold(true));
    await act(async () => panel().onHold(false));
    expect(requested().slice(before)).toContain("40");
    expect(requested().slice(before)).not.toContain("30");
    expect(onMesh).toHaveBeenLastCalledWith("/mesh-40.stl", "stl", "mesh-40");
  } finally {
    await act(async () => renderer?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
