// @effect-diagnostics nodeBuiltinImport:off -- CLI process boundary.
import * as NodeProcess from "node:process";
import { Argument, Command } from "effect/cli";
import { callForkTool } from "../cli/callTool.ts";
const actions = {
  list: "loom_sites",
  analytics: "loom_site_analytics",
  save: "loom_site_save",
  "save-service": "loom_site_service_save",
  "save-check": "loom_site_check_save",
  "run-checks": "loom_site_checks_run",
} as const;
export const sitesCommand = Command.make("sites").pipe(
  Command.withDescription(
    "Manage sites through the authenticated Loom MCP connection. Save operations replace settings; active:false pauses without deleting history.",
  ),
  Command.withSubcommands(
    Object.entries(actions).map(([action, tool]) =>
      Command.make(action, {
        argumentsJson: Argument.String("arguments-json").pipe(Argument.withDefault("{}")),
      }).pipe(
        Command.withDescription(`Call ${tool}. Pass a JSON object using the MCP tool's schema.`),
        Command.withHandler(({ argumentsJson }) =>
          callForkTool(tool, argumentsJson, NodeProcess.env),
        ),
      ),
    ),
  ),
);
