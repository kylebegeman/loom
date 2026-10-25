import { EnvironmentId, ScheduledTaskId, type ScheduledTaskRunStatus } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  tasks: null as unknown[] | null,
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

vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: state.tasks === null ? null : { tasks: state.tasks },
  })) as never,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
  useRouter: (() => ({ state: { location: { pathname: state.pathname } } })) as never,
}));
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

import { ScheduledTaskFailureAlerts } from "./ScheduledTaskFailureAlerts";

const ENVIRONMENT = EnvironmentId.make("env-1");
const task = (lastRunStatus: ScheduledTaskRunStatus, lastRunAt: string) => ({
  id: ScheduledTaskId.make("nightly"),
  title: "Nightly triage",
  lastRunStatus,
  lastRunAt,
  lastRunError: lastRunStatus === "failed" ? "Provider codex is disabled." : null,
});

let root: Root;
const onNotification = vi.fn();
async function render() {
  await act(() =>
    root.render(
      <ScheduledTaskFailureAlerts environmentId={ENVIRONMENT} onNotification={onNotification} />,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { tasks: null, pathname: "/", focused: true });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "locks", "get").mockReturnValue(undefined as never);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "hasFocus").mockImplementation(() => state.focused);
  vi.stubGlobal("Notification", Object.assign(state.notification, { permission: "granted" }));
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("alerts a run that could not start once and opens its task", async () => {
  state.tasks = [task("failed", "2026-10-24T02:00:00.000Z")];
  await render();
  expect(state.add).not.toHaveBeenCalled();
  state.tasks = [task("failed", "2026-10-25T02:00:00.000Z")];
  await render();
  state.tasks = [task("failed", "2026-10-25T02:00:00.000Z")];
  await render();
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

it("stays quiet on the task's own page and uses a system alert in the background", async () => {
  state.tasks = [task("running", "2026-10-25T02:00:00.000Z")];
  await render();
  state.pathname = "/settings/scheduled-tasks";
  state.tasks = [task("failed", "2026-10-25T02:00:00.000Z")];
  await render();
  expect(state.add).not.toHaveBeenCalled();

  state.focused = false;
  state.tasks = [task("failed", "2026-10-25T03:00:00.000Z")];
  await render();
  expect(state.notification).toHaveBeenCalledWith("Scheduled task failed", {
    body: "Nightly triage: Provider codex is disabled.",
    tag: "scheduled-task:env-1:nightly",
    silent: true,
  });
  expect(onNotification).toHaveBeenCalledTimes(1);
});
