import { useAtomValue } from "@effect/atom-react";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { APP_VERSION } from "~/branding";
import {
  isLocalUpdateEnvironment,
  updateEnvironmentInScope,
  type UpdateScope,
} from "~/fork/connections/updateScope";
import { isElectron } from "~/env";
import { useEnvironments } from "~/state/environments";
import {
  isRuntimeArchivePublished,
  useRuntimeReleaseAssets,
} from "~/fork/connections/runtimeRelease";
import { serverEnvironment } from "~/state/server";
import { environmentSession } from "~/state/session";
import { getProviderUpdateRunOutcome } from "../ProviderUpdateLaunchNotification.logic";
import { useProviderUpdates } from "../ProviderUpdatesAction";
import { canUpdateServer, type ServerUpdateOutcome, useServerUpdate } from "../ServerUpdateAction";
import {
  closeFinishedUpdateRun,
  collectRestartingMachines,
  collectServerUpdateTargets,
  collectUpdateEverythingResult,
  describeUpdateEverything,
  runUpdateEverything,
  type SkippedMachine,
  type UpdateRunMachine,
} from "./updateEverything.logic";
import {
  clearSavedUpdateEverythingResult,
  saveUpdateEverythingResult,
  setUpdateEverythingRun,
  settleUpdateRunMachine,
  showUpdateEverythingResult,
  waitForServerUpdateHandoff,
  waitForUpdateRestart,
} from "./updateEverythingRun";

/** How long this app counts down before it relaunches, so the user can postpone it. */
const UPDATE_RESTART_DELAY_MS = 5_000;

/** Where this app's own download or install reports a failure. */
export type ReportLocalUpdateError = (title: string, description: string) => void;

/**
 * Outdated providers and runtimes within the caller's machine scope. Runtime
 * archives must be published for the destination computer's platform.
 * `run` performs the whole pass, including
 * this app's own download and install when given. It updates quietly, tracks
 * each machine in the run state, and reports one summary toast at the end.
 * This app relaunches once every server restarts into its update, after a
 * short countdown the user can postpone. The summary then waits for the
 * relaunch, and servers still restarting are followed after it.
 */
