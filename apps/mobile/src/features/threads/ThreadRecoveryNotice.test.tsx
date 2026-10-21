import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ View: ({ children }: { children: ReactNode }) => children }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../../state/use-thread-detail", () => ({ useThreadVisibleTurnItems: () => [] }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    loading,
    onPress,
  }: {
    label: string;
    loading: boolean;
    onPress: () => void;
  }) => (
    <button disabled={loading} onClick={onPress}>
      {label}
    </button>
  ),
}));

vi.mock("../../components/ui/Notice", () => ({
  Notice: ({ message }: { message: string }) => <span>{message}</span>,
}));

import { ComposerErrorNotice } from "./ComposerErrorNotice";
import { ThreadRecoveryNotice } from "./ThreadRecoveryNotice";

type Props = Parameters<typeof ThreadRecoveryNotice>[0];
let root: Root;
let container: HTMLDivElement;
let props: Props;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  props = {
    threadRef: { environmentId: EnvironmentId.make("computer"), threadId: ThreadId.make("thread") },
    connectionState: "connected",
    queuedMessages: [],
    dispatchingMessageId: null,
    acknowledged: false,
    runtimeStatus: "idle",
    runId: null,
    canOperate: true,
    onReconnect: () => {},
    onOpenConnection: () => {},
    onResumeQueue: null,
  };
});

afterEach(async () => {
  await act(() => root.unmount());
});

const button = () => container.querySelector("button")!;

describe("queue resume recovery", () => {
  it.each([
    { failure: new Error("The computer disconnected."), expected: "The computer disconnected." },
    { failure: null, expected: "Could not resume the queue. Try again." },
  ])("shows a failed resume and lets the user retry ($expected)", async ({ failure, expected }) => {
    const first = Promise.withResolvers<void>();
    const retry = Promise.withResolvers<void>();
    const resume = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    props = { ...props, onResumeQueue: resume };
    await act(() => root.render(<ThreadRecoveryNotice {...props} />));

    await act(() => button().click());
    expect(button().disabled).toBe(true);
    await act(() => button().click());
    expect(resume).toHaveBeenCalledOnce();

    await act(async () => {
      first.reject(failure);
      await Promise.resolve();
    });
    expect(container.textContent).toContain(expected);
    expect(button().disabled).toBe(false);

    await act(() => button().click());
    expect(resume).toHaveBeenCalledTimes(2);
    expect(button().disabled).toBe(true);
    expect(container.textContent).not.toContain(expected);
    await act(async () => {
      retry.resolve();
      await retry.promise;
    });
    expect(button().disabled).toBe(false);
    expect(container.textContent).not.toContain(expected);

    await act(() => root.render(<ThreadRecoveryNotice {...props} onResumeQueue={null} />));
    expect(container.textContent).toBe("");
  });
});

describe("rejected message recovery", () => {
  it("opens conversation context from a send error without losing its reason", async () => {
    const review = vi.fn();
    await act(() =>
      root.render(
        <ComposerErrorNotice
          message="Loom could not read or save this data. Try again."
          onDismiss={() => {}}
          onReviewContext={review}
        />,
      ),
    );
    expect(container.textContent).toContain("Loom could not read or save this data");
    await act(() => button().click());
    expect(review).toHaveBeenCalledOnce();
  });
});
