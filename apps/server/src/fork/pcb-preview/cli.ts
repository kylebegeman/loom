// @effect-diagnostics nodeBuiltinImport:off -- CLI process boundary.
import * as NodeProcess from "node:process";
import { Argument, Command } from "effect/cli";
import { callForkTool } from "../cli/callTool.ts";
/** Uses the same thread-scoped MCP credential and service boundaries as the agent tools. */
export const pcbCommand = Command.make("pcb", {
  action: Argument.String("action"),
  argumentsJson: Argument.String("arguments-json"),
}).pipe(
  Command.withDescription(
    "Call a PCB tool from a Loom agent terminal: t3 pcb <action> '<json>'. Actions match loom_pcb_* MCP tool suffixes.",
  ),
  Command.withHandler(({ action, argumentsJson }) =>
    callForkTool(`loom_pcb_${action}`, argumentsJson, NodeProcess.env),
  ),
);
