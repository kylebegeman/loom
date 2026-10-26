// fork: respectful-notifications
import { useAttentionBadge } from "../fork/attention/useAttentionBadge";
import {
  type EnvironmentThreadShell,
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
import { Fragment, useEffect, useEffectEvent, useRef } from "react"; // fork: scheduled-task-alerts

// fork: respectful-notifications
import { systemNotificationBody } from "../fork/respectful-notifications/notificationBody";
// fork: respectful-notifications
import { deliverDesktopNotification } from "../fork/respectful-notifications/notificationDelivery";
// fork: scheduled-task-alerts
import { ScheduledTaskFailureAlerts } from "../fork/scheduled-task-alerts/ScheduledTaskFailureAlerts";
import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironmentIds } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  threadNotificationTag,
  unlockNotificationAudio,
} from "../threadNotifications";
import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "./Sidebar.logic";
import {
  createThreadNotificationGate,
  type ThreadNotificationKind,
  type ThreadNotificationObservation,
} from "./ThreadNotificationCoordinator.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  // fork: respectful-notifications
  useAttentionBadge();
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
      pending.current.delete(notification.tag); // fork: respectful-notifications
    });
  };

  // fork: respectful-notifications
  const onClear = (tag: string) => {
    const value = pending.current.get(tag);
    if (!value) return;
    value.notification.close();
    pending.current.delete(tag); // fork: respectful-notifications
  };

  useEffect(() => {
    const activeIds = new Set(environmentIds);
    // fork: respectful-notifications
    for (const [tag, entry] of pending.current) {
      if (activeIds.has(entry.environmentId)) continue;
      entry.notification.close();
      pending.current.delete(tag);
    }
  }, [environmentIds]);

  // fork: respectful-notifications
  useEffect(() => {
    if (previews) return;
    for (const { notification } of pending.current.values()) notification.close();
    pending.current.clear(); // fork: respectful-notifications
  }, [previews]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear(); // fork: respectful-notifications
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
    <Fragment key={environmentId}>
      <EnvironmentNotifications
        environmentId={environmentId}
        onNotification={onNotification}
        onClear={onClear} // fork: respectful-notifications
      />
      {/* fork: scheduled-task-alerts */}
      <ScheduledTaskFailureAlerts environmentId={environmentId} onNotification={onNotification} />
    </Fragment>
  ));
}

interface NotificationState extends ThreadNotificationObservation {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly thread: EnvironmentThreadShell;
  readonly status: SidebarThreadStatus;
}

