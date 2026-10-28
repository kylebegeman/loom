import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";

vi.mock("react-native", () => ({ View: ({ children }: { children: ReactNode }) => children }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (atom === "visible-turn-items" ? [] : null),
}));
vi.mock("../../state/threads", () => ({
  threadEnvironment: { updateMetadata: null },
  environmentThreadDetails: { visibleTurnItemsAtom: () => "visible-turn-items" },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => async () => null }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    loading,
    disabled,
    onPress,
  }: {
    label: string;
    loading?: boolean;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={loading || disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));

vi.mock("../../fork/connection-health/useComputerConnectionHealth", () => ({
  useComputerConnectionHealth: () => ({
    label: "Computer",
    stallTitle: null,
    signIn: null,
    directoryHealth: null,
  }),
}));

vi.mock("../../components/ui/Notice", () => ({
  Notice: ({ message }: { message: string }) => <span>{message}</span>,
}));

import { ComposerErrorNotice } from "./ComposerErrorNotice";
import { ThreadRecoveryNotice } from "./ThreadRecoveryNotice";
import { UsageLimitRecoveryCard } from "./UsageLimitRecoveryCard";

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

describe("failed run recovery", () => {
  it("retries the failed run before its held queue and says when that fails", async () => {
    const attempt = Promise.withResolvers<void>();
    const onContinue = vi.fn<() => Promise<void>>().mockReturnValueOnce(attempt.promise);
    const resumeQueue = vi.fn<() => Promise<void>>();
    props = { ...props, onResumeQueue: resumeQueue, continuableRun: { failed: true, onContinue } };
    await act(() => root.render(<ThreadRecoveryNotice {...props} />));
    expect(container.textContent).toContain("Run failed");
    expect(button().textContent).toBe("Retry");

    await act(() => button().click());
    expect(onContinue).toHaveBeenCalledOnce();
    expect(resumeQueue).not.toHaveBeenCalled();
    await act(async () => {
      attempt.reject(null);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Could not continue the run. Try again.");
    expect(button().disabled).toBe(false);
  });
});

describe("usage limit recovery", () => {
  const failedAt = "2026-10-25T10:00:00.000Z";
  const limitedThread = makeThreadShellFixture({
    environmentId: EnvironmentId.make("computer"),
    latestRun: {
      runId: RunId.make("limited-run"),
      status: "failed",
      requestedAt: failedAt,
      startedAt: failedAt,
      completedAt: failedAt,
      assistantMessageId: null,
    },
    runtime: {
      status: "failed",
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: "Usage limit reached.",
      lastErrorClass: "usage_limit",
      usageLimitResetAt: null,
      updatedAt: failedAt,
    },
  });

  it("retries a limit with no reset time now, and stays usable after a failed try", async () => {
    const first = Promise.withResolvers<void>();
    const onRetry = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);
    await act(() =>
      root.render(
        <UsageLimitRecoveryCard
          thread={limitedThread}
          environmentId={limitedThread.environmentId}
          onRetry={onRetry}
        />,
      ),
    );
    expect(container.textContent).toContain("did not report a reset time");
    expect(button().textContent).toBe("Retry now");

    await act(() => button().click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(button().disabled).toBe(true);

    await act(async () => {
      first.reject(null);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Could not retry the run. Try again.");
    expect(button().disabled).toBe(false);

    await act(() => button().click());
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Could not retry the run.");
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
