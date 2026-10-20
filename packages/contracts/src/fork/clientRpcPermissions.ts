import { VAULT_HEALTH_WS_METHODS as VH } from "./vault-health.ts";
import { VAULT_GITHUB_WS_METHODS as VG } from "./vault-github.ts";
import { VAULT_PROFILE_WS_METHODS as VP } from "./vault-profiles.ts";
import { VAULT_SSH_WS_METHODS as VS } from "./vault-ssh.ts";
import { VAULT_BROKER_WS_METHODS as VB } from "./vault-brokers.ts";
import { VAULT_ACCESS_WS_METHODS as VA } from "./vault-access.ts";
import { VAULT_CORE_WS_METHODS as V } from "./vault-core.ts";
import { AuthAccessWriteScope } from "../auth.ts";
import { SITES_WS_METHODS as S } from "./sites.ts";
import { LIBRARY_WS_METHODS as LIB } from "./project-library.ts";
import { LIBRARY_BRIEF_WS_METHODS as BRIEF } from "./project-library-brief.ts";
import { LIBRARY_READINESS_WS_METHODS as LR } from "./project-library-readiness.ts";
import { LIBRARY_BRIEF_SUGGESTION_WS_METHODS as SUGGEST } from "./project-library-brief-suggestions.ts";
import { PROJECT_CHECKOUT_WS_METHODS as C } from "./project-checkout.ts";
import { AuthSettingsWriteScope } from "../auth.ts";
import { COMPUTER_NAMING_WS_METHODS as N } from "./computer-naming.ts";
import { GITHUB_HOST_SETUP_WS_METHODS as GH } from "./github-host-setup.ts";
import { WORKSPACE_HANDOFF_WS_METHODS as H } from "./workspace-handoff.ts";
import { MINI_OFFLOAD_WS_METHODS as O } from "./mini-offload.ts";
import { AuthOrchestrationReadScope, AuthEnvironmentMaintainScope } from "../auth.ts";
import { PCB_PREVIEW_WS_METHODS as P } from "./pcb-preview.ts";
import { AuthOrchestrationOperateScope, AuthTerminalOperateScope } from "../auth.ts";
import { MODEL_PREVIEW_3D_WS_METHODS as M } from "./model-preview-3d.ts";
import { PROJECT_LIFECYCLE_WS_METHODS as L } from "./project-lifecycle.ts";
import { APPLE_BUILD_TOOLING_WS_METHODS as A } from "./apple-build-tooling.ts";
import { DEVICE_QA_WS_METHODS as Q } from "./device-qa.ts";
import { CODE_GRAPH_WS_METHODS as G } from "./code-graph.ts";
import { PREVIEW_LINKS_WS_METHODS as PL } from "./preview-links.ts";
import { AuthPreviewOperateScope } from "../auth.ts";
import { DIRECTORY_WS_METHODS as DIR } from "./directory.ts";

