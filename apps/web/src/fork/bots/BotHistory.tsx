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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { runTime } from "./BotRuns";
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
      : [`${version.medianTotalTokens.toLocaleString()} tokens a run`]),
  ].join(", ");

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
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        {error}
      </p>
    );
  if (!diff)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading versions…
      </p>
    );
  return (
    <div className="grid gap-3" aria-label={`Changes from v${before} to v${after}`}>
      {instructions ? (
        <div className="max-h-96 overflow-auto rounded-lg border text-xs">
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
        <dl className="grid gap-2 text-sm">
          {diff.fields.map((field) => (
            <div key={field.field} className="grid gap-1">
              <dt className="font-medium">{field.label}</dt>
              <dd className="grid gap-2 sm:grid-cols-2">
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                  <span className="text-muted-foreground">Before: </span>
                  {field.before}
                </pre>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                  <span className="text-muted-foreground">After: </span>
                  {field.after}
                </pre>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!instructions && diff.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">These versions are the same.</p>
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
    <li className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">v{version.version}</span>
          {current ? <Badge variant="secondary">Current</Badge> : null}
          {stable ? <Badge variant="success">Stable</Badge> : null}
          <span className="text-xs text-muted-foreground">
            {SAVED_BY[version.savedBy]}
            {version.restoredFrom === null ? "" : ` from v${version.restoredFrom}`} ·{" "}
            {runTime(version.savedAt)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {previous !== null ? (
            <Button size="xs" variant="ghost" onClick={() => setComparing((open) => !open)}>
              {comparing ? "Hide changes" : `Compare with v${previous}`}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            disabled={!canRun || archived}
            onClick={() => onReplay(version.version)}
          >
            Replay
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!canSave || busy || archived}
            onClick={() => void toggleStable()}
          >
            {stable ? "Clear stable" : "Mark stable"}
          </Button>
          {current ? null : (
            <Button
              size="xs"
              variant="ghost"
              disabled={!canSave || busy || archived}
              onClick={() => void restoreThis()}
            >
              Restore
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {version.changed.length > 0 ? `Changed ${version.changed.join(", ")}. ` : ""}
        {versionStats(version)}
      </p>
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
    <section className="space-y-3" aria-label="History">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">History</h3>
          <p className="text-xs text-muted-foreground">
            Triggers that follow the stable version run it; without one they run the latest.
          </p>
        </div>
        <Button
          size="xs"
          variant="ghost"
          disabled={!connected || query.isPending}
          onClick={query.refresh}
        >
          Refresh
        </Button>
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      ) : query.isPending && !query.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading versions…
        </p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved versions yet.</p>
      ) : (
        <ul className="grid gap-2">
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
        </ul>
      )}
      {query.data?.hasMore ? (
        <p className="text-xs text-muted-foreground">
          Showing the {BOTS_VERSIONS_MAX_LIMIT} newest versions.
        </p>
      ) : null}
    </section>
  );
}
