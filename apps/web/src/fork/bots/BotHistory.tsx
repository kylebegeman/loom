import { useEffect, useMemo, useState } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_VERSIONS_MAX_LIMIT,
  type BotDefinition,
  type BotVersionSavedBy,
  type BotVersionSummary,
} from "@t3tools/contracts/fork";
import { botVersionDiff } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatTokens } from "@t3tools/shared/usageFormat";
import {
  BadgeCheckIcon,
  GitCompareIcon,
  HistoryIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { runTime } from "./BotIdentity";
import { BotsEmptyList } from "./BotRuns";
import { bots } from "./state";

const SAVED_BY: Record<BotVersionSavedBy, string> = {
  user: "Saved by you",
  agent: "Saved by an agent",
  starter: "From the starter",
  restore: "Restored",
};

const versionStats = (version: BotVersionSummary) =>
  [
    version.runs === 1 ? "1 run" : `${version.runs} runs`,
    ...(version.passRate === null ? [] : [`${Math.round(version.passRate * 100)}% passed`]),
    ...(version.medianTotalTokens === null
      ? []
      : [`${formatTokens(version.medianTotalTokens)} tokens a run`]),
  ].join(" · ");

/** What changed from one version to the next: a line diff of the brief, then other fields. */
function VersionCompare({
  environmentId,
  botId,
  before,
  after,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId: string;
  readonly before: number;
  readonly after: number;
}) {
  const { resolvedTheme } = useTheme();
  const older = useEnvironmentQuery(
    bots.version({ environmentId, input: { botId, version: before } }),
  );
  const newer = useEnvironmentQuery(
    bots.version({ environmentId, input: { botId, version: after } }),
  );
  const diff = useMemo(
    () =>
      older.data && newer.data
        ? botVersionDiff(older.data.definition, newer.data.definition)
        : null,
    [older.data, newer.data],
  );
  const instructions = useMemo(
    () =>
      diff?.instructions
        ? parseDiffFromFile(
            { name: "instructions.md", contents: diff.instructions.before },
            { name: "instructions.md", contents: diff.instructions.after },
          )
        : null,
    [diff],
  );
  const error = older.error ?? newer.error;
  if (error) return <LibraryErrorNotice error={error} />;
  if (!diff)
    return (
      <div role="status" aria-label="Loading versions" className="grid gap-2">
        <Skeleton shape="card" className="h-32" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    );
  return (
    <div className="grid gap-3" aria-label={`Changes from v${before} to v${after}`}>
      {instructions ? (
        <div className="max-h-96 overflow-auto rounded-xl border border-border text-xs">
          <FileDiff
            fileDiff={instructions}
            options={{
              diffStyle: "unified",
              theme: resolveDiffThemeName(resolvedTheme),
              overflow: "wrap",
            }}
          />
        </div>
      ) : null}
      {diff.fields.length > 0 ? (
        <dl className="grid gap-3 text-sm">
          {diff.fields.map((field) => (
            <div key={field.field} className="grid gap-1.5">
              <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
              <dd className="grid gap-2 sm:grid-cols-2">
                <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 text-xs wrap-anywhere dark:bg-accent/60">
                  <span className="text-muted-foreground">Before: </span>
                  {field.before}
                </pre>
                <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 text-xs wrap-anywhere dark:bg-accent/60">
                  <span className="text-muted-foreground">After: </span>
                  {field.after}
                </pre>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!instructions && diff.fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">These versions are the same.</p>
      ) : null}
    </div>
  );
}

function VersionRow({
  environmentId,
  bot,
  version,
  previous,
  canSave,
  canRun,
  onReplay,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly version: BotVersionSummary;
  readonly previous: number | null;
  readonly canSave: boolean;
  readonly canRun: boolean;
  readonly onReplay: (version: number) => void;
}) {
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStable = useAtomCommand(bots.setStable, { reportFailure: false });
  const restore = useAtomCommand(bots.restoreVersion, { reportFailure: false });
  const current = version.version === bot.version;
  const stable = version.version === bot.stableVersion;
  const archived = bot.archivedAt !== null;

  const act = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const toggleStable = () =>
    act(async () => {
      const result = await setStable({
        environmentId,
        input: { botId: bot.id, version: stable ? null : version.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    }, "Could not change the stable version.");

  const restoreThis = () =>
    act(async () => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Restore v${version.version} of ${bot.name}? It is saved as v${bot.version + 1}; nothing in the history is lost.`,
      );
      if (!confirmed) return;
      const result = await restore({
        environmentId,
        input: { botId: bot.id, version: version.version, expectedVersion: bot.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    }, "Could not restore the version.");

  return (
    <li className="relative flex min-w-0 gap-3 px-3 py-2.5">
      {/* The rail joins each version to the one it came from; the oldest has nothing below. */}
      {previous !== null ? (
        <span aria-hidden className="absolute start-6 top-6 -bottom-6 border-s border-border" />
      ) : null}
      <span
        aria-hidden
        className="relative mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-background"
      >
        <span
          className={cn(
            "rounded-full",
            stable
              ? "size-3 bg-success ring-3 ring-success/20"
              : current
                ? "size-2.5 bg-(--project-color)"
                : "size-2 bg-muted-foreground/45",
          )}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold tabular-nums">v{version.version}</span>
              {stable ? (
                <LibraryStateBadge tone="success" icon={BadgeCheckIcon}>
                  Stable
                </LibraryStateBadge>
              ) : null}
              {current ? <LibraryStateBadge tone="active">Current</LibraryStateBadge> : null}
              <span className="text-xs text-muted-foreground">
                {SAVED_BY[version.savedBy]}
                {version.restoredFrom === null ? "" : ` from v${version.restoredFrom}`} ·{" "}
                {runTime(version.savedAt)}
              </span>
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {version.changed.length > 0 ? `Changed ${version.changed.join(", ")}. ` : ""}
              {versionStats(version)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-0.5">
            {previous !== null ? (
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                aria-expanded={comparing}
                onClick={() => setComparing((open) => !open)}
              >
                <GitCompareIcon />
                {comparing ? "Hide changes" : `Compare with v${previous}`}
              </Button>
            ) : null}
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={!canRun || archived}
              onClick={() => onReplay(version.version)}
            >
              <PlayIcon />
              Replay
            </Button>
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={!canSave || busy || archived}
              onClick={() => void toggleStable()}
            >
              <BadgeCheckIcon />
              {stable ? "Clear stable" : "Mark stable"}
            </Button>
            {current ? null : (
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                disabled={!canSave || busy || archived}
                onClick={() => void restoreThis()}
              >
                <RotateCcwIcon />
                Restore
              </Button>
            )}
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        {comparing && previous !== null ? (
          <VersionCompare
            environmentId={environmentId}
            botId={bot.id}
            before={previous}
            after={version.version}
          />
        ) : null}
      </div>
    </li>
  );
}

/** A bot's saved versions, newest first, with compare, stable, restore and replay. */
export function BotHistory({
  environmentId,
  bot,
  connected,
  canSave,
  canRun,
  onReplay,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly connected: boolean;
  readonly canSave: boolean;
  readonly canRun: boolean;
  readonly onReplay: (version: number) => void;
}) {
  const query = useEnvironmentQuery(
    bots.versions({ environmentId, input: { botId: bot.id, limit: BOTS_VERSIONS_MAX_LIMIT } }),
  );
  const refresh = query.refresh;
  useEffect(() => {
    refresh();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A save or restore adds a version, and versions are not watched.
  }, [bot.version, refresh]);
  const versions = query.data?.versions ?? [];

  return (
    <section className="flex flex-col gap-4" aria-label="History">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
          Triggers that follow the stable version run it; without one they run the latest.
        </p>
        <Button
          shape="pill"
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh history"
          disabled={!connected || query.isPending}
          onClick={query.refresh}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {query.error ? (
        <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      ) : query.isPending && !query.data ? (
        <HistorySkeleton />
      ) : versions.length === 0 ? (
        <BotsEmptyList icon={HistoryIcon} message="No saved versions yet." />
      ) : (
        <ol
          aria-label={`${bot.name} versions, newest first`}
          className={cn(LIBRARY_OUTLINE, "flex flex-col py-1")}
        >
          {versions.map((version, index) => (
            <VersionRow
              key={version.version}
              environmentId={environmentId}
              bot={bot}
              version={version}
              previous={versions[index + 1]?.version ?? null}
              canSave={canSave}
              canRun={canRun}
              onReplay={onReplay}
            />
          ))}
        </ol>
      )}
      {query.data?.hasMore ? (
        <p className="text-xs text-muted-foreground">
          Showing the {BOTS_VERSIONS_MAX_LIMIT} newest versions.
        </p>
      ) : null}
    </section>
  );
}

const SKELETON_VERSIONS = ["first", "second", "third"];

/** Timeline-shaped rows while the versions load, so the panel keeps its height. */
function HistorySkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading versions"
      className={cn(LIBRARY_OUTLINE, "flex flex-col py-1")}
    >
      {SKELETON_VERSIONS.map((row) => (
        <div key={row} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton shape="pill" className="mt-1 size-4" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton shape="pill" className="h-6 w-24" />
        </div>
      ))}
    </div>
  );
}
