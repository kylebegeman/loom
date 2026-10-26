import { RegistryContext } from "@effect/atom-react";
import { WORKING_EXIT_GRACE_MS } from "@t3tools/client-runtime/state/thread-inbox";
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

import { act, fakeTimers, render, stubGlobal, type Screen } from "../../test/render";

const state = vi.hoisted(() => ({
  mode: "notifications",
  previews: true, // fork: respectful-notifications
  inApp: false,
  toast: vi.fn(),
  shells: null as unknown as { set: (id: string, value: unknown) => void },
  navigate: vi.fn(),
  sound: vi.fn(),
  badge: vi.fn(),
  environmentIds: ["one", "two"],
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
  useParams: (() => ({})) as never,
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
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentIds: (() => state.environmentIds) as never,
}));
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  // fork: respectful-notifications
  useClientSettings: ((
    select: (settings: {
      notificationMode: string;
      inAppNotificationsEnabled: boolean;
      notificationPreviewsEnabled: boolean;
    }) => unknown,
  ) =>
    select({
      notificationMode: state.mode,
      inAppNotificationsEnabled: state.inApp,
      notificationPreviewsEnabled: state.previews,
    })) as never,
  // fork: respectful-notifications
  getClientSettings: (() => ({
    notificationMode: state.mode,
    notificationPreviewsEnabled: state.previews,
  })) as never,
}));
vi.mock(import("../threadNotifications"), async (original) => ({
  ...(await original()),
  playNotificationSound: state.sound,
  unlockNotificationAudio: vi.fn(),
  setNotificationBadge: state.badge,
}));

// fork: respectful-notifications
vi.mock(import("../state/threads"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { selectAttentionThreadShells } = await import("@t3tools/contracts/fork");
  const { presentThreadShell } = await import("@t3tools/client-runtime/state/models");
  return {
    ...actual,
    environmentThreadShells: {
      ...actual.environmentThreadShells,
      attentionThreadShellsAtom: Atom.make((get) =>
        state.environmentIds.flatMap((id) => {
          const value = get(shellAtom(id)) as ReturnType<typeof shell> | null;
          const threads =
            value && Option.isSome(value.snapshot) ? value.snapshot.value.threads : [];
          return selectAttentionThreadShells(threads, Date.now()).map((thread) =>
            presentThreadShell(EnvironmentId.make(id), thread),
          );
        }),
      ),
    },
  };
});
import { environmentThreadShells } from "../state/threads";
// fork: scheduled-task-alerts: covered by its own tests; it would subscribe to tasks here.
vi.mock(import("../fork/scheduled-task-alerts/ScheduledTaskFailureAlerts"), () => ({
  ScheduledTaskFailureAlerts: () => null,
}));

import { ThreadNotificationCoordinator } from "./ThreadNotificationCoordinator";
import { threadNotificationTag } from "../threadNotifications";

