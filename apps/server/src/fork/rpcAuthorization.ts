import { PCB_PREVIEW_WS_METHODS as P } from "@t3tools/contracts/fork";
import { MODEL_PREVIEW_3D_WS_METHODS as M } from "@t3tools/contracts/fork";
import { PROJECT_LIFECYCLE_WS_METHODS as L } from "@t3tools/contracts/fork";
import { APPLE_BUILD_TOOLING_WS_METHODS as A } from "@t3tools/contracts/fork";
import { DEVICE_QA_WS_METHODS as Q } from "@t3tools/contracts/fork";
import {
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { FORK_WS_METHODS, type ForkRpcMethod } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";

/** One scope per fork RPC. Exhaustive: a fork method without a scope fails typecheck. */
export const FORK_RPC_REQUIRED_SCOPES = {
  [P.reuseHardware]: AuthOrchestrationOperateScope,
  [P.inspect]: AuthTerminalOperateScope,
  [P.workspace]: AuthOrchestrationReadScope,
  [P.updateWorkspace]: AuthOrchestrationOperateScope,
  [P.asset]: AuthTerminalOperateScope,
  [P.compare]: AuthTerminalOperateScope,
  [P.revisions]: AuthOrchestrationReadScope,
  [P.parameters]: AuthOrchestrationReadScope,
  [P.applyParameters]: AuthOrchestrationOperateScope,
  [P.simulate]: AuthTerminalOperateScope,
  [P.library]: AuthOrchestrationReadScope,
  [P.updateLibrary]: AuthOrchestrationOperateScope,
  [P.exportReference]: AuthOrchestrationOperateScope,
  [P.workspaceUpdates]: AuthOrchestrationReadScope,
  [P.panelEvents]: AuthOrchestrationReadScope,
  [P.editorEvents]: AuthOrchestrationReadScope,
  [P.editorAction]: AuthOrchestrationOperateScope,
  [P.completeEditorAction]: AuthOrchestrationOperateScope,
  [P.status]: AuthOrchestrationReadScope,
  [P.listDesigns]: AuthOrchestrationReadScope,
  [P.render]: AuthTerminalOperateScope,
  [P.check]: AuthTerminalOperateScope,
  [P.readSheet]: AuthOrchestrationReadScope,
  [P.latestChecks]: AuthOrchestrationReadScope,
  [P.watch]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS.coreInfo]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS.limits]: AuthOrchestrationReadScope,
  [M.editorAction]: AuthOrchestrationOperateScope,
  [M.completeEditorAction]: AuthOrchestrationOperateScope,
  [M.editorEvents]: AuthOrchestrationReadScope,
  [M.panelEvents]: AuthOrchestrationReadScope,
  [M.workspace]: AuthOrchestrationReadScope,
  [M.updateWorkspace]: AuthOrchestrationOperateScope,
  [M.cancelVariant]: AuthOrchestrationOperateScope,
  [M.status]: AuthOrchestrationReadScope,
  [M.listModels]: AuthOrchestrationReadScope,
  [M.fileUrl]: AuthOrchestrationReadScope,
  [M.watch]: AuthOrchestrationReadScope,
  [M.parameters]: AuthOrchestrationReadScope,
  [M.renderScad]: AuthOrchestrationOperateScope,
  [M.saveParameterSet]: AuthOrchestrationOperateScope,
  [M.getSettings]: AuthOrchestrationReadScope,
  [M.updateSettings]: AuthOrchestrationOperateScope,
  [M.clearCache]: AuthOrchestrationOperateScope,
  [L.getSettings]: AuthOrchestrationReadScope,
  [L.updateSettings]: AuthOrchestrationOperateScope,
  [L.watch]: AuthOrchestrationReadScope,
  [L.free]: AuthOrchestrationOperateScope,
  [L.grow]: AuthOrchestrationOperateScope,
  [L.mount]: AuthOrchestrationOperateScope,
  [L.discard]: AuthOrchestrationOperateScope,
  [L.releaseLease]: AuthOrchestrationOperateScope,
  // Edits the server user's ~/.zshenv, which shapes every shell agents run.
  [L.installShell]: AuthTerminalOperateScope,
  [L.removeShell]: AuthTerminalOperateScope,
  [A.status]: AuthOrchestrationReadScope,
  [A.inspect]: AuthOrchestrationReadScope,
  [A.destinations]: AuthOrchestrationReadScope,
  [A.xcodegen]: AuthOrchestrationReadScope,
  [A.readiness]: AuthOrchestrationReadScope,
  [A.getRun]: AuthOrchestrationReadScope,
  [A.watchRuns]: AuthOrchestrationReadScope,
  [A.tailLog]: AuthOrchestrationReadScope,
  [A.getSettings]: AuthOrchestrationReadScope,
  // Builds run arbitrary build phases and scripts.
  [A.start]: AuthTerminalOperateScope,
  [A.cancel]: AuthTerminalOperateScope,
  [A.clearHistory]: AuthTerminalOperateScope,
  [A.openResultBundle]: AuthTerminalOperateScope,
  [A.updateSettings]: AuthOrchestrationOperateScope,
  [Q.status]: AuthOrchestrationReadScope,
  [Q.listFlows]: AuthOrchestrationReadScope,
  [Q.readFlow]: AuthOrchestrationReadScope,
  [Q.getRun]: AuthOrchestrationReadScope,
  [Q.watchRuns]: AuthOrchestrationReadScope,
  [Q.runEvents]: AuthOrchestrationReadScope,
  [Q.watchEvidence]: AuthOrchestrationReadScope,
  [Q.getSettings]: AuthOrchestrationReadScope,
  // Flows, captures and installs run host commands against devices.
  [Q.runFlows]: AuthTerminalOperateScope,
  [Q.cancelRun]: AuthTerminalOperateScope,
  [Q.capture]: AuthTerminalOperateScope,
  [Q.stopRecording]: AuthTerminalOperateScope,
  [Q.installApp]: AuthTerminalOperateScope,
  [Q.statusBar]: AuthTerminalOperateScope,
  [Q.disableArgentTelemetry]: AuthTerminalOperateScope,
  [Q.deleteEvidence]: AuthOrchestrationOperateScope,
  [Q.deleteAllEvidence]: AuthOrchestrationOperateScope,
  [Q.updateSettings]: AuthOrchestrationOperateScope,
} as const satisfies Readonly<Record<ForkRpcMethod, AuthEnvironmentScope>>;

const denied = (scope: AuthEnvironmentScope) =>
  new EnvironmentAuthorizationError({
    message: `The authenticated token is missing required scope: ${scope}.`,
    requiredScope: scope,
  });

/** Authorization for fork handlers, bound to one connection. The server group instruments calls. */
export const makeForkRpcAuth = (session: AuthenticatedSession) => ({
  effect: <A, E, R>(method: ForkRpcMethod, effect: Effect.Effect<A, E, R>) => {
    const scope = FORK_RPC_REQUIRED_SCOPES[method];
    return session.scopes.includes(scope) ? effect : Effect.fail(denied(scope));
  },
  stream: <A, E, R>(method: ForkRpcMethod, stream: Stream.Stream<A, E, R>) => {
    const scope = FORK_RPC_REQUIRED_SCOPES[method];
    return session.scopes.includes(scope) ? stream : Stream.fail(denied(scope));
  },
});
export type ForkRpcAuth = ReturnType<typeof makeForkRpcAuth>;
