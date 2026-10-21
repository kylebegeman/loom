import { Link } from "@tanstack/react-router";
import type { EnvironmentId, UsageSummaryInput } from "@t3tools/contracts";
import { formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { useEnvironmentQuery } from "~/state/query";
import { bots, useBotsHost } from "./state";
import { usagePageWindow } from "./usageWindow";

const TOP_BOTS = 3;

/**
 * Bot tokens in the Usage page's window. Bots run on the primary environment, so the section reads
 * only that one, and only while it is selected. The share is approximate: the page totals come from
 * provider transcripts and bot tokens from turn events.
 */
export function BotsUsageSection({
  window,
  environmentIds,
  totalTokens,
}: {
  readonly window: UsageSummaryInput;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly totalTokens: number;
}) {
  const host = useBotsHost();
  const environmentId =
    host.environmentId !== null &&
    host.supported &&
    host.budgetsSupported &&
    environmentIds.includes(host.environmentId)
      ? host.environmentId
      : null;
  const query = useEnvironmentQuery(
    environmentId === null ? null : bots.usage({ environmentId, input: usagePageWindow(window) }),
  );
  const data = query.data;
  if (environmentId === null || data === null || data.rows.length === 0) return null;

  const botTokens = data.totals.tokens.total;
  const complete = data.totals.usageComplete;
  const share =
    totalTokens > 0
      ? `, ${complete ? "about" : "at least"} ${formatPercent(botTokens / totalTokens, 0)} of all tokens`
      : "";
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Bots</h2>
        <Link to="/loom/bots" search={{ tab: "usage" }} className="text-xs underline">
          Open Bots
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        {complete ? "" : "At least "}
        {formatTokens(botTokens)} tokens from bot runs{share}.
      </p>
      <ul className="grid gap-1 text-sm">
        {data.rows.slice(0, TOP_BOTS).map((row) => (
          <li key={row.botId} className="flex justify-between gap-4">
            <span className="truncate">{row.botName}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatTokens(row.tokens.total)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
