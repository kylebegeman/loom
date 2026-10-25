import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { useEffect } from "react";

import {
  getDesktopUpdateInstallConfirmationTitle,
  resolveDesktopUpdateButtonAction,
} from "~/components/desktopUpdate.logic";
import { installLocalUpdate } from "~/components/sidebar/SidebarUpdatePill";
import { UpdateEverythingDialog } from "~/components/sidebar/UpdateEverythingDialog";
import type { UpdateEverythingRun } from "~/components/sidebar/updateEverything.logic";
import {
  clearSavedUpdateEverythingResult,
  saveUpdateEverythingResult,
  useUpdateEverythingRun,
} from "~/components/sidebar/updateEverythingRun";
import { useUpdateEverything } from "~/components/sidebar/useUpdateEverything";
import { isElectron } from "~/env";
import { useDesktopUpdateState } from "~/state/desktopUpdate";
import {
  closeLocalUpdateInstall,
  INSTALL_WHEN_IDLE_QUIET_MS,
  installArmedUpdate,
  setLocalInstallWhenIdle,
  supportsInstallWhenIdle,
  useLocalAgentsIdle,
  useLocalUpdateInstallPrompt,
} from "./localUpdateInstall";

/**
 * The install dialog behind every "install this app's update" button, and the wait behind
 * "Install when idle". It lives at the root because Settings has no sidebar update button, and
 * the wait has to keep running whichever view is open.
 */
export function LocalUpdateInstallHost() {
  return isElectron ? <LocalUpdateInstall /> : null;
}

function LocalUpdateInstall() {
  const state = useDesktopUpdateState();
  const prompted = useLocalUpdateInstallPrompt();
  const bridge = window.desktopBridge;
  const version = state?.downloadedVersion ?? null;
  const installable = bridge !== undefined && version !== null;

  useEffect(() => {
    if (prompted && !installable) closeLocalUpdateInstall();
  }, [prompted, installable]);

  if (!bridge || !state || version === null) return null;
  return (
    <>
      {prompted ? <InstallDialog bridge={bridge} state={state} version={version} /> : null}
      {state.installWhenIdle === true && resolveDesktopUpdateButtonAction(state) === "install" ? (
        <InstallWhenIdle bridge={bridge} version={version} />
      ) : null}
    </>
  );
}

function InstallDialog({
  bridge,
  state,
  version,
}: {
  readonly bridge: DesktopBridge;
  readonly state: DesktopUpdateState;
  readonly version: string;
}) {
  const { restarts } = useUpdateEverything(version, "local");
  return (
    <UpdateEverythingDialog
      open
      onOpenChange={(open) => {
        if (!open) closeLocalUpdateInstall();
      }}
      summary={getDesktopUpdateInstallConfirmationTitle(state)}
      lines={[]}
      restarts={restarts}
      skipped={[]}
      confirmLabel="Restart now"
      onConfirm={() => {
        closeLocalUpdateInstall();
        void installNow(bridge, version);
      }}
      {...(supportsInstallWhenIdle(bridge)
        ? {
            onConfirmWhenIdle: () => {
              closeLocalUpdateInstall();
              void setLocalInstallWhenIdle(bridge, true);
            },
          }
        : {})}
    />
  );
}

async function installNow(bridge: DesktopBridge, version: string) {
  saveUpdateEverythingResult({
    localVersion: version,
    updatedServers: 0,
    updatedProviders: 0,
    failures: [],
    restarting: [],
  });
  if (!(await installLocalUpdate(bridge))) clearSavedUpdateEverythingResult();
}

/** An update pass that is still settling machines or counting down owns the restart. */
function updateRunBusy(run: UpdateEverythingRun | null): boolean {
  return (
    run !== null &&
    (run.phase === "countdown" ||
      run.phase === "installing" ||
      run.machines.some((machine) => machine.result === null))
  );
}

/**
 * Installs once local agents have stayed idle for the quiet window, so a turn that finishes and
 * immediately queues the next one is not cut off between them. Any new work restarts the window.
 */
function InstallWhenIdle({
  bridge,
  version,
}: {
  readonly bridge: DesktopBridge;
  readonly version: string;
}) {
  const idle = useLocalAgentsIdle();
  const run = useUpdateEverythingRun();
  const ready = idle && !updateRunBusy(run);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitThenInstall = () => {
      timer = setTimeout(() => {
        void installArmedUpdate(bridge, version).then((outcome) => {
          if (current && outcome === "refused") waitThenInstall();
        });
      }, INSTALL_WHEN_IDLE_QUIET_MS);
    };
    waitThenInstall();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [bridge, version, ready]);

  return null;
}
