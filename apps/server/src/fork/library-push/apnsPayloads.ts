/**
 * APNs alert payloads, ported from `makePushNotificationRequest` in
 * infra/relay/src/agentActivity/ApnsClient.ts. The relay is a separately deployed Worker package
 * that apps/server cannot import. Keep the shapes in step so the iPhone app's existing handling
 * (notificationPayload.ts) reads both the same way.
 */

export interface ApnsAlert {
  readonly title: string;
  readonly body: string;
  /** Groups alerts with the same id in Notification Center. */
  readonly threadId?: string;
  /** Expo on iOS exposes `userInfo.body` as `notification.content.data` for remote pushes. */
  readonly data?: Readonly<Record<string, string>>;
}

export interface ApnsAlertPayload {
  readonly aps: {
    readonly alert: { readonly title: string; readonly body: string };
    readonly sound: "default";
    readonly "thread-id"?: string;
  };
  readonly body?: Readonly<Record<string, string>>;
}

export interface ApnsAlertRequest {
  readonly payload: ApnsAlertPayload;
  readonly priority: 5 | 10;
  /** How long APNs keeps trying an offline device. A late alert is worse than none. */
  readonly expiresInSeconds: number;
  /** Alerts sharing an id replace each other on the device instead of stacking. */
  readonly collapseId?: string;
}

export const alertPayload = (alert: ApnsAlert): ApnsAlertPayload => ({
  aps: {
    alert: { title: alert.title, body: alert.body },
    sound: "default",
    ...(alert.threadId === undefined ? {} : { "thread-id": alert.threadId }),
  },
  ...(alert.data === undefined ? {} : { body: alert.data }),
});

/**
 * The fixed test push. It carries no custom data, so a tap only opens the app, and it names no
 * thread, project or computer, so nothing private reaches Apple or the lock screen.
 */
export const LIBRARY_PUSH_TEST_ALERT: ApnsAlertRequest = {
  payload: alertPayload({ title: "Loom", body: "Test notification from your Library" }),
  priority: 10,
  expiresInSeconds: 300,
  collapseId: "loom-push-test",
};
