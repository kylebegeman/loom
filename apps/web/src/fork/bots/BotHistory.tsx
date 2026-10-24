import { useEffect, useState } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_VERSIONS_MAX_LIMIT,
  type BotDefinition,
  type BotVersionSavedBy,
  type BotVersionSummary,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatTokens } from "@t3tools/shared/usageFormat";
import {
  BadgeCheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  EllipsisIcon,
  HistoryIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  WifiOffIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { LibraryBar, Sparkline } from "../project-library/LibraryData";
import { runTime } from "./BotIdentity";
import { ConfirmDialog, ReplayLaunchDialog, useLatestReplayId } from "./BotReplay";
import {
  botDefinitionDiff,
  versionChangeText,
  versionCompareOptions,
  versionTrend,
} from "./editorLogic";
import { useBotsNavigation } from "./navigation";
import { bots, useBots, useBotsAccess } from "./state";

const SAVED_BY: Record<BotVersionSavedBy, string> = {
  user: "Saved by you",
  agent: "Saved by an agent",
  starter: "From the starter",
  restore: "Restored",
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The line diff of the instructions, rendered only once a compare is open since it is heavy. */
function InstructionsDiff({ before, after }: { readonly before: string; readonly after: string }) {
  const { resolvedTheme } = useTheme();
  const diff = parseDiffFromFile(
    { name: "instructions.md", contents: before },
    { name: "instructions.md", contents: after },
  );
  return (
    <div className="max-h-112 overflow-auto rounded-xl border border-border text-xs">
      <FileDiff
        fileDiff={diff}
        options={{
          diffStyle: "unified",
          theme: resolveDiffThemeName(resolvedTheme),
          overflow: "wrap",
        }}
      />
    </div>
  );
}

/** Two versions side by side: the instructions as a line diff, then every other field that moved. */
function VersionCompare({
  environmentId,
  bot,
  version,
  listed,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly version: number;
  readonly listed: ReadonlyArray<number>;
}) {
  const projects = useProjects();
  const options = versionCompareOptions(version, {
    stable: bot.stableVersion ?? null,
    current: bot.version,
    listed,
  });
  const [chosen, setChosen] = useState<number | null>(null);
  const other =
    chosen ??
    options.find((option) => option.version === version - 1)?.version ??
    options[0]?.version ??
    null;
  const from = other === null ? version : Math.min(version, other);
  const to = other === null ? version : Math.max(version, other);
  const older = useEnvironmentQuery(
    other === null
      ? null
      : bots.version({ environmentId, input: { botId: bot.id, version: from } }),
  );
  const newer = useEnvironmentQuery(
    other === null ? null : bots.version({ environmentId, input: { botId: bot.id, version: to } }),
  );
  if (other === null)
    return (
      <p className="text-sm text-muted-foreground">
        This is the only version, so there is nothing to compare it with yet.
      </p>
    );
  const projectTitle = (id: string) =>
    projects.find((project) => project.environmentId === environmentId && project.id === id)
      ?.title ?? id;
  const diff =
    older.data && newer.data
      ? botDefinitionDiff(older.data.definition, newer.data.definition, { projectTitle })
      : null;
  const error = older.error ?? newer.error;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Compare v{version} with</span>
        <div className="w-56">
          <Select
            value={String(other)}
            onValueChange={(next) => {
              const value = Number(next);
              if (Number.isInteger(value)) setChosen(value);
            }}
          >
            <SelectTrigger size="sm" aria-label={`Compare v${version} with`}>
              <SelectValue>
                {options.find((option) => option.version === other)?.label ?? `v${other}`}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {options.map((option) => (
                <SelectItem key={option.version} value={String(option.version)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>
      {error ? (
        <LibraryErrorNotice
          error={error}
          onRetry={() => {
            older.refresh();
            newer.refresh();
          }}
        />
      ) : !diff ? (
        <div role="status" aria-label="Loading the comparison" className="flex flex-col gap-2">
          <Skeleton shape="card" className="h-32" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3" aria-label={`Changes from v${from} to v${to}`}>
          {diff.instructions ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">
                Instructions, v{from} to v{to}
              </h4>
              <InstructionsDiff before={diff.instructions.before} after={diff.instructions.after} />
            </div>
          ) : null}
          {diff.fields.length > 0 ? (
            <div className={cn(LIBRARY_OUTLINE, "overflow-x-auto")}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="h-8 px-3 text-start font-medium">
                      Setting
                    </th>
                    <th scope="col" className="h-8 px-3 text-start font-medium">
                      v{from}
                    </th>
                    <th scope="col" className="h-8 px-3 text-start font-medium">
                      v{to}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {diff.fields.map((field) => (
                    <tr key={field.key} className="align-top">
                      <th scope="row" className="px-3 py-2 text-start font-medium">
                        {field.label}
                      </th>
                      <td className="px-3 py-2 whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                        {field.before}
                      </td>
                      <td className="px-3 py-2 whitespace-pre-wrap wrap-anywhere">{field.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!diff.instructions && diff.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              v{from} and v{to} are the same.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

type VersionAction =
  | { readonly kind: "restore"; readonly version: number }
  | { readonly kind: "replay"; readonly version: number };

function VersionRow({
  environmentId,
  bot,
  version,
  listed,
  now,
  locked,
  canReplay,
  onAction,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly version: BotVersionSummary;
  readonly listed: ReadonlyArray<number>;
  readonly now: number;
  /** Why changes are off, or null when they are allowed. */
  readonly locked: string | null;
  readonly canReplay: boolean;
  readonly onAction: (action: VersionAction) => void;
}) {
  const [comparing, setComparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStable = useAtomCommand(bots.setStable, { reportFailure: false });
  const current = version.version === bot.version;
  const stable = version.version === (bot.stableVersion ?? null);
  const saved = runTime(version.savedAt, now);
  const compareId = `bot-version-${version.version}-compare`;

  const toggleStable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await setStable({
        environmentId,
        input: { botId: bot.id, version: stable ? null : version.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Could not change the stable version.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-start gap-3 px-3 py-2.5">
        <span
          aria-hidden
          className="mt-1.5 inline-flex size-3 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              "rounded-full",
              stable
                ? "size-2.5 bg-success"
                : current
                  ? "size-2.5 bg-(--project-color)"
                  : "size-2 bg-muted-foreground/45",
            )}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold tabular-nums">v{version.version}</span>
            {current ? <LibraryStateBadge tone="active">Current</LibraryStateBadge> : null}
            {stable ? (
              <LibraryStateBadge tone="success" icon={BadgeCheckIcon}>
                Stable
              </LibraryStateBadge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {SAVED_BY[version.savedBy]}
              {version.restoredFrom === null ? "" : ` from v${version.restoredFrom}`}
              {saved ? ` · ${saved}` : ""}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">{versionChangeText(version)}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {version.runs === 0
                ? "No runs kept"
                : version.runs === 1
                  ? "1 run"
                  : `${version.runs} runs`}
            </span>
            {version.passRate === null ? null : (
              <span className="flex w-36 items-center gap-1.5">
                <span className="shrink-0">Passed</span>
                <LibraryBar share={version.passRate}>{percent(version.passRate)}</LibraryBar>
              </span>
            )}
            {version.medianTotalTokens === null ? null : (
              <span className="tabular-nums">
                {formatTokens(version.medianTotalTokens)} tokens a run
              </span>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            aria-expanded={comparing}
            aria-controls={comparing ? compareId : undefined}
            onClick={() => setComparing((open) => !open)}
          >
            Compare
            <ChevronDownIcon
              className={cn("transition-transform duration-150", comparing && "rotate-180")}
            />
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  shape="pill"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`More actions for v${version.version}`}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuItem
                disabled={!canReplay}
                onClick={() => onAction({ kind: "replay", version: version.version })}
              >
                <PlayIcon />
                Try on past runs…
              </MenuItem>
              <MenuSeparator />
              <MenuItem disabled={locked !== null || busy} onClick={() => void toggleStable()}>
                <BadgeCheckIcon />
                {stable ? "Clear stable" : "Mark as stable"}
              </MenuItem>
              {current ? null : (
                <MenuItem
                  disabled={locked !== null}
                  onClick={() => onAction({ kind: "restore", version: version.version })}
                >
                  <RotateCcwIcon />
                  Restore as v{bot.version + 1}…
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        </div>
      </div>
      {comparing ? (
        <div id={compareId} className="min-w-0 px-3 pb-3 sm:ps-9">
          <VersionCompare
            environmentId={environmentId}
            bot={bot}
            version={version.version}
            listed={listed}
          />
        </div>
      ) : null}
    </li>
  );
}

const SKELETON_VERSIONS = ["first", "second", "third"];

/** Version-shaped rows while the list loads, so the view keeps its height. */
function VersionsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading versions"
      className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
    >
      {SKELETON_VERSIONS.map((row) => (
        <div key={row} className="flex items-start gap-3 px-3 py-3">
          <Skeleton shape="pill" className="mt-1 size-2.5" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton shape="pill" className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

/** One figure across the versions shown, oldest to newest. */
function VersionTrend({
  label,
  points,
  format,
}: {
  readonly label: string;
  readonly points: ReadonlyArray<{ readonly version: number; readonly value: number }>;
  readonly format: (value: number) => string;
}) {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Sparkline
          values={points.map((point) => point.value)}
          label={`${label} from v${first.version} to v${last.version}: ${points
            .map((point) => `v${point.version} ${format(point.value)}`)
            .join(", ")}`}
        />
        <span className="text-xs tabular-nums">
          v{first.version} {format(first.value)} to v{last.version} {format(last.value)}
        </span>
      </div>
    </div>
  );
}

/**
 * A bot's saved versions, newest first. Each can be compared with any other, tried on past runs,
 * marked stable for the triggers that follow it, or restored as a new version.
 */
export function BotVersionsView({ bot }: { readonly bot: BotDefinition }) {
  const { host } = useBots();
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const lastReplay = useLatestReplayId(bot.id);
  const environmentId = host.environmentId;
  const [cursors, setCursors] = useState<ReadonlyArray<number>>([]);
  const before = cursors.at(-1);
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : bots.versions({
          environmentId,
          input: {
            botId: bot.id,
            limit: BOTS_VERSIONS_MAX_LIMIT,
            ...(before === undefined ? {} : { before }),
          },
        }),
  );
  const refresh = query.refresh;
  useEffect(() => {
    refresh();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A save or restore adds a version, and versions are not watched.
  }, [bot.version, refresh]);
  const [now] = useState(() => Date.now());
  const [action, setAction] = useState<VersionAction | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreVersion = useAtomCommand(bots.restoreVersion, { reportFailure: false });

  if (environmentId === null) return null;
  const versions = query.data?.versions ?? [];
  const listed = versions.map((version) => version.version);
  const archived = bot.archivedAt !== null;
  const locked = !host.connected
    ? "Reconnect to change versions."
    : !access.canSave
      ? "This connection cannot change bots."
      : archived
        ? "Restore the bot from its ⋯ menu to change its versions."
        : null;
  const stable = bot.stableVersion ?? null;
  const passTrend = versionTrend(versions, (version) => version.passRate);
  const tokenTrend = versionTrend(versions, (version) => version.medianTotalTokens);
  const oldest = versions.at(-1)?.version;

  const restore = async (version: number) => {
    setRestoring(true);
    setRestoreError(null);
    try {
      const result = await restoreVersion({
        environmentId,
        input: { botId: bot.id, version, expectedVersion: bot.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setAction(null);
      setCursors([]);
    } catch (cause) {
      setRestoreError(
        cause instanceof Error && cause.message ? cause.message : "Could not restore the version.",
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section aria-label="Versions" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-sm">
            {stable === null ? (
              <>No stable version. Every trigger runs the latest, v{bot.version}.</>
            ) : stable === bot.version ? (
              <>The latest version, v{bot.version}, is stable. Every trigger runs it.</>
            ) : (
              <>
                v{stable} is stable. Triggers that follow stable run it; the rest run the latest, v
                {bot.version}.
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each save makes a version. Mark one stable once it has proved itself on real runs.
          </p>
        </div>
        {passTrend ? <VersionTrend label="Pass rate" points={passTrend} format={percent} /> : null}
        {tokenTrend ? (
          <VersionTrend label="Tokens a run" points={tokenTrend} format={formatTokens} />
        ) : null}
        {lastReplay ? (
          <Button
            shape="pill"
            size="sm"
            variant="ghost"
            onClick={() => nav.overlay({ replay: lastReplay })}
          >
            Last replay
          </Button>
        ) : null}
        <Button
          shape="pill"
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh versions"
          disabled={!host.connected || query.isPending}
          onClick={query.refresh}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {!host.connected ? (
        <LibraryNotice icon={WifiOffIcon}>
          Offline. Versions shown are from before the connection dropped; reconnect to change or
          replay them.
        </LibraryNotice>
      ) : locked !== null ? (
        <LibraryNotice icon={CircleAlertIcon}>{locked}</LibraryNotice>
      ) : null}
      {query.error ? (
        <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      ) : query.isPending && !query.data ? (
        <VersionsSkeleton />
      ) : versions.length === 0 ? (
        <LibraryEmpty icon={HistoryIcon} title="No saved versions">
          {before === undefined
            ? "Versions appear here once the bot is saved."
            : "Nothing older on this page."}
        </LibraryEmpty>
      ) : (
        <ol
          aria-label={`${bot.name} versions, newest first`}
          className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
        >
          {versions.map((version) => (
            <VersionRow
              key={version.version}
              environmentId={environmentId}
              bot={bot}
              version={version}
              listed={listed}
              now={now}
              locked={locked}
              canReplay={access.canReplay && !archived}
              onAction={(next) => {
                setRestoreError(null);
                setAction(next);
              }}
            />
          ))}
        </ol>
      )}
      {before !== undefined || query.data?.hasMore ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {versions.length > 0
              ? `v${versions[0]?.version} to v${oldest}`
              : `Page ${cursors.length + 1}`}
          </span>
          <div className="flex gap-1">
            {before !== undefined ? (
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                disabled={query.isPending}
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                Newer versions
              </Button>
            ) : null}
            {query.data?.hasMore && oldest !== undefined ? (
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={query.isPending}
                onClick={() => setCursors([...cursors, oldest])}
              >
                Older versions
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {action?.kind === "replay" ? (
        <ReplayLaunchDialog
          environmentId={environmentId}
          bot={bot}
          source={{ kind: "version", version: action.version }}
          onClose={() => setAction(null)}
        />
      ) : null}
      <ConfirmDialog
        open={action?.kind === "restore"}
        busy={restoring}
        title={action ? `Restore v${action.version} of ${bot.name}?` : "Restore this version?"}
        description={
          <div className="flex flex-col gap-2">
            <p>
              Its instructions and settings are saved again as v{bot.version + 1}, and every run
              after that uses them. Nothing in the version history is lost.
            </p>
            {stable !== null ? (
              <p>v{stable} stays the stable version until you mark another.</p>
            ) : null}
            {restoreError ? (
              <p role="alert" className="text-destructive-foreground">
                {restoreError}
              </p>
            ) : null}
          </div>
        }
        confirmLabel={`Restore as v${bot.version + 1}`}
        onCancel={() => setAction(null)}
        onConfirm={() => {
          if (action?.kind === "restore") void restore(action.version);
        }}
      />
    </section>
  );
}
