import { AuthOrchestrationOperateScope } from "../auth.ts";
import { MODEL_PREVIEW_3D_WS_METHODS as M } from "./model-preview-3d.ts";

/** Model writes use the same grant as their environment's server handlers. */
export const FORK_CLIENT_GUARDED_RPC_SCOPES = {
  [M.updateWorkspace]: AuthOrchestrationOperateScope,
  [M.cancelVariant]: AuthOrchestrationOperateScope,
  [M.renderScad]: AuthOrchestrationOperateScope,
  [M.saveParameterSet]: AuthOrchestrationOperateScope,
  [M.updateSettings]: AuthOrchestrationOperateScope,
  [M.clearCache]: AuthOrchestrationOperateScope,
} as const;
