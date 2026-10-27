import {
  type EnvironmentThreadShell,
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/threads";
import type { AnyRouter } from "@tanstack/react-router";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { isBotRunThreadId } from "@t3tools/contracts/fork"; // fork: bots
import type { ClientSettings } from "@t3tools/contracts/settings";
// fork: respectful-notifications
import { threadCompletionAlertMuted } from "@t3tools/shared/fork/thread-alerts";
import * as DateTime from "effect/DateTime"; // fork: respectful-notifications
import * as Option from "effect/Option";
import type { AtomRegistry } from "effect/reactivity";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";

// fork: respectful-notifications
import { startAttentionBadge } from "../fork/attention/attentionBadge";
// fork: respectful-notifications
import { systemNotificationBody } from "../fork/respectful-notifications/notificationBody";
// fork: respectful-notifications
import { deliverDesktopNotification } from "../fork/respectful-notifications/notificationDelivery";
import { getClientSettings, subscribeClientSettings } from "../hooks/useSettings";
import { isWindowsPlatform } from "../lib/utils";
import { environmentSummaries } from "../state/presentation";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  // fork: respectful-notifications -- startAttentionBadge sets the badge
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

interface NotificationState extends ThreadNotificationObservation {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly thread: EnvironmentThreadShell;
  readonly status: SidebarThreadStatus;
}

interface WatchedEnvironment {
  unsubscribe: () => void;
  previous: Map<ThreadId, NotificationState>;
  readonly gate: ReturnType<typeof createThreadNotificationGate<ThreadId>>;
  // fork: respectful-notifications
  seeded: boolean;
  resync: boolean; // fork: respectful-notifications
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

// fork: scheduled-task-alerts - fork alerts join the pending set, so focus and settings close them
let trackForkNotification:
  | ((environmentId: EnvironmentId, notification: Notification) => void)
  | undefined;
// fork: scheduled-task-alerts
export const trackThreadNotification = (environmentId: EnvironmentId, notification: Notification) =>
  trackForkNotification?.(environmentId, notification);

/**
 * Turns thread status transitions in every connected environment into sounds, in-app toasts,
 * and desktop notifications, and keeps the dock badge in step with the unread ones.
 */
export function startThreadNotifications(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  const pending = new Map<string, { environmentId: EnvironmentId; notification: Notification }>();
  const watched = new Map<EnvironmentId, WatchedEnvironment>();
  // fork: respectful-notifications - the badge counts threads that need the user, not alerts
  const stopAttentionBadge = startAttentionBadge(registry);

  const trackNotification = (environmentId: EnvironmentId, notification: Notification) => {
    pending.get(notification.tag)?.notification.close();
    pending.set(notification.tag, { environmentId, notification });
    // fork: respectful-notifications
    notification.addEventListener("close", () => {
      if (pending.get(notification.tag)?.notification !== notification) return;
      pending.delete(notification.tag); // fork: respectful-notifications
    });
  };
  trackForkNotification = trackNotification; // fork: scheduled-task-alerts
  const clearPending = () => {
    for (const { notification } of pending.values()) notification.close();
    pending.clear(); // fork: respectful-notifications
  };
  // fork: respectful-notifications
  const clearNotification = (tag: string) => {
    const value = pending.get(tag);
    if (!value) return;
    value.notification.close();
    pending.delete(tag); // fork: respectful-notifications
  };

  // Completions fire from a timer, so read settings, focus and route when presenting.
  const present = (
    environmentId: EnvironmentId,
    state: NotificationState,
    kind: ThreadNotificationKind,
  ) => {
    // fork: respectful-notifications
    const { thread, status, raw: rawThread, attention, completedAt } = state;
    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    const active = (router.state.matches.at(-1)?.params ?? {}) as {
      environmentId?: string;
      threadId?: string;
    };
    const botRun = isBotRunThreadId(thread.id); // fork: bots
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
      (active.environmentId !== environmentId || active.threadId !== thread.id)
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
            void router.navigate({
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
      const latest = watched.get(environmentId)?.previous.get(thread.id);
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
      `${environmentId}:${thread.id}:${rawThread.latestRunId}:${attention ?? completedAt}`,
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
            // Windows drops clicks after a toast moves into Notification Center.
            requireInteraction: kind === "completion" && isWindowsPlatform(navigator.platform),
          });
          trackNotification(environmentId, notification);
          notification.addEventListener("click", () => {
            notification.close();
            // fork: respectful-notifications
            if (!hasDesktopNotifications(getClientSettings().notificationMode) || stale()) return;
            window.focus();
            void window.desktopBridge?.revealWindow?.().catch(() => undefined);
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: thread.id },
            });
          });
          return true; // fork: respectful-notifications
        } catch {
          // Some browsers expose Notification but reject desktop presentation.
          return false; // fork: respectful-notifications
        }
      },
    );
  };

  const observeThreads = (
    environmentId: EnvironmentId,
    entry: WatchedEnvironment,
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  ) => {
    const previous = entry.previous;
    // fork: respectful-notifications
    const resyncing = entry.resync;
    entry.resync = false;
    entry.seeded = true;
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe()); // fork: respectful-notifications
    const next = new Map<ThreadId, NotificationState>();
    const subagentRequests = pendingSubagentRequestsByThread(threads);
    const changed: Array<[NotificationState | undefined, NotificationState]> = [];
    for (const rawThread of threads) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
      const prior = previous.get(rawThread.id);
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
        status === "limited" || // fork: respectful-notifications
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
        clearNotification(threadNotificationTag(environmentId, thread.id));
      changed.push([prior, state]);
    }
    // fork: respectful-notifications
    for (const id of previous.keys())
      if (!next.has(id)) clearNotification(threadNotificationTag(environmentId, id));
    entry.previous = next;
    entry.gate.retain(new Set(next.keys()));
    for (const [prior, state] of changed) {
      entry.gate.observe(
        state.thread.id,
        prior ?? (resyncing ? UNSEEN_THREAD : undefined), // fork: respectful-notifications
        state,
        {
          archived: state.thread.archivedAt !== null,
          quiet:
            state.raw.latestRunStopRequested === true ||
            // fork: respectful-notifications - after a gap, only a recent completion is news
            (resyncing &&
              state.completedAt !== null &&
              now - state.completedAt > RESYNC_COMPLETION_WINDOW_MS),
        },
      );
    }
  };

  const watchEnvironment = (environmentId: EnvironmentId): WatchedEnvironment => {
    const entry: WatchedEnvironment = {
      previous: new Map(),
      unsubscribe: () => {},
      gate: createThreadNotificationGate<ThreadId>((threadId, kind) => {
        const state = entry.previous.get(threadId);
        if (state) present(environmentId, state, kind);
      }),
      // fork: respectful-notifications
      seeded: false,
      resync: false, // fork: respectful-notifications
    };
    const unsubscribeShell = registry.subscribe(
      environmentShell.stateValueAtom(environmentId),
      (shell) => {
        // fork: respectful-notifications
        const snapshot = Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
        const threads = shell.status === "live" ? snapshot : null; // fork: respectful-notifications
        if (threads !== null) {
          observeThreads(environmentId, entry, threads);
          return;
        }
        // fork: respectful-notifications
        // The last known state outlives a disconnect, and the cached snapshot seeds it at launch,
        // so the next live snapshot can announce what changed in between.
        if (!entry.seeded && snapshot !== null) observeThreads(environmentId, entry, snapshot);
        entry.resync = entry.seeded; // fork: respectful-notifications
      },
      { immediate: true },
    );
    entry.unsubscribe = () => {
      unsubscribeShell();
      entry.gate.clear();
    };
    return entry;
  };

  const syncEnvironments = () => {
    const { notificationMode, inAppNotificationsEnabled } = getClientSettings();
    const enabled = notificationMode !== "off" || inAppNotificationsEnabled;
    const environmentIds = enabled ? registry.get(environmentSummaries.environmentIdsAtom) : [];
    const activeIds = new Set(environmentIds);
    for (const [environmentId, entry] of watched) {
      if (activeIds.has(environmentId)) continue;
      entry.unsubscribe();
      watched.delete(environmentId);
    }
    for (const environmentId of environmentIds) {
      if (!watched.has(environmentId)) watched.set(environmentId, watchEnvironment(environmentId));
    }
  };

  const pruneRemovedEnvironments = () => {
    const activeIds = new Set(registry.get(environmentSummaries.environmentIdsAtom));
    // fork: respectful-notifications
    for (const [tag, entry] of pending) {
      if (activeIds.has(entry.environmentId)) continue;
      entry.notification.close();
      pending.delete(tag);
    }
    // fork: respectful-notifications -- startAttentionBadge keeps the badge count
  };

  // Listeners that only exist for some notification modes, rebuilt when the mode changes.
  let appliedMode: ClientSettings["notificationMode"] | null = null;
  let stopModeListeners = () => {};
  const applyMode = () => {
    const nextMode = getClientSettings().notificationMode;
    if (nextMode === appliedMode) return;
    appliedMode = nextMode;
    stopModeListeners();
    clearPending();
    const stops: Array<() => void> = [];
    if (hasDesktopNotifications(nextMode)) {
      const unsubscribeBadgeClear = window.desktopBridge?.onNotificationBadgeClear?.(clearPending);
      window.addEventListener("focus", clearPending);
      stops.push(() => {
        unsubscribeBadgeClear?.();
        window.removeEventListener("focus", clearPending);
        clearPending();
      });
    }
    if (hasNotificationSound(nextMode)) {
      document.addEventListener("pointerdown", unlockNotificationAudio);
      document.addEventListener("keydown", unlockNotificationAudio);
      stops.push(() => {
        document.removeEventListener("pointerdown", unlockNotificationAudio);
        document.removeEventListener("keydown", unlockNotificationAudio);
      });
    }
    stopModeListeners = () => {
      for (const stop of stops) stop();
    };
  };

  // fork: respectful-notifications - turning previews off withdraws the alerts already shown
  let appliedPreviews: boolean | null = null;
  // fork: respectful-notifications
  const applyPreviews = () => {
    const previews = getClientSettings().notificationPreviewsEnabled;
    if (previews === appliedPreviews) return;
    appliedPreviews = previews;
    if (!previews) clearPending();
  };

  const onSettings = () => {
    applyMode();
    applyPreviews(); // fork: respectful-notifications
    syncEnvironments();
  };
  const unsubscribeSettings = subscribeClientSettings(onSettings);
  const unsubscribeEnvironmentIds = registry.subscribe(
    environmentSummaries.environmentIdsAtom,
    () => {
      pruneRemovedEnvironments();
      syncEnvironments();
    },
  );
  onSettings();

  return () => {
    unsubscribeSettings();
    unsubscribeEnvironmentIds();
    for (const entry of watched.values()) entry.unsubscribe();
    watched.clear();
    stopModeListeners();
    stopAttentionBadge(); // fork: respectful-notifications
  };
}