// fork: machine-updates - The footer owns local updates; Computers owns fleet updates.
export function useUpdateEverything(localUpdateVersion: string | null, scope: UpdateScope) {
  const targetVersion = localUpdateVersion ?? APP_VERSION;
  const { environments: allEnvironments } = useEnvironments();
  const environments = useMemo(
    () =>
      allEnvironments.filter((environment) =>
        updateEnvironmentInScope(environment.entry.target, scope, isElectron),
      ),
    [allEnvironments, scope],
  );
  const environmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const machinesAtom = useMemo(
    () =>
      Atom.make((get) =>
        environments.map((environment) => ({
          environmentId: environment.environmentId,
          label: environment.label,
          serverConfig: environment.serverConfig,
          connected: environment.entry.enabled && environment.connection.phase === "connected",
          hostedByThisApp: isLocalUpdateEnvironment(environment.entry.target, isElectron),
          canMaintain: canUpdateServer(
            get(environmentSession.sessionStateAtom(environment.environmentId)),
          ),
          updateState: get(serverEnvironment.updateStateAtom(environment.environmentId)),
        })),
      ),
    [environments],
  );
  const machines = useAtomValue(machinesAtom);
  const { targets: behindServers, skipped: unreachable } = collectServerUpdateTargets(
    machines,
    targetVersion,
  );
  const needsArchive = behindServers.some((server) => server.selfUpdate !== "desktop-managed");
  const release = useRuntimeReleaseAssets(needsArchive ? targetVersion : null);
  const assets = AsyncResult.getOrElse(release, () => []);
  const servers = behindServers.filter((server) => {
    if (server.selfUpdate === "desktop-managed") return true;
    const platform = machines.find((machine) => machine.environmentId === server.environmentId)
      ?.serverConfig?.environment.platform;
    return platform !== undefined && isRuntimeArchivePublished(assets, targetVersion, platform);
  });
  const skipped: ReadonlyArray<SkippedMachine> = [
    ...unreachable,
    ...behindServers
      .filter((server) => !servers.includes(server))
      .map((server) => ({
        environmentId: server.environmentId,
        label: server.serverLabel,
        reason: AsyncResult.isFailure(release)
          ? "could not verify runtime release"
          : AsyncResult.isInitial(release)
            ? "checking runtime release"
            : "runtime archive is not published for this computer",
      })),
  ];
  const restarts = collectRestartingMachines(
    machines,
    servers,
    scope === "local" && localUpdateVersion !== null,
  );
  const providers = useProviderUpdates(environmentIds);
  const updateServer = useServerUpdate();

  const { summary, lines } = describeUpdateEverything({
    localVersion: scope === "local" ? localUpdateVersion : null,
    servers,
    providerMachines: providers.machines.map((machine) => ({
      environmentId: machine.environmentId,
      label: machine.label,
      providers: machine.candidates.map(
        (candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver,
      ),
    })),
  });

  return {
    machines,
    environments,
    targetVersion,
    hasUpdates: servers.length > 0 || providers.machines.length > 0,
    /** Short label for the tooltip and the confirmation title. */
    summary,
    /** One line per machine, for the confirmation. */
    lines,
    /** The servers this run restarts, which stops their running threads. */
    restarts,
    /** Behind machines the run leaves alone, with the reason. */
    skipped,
    /** Runs the pass. `installLocal` resolves true when this app is relaunching.
        Both report failures to the pass, which lists them in its summary. */
    run: async ({
      downloadLocal,
      installLocal,
    }: {
      downloadLocal?: (reportError: ReportLocalUpdateError) => Promise<boolean>;
      installLocal?: (reportError: ReportLocalUpdateError) => Promise<boolean>;
    }) => {
      const localFailures: Array<string> = [];
      const reportLocalError: ReportLocalUpdateError = (title, description) => {
        localFailures.push(`${title}: ${description}`);
      };
      const startedAt = Date.now();
      const machinesById = new Map<UpdateRunMachine["environmentId"], UpdateRunMachine>();
      for (const machine of providers.machines) {
        machinesById.set(machine.environmentId, {
          environmentId: machine.environmentId,
          label: machine.label,
          updatesProviders: true,
          server: null,
          handedOffVersion: null,
          startedAt,
          result: null,
          failure: null,
          providerFailure: null,
        });
      }
      for (const server of servers) {
        const existing = machinesById.get(server.environmentId);
        machinesById.set(server.environmentId, {
          environmentId: server.environmentId,
          label: server.serverLabel,
          updatesProviders: existing?.updatesProviders ?? false,
          server,
          handedOffVersion: null,
          startedAt,
          result: null,
          failure: null,
          providerFailure: null,
        });
      }
      const localVersion = installLocal ? localUpdateVersion : null;
      let started = false;
      setUpdateEverythingRun((existing) => {
        if (existing !== null) return existing;
        started = true;
        return {
          scope,
          localVersion,
          phase: "providers",
          restartAt: null,
          machines: Array.from(machinesById.values()),
        };
      });
      if (!started) return;
      const providerFailures = new Map<UpdateRunMachine["environmentId"], string>();
      const finishedServers: Array<{ label: string; outcome: ServerUpdateOutcome }> = [];
      try {
        const outcome = await runUpdateEverything({
          ...(downloadLocal ? { downloadLocal: () => downloadLocal(reportLocalError) } : {}),
          updateProviders: async () => {
            const runs = await providers.updateAll({ quiet: true });
            const outcomes = runs.map((run) => {
              const runOutcome = getProviderUpdateRunOutcome(run);
              // An interrupted update did not finish either, so its row is not "done".
              if (runOutcome.status !== "updated") {
                providerFailures.set(
                  run.environmentId,
                  runOutcome.status === "failed" ? runOutcome.line : "Provider update interrupted",
                );
              }
              return runOutcome;
            });
            for (const machine of machinesById.values()) {
              if (machine.server === null) {
                settleUpdateRunMachine(
                  machine.environmentId,
                  providerFailures.get(machine.environmentId) ?? null,
                );
              }
            }
            const serversStartedAt = Date.now();
            setUpdateEverythingRun(
              (run) =>
                run && {
                  ...run,
                  phase: "servers",
                  machines: run.machines.map((machine) =>
                    machine.server === null ? machine : { ...machine, startedAt: serversStartedAt },
                  ),
                },
            );
            return outcomes;
          },
          updateServers: async () => {
            const runs = servers.map(async (server) => {
              const serverOutcome = await updateServer(server, { quiet: true });
              settleUpdateRunMachine(
                server.environmentId,
                serverOutcome.status === "failed"
                  ? serverOutcome.message
                  : serverOutcome.status === "skipped"
                    ? "Could not start the update"
                    : (providerFailures.get(server.environmentId) ?? null),
                {
                  serverUpdated: serverOutcome.status === "updated",
                  providerFailure: providerFailures.get(server.environmentId) ?? null,
                },
              );
              const finished = { label: server.serverLabel, outcome: serverOutcome };
              finishedServers.push(finished);
              return finished;
            });
            // Once a server restarts into its update it finishes on its own,
            // so this app does not wait for it to come back.
            await Promise.all(
              servers.map((server, index) =>
                waitForServerUpdateHandoff(server.environmentId, runs[index]!),
              ),
            );
            return runs;
          },
        });
        const result = (finished: ReadonlyArray<{ label: string; outcome: ServerUpdateOutcome }>) =>
          collectUpdateEverythingResult({
            localVersion: null,
            localFailures,
            servers: finished,
            providers: outcome.providers,
          });
        if (outcome.localReady && installLocal) {
          if (await waitForUpdateRestart(UPDATE_RESTART_DELAY_MS)) {
            setUpdateEverythingRun(
              (run) => run && { ...run, phase: "installing", restartAt: null },
            );
            saveUpdateEverythingResult({ ...result(finishedServers), localVersion });
            if (await installLocal(reportLocalError)) return;
            clearSavedUpdateEverythingResult();
          }
        }
        // This app is not relaunching, so the pass waits for every server.
        setUpdateEverythingRun(
          (run) =>
            run &&
            closeFinishedUpdateRun({
              ...run,
              phase: "servers",
              restartAt: null,
              localVersion: null,
            }),
        );
        showUpdateEverythingResult(result(await Promise.all(outcome.servers)));
      } catch (error) {
        setUpdateEverythingRun(() => null);
        throw error;
      }
    },
  };
}
