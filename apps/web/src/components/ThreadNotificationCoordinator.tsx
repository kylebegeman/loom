import {
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/threads";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { isBotRunThreadId } from "@t3tools/contracts/fork";
// fork: respectful-notifications
import { threadCompletionAlertMuted } from "@t3tools/shared/fork/thread-alerts";
import * as DateTime from "effect/DateTime"; // fork: respectful-notifications
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

// fork: respectful-notifications
import { systemNotificationBody } from "../fork/respectful-notifications/notificationBody";
// fork: respectful-notifications
import { deliverDesktopNotification } from "../fork/respectful-notifications/notificationDelivery";
import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironmentIds } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  threadNotificationTag,
  unlockNotificationAudio,
} from "../threadNotifications";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  const environmentIds = useEnvironmentIds();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  // fork: respectful-notifications
  const previews = useClientSettings((settings) => settings.notificationPreviewsEnabled);
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = (environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    // fork: respectful-notifications
    notification.addEventListener("close", () => {
      if (pending.current.get(notification.tag)?.notification !== notification) return;
      pending.current.delete(notification.tag);
      setNotificationBadge(pending.current.size);
    });
    setNotificationBadge(pending.current.size);
  };

  // fork: respectful-notifications
  const onClear = (tag: string) => {
    const value = pending.current.get(tag);
    if (!value) return;
    value.notification.close();
    pending.current.delete(tag);
    setNotificationBadge(pending.current.size);
  };

  useEffect(() => {
    const activeIds = new Set(environmentIds);
    const count = pending.current.size;
    for (const [tag, entry] of pending.current) {
      if (activeIds.has(entry.environmentId)) continue;
      entry.notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environmentIds]);

  // fork: respectful-notifications
  useEffect(() => {
    if (previews) return;
    for (const { notification } of pending.current.values()) notification.close();
    pending.current.clear();
    setNotificationBadge(0);
  }, [previews]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  if (mode === "off" && !inAppNotificationsEnabled) return null;

  return environmentIds.map((environmentId) => (
    <EnvironmentNotifications
      key={environmentId}
      environmentId={environmentId}
      onNotification={onNotification}
      onClear={onClear} // fork: respectful-notifications
    />
  ));
}

interface NotificationState {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly attention: string | null;
  readonly completion: number | null;
}

// fork: respectful-notifications
/** After a gap, only this recent a completion is news; older ones would land as a burst on wake. */
const RESYNC_COMPLETION_WINDOW_MS = 10 * 60 * 1_000;

function EnvironmentNotifications({
  environmentId,
  onNotification,
  onClear, // fork: respectful-notifications
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
  onClear: (tag: string) => void; // fork: respectful-notifications
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  // fork: respectful-notifications
  const snapshot = Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const threads = shell.status === "live" ? snapshot : null; // fork: respectful-notifications
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const previous = useRef(new Map<ThreadId, NotificationState>());
  // fork: respectful-notifications
  const seeded = useRef(false);
  const resync = useRef(false); // fork: respectful-notifications

  useEffect(() => {
    // fork: respectful-notifications
    // The last known state outlives a disconnect, and the cached snapshot seeds it at launch, so
    // the next live snapshot can announce what changed in between.
    if (threads === null) resync.current = seeded.current || snapshot !== null;
    const current = threads ?? (seeded.current ? null : snapshot);
    if (current === null) return;
    const resyncing = threads !== null && resync.current;
    if (threads !== null) resync.current = false;
    seeded.current = true;
    const now = DateTime.nowUnsafe();
    const next = new Map<ThreadId, NotificationState>();
    const subagentRequests = pendingSubagentRequestsByThread(current); // fork: respectful-notifications
    for (const rawThread of current) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
      const botRun = isBotRunThreadId(rawThread.id); // fork: bots
      const prior = previous.current.get(rawThread.id);
      const subagentRequest = subagentRequests.get(rawThread.id) ?? null;
      if (prior?.raw === rawThread && prior.subagentRequest === subagentRequest) {
        next.set(rawThread.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, rawThread, subagentRequest);
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
      // fork: respectful-notifications
      const attention =
        status === "input" || status === "approval" || status === "failed" || status === "limited"
          ? `${thread.latestRun?.runId ?? ""}:${rawThread.pendingRuntimeRequest?.id ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestRun?.status === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { raw: rawThread, subagentRequest, attention, completion });
      // fork: respectful-notifications
      if (
        prior &&
        (thread.archivedAt !== null ||
          attention !== prior.attention ||
          rawThread.latestRunId !== prior.raw.latestRunId ||
          completion !== prior.completion)
      )
        onClear(threadNotificationTag(environmentId, thread.id));
      // fork: respectful-notifications - after a gap, a thread first seen now is news as well
      if ((!prior && !resyncing) || thread.archivedAt !== null) continue;
      // fork: respectful-notifications
      const kind =
        attention && attention !== prior?.attention
          ? "input"
          : completion !== null &&
              (prior?.completion == null || completion > prior.completion) &&
              (!resyncing || DateTime.toEpochMillis(now) - completion <= RESYNC_COMPLETION_WINDOW_MS)
            ? "completion"
            : null;
      if (!kind) continue;
      // fork: respectful-notifications - parked threads keep their own completions quiet
      if (kind === "completion" && threadCompletionAlertMuted(rawThread, now)) continue;
      // fork: bots - the Bots page reports runs; only a run waiting on a person alerts
      if (botRun && status !== "approval" && status !== "input") continue;
      // fork: bots
      const title = botRun
        ? status === "approval"
          ? "Bot needs approval"
          : "Bot needs input"
        : kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "limited"
              ? "Usage limit reached"
              : status === "failed"
                ? "Thread failed"
                : "Input needed";
      if (hasNotificationSound(mode)) {
        void playNotificationSound(kind, () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (
        inAppNotificationsEnabled &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        (activeEnvironmentId !== environmentId || activeThreadId !== thread.id)
      ) {
        const toastId = toastManager.add({
          type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
          title,
          description: thread.title,
          data: {
            hideCopyButton: true,
            leadingIcon:
              kind === "completion" ? (
                <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
              ) : status === "approval" ? (
                <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
              ) : status === "failed" ? (
                <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
              ) : (
                <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
              ),
          },
          actionProps: {
            children: "Open thread",
            onClick: () => {
              toastManager.close(toastId);
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: thread.id },
              });
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus()) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      // fork: respectful-notifications
      previous.current.set(thread.id, next.get(thread.id)!);
      // fork: respectful-notifications
      const stale = () => {
        // The last known state stands through a resync, so an alert stays usable meanwhile.
        const latest = previous.current.get(thread.id);
        return (
          latest === undefined ||
          latest.raw.archivedAt !== null ||
          latest.attention !== attention ||
          latest.completion !== completion ||
          latest.raw.latestRunId !== rawThread.latestRunId
        );
      };
      // fork: respectful-notifications
      deliverDesktopNotification(
        `${environmentId}:${thread.id}:${rawThread.latestRunId}:${attention ?? completion}`,
        () => {
          if (
            stale() ||
            !hasDesktopNotifications(getClientSettings().notificationMode) ||
            (document.visibilityState === "visible" && document.hasFocus())
          )
            return false;
          try {
            const notification = new Notification(title, {
              body: systemNotificationBody(
                thread.title,
                botRun ? "Open Loom to answer this bot run." : "Open Loom to review this thread.", // fork: bots
              ),
              tag: threadNotificationTag(environmentId, thread.id),
              silent: true,
            });
            onNotification(environmentId, notification);
            notification.addEventListener("click", () => {
              notification.close();
              if (!hasDesktopNotifications(getClientSettings().notificationMode) || stale()) return;
              window.focus();
              void window.desktopBridge?.revealWindow?.().catch(() => undefined);
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: thread.id },
              });
            });
            return true;
          } catch {
            // Some browsers expose Notification but reject desktop presentation.
            return false;
          }
        },
      );
    }
    // fork: respectful-notifications
    for (const id of previous.current.keys())
      if (!next.has(id)) onClear(threadNotificationTag(environmentId, id));
    previous.current = next;
  }, [
    activeEnvironmentId,
    activeThreadId,
    environmentId,
    inAppNotificationsEnabled,
    mode,
    navigate,
    onNotification,
    onClear, // fork: respectful-notifications
    snapshot, // fork: respectful-notifications
    threads,
  ]);

  return null;
}
