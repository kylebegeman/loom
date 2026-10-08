import { PcbPreviewRpcGroup, PCB_PREVIEW_WS_METHODS } from "./pcb-preview.ts";
import { ModelPreview3dRpcGroup, MODEL_PREVIEW_3D_WS_METHODS } from "./model-preview-3d.ts";
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
  SwitchboardRpcGroup,
  ModelPreview3dRpcGroup,
  PcbPreviewRpcGroup,
);
export type ForkRpcMethod = RpcGroup.Rpcs<typeof ForkRpcGroup>["_tag"];

/** Served by the server and used by every client in place of WsRpcGroup. */
export const LoomWsRpcGroup = WsRpcGroup.merge(ForkRpcGroup);

/**
 * Fork streaming tags, added to the client's stream unions
 * (packages/client-runtime/src/rpc/client.ts, fork: ext-core). A streaming fork
 * method missing here would be typed as unary. Replace `never` with the first tag.
 */
export type ForkSubscriptionRpcTag =
  | typeof PCB_PREVIEW_WS_METHODS.workspaceUpdates
  | typeof PCB_PREVIEW_WS_METHODS.panelEvents
  | typeof PCB_PREVIEW_WS_METHODS.editorEvents
  | typeof PCB_PREVIEW_WS_METHODS.watch
  | typeof MODEL_PREVIEW_3D_WS_METHODS.panelEvents
  | typeof MODEL_PREVIEW_3D_WS_METHODS.editorEvents
  | typeof MODEL_PREVIEW_3D_WS_METHODS.watch
  | typeof MODEL_PREVIEW_3D_WS_METHODS.workspace;
export type ForkStreamCommandRpcTag = never;
