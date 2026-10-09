import {
  APPLE_BUILD_TOOLING_WS_METHODS as A,
  type AppleBuildSettingsPatch,
  type AppleContainer,
  type AppleRunRequest,
  type AppleWorkspaceRef,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { AppleBuildService } from "./AppleBuildService.ts";

export const makeAppleBuildToolingRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* AppleBuildService;
    return {
      [A.status]: (input: AppleWorkspaceRef) => auth.effect(A.status, service.status(input)),
      [A.inspect]: (input: {
        workspace: AppleWorkspaceRef;
        container: AppleContainer;
        scheme?: string | undefined;
        refresh?: boolean | undefined;
      }) => auth.effect(A.inspect, service.inspect(input)),
      [A.destinations]: () => auth.effect(A.destinations, service.destinations()),
      [A.xcodegen]: (input: { workspace: AppleWorkspaceRef; spec: string }) =>
        auth.effect(A.xcodegen, service.xcodegen(input)),
      [A.readiness]: (input: {
        workspace: AppleWorkspaceRef;
        container: AppleContainer;
        scheme: string;
      }) => auth.effect(A.readiness, service.readiness(input)),
      [A.start]: (input: AppleRunRequest) => auth.effect(A.start, service.start(input, "user")),
      [A.cancel]: (input: { runId: string }) => auth.effect(A.cancel, service.cancel(input.runId)),
      [A.getRun]: (input: { runId: string; includeLogTail?: boolean | undefined }) =>
        auth.effect(A.getRun, service.getRun(input.runId, input.includeLogTail ?? false)),
      [A.watchRuns]: (input: AppleWorkspaceRef) =>
        auth.stream(A.watchRuns, service.watchRuns(input)),
      [A.tailLog]: (input: { runId: string; fromOffset: number }) =>
        auth.stream(A.tailLog, service.tailLog(input.runId, input.fromOffset)),
      [A.getSettings]: () => auth.effect(A.getSettings, service.getSettings),
      [A.updateSettings]: (input: AppleBuildSettingsPatch) =>
        auth.effect(A.updateSettings, service.updateSettings(input)),
      [A.clearHistory]: (input: {
        projectId?: ProjectId | undefined;
        includeDerivedData?: boolean | undefined;
      }) => auth.effect(A.clearHistory, service.clearHistory(input)),
      [A.openResultBundle]: (input: { runId: string }) =>
        auth.effect(A.openResultBundle, service.openResultBundle(input.runId)),
    };
  });
