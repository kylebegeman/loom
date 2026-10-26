import { WORKING_EXIT_GRACE_MS } from "@t3tools/client-runtime/state/thread-inbox";
import type { ClientSettings } from "@t3tools/contracts/settings";
import * as DateTime from "effect/DateTime";
import type { AnyRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  mode: "off" as ClientSettings["notificationMode"],
  inApp: true,
  active: { environmentId: "env-1", threadId: "other-thread" },
  focused: true,
  visible: "visible",
  live: true,
  completedAt: null as string | null,
  archivedAt: null as string | null,
  input: false,
  approval: false,
  sessionError: false,
  turnError: false,
  limited: false,
  subagent: false,
  background: [] as Array<{ taskId: string; kind: "command" | "monitor"; awaited?: boolean }>,
  delegatedChild: null as "running" | "approval" | null,
  // fork: respectful-notifications
  settled: false,
  snoozedUntil: null as string | null,
  botRun: false, // fork: bots
  add: vi.fn(
    (_toast: { title: string; description: string; actionProps: { onClick: () => void } }) =>
      "toast-1",
  ),
  close: vi.fn(),
  navigate: vi.fn(),
  sound: vi.fn(),
  notification: vi.fn(function (_title: string, options: NotificationOptions) {
    return Object.assign(new EventTarget(), { tag: options.tag, close: vi.fn() });
  }),
  settingsListeners: new Set<() => void>(),
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
    lineage: {
      rootThreadId: "thread-1",
      parentThreadId: state.subagent ? "parent" : null,
      relationshipToParent: state.subagent ? "subagent" : null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: "run-1",
    activeRunId: null,
    status: state.completedAt
      ? "completed"
      : state.sessionError || state.turnError || state.limited
        ? "failed"
        : "running",
    lastErrorClass: state.limited ? "usage_limit" : null,
    pendingRuntimeRequest: state.input
      ? { id: "request-1", kind: "user_input", createdAt: SHELL_NOW }
      : state.approval
        ? { id: "request-1", kind: "command", createdAt: SHELL_NOW }
        : null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: state.background,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: SHELL_NOW,
    updatedAt: SHELL_NOW,
    latestRunRequestedAt: SHELL_NOW,
    latestRunStartedAt: SHELL_NOW,
    latestRunCompletedAt: state.completedAt ? DateTime.makeUnsafe(state.completedAt) : undefined,
    archivedAt: state.archivedAt ? DateTime.makeUnsafe(state.archivedAt) : null,
    settledOverride: state.settled ? "settled" : null, // fork: respectful-notifications
    // fork: respectful-notifications
    snoozedUntil: state.snoozedUntil ? DateTime.makeUnsafe(state.snoozedUntil) : null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

let stableParent: ReturnType<typeof mockThreadShell> | null = null;
function mockThreads() {
  if (state.delegatedChild === null) return [mockThreadShell()];
  stableParent ??= mockThreadShell();
  const child = {
    ...mockThreadShell(),
    id: "child-1",
    title: "Review the login form",
    creationSource: "mcp",
    lineage: {
      rootThreadId: "thread-1",
      parentThreadId: "thread-1",
      relationshipToParent: "subagent",
    },
    pendingRuntimeRequest:
      state.delegatedChild === "approval"
        ? { id: "request-2", kind: "command", createdAt: SHELL_NOW }
        : null,
  };
  return [stableParent, child];
}

vi.mock(import("../state/shell"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentShell: {
      ...actual.environmentShell,
      stateValueAtom: (() => shellAtom) as never,
    },
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
  subscribeClientSettings: ((listener: () => void) => {
    state.settingsListeners.add(listener);
    return () => state.settingsListeners.delete(listener);
  }) as never,
  // fork: respectful-notifications
  getClientSettings: (() => ({
    notificationMode: state.mode,
    inAppNotificationsEnabled: state.inApp,
    notificationPreviewsEnabled: true,
  })) as never,
}));
vi.mock(import("../threadNotifications"), async (original) => ({
  ...(await original()),
  playNotificationSound: state.sound,
  setNotificationBadge: vi.fn(),
}));
vi.mock(import("./ui/toast"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    toastManager: { ...actual.toastManager, add: state.add as never, close: state.close },
  };
});

import { startThreadNotifications } from "./ThreadNotificationCoordinator";

