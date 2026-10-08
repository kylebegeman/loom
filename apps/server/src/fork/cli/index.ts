import { pcbCommand } from "../pcb-preview/cli.ts";
import { modelCommand } from "../model-preview-3d/cli.ts";
export const FORK_CLI_COMMANDS = [pcbCommand, modelCommand] as const;
