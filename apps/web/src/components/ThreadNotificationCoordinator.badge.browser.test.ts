import { WORKING_EXIT_GRACE_MS } from "@t3tools/client-runtime/state/thread-inbox";
import type { AnyRouter } from "@tanstack/react-router";
// fork: respectful-notifications
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { fakeTimers, stubGlobal } from "../../test/render";

const state = vi.hoisted(() => ({
  mode: "notifications",
  previews: true, // fork: respectful-notifications
  inApp: false,
  toast: vi.fn(),
  shells: null as unknown as { set: (id: string, value: unknown) => void },
  navigate: vi.fn(),
  sound: vi.fn(),
  badge: vi.fn(),
  settingsListeners: new Set<() => void>(),
}));
vi.mock(import("./ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: state.toast as never } };
});
vi.mock(import("../state/shell"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentShell: {
      ...actual.environmentShell,
      stateValueAtom: ((id: string) => shellAtom(id)) as never,
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
vi.mock(import("../state/threads"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentThreadShells: {
      ...actual.environmentThreadShells,
      pendingSubagentRequestsAtom: (() => noRequestsAtom) as never,
      get delegatedUnderParentAtom() {
        return noDelegatedAtom as never;
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
  getClientSettings: (() => ({
    notificationMode: state.mode,
    inAppNotificationsEnabled: state.inApp,
    notificationPreviewsEnabled: state.previews, // fork: respectful-notifications
  })) as never,
}));
vi.mock(import("../threadNotifications"), async (original) => ({
  ...(await original()),
  playNotificationSound: state.sound,
  unlockNotificationAudio: vi.fn(),
  setNotificationBadge: state.badge,
}));

// fork: respectful-notifications: a second mock of ../state/threads would race the one above.
vi.mock(import("../fork/attention/attentionBadge"), async () => {
  const { Atom } = await import("effect/reactivity");
  const { selectAttentionThreadShells } = await import("@t3tools/contracts/fork");
  const countAtom = Atom.make((get) =>
    get(environmentIdsAtom).reduce((count, id) => {
      const value = get(shellAtom(id)) as ReturnType<typeof shell> | null;
      const threads = value && Option.isSome(value.snapshot) ? value.snapshot.value.threads : [];
      return count + selectAttentionThreadShells(threads, Date.now()).length;
    }, 0),
  );
  return {
    startAttentionBadge: (registry: AtomRegistry.AtomRegistry) =>
      registry.subscribe(countAtom, state.badge, { immediate: true }),
  };
});

import { startThreadNotifications } from "./ThreadNotificationCoordinator";
import { threadNotificationTag } from "../threadNotifications"; // fork: respectful-notifications

let registry: AtomRegistry.AtomRegistry;
const shellAtom = Atom.family((_id: string) => Atom.make<unknown>(null));
const environmentIdsAtom = Atom.make<ReadonlyArray<string>>([]);
const noRequestsAtom = Atom.make(new Map());
const noDelegatedAtom = Atom.make<ReadonlySet<string>>(new Set<string>());
state.shells = { set: (id, value) => registry.set(shellAtom(id), value) };

class TestNotification extends EventTarget {
  static permission = "granted";
  static sent: TestNotification[] = [];
  close = vi.fn();
  get tag() {
    return this.options.tag ?? "";
  }
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    super();
    TestNotification.sent.push(this);
  }
}

const thread = {
  id: "thread",
  title: "Test thread",
  archivedAt: null as string | null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  session: null as { status: string } | null,
  latestTurn: { turnId: "turn", state: "running", completedAt: null as string | null },
};
let focused = false;
let visibility = "visible";

const SHELL_NOW = DateTime.makeUnsafe("2026-09-13T07:00:00.000Z");

// fork: respectful-notifications
function toV2ThreadShell(input: typeof thread): OrchestrationV2ThreadShell {
  const latestTurn = input.latestTurn;
  return {
    // fork: respectful-notifications
    id: ThreadId.make(input.id),
    projectId: ProjectId.make("project"),
    title: input.title,
    // fork: respectful-notifications
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      // fork: respectful-notifications
      rootThreadId: ThreadId.make(input.id),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    // fork: respectful-notifications
    latestRunId: RunId.make(latestTurn.turnId),
    activeRunId: null,
    status:
      latestTurn.state === "completed"
        ? "completed"
        : latestTurn.state === "error" || input.session?.status === "error"
          ? "failed"
          : "running",
    // fork: respectful-notifications
    pendingRuntimeRequest: input.hasPendingUserInput
      ? { id: RuntimeRequestId.make("request-1"), kind: "user_input", createdAt: SHELL_NOW } // fork: respectful-notifications
      : input.hasPendingApprovals
        ? { id: RuntimeRequestId.make("request-1"), kind: "command", createdAt: SHELL_NOW } // fork: respectful-notifications
        : null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    // fork: respectful-notifications
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: SHELL_NOW,
    updatedAt: SHELL_NOW,
    latestRunRequestedAt: SHELL_NOW,
    latestRunStartedAt: SHELL_NOW,
    latestRunCompletedAt: latestTurn.completedAt
      ? DateTime.makeUnsafe(latestTurn.completedAt)
      : undefined,
    archivedAt: input.archivedAt ? DateTime.makeUnsafe(input.archivedAt) : null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function shell(overrides: Partial<typeof thread> = {}, ...others: Partial<typeof thread>[]) {
  return {
    status: "live",
    snapshot: Option.some({
      threads: [overrides, ...others].map((override) =>
        toV2ThreadShell({ ...thread, ...override }),
      ),
    }),
  };
}
// fork: respectful-notifications
function complete(environment = "one", completedAt = "2026-09-13T08:00:00Z") {
  state.shells.set(
    environment,
    shell({ latestTurn: { turnId: "turn", state: "completed", completedAt } }),
  );
}
// The mocked modules read `state` and the focus flags, so every test resets them before
// starting the service.
function setup() {
  vi.clearAllMocks();
  const stack = new AsyncDisposableStack();
  registry = AtomRegistry.make();
  const testRegistry = registry;
  stack.defer(() => testRegistry.dispose());
  state.mode = "notifications";
  state.previews = true; // fork: respectful-notifications
  state.inApp = false;
  state.settingsListeners.clear();
  registry.set(environmentIdsAtom, ["one", "two"]);
  state.shells.set("one", shell());
  state.shells.set("two", shell());
  focused = false;
  visibility = "visible";
  TestNotification.permission = "granted";
  TestNotification.sent = [];
  stack.use(stubGlobal("Notification", TestNotification));
  // fork: respectful-notifications: present synchronously; a fork test below covers Web Locks.
  stack.use(vi.spyOn(navigator, "locks", "get").mockReturnValue(undefined as never));
  stack.use(vi.spyOn(window, "focus").mockImplementation(() => undefined));
  stack.use(vi.spyOn(document, "hasFocus").mockImplementation(() => focused));
  stack.use(
    vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => visibility as DocumentVisibilityState),
  );
  const router = {
    state: { matches: [{ params: {} }] },
    navigate: state.navigate,
  } as unknown as AnyRouter;
  return {
    start: () => {
      stack.defer(startThreadNotifications(testRegistry, router));
    },
    setEnvironmentIds: (ids: ReadonlyArray<string>) => testRegistry.set(environmentIdsAtom, ids),
    changeSettings: () => {
      for (const listener of state.settingsListeners) listener();
    },
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

it.each(["hasPendingApprovals", "hasPendingUserInput"] as const)(
  "keeps %s badged after focus and when notifications are disabled", // fork: respectful-notifications
  async (flag) => {
    await using app = setup();
    app.start();
    state.shells.set("one", shell({ [flag]: true }));
    expect(state.badge).toHaveBeenLastCalledWith(1); // fork: respectful-notifications
    const notification = TestNotification.sent[0]!;
    notification.dispatchEvent(new Event("click"));
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: EnvironmentId.make("one"), threadId: "thread" },
    });
    // fork: respectful-notifications
    window.dispatchEvent(new Event("focus"));
    expect(state.badge).toHaveBeenLastCalledWith(1);
    state.mode = "sound";
    app.changeSettings();
    expect(state.badge).toHaveBeenLastCalledWith(1); // fork: respectful-notifications
    expect(notification.close).toHaveBeenCalled();
  },
);

it("holds a completion through a continuation gap and notifies once it settles", async () => {
  await using app = setup();
  app.start();
  using _timers = fakeTimers();
  const finished = (turnId: string, completedAt: string) => ({
    latestTurn: { turnId, state: "completed", completedAt },
  });
  state.shells.set("one", shell(finished("turn-1", "2026-09-13T07:00:01.000Z")));
  state.shells.set(
    "one",
    shell({ latestTurn: { turnId: "turn-2", state: "running", completedAt: null } }),
  );
  state.shells.set("one", shell(finished("turn-2", "2026-09-13T07:00:02.000Z")));
  expect(TestNotification.sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS - 1);
  expect(TestNotification.sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(TestNotification.sent.map((sent) => sent.title)).toEqual(["Thread completed"]);
});

// fork: respectful-notifications
it("badges an approval that arrived while closed, seeding from the cached snapshot", async () => {
  await using app = setup();
  state.shells.set("one", { ...shell(), status: "cached" });
  app.start();
  state.shells.set("one", { ...shell({ hasPendingApprovals: true }), status: "synchronizing" });
  expect(TestNotification.sent).toHaveLength(0);
  state.shells.set("one", shell({ hasPendingApprovals: true }));
  expect(TestNotification.sent.map((notification) => notification.title)).toEqual([
    "Approval needed",
  ]);
  expect(state.badge).toHaveBeenLastCalledWith(1);
});

// fork: respectful-notifications
it("shows thread titles by default and hides them, closing shown previews, when turned off", async () => {
  await using app = setup();
  app.start();
  using _timers = fakeTimers();
  complete();
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  const preview = TestNotification.sent[0]!;
  expect(preview.options).toMatchObject({ body: "Test thread", silent: true });
  state.previews = false;
  app.changeSettings();
  expect(preview.close).toHaveBeenCalled();
  complete("two");
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  expect(TestNotification.sent.at(-1)!.options.body).toBe("Open Loom to review this thread.");
});

// fork: respectful-notifications
it.each(["resolved", "archived", "removed"])(
  "withdraws obsolete approval banners when %s and rejects stale clicks",
  async (condition) => {
    await using app = setup();
    app.start();
    state.shells.set("one", shell({ hasPendingApprovals: true }));
    const notification = TestNotification.sent[0]!;
    state.shells.set(
      "one",
      condition === "removed"
        ? { status: "live", snapshot: Option.some({ threads: [] }) }
        : shell({ archivedAt: condition === "archived" ? "2026-09-13T08:00:00Z" : null }),
    );
    expect(notification.close).toHaveBeenCalled();
    expect(state.badge).toHaveBeenLastCalledWith(0);
    notification.dispatchEvent(new Event("click"));
    expect(state.navigate).not.toHaveBeenCalled();
  },
);

// fork: respectful-notifications
it.each(["synchronizing", "cached"])(
  "keeps shown alerts while the shell is %s and still opens their thread",
  async (status) => {
    await using app = setup();
    app.start();
    using _timers = fakeTimers();
    complete();
    await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
    const notification = TestNotification.sent[0]!;
    const completed = { turnId: "turn", state: "completed", completedAt: "2026-09-13T08:00:00Z" };
    state.shells.set("one", { ...shell({ latestTurn: completed }), status });
    expect(notification.close).not.toHaveBeenCalled();
    expect(state.badge).toHaveBeenLastCalledWith(0);
    notification.dispatchEvent(new Event("click"));
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: EnvironmentId.make("one"), threadId: "thread" },
    });
    complete();
    await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
    expect(TestNotification.sent).toHaveLength(1);
  },
);

// fork: respectful-notifications
it("delivers through Web Locks once granted and skips alerts answered meanwhile", async () => {
  await using app = setup();
  const grants: (() => void)[] = [];
  const storage = new Map<string, string>();
  using _storage = stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  using _navigator = stubGlobal("navigator", {
    locks: {
      request: (_name: string, callback: () => unknown) =>
        new Promise((resolve) => grants.push(() => resolve(callback()))),
    },
  });
  app.start();
  using _timers = fakeTimers();
  complete();
  state.shells.set("two", shell({ hasPendingApprovals: true }));
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  expect(TestNotification.sent).toHaveLength(0);
  state.shells.set("two", shell());
  for (const grant of grants.splice(0)) grant();
  expect(TestNotification.sent.map((notification) => notification.tag)).toEqual([
    threadNotificationTag(EnvironmentId.make("one"), ThreadId.make("thread")),
  ]);
  expect(state.badge).toHaveBeenLastCalledWith(0);
});
