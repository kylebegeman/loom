import {
  PROJECT_PROFILES_WS_METHODS as PP,
  type ProjectProfileTarget,
  type ProjectProfileUpdate,
  type ProjectProfilesSettings,
  type VarlockCommandInput,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { ProjectProfileService } from "./ProjectProfileService.ts";
export const makeProjectProfilesRpcHandlers = Effect.fn("ProjectProfiles.makeRpcHandlers")(
  function* (auth: ForkRpcAuth) {
    const service = yield* ProjectProfileService;
    return {
      [PP.get]: (input: { projectId: ProjectId }) =>
        auth.effect(PP.get, service.get(input.projectId)),
      [PP.update]: (input: ProjectProfileUpdate) => auth.effect(PP.update, service.update(input)),
      [PP.reset]: (input: { projectId: ProjectId }) =>
        auth.effect(PP.reset, service.reset(input.projectId)),
      [PP.envReport]: (input: ProjectProfileTarget) =>
        auth.effect(PP.envReport, service.envReport(input)),
      [PP.varlockValidate]: (input: ProjectProfileTarget) =>
        auth.effect(PP.varlockValidate, service.varlockValidate(input)),
      [PP.varlockCommand]: (input: VarlockCommandInput) =>
        auth.effect(PP.varlockCommand, service.varlockCommand(input)),
      [PP.budgetStatus]: (input: ProjectProfileTarget) =>
        auth.effect(PP.budgetStatus, service.budgetStatus(input)),
      [PP.getSettings]: () => auth.effect(PP.getSettings, service.getSettings),
      [PP.updateSettings]: (input: ProjectProfilesSettings) =>
        auth.effect(PP.updateSettings, service.updateSettings(input)),
    };
  },
);
