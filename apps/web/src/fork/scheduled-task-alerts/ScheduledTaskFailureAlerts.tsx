import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";
import { CalendarX2Icon } from "lucide-react";

import { toastManager } from "~/components/ui/toast";
import { getClientSettings } from "~/hooks/useSettings";
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
export function startScheduledTaskFailureAlerts(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
  environmentId: EnvironmentId,
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void,
): () => void {
  // Kept through a reconnect, so a run that failed in between is still news.
  let seen: ScheduledTaskRunMarks | null = null;

  const observe = (tasks: ReadonlyArray<ScheduledTask>) => {
    const { marks, failed } = newScheduledTaskFailures(seen, tasks);
    seen = marks;
    for (const task of failed) {
      const mark = scheduledTaskRunMark(task);
      const reason = task.lastRunError ?? "Its last run failed.";
      const open = () =>
        void router.navigate({
          to: SCHEDULED_TASKS_PATH,
          search: { environmentId, taskId: task.id },
        });
      const settings = getClientSettings();
      if (hasNotificationSound(settings.notificationMode)) {
        void playNotificationSound("input", () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (document.visibilityState === "visible" && document.hasFocus()) {
        // The task's own row already shows the error.
        if (
          !settings.inAppNotificationsEnabled ||
          router.state.location.pathname === SCHEDULED_TASKS_PATH
        )
          continue;
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
      const stale = () => seen?.get(task.id) !== mark;
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
  };

  return registry.subscribe(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
    (result) => {
      const tasks = Option.getOrNull(AsyncResult.value(result))?.tasks;
      if (tasks !== undefined) observe(tasks);
    },
    { immediate: true },
  );
}
