import { useLayoutEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useThreadTerminalActions } from "~/components/terminal/useThreadTerminalActions";
import { useTerminalUiStateStore } from "~/terminalUiStateStore";
import { useQuietThreadShell } from "~/state/entities";
import { projectScriptTerminalInput } from "@t3tools/shared/projectScripts";
import type { VarlockCommandInput } from "@t3tools/contracts/fork";
import { profiles, runProfileCommand } from "./state";
export function useRunProfileCommand(threadRef: ScopedThreadRef) {
  const actions = useThreadTerminalActions(threadRef);
  const thread = useQuietThreadShell(threadRef);
  const targetKey = JSON.stringify([threadRef.environmentId, threadRef.threadId]);
  const mountedTarget = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks the mounted thread target in a ref so an in-flight command can detect a thread switch
  useLayoutEffect(() => {
    mountedTarget.current = targetKey;
    return () => {
      mountedTarget.current = null;
    };
  }, [targetKey]);
  return async (target: VarlockCommandInput["target"]) => {
    if (!thread || !actions.canWrite()) throw new Error("Terminal access is required.");
    const resolved = await runProfileCommand(profiles.command, {
      environmentId: threadRef.environmentId,
      input: { projectId: thread.projectId, threadId: threadRef.threadId, target },
    });
    if (mountedTarget.current !== targetKey)
      throw new Error(
        "The active thread changed before the command was ready. Try again in that thread.",
      );
    const terminal = actions.launchTerminal({
      place: (id) => useTerminalUiStateStore.getState().newTerminal(threadRef, id),
      location: { cwd: resolved.cwd, worktreePath: thread.worktreePath ?? null },
      extraEnv: { VARLOCK_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
      size: { cols: 100, rows: 28 },
    });
    if (!terminal) throw new Error("The terminal could not be opened.");
    const opened = await terminal.result;
    if (opened._tag === "Failure") throw new Error("The terminal could not be opened.");
    if (mountedTarget.current !== targetKey)
      throw new Error(
        "The active thread changed before the terminal was ready. Try again in that thread.",
      );
    const written = await actions.writeToTerminal(
      terminal.terminalId,
      projectScriptTerminalInput(resolved.commandLine),
    );
    if (!written || written._tag === "Failure")
      throw new Error("The command could not be sent to the terminal.");
  };
}
