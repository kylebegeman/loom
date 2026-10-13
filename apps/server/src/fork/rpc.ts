import { makeProjectCheckoutRpcHandlers } from "./project-checkout/rpc.ts";
import { COMPUTER_NAMING_WS_METHODS as N } from "@t3tools/contracts/fork";
import * as ComputerNaming from "./computer-naming/ComputerNaming.ts";
import { GITHUB_HOST_SETUP_WS_METHODS as GH } from "@t3tools/contracts/fork";
import * as GitHubSetupFlow from "../sourceControl/GitHubSetupFlow.ts";
import { makeWorkspaceHandoffRpcHandlers } from "./workspace-handoff/rpc.ts";
import { makeMiniOffloadRpcHandlers } from "./mini-offload/rpc.ts";
import { makePcbPreviewRpcHandlers } from "./pcb-preview/rpc.ts";
import { makeModelPreviewRpcHandlers } from "./model-preview-3d/rpc.ts";
import { makeProjectLifecycleRpcHandlers } from "./project-lifecycle/rpc.ts";
import { makeAppleBuildToolingRpcHandlers } from "./apple-build-tooling/rpc.ts";
import { makeDeviceQaRpcHandlers } from "./device-qa/rpc.ts";
import { makeCodeGraphRpcHandlers } from "./code-graph/rpc.ts";
import { withForkRuntime } from "./ForkRuntime.ts";
import { FORK_WS_METHODS, ForkRpcGroup } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

import packageJson from "../../package.json" with { type: "json" };
import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import { LOOM_SERVER_FEATURES } from "./features.ts";
import { makeForkRpcAuth } from "./rpcAuthorization.ts";
import { readSwitchboardLimits } from "./switchboard/limits.ts";

/** Fork RPC handlers for one connection, merged next to makeWsRpcLayer (ws.ts, fork: ext-core). */
export const makeForkRpcLayer = (session: AuthenticatedSession) =>
  ForkRpcGroup.toLayer(
    Effect.gen(function* () {
      const auth = makeForkRpcAuth(session);
      const naming = yield* withForkRuntime(ComputerNaming.ComputerNaming);
      const github = yield* withForkRuntime(GitHubSetupFlow.GitHubSetupFlow);
      return ForkRpcGroup.of({
        [N.get]: () => auth.effect(N.get, naming.current),
        [N.rename]: (input) => auth.effect(N.rename, naming.rename(input)),
        [GH.start]: (input) => auth.effect(GH.start, github.start(input)),
        [GH.cancel]: (input) => auth.effect(GH.cancel, github.cancel(input)),
        [GH.watch]: () => auth.stream(GH.watch, github.changes),
        [FORK_WS_METHODS.coreInfo]: () =>
          auth.effect(
            FORK_WS_METHODS.coreInfo,
            Effect.succeed({ features: LOOM_SERVER_FEATURES, serverVersion: packageJson.version }),
          ),
        [FORK_WS_METHODS.limits]: () => auth.effect(FORK_WS_METHODS.limits, readSwitchboardLimits),
        ...(yield* withForkRuntime(makeProjectCheckoutRpcHandlers(auth))),
        ...(yield* withForkRuntime(makeMiniOffloadRpcHandlers(auth))),
        ...(yield* withForkRuntime(makePcbPreviewRpcHandlers(auth))),
        ...(yield* withForkRuntime(makeModelPreviewRpcHandlers(auth))),
        ...(yield* withForkRuntime(makeProjectLifecycleRpcHandlers(auth))),
        ...(yield* withForkRuntime(makeWorkspaceHandoffRpcHandlers(auth))),
        ...(yield* withForkRuntime(makeAppleBuildToolingRpcHandlers(auth))),
        ...(yield* withForkRuntime(makeDeviceQaRpcHandlers(auth))),
        ...(yield* withForkRuntime(makeCodeGraphRpcHandlers(auth))),
      });
    }),
  );
