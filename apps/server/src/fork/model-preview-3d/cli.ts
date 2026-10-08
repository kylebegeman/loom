// @effect-diagnostics nodeBuiltinImport:off -- CLI process boundary.
import * as NodeProcess from "node:process";
import { Argument, Command } from "effect/cli";
import { callForkTool } from "../cli/callTool.ts";
export const modelCommand = Command.make("model", {
  action: Argument.String("action"),
  argumentsJson: Argument.String("arguments-json"),
}).pipe(
  Command.withDescription(
    "Call a 3D editor tool: t3 model <action> '<json>'. Actions match loom_model_preview_3d_* suffixes.",
  ),
  Command.withHandler(({ action, argumentsJson }) =>
    callForkTool(`loom_model_preview_3d_${action}`, argumentsJson, NodeProcess.env),
  ),
);