let registry: AtomRegistry.AtomRegistry;
const shellAtom = Atom.family((_id: string) => Atom.make<unknown>(null));
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
  latestRunSilent: false,
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
    latestRunSilent: input.latestRunSilent,
    activeRunId: null,
    status:
      latestTurn.state === "completed"
        ? "completed"
        : latestTurn.state === "error" || input.session?.status === "error"
          ? "failed"
          : "running",
    // fork: respectful-notifications
    pendingRuntimeRequest: input.hasPendingUserInput
      ? { id: RuntimeRequestId.make("request-1"), kind: "user_input", createdAt: SHELL_NOW }
      : input.hasPendingApprovals
        ? { id: RuntimeRequestId.make("request-1"), kind: "command", createdAt: SHELL_NOW }
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
// The mocked modules read `state`, the registry and the focus flags, so every test starts by
// resetting them. The first render is left to the test because some tests change state first.
function setup() {
  vi.clearAllMocks();
  const stack = new AsyncDisposableStack();
  registry = AtomRegistry.make();
  const testRegistry = registry;
  stack.defer(() => testRegistry.dispose());
  state.mode = "notifications";
  state.previews = true; // fork: respectful-notifications
  state.inApp = false;
  state.environmentIds = ["one", "two"];
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
  const ui = () => (
    <RegistryContext.Provider value={testRegistry}>
      <ThreadNotificationCoordinator />
    </RegistryContext.Provider>
  );
  let screen: Screen | undefined;
  return {
    ui,
    async render() {
      // fork: respectful-notifications - The test catalog is not itself an atom.
      registry.refresh(environmentThreadShells.attentionThreadShellsAtom);
      if (screen) await screen.rerender(ui());
      else screen = stack.use(await render(ui()));
    },
    unmount: () => screen!.unmount(),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

it.each(["hasPendingApprovals", "hasPendingUserInput"] as const)(
  "keeps %s badged after focus and when notifications are disabled",
  async (flag) => {
    await using app = setup();
    await app.render();
    state.shells.set("one", shell({ [flag]: true }));
    await app.render();
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
    await app.render();
    expect(state.badge).toHaveBeenLastCalledWith(1);
    expect(notification.close).toHaveBeenCalled();
  },
);

it.each([
  ["pre-expiry compaction", true, "completed", []],
  ["manual compaction", false, "completed", ["Thread completed"]],
  ["failed pre-expiry compaction", true, "error", ["Thread failed"]],
] as const)("notifies for %s only when attention is needed", async (_, silent, status, titles) => {
  await using app = setup();
  state.environmentIds = ["one"];
  state.shells.set("one", shell({ latestRunSilent: silent }));
  await using screen = await render(app.ui());
  state.shells.set(
    "one",
    shell({
      latestRunSilent: silent,
      latestTurn: { turnId: "turn", state: status, completedAt: "2026-09-13T07:01:00.000Z" },
    }),
  );
  using _timers = fakeTimers();
  await screen.rerender(app.ui());
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  expect(TestNotification.sent.map((notification) => notification.title)).toEqual(titles);
});

it("holds a completion through a continuation gap and notifies once it settles", async () => {
  await using app = setup();
  await app.render();
  using _timers = fakeTimers();
  const finished = (turnId: string, completedAt: string) => ({
    latestTurn: { turnId, state: "completed", completedAt },
  });
  state.shells.set("one", shell(finished("turn-1", "2026-09-13T07:00:01.000Z")));
  await app.render();
  state.shells.set(
    "one",
    shell({ latestTurn: { turnId: "turn-2", state: "running", completedAt: null } }),
  );
  await app.render();
  state.shells.set("one", shell(finished("turn-2", "2026-09-13T07:00:02.000Z")));
  await app.render();
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
  await app.render();
  state.shells.set("one", { ...shell({ hasPendingApprovals: true }), status: "synchronizing" });
  await app.render();
  expect(TestNotification.sent).toHaveLength(0);
  state.shells.set("one", shell({ hasPendingApprovals: true }));
  await app.render();
  expect(TestNotification.sent.map((notification) => notification.title)).toEqual([
    "Approval needed",
  ]);
  expect(state.badge).toHaveBeenLastCalledWith(1);
});

// fork: respectful-notifications
it("shows thread titles by default and hides them, closing shown previews, when turned off", async () => {
  await using app = setup();
  await app.render();
  using _timers = fakeTimers();
  complete();
  await app.render();
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  const preview = TestNotification.sent[0]!;
  expect(preview.options).toMatchObject({ body: "Test thread", silent: true });
  state.previews = false;
  await app.render();
  expect(preview.close).toHaveBeenCalled();
  complete("two");
  await app.render();
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  expect(TestNotification.sent.at(-1)!.options.body).toBe("Open Loom to review this thread.");
});

// fork: respectful-notifications
it.each(["resolved", "archived", "removed"])(
  "withdraws obsolete approval banners when %s and rejects stale clicks",
  async (condition) => {
    await using app = setup();
    await app.render();
    state.shells.set("one", shell({ hasPendingApprovals: true }));
    await app.render();
    const notification = TestNotification.sent[0]!;
    state.shells.set(
      "one",
      condition === "removed"
        ? { status: "live", snapshot: Option.some({ threads: [] }) }
        : shell({ archivedAt: condition === "archived" ? "2026-09-13T08:00:00Z" : null }),
    );
    await app.render();
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
    await app.render();
    using _timers = fakeTimers();
    complete();
    await app.render();
    await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
    const notification = TestNotification.sent[0]!;
    const completed = { turnId: "turn", state: "completed", completedAt: "2026-09-13T08:00:00Z" };
    state.shells.set("one", { ...shell({ latestTurn: completed }), status });
    await app.render();
    expect(notification.close).not.toHaveBeenCalled();
    expect(state.badge).toHaveBeenLastCalledWith(0);
    notification.dispatchEvent(new Event("click"));
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: EnvironmentId.make("one"), threadId: "thread" },
    });
    complete();
    await app.render();
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
  await app.render();
  using _timers = fakeTimers();
  complete();
  state.shells.set("two", shell({ hasPendingApprovals: true }));
  await app.render();
  await vi.advanceTimersByTimeAsync(WORKING_EXIT_GRACE_MS);
  expect(TestNotification.sent).toHaveLength(0);
  state.shells.set("two", shell());
  await app.render();
  await act(async () => {
    for (const grant of grants.splice(0)) grant();
  });
  expect(TestNotification.sent.map((notification) => notification.tag)).toEqual([
    threadNotificationTag(EnvironmentId.make("one"), ThreadId.make("thread")),
  ]);
  expect(state.badge).toHaveBeenLastCalledWith(0);
});
