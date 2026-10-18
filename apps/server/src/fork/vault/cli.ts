// @effect-diagnostics nodeBuiltinImport:off -- CLI process boundary reads its authenticated connection environment.
import * as NodeProcess from "node:process";
import { Argument, Command } from "effect/cli";
import { callForkTool } from "../cli/callTool.ts";
const actions = {
  status: "loom_vault_status",
  list: "loom_vault_items",
  change: "loom_vault_change",
} as const;
export const vaultCommand = Command.make("vault").pipe(
  Command.withDescription(
    "Inspect Loom Vault or change item lifecycle through the authenticated Loom connection. Enter secret values privately in Loom.",
  ),
  Command.withSubcommands(
    Object.entries(actions).map(([action, tool]) =>
      Command.make(action, {
        argumentsJson: Argument.String("arguments-json").pipe(
          Argument.withDefault(
            action === "list" ? '{"cursor":null,"includeArchived":false}' : "{}",
          ),
        ),
      }).pipe(
        Command.withHandler(({ argumentsJson }) =>
          callForkTool(tool, argumentsJson, NodeProcess.env),
        ),
      ),
    ),
  ),
);
