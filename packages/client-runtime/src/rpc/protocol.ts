import { LoomWsRpcGroup } from "@t3tools/contracts/fork"; // fork: ext-core
import * as Effect from "effect/Effect";
import { RpcClient } from "effect/unstable/rpc";

export const makeWsRpcProtocolClient = RpcClient.make(LoomWsRpcGroup); // fork: ext-core
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;
