// @effect-diagnostics-next-line nodeBuiltinImport:off -- A collapse id is a synchronous SHA-256 digest, which keeps the payload builders pure.
import * as NodeCrypto from "node:crypto";

import type { EnvironmentId } from "@t3tools/contracts";
import {
  type LibraryPushActivityKind,
  type LibraryPushActivityRequest,
  isBotRunThreadId,
  VAULT_APPROVAL_PENDING_MS,
} from "@t3tools/contracts/fork";

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

const AGENT_ALERT_TEXT: Readonly<Record<LibraryPushActivityKind, string>> = {
  approval: "An agent needs your approval.",
  input: "An agent is waiting for your answer.",
  failed: "An agent run failed.",
  limited: "An agent reached a usage limit.",
  completed: "An agent finished.",
  "vault-approval": "An agent is asking for Vault access.",
  "scheduled-failed": "A scheduled task failed.",
};

/**
 * Apple caps `apns-collapse-id` at 64 bytes and ids have no length limit, so the thread is named
 * by a digest. Every agent kind shares one id, so a thread keeps one notification that the latest
 * replaces. A Vault request has its own, so the run finishing never hides a decision still due.
 */
const collapseId = (prefix: string, environmentId: EnvironmentId, threadId: string) =>
  `${prefix}-${NodeCrypto.createHash("sha256")
    .update(`${environmentId}\0${threadId}`)
    .digest("base64url")
    .slice(0, 22)}`;

/**
 * The text names no thread, project, computer, model or Vault item, so none reaches Apple or the
 * lock screen. Thread and Vault requests open their thread; bot requests open the inbox.
 * Scheduled failures carry only a task id and open scheduled tasks.
 */
export const agentAlertRequest = (
  input: LibraryPushActivityRequest & {
    readonly environmentId: EnvironmentId;
  },
): ApnsAlertRequest => {
  const environment = encodeURIComponent(input.environmentId);
  const vault = input.kind === "vault-approval";
  const scheduled = input.kind === "scheduled-failed";
  const id = scheduled ? input.taskId : input.threadId;
  const bot = !scheduled && !vault && isBotRunThreadId(input.threadId);
  const deepLink = scheduled
    ? `/settings/scheduled-tasks?environmentId=${environment}&taskId=${encodeURIComponent(input.taskId)}`
    : bot
      ? `/bots/${environment}/inbox`
      : `/threads/${environment}/${encodeURIComponent(input.threadId)}`;
  return {
    payload: alertPayload({
      title: "Loom",
      body:
        bot && (input.kind === "approval" || input.kind === "input")
          ? input.kind === "approval"
            ? "A bot needs your approval."
            : "A bot is waiting for your answer."
          : AGENT_ALERT_TEXT[input.kind],
      threadId: `${input.environmentId}/${id}`,
      data: {
        environmentId: input.environmentId,
        ...(scheduled ? { taskId: input.taskId } : { threadId: input.threadId }),
        deepLink,
      },
    }),
    priority: 10,
    expiresInSeconds: vault ? VAULT_APPROVAL_PENDING_MS / 1000 : 300,
    collapseId: collapseId(
      vault ? "loom-vault" : scheduled ? "loom-scheduled" : "loom-agent",
      input.environmentId,
      id,
    ),
  };
};
