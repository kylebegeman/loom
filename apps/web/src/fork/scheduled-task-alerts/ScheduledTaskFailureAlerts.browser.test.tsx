import { EnvironmentId, ScheduledTaskId, type ScheduledTaskRunStatus } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { stubGlobal } from "../../../test/render";

const state = vi.hoisted(() => ({
  pathname: "/",
  focused: true,
  add: vi.fn(
    (_toast: { title: string; description: string; actionProps: { onClick: () => void } }) =>
      "toast-1",
  ),
  close: vi.fn(),
  navigate: vi.fn(),
  notification: vi.fn(function (_title: string, options: NotificationOptions) {
    return Object.assign(new EventTarget(), { tag: options.tag, close: vi.fn() });
  }),
}));

vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      // Called only after this module's own bindings exist.
      scheduledTasksLive: (() => tasksAtom) as never,
    },
  };
});
vi.mock(import("~/hooks/useSettings"), async (original) => ({
  ...(await original()),
  getClientSettings: (() => ({
    notificationMode: "notifications",
    inAppNotificationsEnabled: true,
    notificationPreviewsEnabled: true,
  })) as never,
}));
vi.mock(import("~/components/ui/toast"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    toastManager: { ...actual.toastManager, add: state.add as never, close: state.close },
  };
});

import { startScheduledTaskFailureAlerts } from "./ScheduledTaskFailureAlerts";

const ENVIRONMENT = EnvironmentId.make("env-1");
const tasksAtom = Atom.make<AsyncResult.AsyncResult<{ tasks: unknown[] }, never>>(
  AsyncResult.initial(true),
);
const task = (lastRunStatus: ScheduledTaskRunStatus, lastRunAt: string) => ({
  id: ScheduledTaskId.make("nightly"),
  title: "Nightly triage",
  lastRunStatus,
  lastRunAt,
  lastRunError: lastRunStatus === "failed" ? "Provider codex is disabled." : null,
});

function setup() {
  vi.clearAllMocks();
  Object.assign(state, { pathname: "/", focused: true });
  const stack = new DisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  stack.use(vi.spyOn(navigator, "locks", "get").mockReturnValue(undefined as never));
  stack.use(vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"));
  stack.use(vi.spyOn(document, "hasFocus").mockImplementation(() => state.focused));
  stack.use(
    stubGlobal("Notification", Object.assign(state.notification, { permission: "granted" })),
  );
  const router = {
    state: {
      location: {
        get pathname() {
          return state.pathname;
        },
      },
    },
    navigate: state.navigate,
  } as unknown as AnyRouter;
  const onNotification = vi.fn();
  stack.defer(startScheduledTaskFailureAlerts(registry, router, ENVIRONMENT, onNotification));
  return {
    onNotification,
    setTasks: (tasks: unknown[]) => registry.set(tasksAtom, AsyncResult.success({ tasks })),
    [Symbol.dispose]: () => stack.dispose(),
  };
}

it("alerts a run that could not start once and opens its task", () => {
  using app = setup();
  app.setTasks([task("failed", "2026-10-24T02:00:00.000Z")]);
  expect(state.add).not.toHaveBeenCalled();
  app.setTasks([task("failed", "2026-10-25T02:00:00.000Z")]);
  app.setTasks([task("failed", "2026-10-25T02:00:00.000Z")]);
  expect(state.add).toHaveBeenCalledTimes(1);
  const toast = state.add.mock.calls[0]?.[0];
  expect(toast).toMatchObject({
    title: "Scheduled task failed",
    description: "Nightly triage: Provider codex is disabled.",
  });
  toast?.actionProps.onClick();
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/settings/scheduled-tasks",
    search: { environmentId: ENVIRONMENT, taskId: "nightly" },
  });
});

it("stays quiet on the task's own page and uses a system alert in the background", () => {
  using app = setup();
  app.setTasks([task("running", "2026-10-25T02:00:00.000Z")]);
  state.pathname = "/settings/scheduled-tasks";
  app.setTasks([task("failed", "2026-10-25T02:00:00.000Z")]);
  expect(state.add).not.toHaveBeenCalled();

  state.focused = false;
  app.setTasks([task("failed", "2026-10-25T03:00:00.000Z")]);
  expect(state.notification).toHaveBeenCalledWith("Scheduled task failed", {
    body: "Nightly triage: Provider codex is disabled.",
    tag: "scheduled-task:env-1:nightly",
    silent: true,
  });
  expect(app.onNotification).toHaveBeenCalledTimes(1);
});
