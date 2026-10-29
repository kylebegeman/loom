// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({ erase: vi.fn(), confirm: vi.fn() }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../../components/ui/Dialog", () => ({ confirm: state.confirm }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.erase }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "erase-request" }));
vi.mock("./libraryState", () => ({
  library: { eraseConversation: { permissionAtom: () => ({}) } },
  useLibraryAuthority: () => ({ environmentId: "library", ready: true }),
  useLoomFeature: () => true,
}));
import { useLibraryErasure } from "./LibraryErasure";

it("keeps a failed erasure retryable with the same receipt and leaves history only after success", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.erase
    .mockReset()
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new LibraryError({ reason: "io" }))))
    .mockResolvedValueOnce(AsyncResult.success({ id: "archive" }));
  state.confirm.mockClear();
  const onErased = vi.fn(),
    onRefresh = vi.fn();
  const holder: { current: ReturnType<typeof useLibraryErasure> | null } = { current: null };
  function Probe() {
    const current = useLibraryErasure("archive", onErased, onRefresh);
    // Expose committed hook state to the test driver.
    useEffect(() => {
      holder.current = current;
    }, [current]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(() => root.render(<Probe />));
    holder.current!.confirm("Deleted history");
    expect(state.erase).not.toHaveBeenCalled();
    await act(async () => state.confirm.mock.calls[0]![0].onConfirm());
    expect(holder.current?.attempted).toBe(true);
    expect(holder.current?.error).not.toBeNull();
    expect(onErased).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(async () => holder.current!.retry());
    expect(onErased).toHaveBeenCalledOnce();
    expect(state.erase.mock.calls[0]![0].input).toEqual({
      id: "archive",
      requestId: "erase-request",
    });
    expect(state.erase.mock.calls[1]![0].input).toEqual(state.erase.mock.calls[0]![0].input);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
