import { PCB_PREVIEW_WS_METHODS as P } from "./pcb-preview.ts";
import { AuthOrchestrationOperateScope, AuthTerminalOperateScope } from "../auth.ts";
import { MODEL_PREVIEW_3D_WS_METHODS as M } from "./model-preview-3d.ts";
import { PROJECT_LIFECYCLE_WS_METHODS as L } from "./project-lifecycle.ts";

/** Fork writes use the same grant as their environment's server handlers. */
export const FORK_CLIENT_GUARDED_RPC_SCOPES = {
  [P.reuseHardware]: AuthOrchestrationOperateScope,
  [P.inspect]: AuthTerminalOperateScope,
  [P.asset]: AuthTerminalOperateScope,
  [P.compare]: AuthTerminalOperateScope,
  [P.simulate]: AuthTerminalOperateScope,
  [P.updateWorkspace]: AuthOrchestrationOperateScope,
  [P.updateLibrary]: AuthOrchestrationOperateScope,
  [P.applyParameters]: AuthOrchestrationOperateScope,
  [P.exportReference]: AuthOrchestrationOperateScope,
  [P.editorAction]: AuthOrchestrationOperateScope,
  [P.completeEditorAction]: AuthOrchestrationOperateScope,
  [P.render]: AuthTerminalOperateScope,
  [P.check]: AuthTerminalOperateScope,
  [M.editorAction]: AuthOrchestrationOperateScope,
  [M.completeEditorAction]: AuthOrchestrationOperateScope,
  [M.updateWorkspace]: AuthOrchestrationOperateScope,
  [M.cancelVariant]: AuthOrchestrationOperateScope,
  [M.renderScad]: AuthOrchestrationOperateScope,
  [M.saveParameterSet]: AuthOrchestrationOperateScope,
  [M.updateSettings]: AuthOrchestrationOperateScope,
  [M.clearCache]: AuthOrchestrationOperateScope,
  [L.updateSettings]: AuthOrchestrationOperateScope,
  [L.free]: AuthOrchestrationOperateScope,
  [L.grow]: AuthOrchestrationOperateScope,
  [L.mount]: AuthOrchestrationOperateScope,
  [L.discard]: AuthOrchestrationOperateScope,
  [L.installShell]: AuthTerminalOperateScope,
  [L.removeShell]: AuthTerminalOperateScope,
} as const;