// fork: respectful-notifications
/** After a gap, only this recent a completion is news; older ones would land as a burst on wake. */
const RESYNC_COMPLETION_WINDOW_MS = 10 * 60 * 1_000;
// fork: respectful-notifications - after a gap, a thread first seen now is news as well
const UNSEEN_THREAD: ThreadNotificationObservation = {
  attention: null,
  settled: false,
  completedAt: null,
};

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

  // Completions fire from a timer, so read settings, focus and route when presenting.
  const present = useEffectEvent((threadId: ThreadId, kind: ThreadNotificationKind) => {
    const entry = previous.current.get(threadId);
    if (!entry) return;
    const { thread, status, raw: rawThread, attention, completedAt } = entry;
    const botRun = isBotRunThreadId(threadId); // fork: bots
    // fork: respectful-notifications - parked threads keep their own completions quiet
    if (kind === "completion" && threadCompletionAlertMuted(rawThread, DateTime.nowUnsafe())) {
      return;
    }
    // fork: bots - the Bots page reports runs; only a run waiting on a person alerts
    if (botRun && status !== "approval" && status !== "input") return;
    // fork: bots
    const title = botRun
      ? status === "approval"
        ? "Bot needs approval"
        : "Bot needs input"
      : kind === "completion"
        ? "Thread completed"
        : // fork: respectful-notifications
          status === "paused"
          ? "Queue paused"
          : status === "approval"
            ? "Approval needed"
            : status === "limited"
              ? "Usage limit reached"
              : status === "failed"
                ? "Thread failed"
                : status === "request"
                  ? "Guest request"
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
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      (document.visibilityState === "visible" && document.hasFocus()) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    // fork: respectful-notifications
    const stale = () => {
      // The last known state stands through a resync, so an alert stays usable meanwhile.
      const latest = previous.current.get(threadId);
      return (
        latest === undefined ||
        latest.raw.archivedAt !== null ||
        latest.attention !== attention ||
        latest.completedAt !== completedAt ||
        latest.raw.latestRunId !== rawThread.latestRunId
      );
    };
    // fork: respectful-notifications
    deliverDesktopNotification(
      `${environmentId}:${threadId}:${rawThread.latestRunId}:${attention ?? completedAt}`,
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
  });
  const gate = useRef<ReturnType<typeof createThreadNotificationGate<ThreadId>>>(null);
  useEffect(() => {
    const created = createThreadNotificationGate<ThreadId>((threadId, kind) =>
      present(threadId, kind),
    );
    gate.current = created;
    return () => {
      created.clear();
      gate.current = null;
      // A new gate has no pending completions, so forget the states they compared against.
      previous.current.clear();
      // fork: respectful-notifications
      seeded.current = false;
      resync.current = false;
    };
  }, []);

  useEffect(() => {
    const pendingCompletions = gate.current;
    if (!pendingCompletions) return;
    // fork: respectful-notifications
    // The last known state outlives a disconnect, and the cached snapshot seeds it at launch, so
    // the next live snapshot can announce what changed in between.
    if (threads === null) resync.current = seeded.current || snapshot !== null;
    const current = threads ?? (seeded.current ? null : snapshot);
    if (current === null) return;
    const resyncing = threads !== null && resync.current;
    if (threads !== null) resync.current = false;
    seeded.current = true;
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe()); // fork: respectful-notifications
    const next = new Map<ThreadId, NotificationState>();
    const subagentRequests = pendingSubagentRequestsByThread(current); // fork: respectful-notifications
    const changed: Array<[NotificationState | undefined, NotificationState]> = [];
    for (const rawThread of current) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
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
        status === "input" ||
        status === "request" ||
        status === "approval" ||
        status === "failed" ||
        status === "limited" ||
        status === "paused"
          ? `${thread.latestRun?.runId ?? ""}:${rawThread.pendingRuntimeRequest?.id ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      const settled = status === "ready" && thread.latestRun?.status === "completed";
      const state = {
        raw: rawThread,
        subagentRequest,
        thread,
        status,
        attention,
        settled,
        completedAt: settled && Number.isFinite(completedAt) ? completedAt : null,
      };
      next.set(thread.id, state);
      // fork: respectful-notifications
      if (
        prior &&
        (thread.archivedAt !== null ||
          attention !== prior.attention ||
          rawThread.latestRunId !== prior.raw.latestRunId ||
          state.completedAt !== prior.completedAt)
      )
        onClear(threadNotificationTag(environmentId, thread.id));
      changed.push([prior, state]);
    }
    // fork: respectful-notifications
    for (const id of previous.current.keys())
      if (!next.has(id)) onClear(threadNotificationTag(environmentId, id));
    previous.current = next;
    pendingCompletions.retain(new Set(next.keys()));
    for (const [prior, state] of changed) {
      pendingCompletions.observe(
        state.thread.id,
        prior ?? (resyncing ? UNSEEN_THREAD : undefined), // fork: respectful-notifications
        state,
        {
          archived: state.thread.archivedAt !== null,
          quiet:
            state.raw.latestRunStopRequested === true ||
            state.raw.latestRunSilent === true ||
            // fork: respectful-notifications - after a gap, only a recent completion is news
            (resyncing &&
              state.completedAt !== null &&
              now - state.completedAt > RESYNC_COMPLETION_WINDOW_MS),
        },
      );
    }
  }, [
    environmentId,
    onClear, // fork: respectful-notifications
    snapshot, // fork: respectful-notifications
    threads,
  ]);

  return null;
}
