import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";

import { switchboardCodexArgs } from "../fork/switchboard/switchboard.ts"; // fork: switchboard

const T3CODE_CODEX_LAUNCH_ARGS_ENV = "T3CODE_CODEX_LAUNCH_ARGS";

export const resolveCodexLaunchArgs = (
  launchArgs?: string,
  environment: NodeJS.ProcessEnv = process.env,
) => environment[T3CODE_CODEX_LAUNCH_ARGS_ENV]?.trim() || launchArgs?.trim() || "";

const codexLaunchArgv = (
  launchArgs?: string,
  switchboardArgs = switchboardCodexArgs(), // fork: switchboard
): ReadonlyArray<string> => [
  ...tokenizeCliArgs(launchArgs),
  ...switchboardArgs, // fork: switchboard
];

export const codexAppServerArgs = (
  launchArgs?: string,
  switchboardArgs?: ReadonlyArray<string>, // fork: switchboard
) => [
  "app-server",
  ...codexLaunchArgv(launchArgs, switchboardArgs), // fork: switchboard
];

export const codexExecLaunchArgs = (launchArgs?: string) => {
  const args = codexLaunchArgv(launchArgs);
  const execArgs: Array<string> = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg === "--strict-config" || arg.startsWith("--config=") || arg.startsWith("-c=")) {
      execArgs.push(arg);
    } else if (arg === "--config" || arg === "-c" || arg === "--enable" || arg === "--disable") {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith("-")) {
        execArgs.push(arg, value);
        index++;
      }
    } else if (arg.startsWith("--enable=") || arg.startsWith("--disable=")) {
      execArgs.push(arg);
    }
  }

  return execArgs;
};
