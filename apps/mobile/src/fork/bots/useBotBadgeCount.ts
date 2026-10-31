import { useEffect, useRef } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../../state/query";
import { bots, useBotsChanges, useWaitingBotRuns } from "./state";

export function useBotBadgeCount(
  environmentId: EnvironmentId | null,
  supported: boolean,
  connected: boolean,
): number | null {
  const live = Boolean(environmentId && supported && connected);
  const changes = useBotsChanges(environmentId, live);
  const waiting = useWaitingBotRuns(live ? environmentId : null);
  const waitingKey = JSON.stringify(
    waiting
      .map((thread) => [
        thread.id,
        thread.hasPendingApprovals,
        thread.hasPendingUserInput,
        thread.waitingSince,
      ])
      .sort(),
  );
  const preferences = useEnvironmentQuery(
    environmentId && live ? bots.badgePreferenceChanges({ environmentId, input: {} }) : null,
  );
  const count = useEnvironmentQuery(
    environmentId && live ? bots.badgeCount({ environmentId, input: {} }) : null,
  );
  const refresh = count.refresh;
  const previous = useRef<ReadonlyArray<unknown>>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- invalidates the server badge projection when live job, approval, or preference evidence changes
  useEffect(() => {
    const evidence = [
      environmentId,
      changes.bots,
      changes.runs,
      changes.pruned,
      waitingKey,
      preferences.successResult,
      live,
    ];
    if (!evidence.some((value, index) => value !== previous.current[index])) return;
    previous.current = evidence;
    if (live) refresh();
  }, [
    live,
    environmentId,
    changes.bots,
    changes.runs,
    changes.pruned,
    waitingKey,
    preferences.successResult,
    refresh,
  ]);
  return supported ? (preferences.data?.enabled === false ? 0 : (count.data?.count ?? 0)) : null;
}
