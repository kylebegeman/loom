import { Link } from "@tanstack/react-router";
import type { EnvironmentId, UsageSummaryInput } from "@t3tools/contracts";
import { botColor } from "@t3tools/client-runtime/fork";
import { formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { BotTile } from "./BotIdentity";
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
  const rows = data.rows.slice(0, TOP_BOTS);
  const busiest = Math.max(1, ...rows.map((row) => row.tokens.total));
  return (
    <section aria-label="Bots" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Bots</h2>
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          render={<Link to="/loom/bots" search={{ tab: "usage" }} />}
        >
          Open Bots
          <ArrowUpRightIcon />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {complete ? "" : "At least "}
        {formatTokens(botTokens)} tokens from bot runs{share}.
      </p>
      <ol className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.botId}
            style={projectColorStyle(botColor({ id: row.botId }))}
            className="relative isolate flex min-w-0 items-center gap-2.5 overflow-hidden rounded-md px-2 py-1.5 text-sm"
          >
            {/* Each bot's share of the top bot's tokens, drawn behind its row in the bot's color. */}
            <span
              aria-hidden
              className="absolute inset-y-0 start-0 -z-10 rounded-md bg-(--project-color)/10 dark:bg-(--project-color)/14"
              style={{ width: `${(row.tokens.total / busiest) * 100}%` }}
            />
            <BotTile bot={{ id: row.botId }} size="sm" />
            <span className="min-w-0 flex-1 truncate">{row.botName}</span>
            <span className="shrink-0 text-xs font-medium tabular-nums">
              {formatTokens(row.tokens.total)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
