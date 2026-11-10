import { useState } from "react";

import {
  desktopCliCommandStateAtom,
  getDesktopCliCommandBridge,
  refreshDesktopCliCommandState,
} from "~/state/desktopCliCommand";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const FAILURE_TITLES = {
  // fork: brand
  install: "Could not install loom",
  // fork: brand
  uninstall: "Could not remove loom",
  // fork: brand
  addToPath: "Could not add loom to PATH",
} as const;

/** The desktop `t3` command's state, and its actions with a toast on failure. */
export function useDesktopCliCommand() {
  const bridge = getDesktopCliCommandBridge();
  const query = useEnvironmentQuery(bridge ? desktopCliCommandStateAtom : null);
  const [pending, setPending] = useState(false);

  const run = (action: keyof typeof FAILURE_TITLES) => {
    if (!bridge || pending) return;
    setPending(true);
    void bridge[action]()
      .then(refreshDesktopCliCommandState)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: FAILURE_TITLES[action],
            description: error instanceof Error ? error.message : "Something went wrong.",
          }),
        );
      })
      .finally(() => setPending(false));
  };

  return {
    state: bridge ? query.data : undefined,
    busy: pending || query.isPending,
    run,
  };
}

export function CliCommandSettingsRow() {
  const { state, busy, run } = useDesktopCliCommand();

  if (!state?.supported) return null;
  const installed = state.installedPath !== null;
  const description = state.shadowedBy
    ? // fork: brand
      `Another loom at ${state.shadowedBy} runs first in a new terminal. Remove it to use Loom's.`
    : !installed
      ? // fork: brand
        "Run Loom's CLI as `loom` from any terminal."
      : state.onPath
        ? `Installed at ${state.installedPath}. Open a new terminal to use it.`
        : state.pathSetup?.added
          ? `Installed at ${state.installedPath} and added to PATH in ${state.pathSetup.file}. Open a new terminal to use it.`
          : // fork: brand
            `Installed at ${state.installedPath}, which is not on your PATH yet.${state.pathSetup ? "" : " Add its folder to your PATH to run `loom`."}`;

  return (
    <SettingsRow
      {...searchableSetting("cli-command")}
      description={description}
      control={
        <div className="flex gap-2">
          {state.pathSetup && !state.pathSetup.added ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run("addToPath")}>
              Add to PATH
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (!installed && Boolean(state.shadowedBy))}
            onClick={() => run(installed ? "uninstall" : "install")}
          >
            {installed ? "Remove" : "Install"}
          </Button>
        </div>
      }
    />
  );
}
