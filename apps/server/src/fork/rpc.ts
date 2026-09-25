import { FORK_WS_METHODS, ForkRpcGroup } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

import packageJson from "../../package.json" with { type: "json" };
import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import { LOOM_SERVER_FEATURES } from "./features.ts";
import { makeForkRpcAuth } from "./rpcAuthorization.ts";

/** Fork RPC handlers for one connection, merged next to makeWsRpcLayer (ws.ts, fork: ext-core). */
export const makeForkRpcLayer = (session: AuthenticatedSession) =>
  ForkRpcGroup.toLayer(
    Effect.gen(function* () {
      const auth = makeForkRpcAuth(session);
      return ForkRpcGroup.of({
        [FORK_WS_METHODS.coreInfo]: () =>
          auth.effect(
            FORK_WS_METHODS.coreInfo,
            Effect.succeed({ features: LOOM_SERVER_FEATURES, serverVersion: packageJson.version }),
          ),
        // ...(yield* makeSnippetsRpcHandlers(auth)),
      });
    }),
  );
