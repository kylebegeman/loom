import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import { useParameterHistory } from "./useParameterHistory";
import { useParameterPreview } from "./useParameterPreview";
it("retains undo history across file reopen, rebases changed sources and respects manual Apply", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let state: ReturnType<typeof useParameterHistory>;
  let preview: ReturnType<typeof useParameterPreview>;
  let renderer: ReactTestRenderer | null = null;
  function Harness({ source }: { source: string }) {
    const history = useParameterHistory("history-source-test", source, {
      overrides: { width: source === "a" ? "10" : "30" },
      setName: null,
    });
    const applied = useParameterPreview(history.current, true, false, source);
    useLayoutEffect(() => {
      state = history;
      preview = applied;
    });
    return null;
  }
  try {
    await act(async () => {
      renderer = create(<Harness source="a" />);
    });
    await act(async () => state.record({ overrides: { width: "20" }, setName: null }, "Width 20"));
    expect(preview!.applied.overrides.width).toBe("10");
    expect(preview!.hasUnapplied).toBe(true);
    await act(async () => preview.apply());
    expect(preview!.applied.overrides.width).toBe("20");
    await act(async () => state.move(0));
    expect(preview!.applied.overrides.width).toBe("20");
    await act(async () => renderer!.unmount());
    await act(async () => {
      renderer = create(<Harness source="a" />);
    });
    expect(state!.history.entries).toHaveLength(2);
    await act(async () => renderer!.update(<Harness source="b" />));
    expect(state!.history.entries).toHaveLength(1);
    expect(state!.current.overrides.width).toBe("30");
    expect(preview!.applied.overrides.width).toBe("30");
  } finally {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
