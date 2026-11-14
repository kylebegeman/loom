import { RELEASE_INDEX_WS_METHODS as R } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { LoomReleaseSource } from "./LoomReleaseSource.ts";

export const makeReleaseIndexRpcHandlers = Effect.fn("LoomReleaseSource.makeRpcHandlers")(
  function* (auth: ForkRpcAuth) {
    const source = yield* LoomReleaseSource;
    return { [R.index]: () => auth.effect(R.index, source.index) };
  },
);
