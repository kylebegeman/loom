import { WORKING_EXIT_GRACE_MS } from "@t3tools/client-runtime/state/thread-inbox";
import * as DateTime from "effect/DateTime";
import type { AnyRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../../test/render";

const state = vi.hoisted(() => ({
  live: true,
  completedAt: null as string | null,
  input: false,
  approval: false,
  turnError: false,
  // fork: respectful-notifications
  settled: false,
  snoozedUntil: null as string | null,
  botRun: false, // fork: bots
  add: vi.fn((_toast: { title: string; description: string }) => "toast-1"),
}));

const SHELL_NOW = DateTime.makeUnsafe("2026-09-13T09:00:00.000Z");

function mockThreadShell() {
  return {
    id: state.botRun ? "bot-run-1" : "thread-1", // fork: bots
    projectId: "project-1",
    title: state.botRun ? "Review bot" : "Fix the login form", // fork: bots
    providerInstanceId: "codex",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: "thread-1", parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: "run-1",
    activeRunId: null,
    status: state.completedAt ? "completed" : state.turnError ? "failed" : "running",
    lastErrorClass: null,
    pendingRuntimeRequest: state.input
      ? { id: "request-1", kind: "user_input", createdAt: SHELL_NOW }
      : state.approval
        ? { id: "request-1", kind: "command", createdAt: SHELL_NOW }
        : null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: SHELL_NOW,
    updatedAt: SHELL_NOW,
    latestRunRequestedAt: SHELL_NOW,
    latestRunStartedAt: SHELL_NOW,
    latestRunCompletedAt: state.completedAt ? DateTime.makeUnsafe(state.completedAt) : undefined,
    archivedAt: null,
    settledOverride: state.settled ? "settled" : null, // fork: respectful-notifications
    // fork: respectful-notifications
    snoozedUntil: state.snoozedUntil ? DateTime.makeUnsafe(state.snoozedUntil) : null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

vi.mock(import("../state/shell"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentShell: { ...actual.environmentShell, stateValueAtom: (() => shellAtom) as never },
  };
});
vi.mock(import("../state/presentation"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentSummaries: {
      ...actual.environmentSummaries,
      // Read lazily: the factory runs before this module's own bindings exist.
      get environmentIdsAtom() {
        return environmentIdsAtom as never;
      },
    },
  };
});
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  subscribeClientSettings: (() => () => undefined) as never,
  // fork: respectful-notifications
  getClientSettings: (() => ({
    notificationMode: "off",
    inAppNotificationsEnabled: true,
    notificationPreviewsEnabled: true,
  })) as never,
}));
// fork: respectful-notifications: the badge has its own tests; it would read every thread here.
vi.mock(import("../fork/attention/attentionBadge"), () => ({
  startAttentionBadge: () => () => undefined,
}));
vi.mock(import("./ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: state.add as never } };
});

import { startThreadNotifications } from "./ThreadNotificationCoordinator";

const shellAtom = Atom.make<unknown>(null);
const environmentIdsAtom = Atom.make<ReadonlyArray<string>>(["env-1"]);
const router = {
  state: { matches: [{ params: { environmentId: "env-1", threadId: "other-thread" } }] },
  navigate: vi.fn(),
} as unknown as AnyRouter;

// The mocked modules read `state`, so every test resets it before starting the service.
function setup() {
  vi.clearAllMocks();
  Object.assign(state, {
    live: true,
    completedAt: null,
    input: false,
    approval: false,
    turnError: false,
    // fork: respectful-notifications
    settled: false,
    snoozedUntil: null,
    botRun: false, // fork: bots
  });
  const stack = new AsyncDisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  stack.use(vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"));
  stack.use(vi.spyOn(document, "hasFocus").mockReturnValue(true));
  stack.use(fakeTimers());
  let stop: (() => void) | undefined;
  stack.defer(() => stop?.());
  const render = async () => {
    registry.set(shellAtom, {
      status: state.live ? "live" : "disconnected",
      snapshot: Option.some({ threads: [mockThreadShell()] }),
    });
    stop ??= startThreadNotifications(registry, router);
    // fork: respectful-notifications - a completion waits out the Working shelf's exit grace.
    await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  };
  return {
    render,
    complete: async () => {
      state.completedAt = "2026-09-13T10:00:00.000Z";
      await render();
    },
    restart: () => {
      stop?.();
      stop = undefined;
    },
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

describe("thread notifications", () => {
  // fork: respectful-notifications
  it("announces an approval that arrived while the shell was away, once", async () => {
    await using app = setup();
    await app.render();
    state.live = false;
    await app.render();
    state.approval = true;
    await app.render();
    expect(state.add).not.toHaveBeenCalled();
    state.live = true;
    await app.render();
    await app.render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Approval needed", description: "Fix the login form" }),
    );
  });

  // fork: respectful-notifications
  it("seeds from the cached snapshot at launch and announces only what is new since", async () => {
    await using app = setup();
    state.live = false;
    await app.render();
    state.input = true;
    state.live = true;
    await app.render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Input needed" }));

    app.restart();
    state.live = false;
    await app.render();
    state.live = true;
    await app.render();
    expect(state.add).toHaveBeenCalledTimes(1);
  });

  // fork: respectful-notifications
  it.each([
    ["2026-09-13T10:05:00.000Z", 1],
    ["2026-09-13T10:30:00.000Z", 0],
  ])("after a gap, at %s, announces a completion only while it is recent", async (now, count) => {
    await using app = setup();
    vi.setSystemTime(now);
    await app.render();
    state.live = false;
    await app.render();
    state.live = true;
    await app.complete();
    expect(state.add).toHaveBeenCalledTimes(count);
  });

  // fork: respectful-notifications
  it.each(["snoozed", "settled"])(
    "keeps a %s thread's completions quiet but still asks for approvals",
    async (parked) => {
      await using app = setup();
      vi.setSystemTime("2026-09-13T10:00:00.000Z");
      if (parked === "snoozed") state.snoozedUntil = "2026-09-13T12:00:00.000Z";
      else state.settled = true;
      await app.render();
      await app.complete();
      expect(state.add).not.toHaveBeenCalled();
      state.completedAt = null;
      state.approval = true;
      await app.render();
      expect(state.add).toHaveBeenCalledTimes(1);
      expect(state.add).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: "Approval needed" }),
      );
    },
  );

  // fork: bots
  it("alerts a bot run waiting on a person by its bot, and never its completion or failure", async () => {
    await using app = setup();
    state.botRun = true;
    await app.render();
    state.approval = true;
    await app.render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Bot needs approval", description: "Review bot" }),
    );
    state.approval = false;
    await app.complete();
    state.completedAt = null;
    state.turnError = true;
    await app.render();
    expect(state.add).toHaveBeenCalledTimes(1);
  });
});
