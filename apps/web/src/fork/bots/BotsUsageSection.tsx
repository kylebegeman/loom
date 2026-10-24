import { Link } from "@tanstack/react-router";
import type { EnvironmentId, UsageSummaryInput } from "@t3tools/contracts";
import { formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { LIBRARY_ROW, LibraryErrorNotice } from "../project-library/LibraryControls";
import { LibraryBar } from "../project-library/LibraryData";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { BOTS_COLOR, BotTile } from "./BotIdentity";
import { bots, useBotsHost } from "./state";
import { busiestTokens, tokenShare, usagePageWindow } from "./usageWindow";

const TOP_BOTS = 3;

const SKELETON_ROWS = ["first", "second", "third"];

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
  // A page about all tokens should not grow an empty Bots section.
  if (environmentId === null || data?.rows.length === 0) return null;
  if (data === null && !query.isPending && query.error === null) return null;

  const rows = data?.rows.slice(0, TOP_BOTS) ?? [];
  const busiest = busiestTokens(rows);
  const complete = data?.totals.usageComplete ?? true;
  const share =
    data && totalTokens > 0
      ? `, ${complete ? "about" : "at least"} ${formatPercent(data.totals.tokens.total / totalTokens, 0)} of all tokens`
      : "";
  return (
    <section
      aria-label="Bots"
      style={projectColorStyle(BOTS_COLOR)}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Bots</h2>
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          render={<Link to="/loom/bots" search={{}} />}
        >
          Open Bots
          <ArrowUpRightIcon />
        </Button>
      </div>
      {data === null ? (
        query.error ? (
          <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
        ) : (
          <div role="status" aria-label="Loading bot usage" className="flex flex-col gap-1">
            <Skeleton className="mb-1 h-4 w-64" />
            {SKELETON_ROWS.map((row) => (
              <div key={row} className="flex items-center gap-2.5 py-1.5">
                <Skeleton className="size-6" />
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="ms-auto h-1 w-1/3" />
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {complete ? "" : "At least "}
            {formatTokens(data.totals.tokens.total)} tokens from bot runs{share}.
          </p>
          <ol className="flex flex-col">
            {rows.map((row) => (
              <li key={row.botId}>
                <Link
                  to="/loom/bots"
                  search={{ bot: row.botId }}
                  className={cn(
                    LIBRARY_ROW,
                    "flex min-w-0 items-center gap-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                >
                  <BotTile bot={{ id: row.botId }} size="sm" />
                  <span className="w-32 min-w-0 shrink-0 truncate sm:w-48">{row.botName}</span>
                  <span className="min-w-0 flex-1 text-xs font-medium">
                    <LibraryBar share={tokenShare(row.tokens.total, busiest)}>
                      {row.usageComplete ? "" : "at least "}
                      {formatTokens(row.tokens.total)}
                    </LibraryBar>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
