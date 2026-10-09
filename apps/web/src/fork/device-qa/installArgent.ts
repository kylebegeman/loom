import { randomUUID } from "~/lib/utils";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "~/terminalUiStateStore";
import { terminalEnvironment } from "~/state/terminal";
import { runCommand } from "./state";

const COLS = 120;
const ROWS = 30;

/**
 * Opens a new thread terminal and types `command` without pressing Enter, so the user reviews
 * and runs it. The same calls the chat view makes for project scripts.
 */
export async function typeInNewTerminal(
  threadRef: ScopedThreadRef,
  workspace: { readonly workspaceRoot: string; readonly worktreePath: string | null },
  command: string,
) {
  const terminals = useTerminalUiStateStore.getState();
  const known = selectThreadTerminalUiState(terminals.terminalUiStateByThreadKey, threadRef);
  // A unique suffix keeps the id clear of sessions this client has not seen.
  const terminalId = nextTerminalId(known.terminalIds, randomUUID());
  const cwd = workspace.worktreePath ?? workspace.workspaceRoot;
  terminals.setTerminalOpen(threadRef, true);
  terminals.newTerminal(threadRef, terminalId);
  const { environmentId, threadId } = threadRef;
  await runCommand(terminalEnvironment.open, {
    environmentId,
    input: {
      threadId,
      terminalId,
      cwd,
      ...(workspace.worktreePath === null ? {} : { worktreePath: workspace.worktreePath }),
      env: projectScriptRuntimeEnv({
        project: { cwd: workspace.workspaceRoot },
        worktreePath: workspace.worktreePath,
      }),
      cols: COLS,
      rows: ROWS,
    },
  });
  await runCommand(terminalEnvironment.write, {
    environmentId,
    input: { threadId, terminalId, data: command },
  });
}
