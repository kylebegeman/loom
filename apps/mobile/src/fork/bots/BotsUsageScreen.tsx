import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import type { BotBudgetState, BotUsageRow } from "@t3tools/contracts/fork";
import { formatCount, formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { BotChoice, BotPage, BotSection } from "./BotControls";
import { rollingBotsUsageWindow } from "@t3tools/client-runtime/fork";
import { budgetStatus, formatDuration } from "./historyLogic";
import { bots, useBotsCapabilities, useBotsCollection, useBotsReconnect } from "./state";

type Params = { environmentId: string; botId?: string };
const WINDOWS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const;
const REFRESH_INTERVAL_MS = 5_000;

export function BotsUsageRouteScreen({ route }: StaticScreenProps<Params>) {
  return (
    <UsageScreen
      key={`${route.params.environmentId}:${route.params.botId ?? ""}`}
      params={route.params}
    />
  );
}

function UsageScreen({ params }: { params: Params }) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(params.environmentId);
  const capabilities = useBotsCapabilities(environmentId);
  const canSave = useAtomValue(bots.save.permissionAtom(environmentId));
  const collection = useBotsCollection(environmentId);
  const [days, setDays] = useState<"1" | "7" | "30">("7");
  const [window, setWindow] = useState(() => rollingBotsUsageWindow(7, Date.now()));
  const query = useEnvironmentQuery(
    capabilities.budgetsSupported
      ? bots.usage({
          environmentId,
          input: { ...window, ...(params.botId ? { botId: params.botId } : {}) },
        })
      : null,
  );
  const lastFetch = useRef(0);
  const refresh = () => {
    const now = Date.now();
    lastFetch.current = now;
    const next = rollingBotsUsageWindow(Number(days), now);
    if (next.until === window.until) query.refresh();
    else setWindow(next);
  };
  const refreshCurrent = useEffectEvent(refresh);
  useBotsReconnect(capabilities.connected, query.refresh);
  const finished = [...collection.changes.runs.values()]
    .filter((run) => run.finishedAt !== null)
    .map((run) => `${run.id}:${run.usage?.inputTokens ?? ""}:${run.usage?.outputTokens ?? ""}`)
    .join(",");
  const definitions = collection.changes.bots;
  useEffect(() => {
    if (
      (!finished && definitions.size === 0) ||
      !capabilities.connected ||
      !capabilities.budgetsSupported
    )
      return;
    const wait = lastFetch.current + REFRESH_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      refreshCurrent();
      return;
    }
    const timer = setTimeout(() => refreshCurrent(), wait);
    return () => clearTimeout(timer);
  }, [finished, definitions, capabilities.connected, capabilities.budgetsSupported]);
  const data = query.data;
  const selectedBot = collection.bots.find((bot) => bot.id === params.botId);
  const budgetEntries = Object.entries(data?.budgets ?? {});
  return (
    <BotPage title={selectedBot ? `${selectedBot.name} usage` : "Bots usage"}>
      <Text className="px-2 text-sm text-foreground-muted">
        Runs, outcomes and tokens across the bots on {capabilities.label}. Budgets always use a
        rolling 24 hour window.
      </Text>
      {!capabilities.connected ? (
        <Text>Computer offline. Saved usage may be out of date.</Text>
      ) : null}
      {!capabilities.budgetsSupported ? (
        <Text>Update this computer to view bot usage and budgets.</Text>
      ) : (
        <>
          <BotChoice
            label="Usage window"
            value={days}
            options={WINDOWS}
            onChange={(next) => {
              setDays(next);
              setWindow(rollingBotsUsageWindow(Number(next), Date.now()));
            }}
          />
          <Button
            label="Refresh usage"
            disabled={!capabilities.connected || query.isPending}
            onPress={refresh}
          />
          {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
          {query.isPending && !data ? <Text>Loading usage…</Text> : null}
          {data ? (
            <>
              <Text>
                {formatCount(data.totals.runs)} runs ·{" "}
                {data.totals.usageComplete ? "" : "At least "}
                {formatTokens(data.totals.tokens.total)} tokens
              </Text>
              {!data.totals.usageComplete ? (
                <Text className="text-foreground-muted">
                  Some runs did not report all their tokens, so token figures are lower bounds.
                </Text>
              ) : null}
              {budgetEntries.length ? (
                <BotSection
                  title="Daily budgets"
                  description="A reached run or token limit blocks new runs, including replays."
                >
                  {budgetEntries.map(([botId, budget]) => (
                    <View key={botId} className="gap-2 rounded-xl border border-border-subtle p-3">
                      <Text className="font-t3-semibold">
                        {collection.bots.find((bot) => bot.id === botId)?.name ??
                          data.rows.find((row) => row.botId === botId)?.botName ??
                          botId}
                      </Text>
                      <BudgetMeter budget={budget} />
                      <Button
                        label="Edit budget"
                        disabled={!capabilities.connected || !canSave}
                        onPress={() => navigation.navigate("BotsEdit", { environmentId, botId })}
                      />
                    </View>
                  ))}
                </BotSection>
              ) : null}
              {data.rows.length === 0 ? (
                <Text>No bot runs in this window.</Text>
              ) : (
                <BotSection title="Bots">
                  {data.rows.map((row) => (
                    <UsageRow
                      key={row.botId}
                      row={row}
                      total={data.totals.tokens.total}
                      complete={data.totals.usageComplete}
                    />
                  ))}
                </BotSection>
              )}
              {data.pipelines?.length ? (
                <BotSection
                  title="Pipelines"
                  description="Pipeline tokens include their bot steps, which are also counted above."
                >
                  {data.pipelines.map((pipeline) => (
                    <View
                      key={pipeline.pipelineId}
                      className="gap-1 rounded-xl border border-border-subtle p-3"
                    >
                      <Text className="font-t3-semibold">{pipeline.pipelineName}</Text>
                      <Text>
                        {formatCount(pipeline.runs)} runs · {formatCount(pipeline.completed)}{" "}
                        completed · {formatCount(pipeline.botRuns)} bot steps
                      </Text>
                      <Text>
                        {pipeline.usageComplete ? "" : "At least "}
                        {formatTokens(pipeline.tokens.total)} tokens
                      </Text>
                    </View>
                  ))}
                </BotSection>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </BotPage>
  );
}

export function BudgetMeter({ budget }: { budget: BotBudgetState }) {
  const status = budgetStatus(budget);
  return (
    <View className="gap-1">
      <Text
        accessibilityLiveRegion="polite"
        className={
          status === "blocked"
            ? "font-t3-semibold text-danger-foreground"
            : "font-t3-medium text-foreground"
        }
      >
        {status === "blocked"
          ? "Daily limit reached"
          : status === "approaching"
            ? "Approaching daily limit"
            : "Within daily budget"}
      </Text>
      {budget.runsPerDay === undefined ? null : (
        <Text>
          {formatCount(budget.runsInWindow)} of {formatCount(budget.runsPerDay)} runs in the last 24
          hours
        </Text>
      )}
      {budget.tokensPerDay === undefined ? null : (
        <Text>
          {formatTokens(budget.tokensInWindow)} of {formatTokens(budget.tokensPerDay)} tokens in the
          last 24 hours
        </Text>
      )}
      {budget.retryAt ? (
        <Text>Next run possible {new Date(budget.retryAt).toLocaleString()}.</Text>
      ) : null}
    </View>
  );
}

function UsageRow({
  row,
  total,
  complete,
}: {
  row: BotUsageRow;
  total: number;
  complete: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const verdicts = row.pass + row.fail + row.needsAttention > 0;
  return (
    <View className="gap-2 rounded-xl border border-border-subtle p-3">
      <Text className="font-t3-semibold">{row.botName}</Text>
      <Text>
        {formatCount(row.runs)} runs
        {row.successRate === null
          ? ""
          : ` · ${formatPercent(row.successRate, 0)} ${verdicts ? "pass" : "completed"}`}
        {row.medianDurationMs === null ? "" : ` · ${formatDuration(row.medianDurationMs)} median`}
      </Text>
      <Text>
        {row.usageComplete ? "" : "At least "}
        {formatTokens(row.tokens.total)} tokens
        {total > 0
          ? ` · ${complete ? "" : "about "}${formatPercent(row.tokens.total / total, 0)} of bot tokens`
          : ""}
      </Text>
      <Button
        label={expanded ? "Hide details" : "Show details"}
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${row.botName} usage details`}
        tone="text"
        onPress={() => setExpanded(!expanded)}
      />
      {expanded ? (
        <>
          <Text>
            {formatCount(row.completed)} completed · {formatCount(row.failed)} failed ·{" "}
            {formatCount(row.timedOut)} timed out · {formatCount(row.cancelled)} cancelled
          </Text>
          {verdicts ? (
            <Text>
              {row.pass} passed · {row.fail} failed verdict · {row.needsAttention} need attention
            </Text>
          ) : null}
          <Text>
            {formatTokens(row.tokens.input)} input tokens · {formatTokens(row.tokens.cachedInput)}{" "}
            cached input · {formatTokens(row.tokens.output)} output
          </Text>
          {row.maxDurationMs !== null ? (
            <Text>Slowest {formatDuration(row.maxDurationMs)}</Text>
          ) : null}
          {row.replays ? (
            <Text>
              {row.replays} {row.replays === 1 ? "run was a replay" : "runs were replays"}.
            </Text>
          ) : null}
          {row.byModel.map((model) => (
            <View
              key={`${model.assumed}:${model.model}`}
              className="gap-1 rounded-xl bg-subtle p-3"
            >
              <Text className="font-t3-medium">
                {model.model}
                {model.assumed ? " (current model, assumed)" : ""}
              </Text>
              <Text>
                {formatCount(model.runs)} runs · {formatTokens(model.totalTokens)} tokens
                {model.successRate === null
                  ? ""
                  : ` · ${formatPercent(model.successRate, 0)} ${verdicts ? "pass" : "completed"}`}
                {model.medianDurationMs === null
                  ? ""
                  : ` · ${formatDuration(model.medianDurationMs)} median`}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
