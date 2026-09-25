import { WsRpcGroup } from "@t3tools/contracts";
import { ForkRpcGroup } from "@t3tools/contracts/fork";
import { describe, expect, it } from "@effect/vitest";

import { FORK_RPC_REQUIRED_SCOPES } from "./rpcAuthorization.ts";

const forkTags = [...ForkRpcGroup.requests.keys()];

describe("fork RPC authorization", () => {
  it("declares exactly one scope for every fork RPC", () => {
    expect(new Set(Object.keys(FORK_RPC_REQUIRED_SCOPES))).toEqual(new Set(forkTags));
  });

  it("never reuses an upstream tag, which RpcGroup.merge would silently replace", () => {
    const upstreamTags = new Set(WsRpcGroup.requests.keys());
    expect(forkTags.filter((tag) => upstreamTags.has(tag))).toEqual([]);
  });

  it("prefixes every fork tag with loom.", () => {
    expect(forkTags.filter((tag) => !tag.startsWith("loom."))).toEqual([]);
  });
});
