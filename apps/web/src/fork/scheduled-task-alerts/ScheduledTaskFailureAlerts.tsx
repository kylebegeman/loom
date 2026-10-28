import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { CalendarX2Icon } from "lucide-react";
import { useEffect, useRef } from "react";

import { toastManager } from "~/components/ui/toast";
import { getClientSettings } from "~/hooks/useSettings";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "~/threadNotifications";
import { systemNotificationBody } from "../respectful-notifications/notificationBody";
import { deliverDesktopNotification } from "../respectful-notifications/notificationDelivery";
import {
  newScheduledTaskFailures,
  scheduledTaskRunMark,
  type ScheduledTaskRunMarks,
} from "./scheduledTaskFailures";

const SCHEDULED_TASKS_PATH = "/settings/scheduled-tasks";

/**
 * A scheduled run that cannot start creates no thread, so the thread alerts never hear of it.
 * This says so, the same way, and opens the task. "Failed" rather than "could not start": a
 * Vault-attached task also reports a started run that did not complete as failed.
 */
export function ScheduledTaskFailureAlerts({
  environmentId,
  onNotification,
}: {
  readonly environmentId: EnvironmentId;
  readonly onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const tasks = query.data?.tasks ?? null;
  const navigate = useNavigate();
  const router = useRouter();
  // Kept through a reconnect, so a run that failed in between is still news.
  const seen = useRef<ScheduledTaskRunMarks | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays sounds and shows toasts or desktop notifications for newly failed scheduled task runs from the server
  useEffect(() => {
    if (tasks === null) return;
    const { marks, failed } = newScheduledTaskFailures(seen.current, tasks);
    seen.current = marks;
    for (const task of failed) {
      const mark = scheduledTaskRunMark(task);
      const reason = task.lastRunError ?? "Its last run failed.";
      const open = () =>
        void navigate({ to: SCHEDULED_TASKS_PATH, search: { environmentId, taskId: task.id } });
      const settings = getClientSettings();
      if (hasNotificationSound(settings.notificationMode)) {
        void playNotificationSound("input", () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (document.visibilityState === "visible" && document.hasFocus()) {
        // The task's own row already shows the error.
        if (!settings.inAppNotificationsEnabled || onTasksPage(router)) continue;
        const toastId = toastManager.add({
          type: "error",
          title: "Scheduled task failed",
          description: `${task.title}: ${reason}`,
          data: {
            hideCopyButton: true,
            leadingIcon: (
              <CalendarX2Icon aria-hidden className="size-4 text-destructive-foreground" />
            ),
          },
          actionProps: {
            children: "Open task",
            onClick: () => {
              toastManager.close(toastId);
              open();
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(settings.notificationMode) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      const stale = () => seen.current?.get(task.id) !== mark;
      deliverDesktopNotification(`${environmentId}:scheduled-task:${task.id}:${mark}`, () => {
        if (
          stale() ||
          !hasDesktopNotifications(getClientSettings().notificationMode) ||
          (document.visibilityState === "visible" && document.hasFocus())
        )
          return false;
        try {
          const notification = new Notification("Scheduled task failed", {
            body: systemNotificationBody(
              `${task.title}: ${reason}`,
              "Open Loom to review this scheduled task.",
            ),
            tag: `scheduled-task:${environmentId}:${task.id}`,
            silent: true,
          });
          onNotification(environmentId, notification);
          notification.addEventListener("click", () => {
            notification.close();
            if (!hasDesktopNotifications(getClientSettings().notificationMode)) return;
            window.focus();
            void window.desktopBridge?.revealWindow?.().catch(() => undefined);
            open();
          });
          return true;
        } catch {
          // Some browsers expose Notification but reject desktop presentation.
          return false;
        }
      });
    }
  }, [environmentId, navigate, onNotification, router, tasks]);

  return null;
}

function onTasksPage(router: ReturnType<typeof useRouter>) {
  return router.state.location.pathname === SCHEDULED_TASKS_PATH;
}