const shellAtom = Atom.make<unknown>(null);
const environmentIdsAtom = Atom.make<ReadonlyArray<string>>(["env-1"]);
const router = {
  get state() {
    return { matches: [{ params: state.active }] };
  },
  navigate: (options: unknown) => state.navigate(options),
} as unknown as AnyRouter;
let registry: AtomRegistry.AtomRegistry;
let stop: (() => void) | undefined;

function start() {
  stop = startThreadNotifications(registry, router);
}

// Publishes the current shell and settings the way the app's atoms and settings store would.
async function render() {
  registry.set(shellAtom, {
    status: state.live ? "live" : "disconnected",
    snapshot: Option.some({ threads: mockThreads() }),
  });
  if (stop === undefined) start();
  for (const listener of state.settingsListeners) listener();
  // fork: respectful-notifications - a completion waits out the Working shelf's exit grace.
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
}

async function complete() {
  state.completedAt = "2026-09-13T10:00:00.000Z";
  await render();
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    mode: "off",
    inApp: true,
    active: { environmentId: "env-1", threadId: "other-thread" },
    focused: true,
    visible: "visible",
    live: true,
    completedAt: null,
    archivedAt: null,
    input: false,
    approval: false,
    sessionError: false,
    turnError: false,
    limited: false,
    subagent: false,
    background: [],
    delegatedChild: null,
    // fork: respectful-notifications
    settled: false,
    snoozedUntil: null,
    botRun: false, // fork: bots
  });
  stableParent = null;
  state.settingsListeners.clear();
  // fork: respectful-notifications: present synchronously; the fork delivery test covers Web Locks.
  vi.spyOn(navigator, "locks", "get").mockReturnValue(undefined as never);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => state.visible as DocumentVisibilityState,
  );
  vi.spyOn(document, "hasFocus").mockImplementation(() => state.focused);
  vi.stubGlobal("Notification", Object.assign(state.notification, { permission: "granted" }));
  // fork: respectful-notifications - only timers, so tests can still pin Date.now.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  registry = AtomRegistry.make();
  stop = undefined;
});

