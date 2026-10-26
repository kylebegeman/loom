import type { EnvironmentId } from "@t3tools/contracts";

type TrackNotification = (environmentId: EnvironmentId, notification: Notification) => void;

let tracker: TrackNotification | undefined;

/** The thread notification service shares its open-notification set, so focus closes these too. */
export function setForkNotificationTracker(next: TrackNotification | undefined) {
  tracker = next;
}

export const trackForkNotification: TrackNotification = (environmentId, notification) =>
  tracker?.(environmentId, notification);
