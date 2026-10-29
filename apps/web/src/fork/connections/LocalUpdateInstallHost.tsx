import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { useEffect } from "react";

import { getDesktopUpdateInstallConfirmationTitle } from "~/components/desktopUpdate.logic";
import { installLocalUpdate } from "~/components/sidebar/SidebarUpdatePill";
import { UpdateEverythingDialog } from "~/components/sidebar/UpdateEverythingDialog";
import {
  clearSavedUpdateEverythingResult,
  saveUpdateEverythingResult,
} from "~/components/sidebar/updateEverythingRun";
import { useUpdateEverything } from "~/components/sidebar/useUpdateEverything";
import { isElectron } from "~/env";
import { useDesktopUpdateState } from "~/state/desktopUpdate";
import {
  closeLocalUpdateInstall,
  setLocalInstallWhenIdle,
  supportsInstallWhenIdle,
  useLocalUpdateInstallPrompt,
} from "./localUpdateInstall";

/** The install dialog shared by every local update button; desktop main owns idle waiting. */
export function LocalUpdateInstallHost() {
  return isElectron ? <LocalUpdateInstall /> : null;
}

function LocalUpdateInstall() {
  const state = useDesktopUpdateState();
  const prompted = useLocalUpdateInstallPrompt();
  const bridge = window.desktopBridge;
  const version = state?.downloadedVersion ?? null;
  const installable = bridge !== undefined && version !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes the app-registry install prompt once the desktop update is no longer installable
  useEffect(() => {
    if (prompted && !installable) closeLocalUpdateInstall();
  }, [prompted, installable]);

  if (!bridge || !state || version === null) return null;
  return <>{prompted ? <InstallDialog bridge={bridge} state={state} version={version} /> : null}</>;
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
      title={getDesktopUpdateInstallConfirmationTitle(state)}
      version={null}
      providerCount={0}
      rows={[]}
      restarts={restarts}
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