afterEach(() => {
  stop?.();
  registry.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("thread notifications", () => {
  it.each([true, false])("keeps subagents silent with focus=%s", async (focused) => {
    state.subagent = true;
    state.focused = focused;
    state.mode = "notifications-and-sound";
    await render();
    await complete();
    state.input = true;
    await render();
    expect(state.sound).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.notification).not.toHaveBeenCalled();
  });

  it("alerts on the parent when its delegated subagent asks for approval", async () => {
    state.mode = "notifications-and-sound";
    state.delegatedChild = "running";
    await render();
    state.delegatedChild = "approval";
    await render();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Approval needed", description: "Fix the login form" }),
    );
  });

  it("alerts once with system alerts off and opens the completed thread", async () => {
    await render();
    await complete();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    const toast = state.add.mock.calls[0]?.[0];
    expect(toast?.title).toBe("Thread completed");
    expect(toast?.description).toBe("Fix the login form");
    toast?.actionProps.onClick();
    expect(state.close).toHaveBeenCalledWith("toast-1");
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-1", threadId: "thread-1" },
    });
    expect(state.notification).not.toHaveBeenCalled();
  });

  it.each(["active", "blurred", "hidden", "archived", "disabled"])(
    "does not show a completion toast for %s threads",
    async (condition) => {
      await render();
      if (condition === "active") state.active.threadId = "thread-1";
      if (condition === "blurred") state.focused = false;
      if (condition === "hidden") state.visible = "hidden";
      if (condition === "archived") state.archivedAt = "2026-09-13T09:00:00.000Z";
      if (condition === "disabled") state.inApp = false;
      await complete();
      expect(state.add).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["input", "Input needed"],
    ["approval", "Approval needed"],
    ["sessionError", "Thread failed"],
    ["turnError", "Thread failed"],
    ["limited", "Usage limit reached"],
  ] as const)("uses the same %s event for in-app and desktop alerts", async (event, title) => {
    state.mode = "notifications-and-sound";
    await render();
    state[event] = true;
    await render();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(expect.objectContaining({ title }));
    expect(state.sound).toHaveBeenCalledWith("input", expect.any(Function));
    expect(state.notification).not.toHaveBeenCalled();

    state[event] = false;
    await render();
    state.focused = false;
    state[event] = true;
    await render();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.notification).toHaveBeenCalledTimes(1);
    expect(state.notification).toHaveBeenCalledWith(title, {
      body: "Fix the login form",
      tag: expect.any(String),
      silent: true,
      requireInteraction: false,
    });
  });

  it("alerts when only a dev server is left running, not while a monitor can wake the agent", async () => {
    await render();
    state.background = [{ taskId: "watch", kind: "monitor", awaited: true }];
    await complete();
    expect(state.add).not.toHaveBeenCalled();
    state.background = [{ taskId: "dev", kind: "command" }];
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Thread completed" }),
    );
  });

  it("keeps background desktop alerts when in-app notifications are disabled", async () => {
    state.focused = false;
    state.inApp = false;
    state.mode = "notifications";
    await render();
    await complete();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.notification).toHaveBeenCalledTimes(1);
    state.inApp = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("does not replay a completion when opting in from all alerts off", async () => {
    state.inApp = false;
    await render();
    await complete();
    state.inApp = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("compares the environment as well as the thread", async () => {
    state.active = { environmentId: "env-2", threadId: "thread-1" };
    await render();
    await complete();
    expect(state.add).toHaveBeenCalledTimes(1);
  });

  it("does not replay completed threads on first load or reconnect", async () => {
    await complete();
    state.live = false;
    await render();
    state.live = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
  });

  // fork: respectful-notifications
  it("announces an approval that arrived while the shell was away, once", async () => {
    await render();
    state.live = false;
    await render();
    state.approval = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
    state.live = true;
    await render();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Approval needed", description: "Fix the login form" }),
    );
  });

  // fork: respectful-notifications
  it("seeds from the cached snapshot at launch and announces only what is new since", async () => {
    state.live = false;
    await render();
    state.input = true;
    state.live = true;
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Input needed" }));

    stop?.();
    stop = undefined;
    state.live = false;
    await render();
    state.live = true;
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
  });

  // fork: respectful-notifications
  it.each([
    ["2026-09-13T10:05:00.000Z", 1],
    ["2026-09-13T10:30:00.000Z", 0],
  ])("after a gap, at %s, announces a completion only while it is recent", async (now, count) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
    await render();
    state.live = false;
    await render();
    state.live = true;
    await complete();
    expect(state.add).toHaveBeenCalledTimes(count);
  });

  // fork: respectful-notifications
  it.each(["snoozed", "settled"])(
    "keeps a %s thread's completions quiet but still asks for approvals",
    async (parked) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-13T10:00:00.000Z"));
      if (parked === "snoozed") state.snoozedUntil = "2026-09-13T12:00:00.000Z";
      else state.settled = true;
      await render();
      await complete();
      expect(state.add).not.toHaveBeenCalled();
      state.completedAt = null;
      state.approval = true;
      await render();
      expect(state.add).toHaveBeenCalledTimes(1);
      expect(state.add).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: "Approval needed" }),
      );
    },
  );

  // fork: bots
  it("alerts a bot run waiting on a person by its bot, and never its completion or failure", async () => {
    state.botRun = true;
    await render();
    state.approval = true;
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Bot needs approval", description: "Review bot" }),
    );
    state.approval = false;
    await complete();
    state.completedAt = null;
    state.turnError = true;
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
  });

  it("keeps sound but replaces the system popup when showing a toast", async () => {
    state.mode = "notifications-and-sound";
    await render();
    await complete();
    expect(state.sound).toHaveBeenCalledWith("completion", expect.any(Function));
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.notification).not.toHaveBeenCalled();
  });

  it("keeps system alerts when the app is in the background", async () => {
    state.mode = "notifications";
    state.focused = false;
    await render();
    await complete();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.notification).toHaveBeenCalledWith("Thread completed", {
      body: "Fix the login form",
      tag: expect.any(String),
      silent: true,
      requireInteraction: false,
    });
  });

  it("reveals the desktop window and opens the thread when a system alert is clicked", async () => {
    const revealWindow = vi.fn(() => Promise.resolve());
    vi.stubGlobal("desktopBridge", { revealWindow });
    state.mode = "notifications";
    state.focused = false;
    await render();
    await complete();
    const notification: EventTarget = state.notification.mock.results[0]?.value;
    notification.dispatchEvent(new Event("click"));
    expect(revealWindow).toHaveBeenCalledTimes(1);
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-1", threadId: "thread-1" },
    });
  });
});