/** Fork writes use the same grant as their environment's server handlers. */
export const FORK_CLIENT_GUARDED_RPC_SCOPES = {
  [VH.apply]: AuthAccessWriteScope,
  [VH.recheck]: AuthAccessWriteScope,
  [VG.save]: AuthAccessWriteScope,
  [VG.test]: AuthAccessWriteScope,
  [VG.readiness]: AuthAccessWriteScope,
  [VG.change]: AuthAccessWriteScope,
  [VP.apply]: AuthAccessWriteScope,
  [VP.retirePin]: AuthAccessWriteScope,
  [VS.generate]: AuthAccessWriteScope,
  [VS.trust]: AuthAccessWriteScope,
  [VS.probe]: AuthAccessWriteScope,
  [VB.begin]: AuthAccessWriteScope,
  [VB.apply]: AuthAccessWriteScope,
  [VA.apply]: AuthAccessWriteScope,
  [V.save]: AuthAccessWriteScope,
  [V.change]: AuthAccessWriteScope,
  [V.reveal]: AuthAccessWriteScope,
  [S.saveSite]: AuthSettingsWriteScope,
  [S.saveService]: AuthSettingsWriteScope,
  [S.saveCheck]: AuthSettingsWriteScope,
  [S.runChecks]: AuthSettingsWriteScope,
  [LIB.flushHistory]: AuthOrchestrationOperateScope,
  [LIB.registerThread]: AuthOrchestrationOperateScope,
  [LIB.inspectFolder]: AuthTerminalOperateScope,
  [LIB.createProject]: AuthSettingsWriteScope,
  [LIB.updateProject]: AuthSettingsWriteScope,
  [LIB.archiveProject]: AuthSettingsWriteScope,
  [LIB.registerCopy]: AuthOrchestrationOperateScope,
  [LIB.prepareCopy]: AuthTerminalOperateScope,
  [LIB.unregisterCopy]: AuthOrchestrationOperateScope,
  [LIB.releaseCopy]: AuthOrchestrationOperateScope,
  [LIB.bindThread]: AuthOrchestrationOperateScope,
  [LIB.ingestHistory]: AuthOrchestrationOperateScope,
  [LIB.importShadow]: AuthEnvironmentMaintainScope,
  [BRIEF.propose]: AuthOrchestrationOperateScope,
  // Accepting rewrites the brief, so deciding needs the grant that edits projects.
  [BRIEF.accept]: AuthSettingsWriteScope,
  [BRIEF.dismiss]: AuthSettingsWriteScope,
  // Applying a setup rewrites local project settings, like editing them in Settings.
  [LR.applyProfile]: AuthSettingsWriteScope,
  // Starting launches a background conversation, like sending one a message.
  [SUGGEST.start]: AuthOrchestrationOperateScope,
  [SUGGEST.decline]: AuthOrchestrationOperateScope,
  [C.adopt]: AuthSettingsWriteScope,
  [C.setRetention]: AuthSettingsWriteScope,
  [N.rename]: AuthSettingsWriteScope,
  [GH.start]: AuthTerminalOperateScope,
  [GH.cancel]: AuthTerminalOperateScope,
  [O.register]: AuthEnvironmentMaintainScope,
  [O.setEnabled]: AuthEnvironmentMaintainScope,
  [O.submit]: AuthTerminalOperateScope,
  [O.recover]: AuthTerminalOperateScope,
  [O.cancel]: AuthTerminalOperateScope,
  [O.artifacts]: AuthOrchestrationReadScope,
  [O.check]: AuthOrchestrationReadScope,
  [O.prepare]: AuthEnvironmentMaintainScope,
  [P.historyRestore]: AuthOrchestrationOperateScope,
  [P.historyUndo]: AuthOrchestrationOperateScope,
  [P.pinMap]: AuthOrchestrationOperateScope,
  [P.reuseHardware]: AuthOrchestrationOperateScope,
  [P.inspect]: AuthTerminalOperateScope,
  [P.asset]: AuthTerminalOperateScope,
  [P.compare]: AuthTerminalOperateScope,
  [P.simulate]: AuthTerminalOperateScope,
  [P.updateWorkspace]: AuthOrchestrationOperateScope,
  [P.changeRequest]: AuthOrchestrationOperateScope,
  [P.updateLibrary]: AuthOrchestrationOperateScope,
  [P.applyParameters]: AuthOrchestrationOperateScope,
  [P.enclosure]: AuthTerminalOperateScope,
  [P.exportReference]: AuthTerminalOperateScope,
  [P.editorAction]: AuthOrchestrationOperateScope,
  [P.completeEditorAction]: AuthOrchestrationOperateScope,
  [P.render]: AuthTerminalOperateScope,
  [P.renderVariant]: AuthTerminalOperateScope,
  [P.cancelVariant]: AuthTerminalOperateScope,
  [P.updateProjectSettings]: AuthTerminalOperateScope,
  [P.fabPackage]: AuthTerminalOperateScope,
  [P.deleteFabPackage]: AuthOrchestrationOperateScope,
  [P.fabCheck]: AuthTerminalOperateScope,
  [P.updateFabCapabilities]: AuthOrchestrationOperateScope,
  [P.review]: AuthTerminalOperateScope,
  [P.check]: AuthTerminalOperateScope,
  [P.print]: AuthTerminalOperateScope,
  [M.editorAction]: AuthOrchestrationOperateScope,
  [M.completeEditorAction]: AuthOrchestrationOperateScope,
  [M.updateWorkspace]: AuthOrchestrationOperateScope,
  [M.cancelVariant]: AuthOrchestrationOperateScope,
  [M.renderScad]: AuthOrchestrationOperateScope,
  [M.checkPrint]: AuthOrchestrationOperateScope,
  [M.cancelPrintCheck]: AuthOrchestrationOperateScope,
  [M.saveParameterSet]: AuthOrchestrationOperateScope,
  [M.updatePrinters]: AuthOrchestrationOperateScope,
  [M.historyVersion]: AuthOrchestrationOperateScope,
  [M.historyCancel]: AuthOrchestrationOperateScope,
  [M.historyRestore]: AuthOrchestrationOperateScope,
  [M.historyUndo]: AuthOrchestrationOperateScope,
  [M.updateAssembly]: AuthOrchestrationOperateScope,
  [M.checkAssembly]: AuthTerminalOperateScope,
  [M.cancelAssemblyCheck]: AuthOrchestrationOperateScope,
  [M.slice]: AuthOrchestrationOperateScope,
  [M.importSlicerProfile]: AuthOrchestrationOperateScope,
  [M.openSlice]: AuthTerminalOperateScope,
  [M.renderModel]: AuthTerminalOperateScope,
  [M.exportStep]: AuthTerminalOperateScope,
  [M.pythonSetup]: AuthTerminalOperateScope,
  [M.updateSettings]: AuthOrchestrationOperateScope,
  [M.clearCache]: AuthOrchestrationOperateScope,
  [H.offer]: AuthOrchestrationOperateScope,
  [H.prepare]: AuthOrchestrationOperateScope,
  [H.finish]: AuthOrchestrationOperateScope,
  [H.resume]: AuthOrchestrationOperateScope,
  [L.updateSettings]: AuthOrchestrationOperateScope,
  [L.free]: AuthOrchestrationOperateScope,
  [L.grow]: AuthOrchestrationOperateScope,
  [L.mount]: AuthOrchestrationOperateScope,
  [L.discard]: AuthOrchestrationOperateScope,
  [L.releaseLease]: AuthOrchestrationOperateScope,
  [L.installShell]: AuthTerminalOperateScope,
  [L.removeShell]: AuthTerminalOperateScope,
  [A.start]: AuthTerminalOperateScope,
  [A.cancel]: AuthTerminalOperateScope,
  [A.clearHistory]: AuthTerminalOperateScope,
  [A.openResultBundle]: AuthTerminalOperateScope,
  [A.updateSettings]: AuthOrchestrationOperateScope,
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
  [G.build]: AuthOrchestrationOperateScope,
  [G.cancel]: AuthOrchestrationOperateScope,
  [G.deleteGraph]: AuthOrchestrationOperateScope,
  [G.setAgentTool]: AuthOrchestrationOperateScope,
  [G.updateSettings]: AuthTerminalOperateScope,
  [PL.configure]: AuthSettingsWriteScope,
  [PL.share]: AuthPreviewOperateScope,
  [PL.open]: AuthPreviewOperateScope,
  [PL.extend]: AuthPreviewOperateScope,
  [PL.revoke]: AuthPreviewOperateScope,
  [PL.restore]: AuthPreviewOperateScope,
  [PL.revokeAll]: AuthPreviewOperateScope,
  [PL.signOutBrowsers]: AuthPreviewOperateScope,
  // pagesList stays unguarded: clients read it with a query atom, which excludes guarded tags.
  [PL.pagesUpdate]: AuthPreviewOperateScope,
  // The directory list stays unguarded for the same reason.
  [DIR.forget]: AuthSettingsWriteScope,
} as const;
