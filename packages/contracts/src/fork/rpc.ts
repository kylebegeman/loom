import { VaultGitHubRpcGroup } from "./vault-github.ts";
import { VaultProfileRpcGroup } from "./vault-profiles.ts";
import { VaultReferenceRpcGroup } from "./vault-references.ts";
import { VaultSshRpcGroup } from "./vault-ssh.ts";
import { VaultBrokerRpcGroup } from "./vault-brokers.ts";
import { VaultAccessRpcGroup } from "./vault-access.ts";
import { VaultCoreRpcGroup } from "./vault-core.ts";
import { SitesRpcGroup } from "./sites.ts";
import { ProjectLibraryRpcGroup, LIBRARY_WS_METHODS } from "./project-library.ts";
import { ProjectLibraryHealthRpcGroup } from "./project-library-health.ts";
import { LibrarySearchRpcGroup } from "./project-library-search.ts";
import { ProjectLibraryTimelineRpcGroup } from "./project-library-timeline.ts";
import { ProjectLibraryBriefRpcGroup } from "./project-library-brief.ts";
import { ProjectLibraryReadinessRpcGroup } from "./project-library-readiness.ts";
import { ProjectLibraryBriefSuggestionRpcGroup } from "./project-library-brief-suggestions.ts";
import { ProjectCheckoutRpcGroup } from "./project-checkout.ts";
import { ComputerNamingRpcGroup } from "./computer-naming.ts";
import { GitHubHostSetupRpcGroup, GITHUB_HOST_SETUP_WS_METHODS } from "./github-host-setup.ts";
import { WorkspaceHandoffRpcGroup } from "./workspace-handoff.ts";
import { MiniOffloadRpcGroup } from "./mini-offload.ts";
import { PcbPreviewRpcGroup, PCB_PREVIEW_WS_METHODS } from "./pcb-preview.ts";
import { ModelPreview3dRpcGroup, MODEL_PREVIEW_3D_WS_METHODS } from "./model-preview-3d.ts";
import { ProjectLifecycleRpcGroup, PROJECT_LIFECYCLE_WS_METHODS } from "./project-lifecycle.ts";
import {
  AppleBuildToolingRpcGroup,
  APPLE_BUILD_TOOLING_WS_METHODS,
} from "./apple-build-tooling.ts";
import { DeviceQaRpcGroup, DEVICE_QA_WS_METHODS } from "./device-qa.ts";
import { CodeGraphRpcGroup, CODE_GRAPH_WS_METHODS } from "./code-graph.ts";
import { PreviewLinksRpcGroup, PREVIEW_LINKS_WS_METHODS } from "./preview-links.ts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { WsRpcGroup } from "../rpc.ts";
import { SWITCHBOARD_WS_METHODS, SwitchboardRpcGroup } from "./switchboard.ts";

/** Fork RPC tags. Every tag is `loom.<slug>.<verb>`; packets append theirs. */
export const FORK_WS_METHODS = {
  coreInfo: "loom.core.info",
  ...SWITCHBOARD_WS_METHODS,
} as const;

export const LoomCoreInfo = Schema.Struct({
  features: Schema.Array(Schema.String),
  serverVersion: Schema.String,
});
export type LoomCoreInfo = typeof LoomCoreInfo.Type;

const LoomCoreInfoRpc = Rpc.make(FORK_WS_METHODS.coreInfo, {
  payload: Schema.Struct({}),
  success: LoomCoreInfo,
  error: EnvironmentAuthorizationError,
});

/** Every fork RPC. Packets merge their own group here, one line each. */
export const ForkRpcGroup = RpcGroup.make(LoomCoreInfoRpc).merge(
  VaultGitHubRpcGroup,
  VaultProfileRpcGroup,
  VaultReferenceRpcGroup,
  VaultSshRpcGroup,
  VaultCoreRpcGroup,
  VaultBrokerRpcGroup,
  VaultAccessRpcGroup,
  SitesRpcGroup,
  ProjectLibraryRpcGroup,
  ProjectLibraryHealthRpcGroup,
  LibrarySearchRpcGroup,
  ProjectLibraryTimelineRpcGroup,
  ProjectLibraryBriefRpcGroup,
  ProjectLibraryReadinessRpcGroup,
  ProjectLibraryBriefSuggestionRpcGroup,
  ProjectCheckoutRpcGroup,
  ComputerNamingRpcGroup,
  MiniOffloadRpcGroup,
  SwitchboardRpcGroup,
  ModelPreview3dRpcGroup,
  PcbPreviewRpcGroup,
  ProjectLifecycleRpcGroup,
  AppleBuildToolingRpcGroup,
  DeviceQaRpcGroup,
  CodeGraphRpcGroup,
  WorkspaceHandoffRpcGroup,
  GitHubHostSetupRpcGroup,
  PreviewLinksRpcGroup,
);
export type ForkRpcMethod = RpcGroup.Rpcs<typeof ForkRpcGroup>["_tag"];

/** Served by the server and used by every client in place of WsRpcGroup. */
export const LoomWsRpcGroup = WsRpcGroup.merge(ForkRpcGroup);

/**
 * Fork streaming tags, added to the client's stream unions
 * (packages/client-runtime/src/rpc/client.ts, fork: ext-core). A streaming fork
 * method missing here would be typed as unary.
 */
export type ForkSubscriptionRpcTag =
  | typeof LIBRARY_WS_METHODS.subscribeRefreshes
  | typeof GITHUB_HOST_SETUP_WS_METHODS.watch
  | typeof PCB_PREVIEW_WS_METHODS.workspaceUpdates
  | typeof PCB_PREVIEW_WS_METHODS.panelEvents
  | typeof PCB_PREVIEW_WS_METHODS.editorEvents
  | typeof PCB_PREVIEW_WS_METHODS.checkEvents
  | typeof PCB_PREVIEW_WS_METHODS.turnDesignEvents
  | typeof PCB_PREVIEW_WS_METHODS.watch
  | typeof MODEL_PREVIEW_3D_WS_METHODS.panelEvents
  | typeof MODEL_PREVIEW_3D_WS_METHODS.editorEvents
  | typeof MODEL_PREVIEW_3D_WS_METHODS.turnModelEvents
  | typeof MODEL_PREVIEW_3D_WS_METHODS.watch
  | typeof MODEL_PREVIEW_3D_WS_METHODS.workspace
  | typeof PROJECT_LIFECYCLE_WS_METHODS.watch
  | typeof APPLE_BUILD_TOOLING_WS_METHODS.watchRuns
  | typeof DEVICE_QA_WS_METHODS.watchRuns
  | typeof DEVICE_QA_WS_METHODS.watchEvidence
  | typeof CODE_GRAPH_WS_METHODS.subscribeStatus
  | typeof PREVIEW_LINKS_WS_METHODS.watch;
export type ForkStreamCommandRpcTag =
  | typeof APPLE_BUILD_TOOLING_WS_METHODS.tailLog
  | typeof DEVICE_QA_WS_METHODS.runEvents;
