import { LoomWsRpcGroup } from "@t3tools/contracts/fork"; // fork: ext-core
import * as Effect from "effect/Effect";
import { RpcClient } from "effect/rpc";

export const makeWsRpcProtocolClient = RpcClient.make(LoomWsRpcGroup); // fork: ext-core
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;

// Pings go out every 5 seconds, and a server busy for a few seconds stops
// answering them. Allow 15 seconds without any frame before dropping the socket.
export const PING_TIMEOUT = "15 seconds";
